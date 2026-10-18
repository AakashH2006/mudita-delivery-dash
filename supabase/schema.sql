-- ===========================================================
-- Mudita Delivery Dash - shared leaderboard
--
-- Run this once in the Supabase SQL editor.
--
-- Shape of the thing:
--   * Nobody plays until you approve them. Signing up only gets a
--     player onto a waiting list; profiles.approved is what lets them
--     submit a score, and only an admin can set it.
--   * Each board keeps the top ten PLAYERS, not the top ten runs - one
--     row per player per board - and anything past tenth is deleted.
--   * There are two boards per difficulty: 'overall' and 'full' (the
--     100% cargo board). They are pruned separately on purpose. Pruning
--     to the top ten overall would delete the clean runs the full-load
--     board exists to show, which is exactly the bug the local version
--     had before it was given its own store.
-- ===========================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null unique
             check (char_length(username) between 2 and 14),
  approved   boolean not null default false,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.profiles.approved is
  'Set by an admin. Until this is true the player can sign in but cannot submit a score.';

-- ---------- scores ----------
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  mode        text not null check (mode in ('easy','hard')),
  board       text not null check (board in ('overall','full')),
  time_s      numeric(5,2) not null,
  cargo       smallint not null check (cargo between 0 and 100),
  stunt_score integer not null default 0 check (stunt_score >= 0),
  created_at  timestamptz not null default now(),

  -- one row per player per board, so the board lists ten PLAYERS
  unique (user_id, mode, board),

  -- the full-load board only takes a whole load
  constraint full_board_is_full check (board <> 'full' or cargo = 100),

  -- a run that beat the clock, or it would not have been saved
  constraint within_the_clock check (time_s <= 40.00),

  -- Physically impossible times, rejected. The fastest the tempo can
  -- travel is its airborne ceiling, 209 km/h (58 m/s); covering the
  -- straight line between the gates at that speed takes 22.2 s on easy
  -- and 25.2 s on hard, and that already pretends you accelerate
  -- instantly, stay airborne the whole way and pass through buildings.
  --
  -- The floors sit well under even that, because the only thing they
  -- need to catch is an obviously forged time, and the cost of setting
  -- them too high is throwing out a real player's run. Cutting corners
  -- and ignoring the suggested route stay entirely legal.
  constraint not_faster_than_physics check (
    (mode = 'easy' and time_s >= 20.00) or
    (mode = 'hard' and time_s >= 23.00)
  )
);

create index if not exists scores_board_time_idx
  on public.scores (mode, board, time_s, created_at);

-- ---------- who am i ----------
-- These exist as SECURITY DEFINER functions rather than inline EXISTS
-- clauses because a policy on profiles that reads profiles recurses.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$fn$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select p.approved from public.profiles p where p.id = auth.uid()), false);
$fn$;

-- ---------- a profile appears with the account ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      'player' || substr(replace(new.id::text, '-', ''), 1, 6)
    )
  )
  on conflict (id) do nothing;
  return new;
end; $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- players may rename themselves, nothing more ----------
-- RLS decides WHICH ROW you may touch, not which columns, so without
-- this a player could update their own row and simply set approved and
-- is_admin to true. That would hand every signup the run of the place.
--
-- auth.uid() is null when this runs from the SQL editor or with the
-- service key, which is how the first admin gets made in the first place.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.approved is distinct from old.approved
     or new.is_admin is distinct from old.is_admin then
    raise exception 'only an admin can change approval or admin rights';
  end if;
  return new;
end; $fn$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------- keep only the top ten ----------
create or replace function public.prune_scores()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.scores s
  where s.mode = new.mode
    and s.board = new.board
    and s.id not in (
      select k.id from public.scores k
      where k.mode = new.mode and k.board = new.board
      order by k.time_s asc, k.created_at asc
      limit 10
    );
  return null;
end; $fn$;

drop trigger if exists scores_prune on public.scores;
create trigger scores_prune
  after insert or update on public.scores
  for each row execute function public.prune_scores();

-- ---------- submitting a run ----------
-- One call writes both boards. Done server-side so the rules cannot be
-- skipped by a client that simply chooses not to run them.
create or replace function public.submit_score(
  p_mode  text,
  p_time  numeric,
  p_cargo integer,
  p_stunt integer default 0
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_approved() then
    raise exception 'this account has not been approved to play yet';
  end if;

  insert into public.scores (user_id, mode, board, time_s, cargo, stunt_score)
  values (uid, p_mode, 'overall', p_time, p_cargo, p_stunt)
  on conflict (user_id, mode, board) do update
    set time_s = excluded.time_s,
        cargo = excluded.cargo,
        stunt_score = excluded.stunt_score,
        created_at = now()
    where excluded.time_s < scores.time_s;

  if p_cargo >= 100 then
    insert into public.scores (user_id, mode, board, time_s, cargo, stunt_score)
    values (uid, p_mode, 'full', p_time, 100, p_stunt)
    on conflict (user_id, mode, board) do update
      set time_s = excluded.time_s,
          stunt_score = excluded.stunt_score,
          created_at = now()
      where excluded.time_s < scores.time_s;
  end if;
end; $fn$;

-- ---------- what the game reads ----------
create or replace view public.leaderboard
with (security_invoker = true) as
  select s.mode, s.board, p.username, s.time_s, s.cargo, s.stunt_score, s.created_at
  from public.scores s
  join public.profiles p on p.id = s.user_id
  order by s.mode, s.board, s.time_s asc, s.created_at asc;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;

-- profiles
drop policy if exists profiles_readable on public.profiles;
create policy profiles_readable on public.profiles
  for select using (true);

drop policy if exists profiles_update_own_name on public.profiles;
create policy profiles_update_own_name on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- scores
drop policy if exists scores_readable on public.scores;
create policy scores_readable on public.scores
  for select using (true);

-- Writes go through submit_score(), which is SECURITY DEFINER, so no
-- insert or update policy is granted to players here. Without one they
-- cannot write a row of their own devising, and in particular cannot
-- touch anyone else's.
drop policy if exists scores_admin_delete on public.scores;
create policy scores_admin_delete on public.scores
  for delete using (public.is_admin());

-- ---------- grants ----------
revoke all on public.scores   from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.scores      to anon, authenticated;
grant select on public.profiles    to anon, authenticated;
grant update on public.profiles    to authenticated;
grant delete on public.scores      to authenticated;   -- gated by policy to admins
grant select on public.leaderboard to anon, authenticated;
grant execute on function public.submit_score(text, numeric, integer, integer) to authenticated;
grant execute on function public.is_admin()    to anon, authenticated;
grant execute on function public.is_approved() to anon, authenticated;
