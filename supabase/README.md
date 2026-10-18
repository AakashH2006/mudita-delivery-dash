# Shared leaderboard

`schema.sql` is the whole database. Run it once in the Supabase SQL editor
and the server side is done.

## Setting it up

1. Create a project at supabase.com. The free plan is plenty — the whole
   leaderboard is a few kilobytes.
2. Open **SQL Editor**, paste `schema.sql`, run it.
3. **Authentication → Providers → Email**: turn *Confirm email* off, unless
   you want every player waiting on an inbox at the event.
4. Sign up once from the game to create your own account, then make yourself
   the admin from the SQL editor:

   ```sql
   update public.profiles
      set is_admin = true, approved = true
    where username = 'AAKASH';
   ```

   `auth.uid()` is null in the SQL editor, which is deliberately allowed by
   the guard trigger — that is how the first admin gets made.

## Letting people play

Signing up is not the same as being allowed to play. A new account lands with
`approved = false` and cannot submit a score until you say so:

```sql
-- see who is waiting
select username, created_at from public.profiles
 where not approved order by created_at;

-- let someone in
update public.profiles set approved = true where username = 'SOMEBODY';
```

## After the event

You said you want the login gone afterwards. Two ways, depending on what you
want to keep:

```sql
-- open it to everyone who signs up, from now on
alter table public.profiles alter column approved set default true;
update public.profiles set approved = true;
```

Or freeze the board as a record of the event and stop taking new scores:

```sql
revoke execute on function public.submit_score(text, numeric, integer, integer)
  from authenticated;
```

Worth knowing: with the gate open, anyone can submit, and a browser game
cannot stop a determined person forging a time. The checks below raise the
bar; they do not make it impossible.

## What the database enforces

- **Only approved accounts can submit.** Checked inside `submit_score()`, so
  a client cannot skip it.
- **Ten players per board, not ten runs.** One row per player per board, and
  the prune trigger deletes anything past tenth.
- **The two boards are pruned separately.** `overall` and `full` each keep
  their own ten. Pruning to the overall top ten would delete the clean runs
  the full-load board exists to show.
- **Impossible times are rejected.** The truck tops out at 200 km/h, so the
  straight line between the gates cannot be covered in under 23.2 s on easy
  or 26.3 s on hard. The floors sit just below that, at 22 s and 25 s, and
  that leaves cutting corners and skipping the suggested route entirely
  legal — the floors only reject what the physics cannot produce.
- **Players cannot write scores directly.** No insert or update grant; the
  only way in is `submit_score()`.
- **Players cannot promote themselves.** Row-level security picks the row,
  not the columns, so a trigger stops anyone who is not an admin from
  changing `approved` or `is_admin`. Renaming yourself is still fine.
- **Only admins delete.**

## Tested

`schema.sql` was applied to a real Postgres 16 and exercised with 45 checks
covering signup, the approval gate, best-time-per-player, both prune paths,
every plausibility constraint, the view, and each privilege-escalation route
above. All pass. The escalation guard exists because the first version of
this schema failed that test — a player could approve themselves.

## Not done yet

The game does not talk to any of this. Wiring it up needs the project URL and
anon key, a login screen, and the boards reading from `public.leaderboard`
instead of `localStorage`. The anon key is safe to commit — it is a public
identifier, and access is controlled by the policies above.
