/* ===========================================================
   minimap.js - GTA-style circular radar for the grid city.

   Drawn in 2D rather than rendered in 3D: a radar is a
   stylised map, and 2D gives crisper lines for a fraction of
   the cost. Rotates with the player, who stays at the centre.
   =========================================================== */
(function (M) {
  'use strict';

  var SCALE = 0.86;        /* pixels per metre on the backing store */
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  var COL = {
    grass: '#6fa857',
    walk: '#c8c6bd',
    plaza: '#ddd0b4',
    dirt: '#c0a07a',
    build: '#8e9299',
    road: '#f2f2ee',
    casing: '#9aa0a6'
  };

  var MM = M.Minimap = {
    init: function (world) {
      this.cv = document.getElementById('minimap');
      this.ctx = this.cv.getContext('2d');
      this.size = this.cv.width;
      this.cx = this.cy = this.size / 2;
      this.compass = document.querySelector('.mm-n');
      this.w = world;
      this.lastDir = '';
    },

    draw: function (px, pz, yaw) {
      var w = this.w, g = this.ctx, S = this.size;
      var cx = this.cx, cy = this.cy, R = S / 2;
      var c = Math.cos(yaw), s = Math.sin(yaw);
      var GRID = w.GRID, PITCH = w.PITCH, RH = w.ROAD_HALF;
      var p = [0, 0];

      /* Steering is `yaw -= steer`, so at yaw 0 - nose down +Z - turning
         right carries you towards -X. The driver's right hand is -X, and
         the screen's right hand has to agree with it, hence the negated
         x term. Without it the whole radar comes out mirrored: it turns
         the right way but everything on it is swapped left for right. */
      function proj(wx, wz, out) {
        var dx = (wx - px) * SCALE, dz = (wz - pz) * SCALE;
        out[0] = cx - (dx * c - dz * s);
        out[1] = cy - (dx * s + dz * c);
        return out;
      }
      function line(x0, z0, x1, z1, width, color) {
        g.strokeStyle = color; g.lineWidth = width * SCALE;
        g.beginPath();
        proj(x0, z0, p); g.moveTo(p[0], p[1]);
        proj(x1, z1, p); g.lineTo(p[0], p[1]);
        g.stroke();
      }

      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, 6.2832);
      g.clip();

      /* open country */
      g.fillStyle = COL.grass;
      g.fillRect(0, 0, S, S);

      var i, j;
      var lo = w.nodeX(0), hi = w.nodeX(GRID - 1);

      /* city blocks, coloured by what is in them */
      for (i = 0; i < GRID - 1; i++) {
        for (j = 0; j < GRID - 1; j++) {
          var bx = w.nodeX(i) + PITCH / 2, bz = w.nodeX(j) + PITCH / 2;
          if (Math.abs(bx - px) > 320 || Math.abs(bz - pz) > 320) continue;
          var t = w.BLOCKS[j][i];
          g.fillStyle = t === 'P' ? '#5f9b48' : t === 'G' ? COL.plaza
            : t === 'S' ? COL.dirt : COL.walk;
          var half = (PITCH - RH * 2) / 2 * SCALE;
          proj(bx, bz, p);
          g.save();
          g.translate(p[0], p[1]);
          g.rotate(yaw);
          g.fillRect(-half, -half, half * 2, half * 2);
          g.restore();
        }
      }

      /* building footprints */
      g.fillStyle = COL.build;
      for (i = 0; i < w.decor.length; i++) {
        var b = w.decor[i];
        if (Math.abs(b.x - px) > 300 || Math.abs(b.z - pz) > 300) continue;
        proj(b.x, b.z, p);
        g.save();
        g.translate(p[0], p[1]);
        g.rotate(yaw);
        g.fillRect(-b.w * SCALE / 2, -b.d * SCALE / 2, b.w * SCALE, b.d * SCALE);
        g.restore();
      }

      /* street grid: casing then surface */
      g.lineCap = 'butt';
      for (i = 0; i < GRID; i++) {
        var nx = w.nodeX(i);
        if (Math.abs(nx - px) < 340) line(nx, lo, nx, hi, RH * 2 + 3, COL.casing);
        var nz = w.nodeX(i);
        if (Math.abs(nz - pz) < 340) line(lo, nz, hi, nz, RH * 2 + 3, COL.casing);
      }
      for (i = 0; i < GRID; i++) {
        var nx2 = w.nodeX(i);
        if (Math.abs(nx2 - px) < 340) line(nx2, lo, nx2, hi, RH * 2, COL.road);
        var nz2 = w.nodeX(i);
        if (Math.abs(nz2 - pz) < 340) line(lo, nz2, hi, nz2, RH * 2, COL.road);
      }

      /* suggested route */
      var nodes = w.routeNodes;
      if (nodes && nodes.length > 1) {
        g.strokeStyle = '#4fc4bd';
        g.lineWidth = 7 * SCALE;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        for (var k = 0; k < nodes.length; k++) {
          var ni = nodes[k] % GRID, nj = (nodes[k] / GRID) | 0;
          proj(w.nodeX(ni), w.nodeX(nj), p);
          if (k === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
        }
        g.stroke();
      }

      /* ramps */
      g.fillStyle = '#f2a03c';
      for (i = 0; i < w.ramps.length; i++) {
        var rp = w.ramps[i];
        if (Math.abs(rp.x - px) > 260 || Math.abs(rp.z - pz) > 260) continue;
        proj(rp.x, rp.z, p);
        g.save();
        g.translate(p[0], p[1]);
        g.rotate(-(rp.yaw - yaw));
        g.beginPath();
        g.moveTo(0, -7); g.lineTo(5, 4); g.lineTo(-5, 4);
        g.closePath(); g.fill();
        g.restore();
      }

      /* traffic */
      g.fillStyle = '#e8eaed';
      g.strokeStyle = 'rgba(30,36,44,.75)';
      g.lineWidth = 1;
      for (i = 0; i < w.traffic.length; i++) {
        var tc = w.traffic[i];
        if (Math.abs(tc.x - px) > 200 || Math.abs(tc.z - pz) > 200) continue;
        proj(tc.x, tc.z, p);
        g.beginPath(); g.arc(p[0], p[1], 2.6, 0, 6.2832); g.fill(); g.stroke();
      }

      /* live boost pads */
      g.fillStyle = '#f7cf45';
      for (i = 0; i < w.pads.length; i++) {
        var pad = w.pads[i];
        if (pad.cooldown > 0) continue;
        if (Math.abs(pad.x - px) > 230 || Math.abs(pad.z - pz) > 230) continue;
        proj(pad.x, pad.z, p);
        g.beginPath(); g.arc(p[0], p[1], 3, 0, 6.2832); g.fill();
      }

      /* destination, clamped to the rim when it is off the radar */
      var q = [0, 0];
      proj(w.finish.x, w.finish.z, q);
      var inside = (q[0] - cx) * (q[0] - cx) + (q[1] - cy) * (q[1] - cy) < (R - 15) * (R - 15);
      if (!inside) {
        var ang = Math.atan2(q[1] - cy, q[0] - cx);
        q[0] = cx + Math.cos(ang) * (R - 16);
        q[1] = cy + Math.sin(ang) * (R - 16);
      }
      var pulse = 0.72 + 0.28 * Math.sin(performance.now() / 260);
      /* Once it is on the radar this is drawn at its true 17 m footprint,
         so it reads as the piece of ground it is. Off the radar there is
         no footprint to be faithful to, so it falls back to a pin on the
         rim pointing the way. */
      if (inside) {
        g.fillStyle = 'rgba(47,168,119,' + (0.30 * pulse).toFixed(3) + ')';
        g.beginPath(); g.arc(q[0], q[1], 17 * SCALE, 0, 6.2832); g.fill();
        g.strokeStyle = 'rgba(150,255,200,' + (0.85 * pulse).toFixed(3) + ')';
        g.lineWidth = 2.4;
        g.beginPath(); g.arc(q[0], q[1], 17 * SCALE, 0, 6.2832); g.stroke();
      } else {
        g.fillStyle = 'rgba(47,168,119,' + (0.25 * pulse).toFixed(3) + ')';
        g.beginPath(); g.arc(q[0], q[1], 17 * pulse, 0, 6.2832); g.fill();
      }
      g.fillStyle = '#2fa877';
      g.beginPath(); g.arc(q[0], q[1], 7.5, 0, 6.2832); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.stroke();

      g.restore();

      /* player arrow, dead centre, always pointing up */
      g.save();
      g.translate(cx, cy);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.arc(0, 0, 14, 0, 6.2832); g.fill();
      g.fillStyle = '#f2a03c';
      g.beginPath();
      g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5.5); g.lineTo(-9, 10);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(11,43,51,.9)'; g.lineWidth = 1.5; g.stroke();
      g.restore();

      /* north is +Z, so east is -X and the heading runs the other way */
      var deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
      var dir = DIRS[Math.round(deg / 45) % 8];
      if (dir !== this.lastDir && this.compass) {
        this.compass.textContent = dir;
        this.lastDir = dir;
      }
    }
  };

})(window.MUD);
