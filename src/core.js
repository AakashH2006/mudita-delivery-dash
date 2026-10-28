/* ===========================================================
   core.js - namespace, math helpers, input (keyboard + gamepad)
   =========================================================== */
window.MUD = window.MUD || {};

(function (M) {
  'use strict';

  /* ---------------- math ---------------- */
  var U = M.util = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    /* framerate-independent exponential approach */
    damp: function (a, b, rate, dt) { return b + (a - b) * Math.exp(-rate * dt); },
    rnd: function (a, b) { return a + Math.random() * (b - a); },
    rndInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    /* deterministic pseudo-random so the city is identical every run */
    seeded: function (seed) {
      var s = seed >>> 0;
      return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    },
    /* shortest signed angle from a to b */
    angleDelta: function (a, b) {
      var d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    fmtTime: function (t) {
      if (t < 0) t = 0;
      var s = Math.floor(t);
      var cs = Math.floor((t - s) * 100);
      return (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
    }
  };

  /* ---------------- input ---------------- */
  var Input = M.Input = {
    keys: Object.create(null),
    pressed: Object.create(null),   /* edge-triggered, cleared each frame */
    pad: null,
    padWasDown: Object.create(null),
    enabled: true,

    init: function () {
      var self = this;
      window.addEventListener('keydown', function (e) {
        /* let the leaderboard name field behave like a normal input */
        if (e.target && e.target.tagName === 'INPUT') return;
        var c = e.code;
        if (!self.keys[c]) self.pressed[c] = true;
        self.keys[c] = true;
        if (SWALLOW[c]) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
      window.addEventListener('blur', function () { self.keys = Object.create(null); });
      window.addEventListener('gamepadconnected', function () { self.pad = true; });
    },

    /* keys whose default browser action would get in the way */
    down: function (code) { return !!this.keys[code]; },
    justPressed: function (code) { return !!this.pressed[code]; },
    endFrame: function () { this.pressed = Object.create(null); },

    gamepad: function () {
      if (!navigator.getGamepads) return null;
      var pads = navigator.getGamepads();
      for (var i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) return pads[i];
      }
      return null;
    },

    /* Combined control state. Keyboard and gamepad are additive -
       whichever gives the stronger signal wins. */
    read: function () {
      var s = {
        throttle: 0,    /* 0..1  */
        brake: 0,       /* 0..1  (also reverse) */
        steer: 0,       /* -1 left .. +1 right */
        boost: false,
        handbrake: false,
        pitch: 0,       /* air: -1 nose down .. +1 nose up */
        roll: 0         /* air: -1 left .. +1 right */
      };
      if (!this.enabled) return s;

      var k = this.keys;
      if (k.KeyW || k.ArrowUp) s.throttle = 1;
      if (k.KeyS || k.ArrowDown) s.brake = 1;
      if (k.KeyA || k.ArrowLeft) s.steer -= 1;
      if (k.KeyD || k.ArrowRight) s.steer += 1;
      if (k.ShiftLeft || k.ShiftRight) s.boost = true;
      if (k.Space) s.handbrake = true;

      /* in the air the same sticks pitch and roll the truck */
      s.pitch = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
      s.roll = s.steer;

      var p = this.gamepad();
      if (p) {
        this.pad = true;
        var ax = p.axes.length > 0 ? p.axes[0] : 0;
        if (Math.abs(ax) > 0.14) {
          var v = (Math.abs(ax) - 0.14) / 0.86 * (ax < 0 ? -1 : 1);
          if (Math.abs(v) > Math.abs(s.steer)) s.steer = v;
        }
        var ay = p.axes.length > 1 ? p.axes[1] : 0;
        if (Math.abs(ay) > 0.18 && Math.abs(ay) > Math.abs(s.pitch)) s.pitch = ay;
        if (Math.abs(ax) > Math.abs(s.roll)) s.roll = s.steer;

        var rt = btnVal(p, 7), lt = btnVal(p, 6);
        if (rt > s.throttle) s.throttle = rt;
        if (lt > s.brake) s.brake = lt;
        if (btnDown(p, 0) || btnDown(p, 5)) s.boost = true;     /* A / RB */
        if (btnDown(p, 2) || btnDown(p, 4)) s.handbrake = true; /* X / LB */
        if (btnDown(p, 9)) this.pressed.Enter = true;           /* Start  */
        if (btnDown(p, 1) && !this.padWasDown.b) this.pressed.KeyR = true; /* B */
        this.padWasDown.b = btnDown(p, 1);

        /* d-pad left/right works the radio, same as [ and ] */
        if (btnDown(p, 14) && !this.padWasDown.dl) this.pressed.BracketLeft = true;
        this.padWasDown.dl = btnDown(p, 14);
        if (btnDown(p, 15) && !this.padWasDown.dr) this.pressed.BracketRight = true;
        this.padWasDown.dr = btnDown(p, 15);
      }

      s.steer = U.clamp(s.steer, -1, 1);
      return s;
    },

    hasPad: function () { return !!this.gamepad(); }
  };

  var SWALLOW = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Tab: 1
  };

  function btnVal(p, i) {
    var b = p.buttons[i];
    if (!b) return 0;
    return typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : b;
  }
  function btnDown(p, i) {
    var b = p.buttons[i];
    if (!b) return false;
    return typeof b === 'object' ? b.pressed : b > 0.5;
  }

  /* control list rendered on the menu */
  M.CONTROLS = [
    { key: 'W / Up',     what: 'Accelerate' },
    { key: 'S / Down',   what: 'Brake / Reverse' },
    { key: 'A D',        what: 'Steer' },
    { key: 'Shift',      what: 'Boost' },
    { key: 'Space',      what: 'Drift' },
    { key: 'W A S D',    what: 'Flip in air' },
    { key: 'R',          what: 'Restart' },
    { key: 'Esc',        what: 'Menu' },
    { key: '[  ]',       what: 'Radio: prev / next' },
    { key: 'M',          what: 'Mute radio' }
  ];
  M.CONTROLS_PAD = [
    { key: 'RT',        what: 'Accelerate' },
    { key: 'LT',        what: 'Brake' },
    { key: 'L-Stick',   what: 'Steer / Air' },
    { key: 'A  or  RB', what: 'Boost' },
    { key: 'X  or  LB', what: 'Drift' },
    { key: 'B',         what: 'Restart' },
    { key: 'D-Pad',     what: 'Radio: prev / next' }
  ];

})(window.MUD);
