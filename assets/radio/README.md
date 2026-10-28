# Radio tracks

Music files the in-game radio plays. This is the only folder under
`assets/` that is committed and deployed — everything else here is
build-time reference material and is ignored.

## Adding a track

1. Drop the file in this folder.
2. Add a line to `TRACKS` at the top of `src/radio.js`:

```js
var TRACKS = [
  { file: '01-golden-hour.mp3', title: 'Golden Hour', artist: 'Someone' },
  { file: '02-crate-depot.mp3', title: 'Crate Depot', artist: 'Someone' }
];
```

`file` is the filename only — `assets/radio/` is prepended for you.
`artist` is optional; leave it out and the radio shows "Amhiti FM".
The order here is the order they go to air.

There is no manifest to fetch, which is deliberate: the list lives in
the JS so the game still works opened straight off the filesystem.

## Formats

`.mp3` and `.m4a` play in every browser. `.ogg` and `.webm` play
everywhere except Safari, so avoid them unless you know your audience.

## Size

These files go into the git repo and are served on every page load.
Keep the whole folder under about 20 MB or the site gets slow to open
on a phone — that is roughly 5–6 tracks at 128 kbps, or 3–4 at 192.
Export at 128 kbps mono if you want more of them; it is a car radio
under an engine loop, nobody is listening for the top end.

## Licensing

Whatever goes in here is served publicly from the deployed site, so it
has to be music you are allowed to redistribute: your own, properly
licensed, or Creative Commons with the attribution the licence asks
for. Chart music is not fine just because the game is non-commercial.

If you use CC tracks, put the attribution line in the root `README.md`
alongside the credits.

## Nothing here yet

With `TRACKS` empty the radio shows "No tracks" and its buttons are
dead. Nothing else in the game changes — it is a missing station, not
a broken build.
