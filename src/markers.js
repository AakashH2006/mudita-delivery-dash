/* ===========================================================
   markers.js - badges pinned to things out in the world.

   The HUD tells you numbers. These tell you where. A pill rides
   over the drop-off the whole run and slides to the edge of the
   screen with an arrow on it when the orphanage is behind you,
   and the kickers announce themselves a block out so taking one
   is a decision you make early rather than a thing that happens
   to you.

   DOM, not sprites: text stays crisp at any distance, costs no
   draw calls, and restyling it is a line of CSS.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;

  var RAMP_SLOTS = 3;       /* how many kicker badges at once        */
  var RAMP_RANGE = 165;     /* how far out one announces itself      */
  var RAMP_BEHIND = -12;    /* ...and how far past you it stays up   */
  var EDGE = 54;            /* keep a clamped badge this far inside  */

  var _v, _p = { x: 0, y: 0, behind: false };

  var MK = M.Markers = {
    ramps: [],

    /* ------------------------------------------------------- */
    init: function (world) {
      this.world = world;
      this.root = document.getElementById('markers');
      this.root.innerHTML = '';
      _v = new THREE.Vector3();

      this.goal = this.make('goal');
      this.setText(this.goal, 'Orphanage', '');

      this.ramps.length = 0;
      for (var i = 0; i < RAMP_SLOTS; i++) this.ramps.push(this.make('ramp'));

      this.show(false);
    },

    make: function (kind) {
      var el = document.createElement('div');
      el.className = 'marker mk-' + kind;
      el.innerHTML =
        '<div class="mk-pill">' +
        '<span class="mk-dot"></span>' +
        '<span class="mk-body"><b class="mk-title"></b><i class="mk-sub"></i></span>' +
        '</div><span class="mk-tail"></span>';
      this.root.appendChild(el);
      return {
        el: el,
        title: el.querySelector('.mk-title'),
        sub: el.querySelector('.mk-sub'),
        vis: null, _t: '', _s: ''
      };
    },

    setText: function (m, title, sub) {
      if (title !== m._t) { m.title.textContent = title; m._t = title; }
      if (sub !== m._s) { m.sub.textContent = sub; m._s = sub; }
    },

    setVisible: function (m, on) {
      if (m.vis === on) return;
      m.vis = on;
      m.el.style.display = on ? '' : 'none';
    },

    show: function (on) {
      this.root.classList.toggle('screen-hidden', !on);
    },

    /* ----------------------------------------------------------
       World point to screen point. A point behind the camera
       projects to the mirror image of where it really is, which
       is why the arrow used to swing the wrong way: flip it back
       before anything is done with it.
       ---------------------------------------------------------- */
    project: function (x, y, z, cam, out) {
      _v.set(x, y, z).project(cam);
      out.behind = _v.z > 1;
      var sx = _v.x, sy = _v.y;
      if (out.behind) { sx = -sx; sy = -sy; }
      out.x = (sx * 0.5 + 0.5) * window.innerWidth;
      out.y = (-sy * 0.5 + 0.5) * window.innerHeight;
      return out;
    },

    place: function (m, x, y, z, cam, clamp) {
      var p = this.project(x, y, z, cam, _p);
      var w = window.innerWidth, h = window.innerHeight;
      var off = p.behind || p.x < EDGE || p.x > w - EDGE || p.y < EDGE || p.y > h - EDGE;

      if (!clamp && off) { this.setVisible(m, false); return false; }

      var px = U.clamp(p.x, EDGE, w - EDGE);
      var py = U.clamp(p.y, EDGE, h - EDGE);
      m.el.style.transform = 'translate(-50%,-50%) translate(' + (px | 0) + 'px,' + (py | 0) + 'px)';
      if (m.edge !== off) {
        m.edge = off;
        m.el.classList.toggle('at-edge', off);
      }
      this.setVisible(m, true);
      return true;
    },

    /* ------------------------------------------------------- */
    update: function (cam, veh) {
      var w = this.world, car = veh.pos;

      /* ---- the drop-off ---- */
      var dx = w.finish.x - car.x, dz = w.finish.z - car.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      this.setText(this.goal, 'Orphanage', Math.round(d) + ' m');
      /* over the column of light rather than on the deck, so it is
         not buried in the apron when you come in low */
      this.place(this.goal, w.finish.x, 11, w.finish.z, cam, true);

      /* ---- kickers near enough to matter ---- */
      var fx = Math.sin(veh.yaw), fz = Math.cos(veh.yaw);
      var near = _near;
      near.length = 0;
      for (var i = 0; i < w.ramps.length; i++) {
        var r = w.ramps[i];
        var rx = r.x - car.x, rz = r.z - car.z;
        var ahead = rx * fx + rz * fz;
        if (ahead < RAMP_BEHIND || ahead > RAMP_RANGE) continue;
        /* only the ones roughly down the road you are on */
        var side = Math.abs(rx * fz - rz * fx);
        if (side > 42) continue;
        near.push({ r: r, d: ahead });
      }
      near.sort(byDist);

      for (var s = 0; s < this.ramps.length; s++) {
        var m = this.ramps[s];
        var hit = near[s];
        if (!hit) { this.setVisible(m, false); continue; }
        var rr = hit.r;
        var twist = !!rr.twist;
        if (m.twist !== twist) {
          m.twist = twist;
          m.el.classList.toggle('roll', twist);
        }
        this.setText(m, twist ? 'Barrel Roll' : 'Stunt Ramp', Math.round(hit.d) + ' m');
        /* float it over the lip, which is the part you are aiming at */
        this.place(m, rr.x + rr.fx * rr.len, rr.rise + 4.6, rr.z + rr.fz * rr.len, cam, false);
      }
    }
  };

  var _near = [];
  function byDist(a, b) { return a.d - b.d; }

})(window.MUD);
