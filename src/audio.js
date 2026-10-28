/* ===========================================================
   audio.js - everything is synthesised with WebAudio, so there
   are still no files to ship. Starts on the first click/keypress
   because browsers block audio before a gesture.
   =========================================================== */
(function (M) {
  'use strict';

  var A = M.Audio = {
    ctx: null, ready: false, muted: false,
    master: null, music: null, engineOsc: null, engineGain: null, engineFilter: null,
    boostGain: null, boostSrc: null,

    init: function () {
      if (this.ready) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        var ctx = this.ctx = new AC();

        this.master = ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(ctx.destination);

        /* The radio hangs off its own bus. Everything else here is
           synthesised and short; the music is neither, so it needs a
           level that can be ducked under a beep without the engine
           dipping with it. radio.js connects its decks to this. */
        this.music = ctx.createGain();
        this.music.gain.value = 1;
        this.music.connect(this.master);

        /* --- engine: two detuned saws through a moving lowpass --- */
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 700;
        this.engineFilter.Q.value = 3;
        this.engineGain.connect(this.engineFilter);
        this.engineFilter.connect(this.master);

        this.engineOsc = [];
        [1, 1.005, 0.5].forEach(function (mult, i) {
          var o = ctx.createOscillator();
          o.type = i === 2 ? 'square' : 'sawtooth';
          o.frequency.value = 60 * mult;
          var g = ctx.createGain();
          g.gain.value = i === 2 ? 0.35 : 0.6;
          o.connect(g); g.connect(A.engineGain);
          o.start();
          A.engineOsc.push({ osc: o, mult: mult });
        });

        /* --- boost: filtered noise loop --- */
        var len = ctx.sampleRate * 2;
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        var src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
        this.boostGain = ctx.createGain();
        this.boostGain.gain.value = 0;
        src.connect(bp); bp.connect(this.boostGain); this.boostGain.connect(this.master);
        src.start();
        this.boostSrc = src;
        this.noiseBuf = buf;

        this.ready = true;
      } catch (e) { this.ready = false; }
    },

    resume: function () {
      if (!this.ready) this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    /* called every frame while driving */
    engine: function (speedKmh, throttle, boosting, airborne) {
      if (!this.ready || this.muted) return;
      var t = this.ctx.currentTime;
      var rpm = 55 + Math.min(speedKmh, 260) * 1.35 + throttle * 28;
      this.engineOsc.forEach(function (e) {
        e.osc.frequency.setTargetAtTime(rpm * e.mult, t, 0.08);
      });
      this.engineFilter.frequency.setTargetAtTime(
        420 + Math.min(speedKmh, 260) * 7 + (boosting ? 900 : 0), t, 0.1);
      this.engineGain.gain.setTargetAtTime(airborne ? 0.07 : 0.13, t, 0.12);
      this.boostGain.gain.setTargetAtTime(boosting ? 0.1 : 0, t, 0.07);
    },

    silence: function () {
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0, t, 0.1);
      this.boostGain.gain.setTargetAtTime(0, t, 0.1);
    },

    /* short synthesised one-shots */
    blip: function (freq, dur, type, vol) {
      if (!this.ready || this.muted) return;
      try {
        var ctx = this.ctx, t = ctx.currentTime;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'triangle';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { /* ignore */ }
    },

    thud: function (force) {
      if (!this.ready || this.muted) return;
      try {
        var ctx = this.ctx, t = ctx.currentTime;
        var s = ctx.createBufferSource();
        s.buffer = this.noiseBuf;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(90, t + 0.3);
        var g = ctx.createGain();
        var v = Math.min(0.45, 0.1 + force * 0.016);
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        s.connect(f); f.connect(g); g.connect(this.master);
        s.start(t); s.stop(t + 0.36);
      } catch (e) { /* ignore */ }
    },

    stunt: function () { this.blip(760, 0.1, 'square', 0.16); var a = this; setTimeout(function () { a.blip(1180, 0.16, 'square', 0.14); }, 85); },
    pad: function () { this.blip(520, 0.12, 'sawtooth', 0.1); },
    beep: function (go) { this.blip(go ? 1050 : 620, go ? 0.42 : 0.14, 'square', 0.2); },
    win: function () {
      var a = this;
      [0, 110, 220, 380].forEach(function (d, i) {
        setTimeout(function () { a.blip([620, 780, 930, 1240][i], 0.3, 'triangle', 0.17); }, d);
      });
    },
    lose: function () {
      var a = this;
      [0, 160, 340].forEach(function (d, i) {
        setTimeout(function () { a.blip([420, 330, 220][i], 0.36, 'sawtooth', 0.15); }, d);
      });
    },

    /* ----------------------------------------------------------
       Brought the whole load across. `win` already played, so this
       rides on top of it: a rising major run, and for a perfect
       load the octave again over the top of the last note so it
       lands on something bigger than it started.
       ---------------------------------------------------------- */
    fanfare: function (perfect) {
      var a = this;
      var run = perfect
        ? [523, 659, 784, 1047, 1319, 1568]
        : [523, 659, 784, 1047];
      run.forEach(function (hz, i) {
        setTimeout(function () {
          a.blip(hz, 0.34, 'triangle', perfect ? 0.17 : 0.13);
        }, 150 + i * 95);
      });
      if (!perfect) return;
      [0, 1, 2].forEach(function (k) {
        setTimeout(function () {
          a.blip([1047, 1319, 2093][k], 0.75, 'triangle', 0.14);
        }, 760 + k * 20);
      });
    }
  };

})(window.MUD);
