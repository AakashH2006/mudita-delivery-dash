# Mudita Delivery Dash

*A vibe coded game for Mudita, Dayananda Sagar College of Engineering.*

A browser arcade-driving game. A Mudita tempo leaves the **DSCE** gate loaded with
donation crates and has to reach the **orphanage** on the far side of the city in
under **40 seconds**, with the load still in one piece.

It runs at **golden hour**: the sun sits low and orange on the horizon, the sky
above it goes violet, and the city has its lights on. The key light is warm and
the sky bounce is cold, which is the whole reason an evening reads as an evening
instead of a beige noon — and it means the long shadows rake straight down the
streets you are driving.

No build step, no bundler, no binary assets — every texture is painted on a
`<canvas>` at load time. Double-click `index.html` and it runs.

---

## Playing

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake | `W` `S` or arrows | RT / LT |
| Steer | `A` `D` or arrows | left stick |
| Boost | `Shift` | A / cross |
| Handbrake (drift) | `Space` | B / circle |
| Air pitch / roll | `W` `S` / `A` `D` while airborne | stick |
| Restart | `R` | — |

**The clock is the whole game.** 40.00 s, counting down from the moment the
3-2-1 ends. Run it out and the delivery fails.

**Cargo integrity** starts at 100 %. Every solid hit and every bad landing
knocks a chunk off. Arrive below **50 %** and the donations are written off —
the run counts as failed even if you beat the clock.

And you can see it happen. The bed is loaded with five crates, and **every
15 % of the load you lose, one of them actually leaves** — thrown back over
the tailgate to bounce and cartwheel away up the road behind you. The top
crate goes first, then the pair by the tailgate, then the front pair, so by
25 % the bed is visibly stripped. A number ticking down on a panel is a
statistic; a crate tumbling in your mirror is the delivery coming apart.

**Boost** is earned, not given. Sustained drifts pay out, **nitro** floats over
the streets for you to drive through, and landing a stunt pays the most:

| Stunt | Trigger |
|---|---|
| **Flip** | ≥ 340° of pitch in the air |
| **Barrel Roll** | ≥ 340° of roll in the air |
| **Big Air** | ≥ 1.1 s of airtime |

**Arriving intact is worth something.** Getting the whole load across means
forty seconds through cross traffic without once getting it wrong, so it pays
out rather than just printing a different number on the same card:

| Arrival | Bonus | What happens |
|---|---|---|
| **100 % cargo** | +2,500 | gold card, **PERFECT DELIVERY** across the screen, a rising fanfare, and three seconds of gold confetti fired from a ring around the forecourt |
| **≥ 90 % cargo** | +1,000 | cyan card, **PRISTINE LOAD**, a shorter fanfare and a second helping of confetti |
| **≥ 50 % cargo** | — | the normal handover |

Nitro hangs about three metres up rather than being painted on the road, so
collecting it is a line you take rather than a stripe you happen to cross —
and the three strung out past every barrel-roll lip can only be had in flight.

**Badges ride on the world, not just the HUD.** A pill sits over the
orphanage the whole run with the live distance on it, and slides to the edge
of the screen with a pulsing marker when the drop-off is behind you — so the
direction home is never a thing you have to go looking for on the radar.
Kickers announce themselves about a block and a half out, in their own
livery, which makes taking one a decision you commit to early rather than
something that happens to you at 150 km/h.

Times, cargo % and stunt score are kept in a top-10 leaderboard in
`localStorage`, on this device only.

Under it sits a second board, **Full Load**, which only takes runs that
arrived with cargo integrity at 100%. It keeps its own store rather than
filtering the first one: a clean 34 s run would otherwise be pushed off a
shared top ten by four scrappy 30 s ones, and the thing the board exists to
celebrate would be the first thing to disappear. A full load also gets its
own shot at saving, so a careful slow run is never turned away for missing
the outright top ten.

---

## The city

A **9 × 9 open grid** of intersections, 152 m apart — a 1216 m square of
streets, 28 m of tarmac wide. Past the last junction the city gives way to
open country: fields, hedge lines and orchards running several hundred metres
out, so the grid ends in a landscape rather than at a border. There are **no
invisible walls** anywhere — drive out there if you like, it only costs you
the clock.

The DSCE gate is a block in from one corner and the orphanage a block in from
the far one, **1735 m apart by road** against a 1290 m straight line. The cyan
line on the tarmac and on the radar is the **suggested route**: it staircases
through the middle of town, it sticks to the streets, and it is *not* the
fastest way there.

The orphanage end is **not** a second arch. An arch has to be driven through,
which means lining up on it, and after a run spent cutting corners that is the
wrong note to end on — you should be able to arrive from any direction and
simply be there. So it is marked the way a landing site is: the ground painted
with a ringed, chevroned apron, a soft column of light standing over it so you
can pick it out over the rooftops, and nothing solid anywhere near it. Hand the
crates over and the column turns gold, a shockwave runs out across the
forecourt and a **DONATIONS DELIVERED** board rises out of the middle of it,
turned to face whichever way you came in. The result card waits a beat so you
actually see it happen.

The 64 city blocks come in six flavours, and most of them can be driven
through:

| Block | Count | Shortcut |
|---|---|---|
| **Courtyard** | 29 | four buildings with wide gaps between them, passable on both axes |
| **Solid tower** | 11 | none — go around |
| **Plaza** | 7 | stalls round the edge, paved and open across the diagonal |
| **Alley** | 6 | a single 13 m slot punched clean through |
| **Construction site** | 6 | dirt, scaffolding, material piles and a site hut |
| **Park** | 5 | grass, an off-centre fountain, trees round the rim — open in the middle |

**Ramps are everywhere, and every one of them is on a street.** 79 kickers are
scattered across the grid — about one street segment in two gets one, placed at
a different distance along the block each time and alternating sides, so there
is no long stretch of empty tarmac and no two setups that read the same.

Each one sits in the **outer lane, hard against the kerb**, which is where the
paint already marks a lane off. That is the whole geometry of the thing: the
deck is one lane wide, so taking a ramp is a line you commit to rather than
something the road funnels you into, and the two inner lanes stay clear for a
driver who wants no part of it. Neither gate has a kicker within 70 m, so
nothing launches you before you have read the clock.

| Kicker | Livery | What it does |
|---|---|---|
| **Stunt ramp** (53) | indigo deck, cyan chevrons and rail lights | straight launch — flip it yourself for the boost |
| **Barrel roll** (26) | magenta, and the deck visibly corkscrews | banks you over and throws you into a roll |

A barrel-roll kicker is an Asphalt one: the deck is flat at the foot and
banked right over at the lip, so it hands you the rotation instead of asking
you to start one from nothing in mid-air. The tempo leans with the deck the
whole way up it and is already half onto its side at the lip — the roll in the
air is the same motion carrying on, not a spin that starts from nothing — and
it is metered out to finish exactly one revolution later, eased at the end, so
you come down on your wheels. Fighting it on the roll key is what costs you,
not forgetting to use it. Take the deck end to end and the roll always has the
air it needs — the ramp drops you six and a half metres, which is most of a
second by itself. What it refuses is the scrappy entry: clip the foot or slide
off the side halfway up and you leave with the bank but no height to pay for
turning it, so the truck simply rights itself instead.

**Traffic runs the inner lanes.** 230 cars — saloons, hatchbacks, vans and
pickups, each with its own glasshouse, bumpers, lit lamps and wheels — hold the
two lanes either side of the centre line, leaving the kerb lanes to the ramps.
That is deliberate: a car driving through a ramp deck looks like a bug even
when it is only paint, and it means the lane with the stunts in it is the lane
with nothing coming. They lift off for anything filling the lane ahead and get
knocked aside if you barge one, so they can never pin you — but they cost cargo
and they will break your rhythm. Nothing spawns on the start line or in the
drop zone.

Cutting the corners is what buys you the time, and the 40 s window does not
leave enough of it to make the trip on the engine alone — the run is really a
question of whether you can keep the nitro meter fed. The grass makes you pay
for the distance a shortcut saves, and the suggested line costs the most cargo
of anything, because it runs you through every junction in town.

> The measured bot-run table that used to sit here was taken against the old
> 45 s / 40 % tuning and no longer describes the game. It needs re-running.

Off-road is slower but never fatal — grass and dirt cost grip and add drag,
paving and pavement barely cost anything:

| Surface | Grip | Extra drag |
|---|---|---|
| Road | 1.00 | — |
| Pavement | 0.96 | 0.13 |
| Plaza | 0.95 | 0.11 |
| Roof | 0.94 | 0.13 |
| Dirt | 0.84 | 0.40 |
| Grass | 0.77 | 0.64 |

---

## Code

```
index.html          CDN tag for three.js, canvas, HUD markup, overlays
styles/ui.css       rounded-pill design tokens + all UI layout
src/core.js         MUD namespace, math helpers, keyboard + Gamepad input
src/textures.js     every texture, painted procedurally on a canvas
src/world.js        grid city: streets, blocks, ramps, pads, GPS routing
src/vehicle.js      the tempo: drive, drift, boost, air control, stunts
src/audio.js        WebAudio engine, boost, impact and stunt sounds
src/hud.js          speed, boost arc, cargo, clock, stunt toasts
src/minimap.js      GTA-style circular radar, drawn in 2D
src/markers.js      DOM badges pinned to world positions (drop-off, ramps)
src/leaderboard.js  localStorage top 10 + full-load board
src/game.js         state machine, fixed-timestep loop, lighting, wiring
assets/             vehicle styling reference (not loaded by the game)
```

Everything hangs off one `window.MUD` global and loads as plain
`<script>` tags — no ES modules, because modules are blocked on `file://`.

**three.js is pinned to r148 on purpose.** r148 is the last release that ships a
non-module UMD build, and that build is the only reason the game runs by
double-clicking rather than needing a server. Bumping the version breaks
`file://` unless you also switch to serving the folder.

### Under the hood

- Physics is hand-rolled arcade kinematics on a fixed 1/120 s timestep with an
  accumulator — not a physics engine, because Asphalt-style handling is tuned
  feel rather than simulation.
- Collision is circle-vs-AABB against a spatial hash of building boxes.
  Clear the roof height and you pass straight over the top.
- The GPS is a breadth-first search over the 9 × 9 node grid, re-run a few times
  a second, so it re-routes the moment you leave the suggested line. Its
  tie-break is memoryless on purpose — anything that depended on how you
  arrived got reset on every rebuild and collapsed the route onto the rim.
- Traffic is kept out of the static collision hash and tested separately each
  frame, since it moves. A hit displaces the car, never the tempo: splitting
  the push between them deadlocks the pair at walking pace.
- Flat surfaces (tarmac, junctions, pavements, grass, paving, dirt) are merged
  into one mesh per material, which keeps the whole city at a few hundred draw
  calls.
- Anything built from a pile of small rigid parts — a ramp rig, the tempo
  itself — goes through `Batch`, which stamps every part into one buffer and
  returns one mesh per material. The tempo is about two hundred pieces and none
  of it is ever off screen; left as separate objects it was two hundred draw
  calls on every frame of the run, and merged it is thirty-six.
- Nitro and traffic are `InstancedMesh`, so 186 floating cells and 230 cars with
  eight detail layers each are ten draw calls between them.

### Credits

Vehicle styling is an original build from primitives; `assets/vehicle-reference.jpg`
is the look that was aimed at. No third-party logos, badges or model names are
reproduced anywhere in the game.
