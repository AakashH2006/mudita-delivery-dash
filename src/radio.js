/* ===========================================================
   radio.js - the in-cab radio.

   The odd one out in this project: everything else you hear is
   synthesised in audio.js, but a radio playing a square wave is
   not a radio. So this one plays real files. Drop them into
   assets/radio/ and list them in TRACKS below.

   Two <audio> elements leapfrog each other, which is what buys
   the crossfade - the next track is already up and rising before
   the last one is gone, so the music never actually stops.

   Ship it with TRACKS empty and nothing breaks: the radio simply
   has nothing to play, the widget says so, and no other part of
   the game notices the difference.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;

  /* ----------------------------------------------------------
     THE PLAYLIST

     One line per file, in the order they go to air:

       { file: '01-track.mp3', title: 'Golden Hour', artist: 'Someone' }

     `file` is relative to assets/radio/. Anything the browser can
     decode works - .mp3 and .m4a play everywhere, .ogg and .webm
     everywhere except Safari. `artist` is optional.

     A file that will not load is dropped from the rotation rather
     than stalling it, so a typo here costs you one track and not
     the radio.
     ---------------------------------------------------------- */
  var TRACKS = [
  ];

  var DIR = 'assets/radio/';
  var FADE = 2.2;          /* crossfade / fade-in / fade-out, seconds */
  var VOLUME = 0.75;       /* before the master gain in audio.js */

  function $(id) { return document.getElementById(id); }

  function makeDeck() {
    var a = new Audio();
    a.preload = 'none';
    a.loop = false;
    return { audio: a, node: null, gain: null, fade: 0, live: false, file: '' };
  }

  var R = M.Radio = {
    tracks: TRACKS,
    decks: [],
    slot: 0,              /* which deck is on air */
    idx: -1,              /* index into tracks of what is on air */
    on: false,            /* switched on (as opposed to paused) */
    muted: false,
    volume: VOLUME,
    duck: 1, duckTo: 1, duckHold: 0,
    bad: 0,               /* consecutive files that refused to load */
    el: {},

    /* ======================================================= */
    init: function () {
      var self = this;
      var wrap = $('radio');
      if (!wrap) return;

      this.el = {
        wrap: wrap,
        title: $('rd-title'), sub: $('rd-sub'),
        prev: $('rd-prev'), play: $('rd-play'), next: $('rd-next'),
        mute: $('rd-mute')
      };

      this.decks = [makeDeck(), makeDeck()];
      this.decks.forEach(function (d) {
        d.audio.addEventListener('ended', function () {
          if (d.live) self.step(1);
        });
        d.audio.addEventListener('error', function () {
          if (d.live || d.fade > 0) self.failed();
        });
      });

      this.el.prev.onclick = function () { self.step(-1); };
      this.el.next.onclick = function () { self.step(1); };
      this.el.play.onclick = function () { self.toggle(); };
      this.el.mute.onclick = function () { self.setMuted(!self.muted); };

      /* a radio with nothing in it is a dead control, not a broken one */
      wrap.classList.toggle('empty', !this.tracks.length);
      this.render();
    },

    /* ----------------------------------------------------------
       The decks are hung off audio.js's music bus so the radio
       ducks and mutes on its own without touching the engine.
       It can only be done once the AudioContext exists, which is
       after the first gesture, so it happens on first play rather
       than at startup. If WebAudio is unavailable the deck falls
       back to the element's own volume and nothing else changes.
       ---------------------------------------------------------- */
    wire: function (deck) {
      if (deck.gain || !M.Audio.ready || !M.Audio.ctx) return;
      try {
        var ctx = M.Audio.ctx;
        deck.node = ctx.createMediaElementSource(deck.audio);
        deck.gain = ctx.createGain();
        deck.gain.gain.value = 0;
        deck.node.connect(deck.gain);
        deck.gain.connect(M.Audio.music || M.Audio.master || ctx.destination);
      } catch (e) {
        deck.node = null;
        deck.gain = null;
      }
    },

    level: function (deck) {
      return deck.fade * this.volume * this.duck * (this.muted ? 0 : 1);
    },

    applyGain: function (deck) {
      var v = U.clamp(this.level(deck), 0, 1);
      if (deck.gain) deck.gain.gain.value = v;
      else deck.audio.volume = v;
    },

    /* ======================================================= */

    /* Switch on, or pick up where the last track left off. */
    start: function () {
      if (!this.tracks.length) return;
      M.Audio.resume();
      if (this.on) return;
      if (this.idx < 0) this.playAt(0);
      else {
        var d = this.decks[this.slot];
        d.live = true;
        this.on = true;
        var p = d.audio.play();
        if (p && p['catch']) p['catch'](function () { /* needs a gesture */ });
        this.render();
      }
    },

    stop: function () {
      if (!this.on) return;
      this.on = false;
      this.decks[this.slot].live = false;   /* fades out, then pauses */
      this.render();
    },

    toggle: function () {
      if (!this.tracks.length) return;
      if (this.on) this.stop(); else this.start();
    },

    step: function (dir) {
      if (!this.tracks.length) return;
      M.Audio.resume();
      this.playAt(this.idx + dir);
    },

    /* Bring up the off-air deck on `n`, and let the on-air one go. */
    playAt: function (n, immediate) {
      var len = this.tracks.length;
      if (!len) return;
      n = ((n % len) + len) % len;

      var out = this.decks[this.slot];
      var into = this.decks[1 - this.slot];

      this.wire(into);
      var t = this.tracks[n];
      into.file = t.file;
      into.audio.src = DIR + t.file;
      into.audio.currentTime = 0;
      into.fade = immediate ? 1 : 0;
      into.live = true;
      this.applyGain(into);

      var p = into.audio.play();
      /* Blocked until the first gesture. That is not an error and the
         deck is left cued: the next start() picks it straight up. */
      if (p && p['catch']) p['catch'](function () { });

      out.live = false;
      this.slot = 1 - this.slot;
      this.idx = n;
      this.on = true;
      this.render();
    },

    /* A file that would not load. Drop it and move on, unless every
       track has now failed - then the radio goes quiet rather than
       spinning through a playlist of 404s. */
    failed: function () {
      this.bad++;
      if (this.bad >= this.tracks.length) {
        this.on = false;
        this.decks.forEach(function (d) { d.live = false; });
        this.el.wrap.classList.add('empty');
        this.render('Radio off', 'No track would load');
        return;
      }
      this.step(1);
    },

    setMuted: function (m) {
      this.muted = !!m;
      this.render();
    },

    /* Drop the music under something that needs to be heard - the
       countdown beeps, the finish fanfare - and bring it back up on
       its own afterwards. */
    duckFor: function (level, secs) {
      this.duckTo = level;
      this.duckHold = secs;
    },

    /* ======================================================= */
    /* driven from the game loop, so it stops when the tab does */
    update: function (dt) {
      if (!this.decks.length) return;

      if (this.duckHold > 0) {
        this.duckHold -= dt;
        if (this.duckHold <= 0) { this.duckHold = 0; this.duckTo = 1; }
      }
      /* down fast so the beep is never stepped on, back up slowly */
      this.duck = U.damp(this.duck, this.duckTo, this.duck > this.duckTo ? 16 : 2.4, dt);

      for (var i = 0; i < 2; i++) {
        var d = this.decks[i];
        var want = d.live ? 1 : 0;
        if (d.fade !== want) {
          var s = dt / FADE;
          d.fade = want > d.fade ? Math.min(want, d.fade + s) : Math.max(want, d.fade - s);
          if (d.fade === 0 && !d.audio.paused) d.audio.pause();
        }
        if (d.fade > 0 || d.gain) this.applyGain(d);
      }

      /* start the next one early, so it is already up when this ends */
      var live = this.decks[this.slot];
      if (this.on && live.live && live.audio.duration) {
        var left = live.audio.duration - live.audio.currentTime;
        if (left > 0 && left <= FADE) this.step(1);
      }
    },

    /* ======================================================= */
    render: function (title, sub) {
      var e = this.el;
      if (!e.wrap) return;

      if (title === undefined) {
        var t = this.idx >= 0 ? this.tracks[this.idx] : null;
        title = t ? t.title : (this.tracks.length ? 'Ready' : 'No tracks');
        sub = t ? (t.artist || 'Amhiti FM')
                : (this.tracks.length ? 'Press play' : 'Add music to assets/radio/');
      }
      if (e.title.textContent !== title) e.title.textContent = title;
      if (e.sub.textContent !== sub) e.sub.textContent = sub;

      e.wrap.classList.toggle('playing', this.on && !this.muted);
      e.wrap.classList.toggle('muted', this.muted);
      e.play.setAttribute('aria-label', this.on ? 'Pause radio' : 'Play radio');
      e.mute.setAttribute('aria-label', this.muted ? 'Unmute radio' : 'Mute radio');
    }
  };

})(window.MUD);
