/* ===========================================================
   hud.js - writes game state into the DOM overlay.
   Only touches the DOM when a value actually changed.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;
  var CIRC = 2 * Math.PI * 51;   /* boost arc circumference */

  function $(id) { return document.getElementById(id); }

  var H = M.HUD = {
    el: {},
    last: {},

    init: function () {
      var ids = ['hud', 'clock', 't-sec', 't-cs', 't-bar', 'cargo-pct', 'cargo-bar',
        'dist-m', 'prog-bar', 'score-num', 'boost-arc', 'boost-num', 'speed-num',
        'toasts', 'bigmsg', 'boostfx', 'hitfx'];
      var self = this;
      ids.forEach(function (id) { self.el[id] = $(id); });
      this.el['boost-arc'].style.strokeDasharray = CIRC;
      this.el.gauge = document.querySelector('.boost-gauge');
      this.el.cargoPanel = this.el['cargo-bar'].closest('.panel');
      this.last = {};
    },

    show: function (on) {
      this.el.hud.classList.toggle('screen-hidden', !on);
    },

    /* ---- per-frame update ---- */
    update: function (s) {
      var e = this.el, L = this.last;

      /* clock */
      var t = Math.max(0, s.timeLeft);
      var sec = Math.floor(t);
      var cs = Math.floor((t - sec) * 100);
      if (sec !== L.sec) { e['t-sec'].textContent = sec < 10 ? '0' + sec : sec; L.sec = sec; }
      if (cs !== L.cs) { e['t-cs'].textContent = cs < 10 ? '0' + cs : cs; L.cs = cs; }
      var frac = U.clamp(t / s.timeLimit, 0, 1);
      e['t-bar'].style.width = (frac * 100).toFixed(1) + '%';
      var warn = t <= 10;
      if (warn !== L.warn) { e.clock.classList.toggle('warn', warn); L.warn = warn; }

      /* speed */
      var kmh = Math.round(s.kmh);
      if (kmh !== L.kmh) { e['speed-num'].textContent = kmh; L.kmh = kmh; }

      /* boost */
      var bp = U.clamp(s.boostPct, 0, 1);
      e['boost-arc'].style.strokeDashoffset = (CIRC * (1 - bp)).toFixed(1);
      var bn = Math.round(bp * 100);
      if (bn !== L.boost) { e['boost-num'].textContent = bn; L.boost = bn; }
      var full = bp > 0.995;
      if (full !== L.full) { e.gauge.classList.toggle('full', full); L.full = full; }

      /* cargo */
      var cg = Math.round(s.cargo);
      if (cg !== L.cargo) {
        e['cargo-pct'].textContent = cg + '%';
        e['cargo-bar'].style.width = cg + '%';
        e.cargoPanel.classList.toggle('hurt', cg < 58);
        e.cargoPanel.classList.toggle('warn', cg >= 58 && cg < 78);
        L.cargo = cg;
      }

      /* distance + progress */
      var dm = Math.max(0, Math.round(s.remaining));
      if (dm !== L.dist) {
        e['dist-m'].textContent = dm + ' m';
        e['prog-bar'].style.width = (U.clamp(1 - dm / s.totalLength, 0, 1) * 100).toFixed(1) + '%';
        L.dist = dm;
      }

      /* stunt score */
      var sc = Math.round(s.score);
      if (sc !== L.score) { e['score-num'].textContent = sc.toLocaleString(); L.score = sc; }

      /* boost screen tint */
      var bo = !!s.boosting;
      if (bo !== L.boosting) { e.boostfx.classList.toggle('on', bo); L.boosting = bo; }
    },

    /* ---- transient feedback ---- */
    toast: function (text, bonus) {
      var el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = text + (bonus ? '<b>+' + bonus + '</b>' : '');
      this.el.toasts.appendChild(el);
      /* keep the stack short */
      while (this.el.toasts.children.length > 4) {
        this.el.toasts.removeChild(this.el.toasts.firstChild);
      }
      setTimeout(function () {
        el.classList.add('fade');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 420);
      }, 1250);
    },

    big: function (text, color) {
      var el = this.el.bigmsg;
      el.textContent = text;
      el.style.color = color || '';
      el.classList.remove('show');
      void el.offsetWidth;          /* restart the animation */
      el.classList.add('show');
    },

    hitFlash: function () {
      var el = this.el.hitfx;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    },

    reset: function () {
      this.last = {};
      this.el.toasts.innerHTML = '';
      this.el.bigmsg.classList.remove('show');
      this.el.boostfx.classList.remove('on');
    }
  };

})(window.MUD);
