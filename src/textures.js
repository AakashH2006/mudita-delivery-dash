/* ===========================================================
   textures.js - every texture is drawn on a canvas at runtime.
   No binary assets, so the game runs straight off the file system.

   Daytime palette: bright, warm, cheerful.
   =========================================================== */
(function (M) {
  'use strict';

  var cache = {};

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function tex(canvas, repX, repY) {
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repX || 1, repY || 1);
    t.anisotropy = 8;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function noise(ctx, w, h, amount, alpha) {
    for (var i = 0; i < amount; i++) {
      var g = Math.floor(Math.random() * 255);
      ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ',' + alpha + ')';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }

  /* cheerful facade colours - a sunny side street */
  var HOUSE = [
    '#e8785f', '#f2c14e', '#6fc9a8', '#6fa8dc', '#b79ae0',
    '#f0e2c8', '#e59a4c', '#4fb3a6', '#ef8fa8', '#9ec96f'
  ];
  M.HOUSE_COLORS = HOUSE;

  var T = M.tex = {

    /* ---- road surface. one tile = full road width x 14 m ---- */
    road: function () {
      if (cache.road) return cache.road;
      var w = 512, h = 512, c = cv(w, h), x = c.getContext('2d');

      x.fillStyle = '#565d64';
      x.fillRect(0, 0, w, h);
      noise(x, w, h, 16000, 0.055);

      x.fillStyle = 'rgba(0,0,0,.08)';
      [128, 384].forEach(function (cx) { x.fillRect(cx - 44, 0, 88, h); });
      x.fillStyle = 'rgba(255,255,255,.03)';
      x.fillRect(290, 90, 110, 180);

      /* solid edge lines */
      x.fillStyle = 'rgba(248,250,252,.92)';
      x.fillRect(12, 0, 10, h);
      x.fillRect(w - 22, 0, 10, h);

      /* centre: double yellow */
      x.fillStyle = 'rgba(250,206,70,.95)';
      x.fillRect(243, 0, 9, h);
      x.fillRect(261, 0, 9, h);

      /* lane dashes */
      x.fillStyle = 'rgba(248,250,252,.9)';
      x.fillRect(124, 30, 10, 220);
      x.fillRect(379, 30, 10, 220);

      cache.road = tex(c, 1, 1);
      return cache.road;
    },

    /* ---- intersection: plain asphalt, no lane paint ---- */
    junction: function () {
      if (cache.junction) return cache.junction;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#565d64'; x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 9000, 0.06);
      x.fillStyle = 'rgba(0,0,0,.05)';
      for (var i = 0; i < 14; i++) {
        x.fillRect(Math.random() * 256, Math.random() * 256, 16 + Math.random() * 50, 5 + Math.random() * 12);
      }
      cache.junction = tex(c, 1, 1);
      return cache.junction;
    },

    /* ---- pavement ---- */
    walk: function () {
      if (cache.walk) return cache.walk;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#b9bcc0'; x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 6000, 0.05);
      x.strokeStyle = 'rgba(120,126,132,.55)'; x.lineWidth = 2;
      for (var i = 0; i <= 256; i += 64) {
        x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
        x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
      }
      cache.walk = tex(c, 1, 1);
      return cache.walk;
    },

    /* ---- grass: parks, verges, everything beyond the city ---- */
    grass: function () {
      if (cache.grass) return cache.grass;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#5c9448'; x.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 400; i++) {
        x.fillStyle = ['#6aa652', '#538a40', '#74b058', '#4e803c'][i % 4];
        x.globalAlpha = 0.25 + Math.random() * 0.4;
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 5 + Math.random() * 22, 0, 6.3);
        x.fill();
      }
      x.globalAlpha = 0.85;
      for (var f = 0; f < 70; f++) {
        x.fillStyle = ['#f6d65c', '#f2896f', '#ffffff', '#d9a8e8'][f % 4];
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 1.0 + Math.random() * 1.1, 0, 6.3);
        x.fill();
      }
      x.globalAlpha = 1;
      cache.grass = tex(c, 1, 1);
      return cache.grass;
    },

    /* ---- plaza paving ---- */
    plaza: function () {
      if (cache.plaza) return cache.plaza;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#d8cdb8'; x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 5000, 0.045);
      for (var r = 0; r < 4; r++) {
        for (var i = 0; i < 4; i++) {
          if ((r + i) % 2) continue;
          x.fillStyle = 'rgba(196,182,158,.55)';
          x.fillRect(i * 64 + 3, r * 64 + 3, 58, 58);
        }
      }
      x.strokeStyle = 'rgba(150,138,118,.5)'; x.lineWidth = 2;
      for (var k = 0; k <= 256; k += 64) {
        x.beginPath(); x.moveTo(0, k); x.lineTo(256, k); x.stroke();
        x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 256); x.stroke();
      }
      cache.plaza = tex(c, 1, 1);
      return cache.plaza;
    },

    /* ---- construction site dirt ---- */
    dirt: function () {
      if (cache.dirt) return cache.dirt;
      var c = cv(256, 256), x = c.getContext('2d');
      x.fillStyle = '#b09372'; x.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 180; i++) {
        x.fillStyle = ['#a1845f', '#c0a383', '#95795a'][i % 3];
        x.globalAlpha = 0.3 + Math.random() * 0.4;
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 20, 0, 6.3);
        x.fill();
      }
      x.globalAlpha = 1;
      cache.dirt = tex(c, 1, 1);
      return cache.dirt;
    },

    /* ---- building facades, one per cheerful colour ---- */
    facade: function (idx) {
      var key = 'fac' + idx;
      if (cache[key]) return cache[key];

      var base = HOUSE[idx % HOUSE.length];
      var w = 256, h = 256, c = cv(w, h), x = c.getContext('2d');
      var rnd = M.util.seeded(4000 + idx * 131);

      x.fillStyle = base;
      x.fillRect(0, 0, w, h);
      noise(x, w, h, 4000, 0.03);

      /* Slim floor bands. Tinted, not white: the body colour has to
         stay the thing you read the building by from a moving car. */
      for (var fy = 0; fy < h; fy += 64) {
        x.fillStyle = 'rgba(255,255,255,.26)';
        x.fillRect(0, fy, w, 4);
        x.fillStyle = 'rgba(0,0,0,.10)';
        x.fillRect(0, fy + 4, w, 2);
      }

      var cols = 4, pad = 18;
      var cw = (w - pad * 2) / cols;
      for (var r = 0; r < 4; r++) {
        for (var i = 0; i < cols; i++) {
          var ww = cw - 26, wh = 26;
          var wx = pad + i * cw + 13, wy = r * 64 + 24;
          x.fillStyle = 'rgba(255,255,255,.55)';
          x.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
          var gl = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
          gl.addColorStop(0, '#9cc6e4');
          gl.addColorStop(0.5, '#6ea4cc');
          gl.addColorStop(1, '#4f86b4');
          x.fillStyle = gl;
          x.fillRect(wx, wy, ww, wh);
          if (rnd() < 0.3) {
            x.fillStyle = ['#e8785f', '#f2c14e', '#6fc9a8'][Math.floor(rnd() * 3)];
            x.fillRect(wx - 2, wy + wh + 2, ww + 4, 6);
          }
        }
      }
      x.fillStyle = 'rgba(0,0,0,.14)';
      x.fillRect(0, h - 20, w, 20);
      x.fillStyle = 'rgba(255,255,255,.3)';
      x.fillRect(0, h - 22, w, 2);

      cache[key] = tex(c, 1, 1);
      return cache[key];
    },

    /* ---- donation crate ---- */
    crate: function () {
      if (cache.crate) return cache.crate;
      var c = cv(128, 128), x = c.getContext('2d');
      x.fillStyle = '#c69355'; x.fillRect(0, 0, 128, 128);
      noise(x, 128, 128, 2200, 0.05);
      x.strokeStyle = 'rgba(120,85,45,.6)'; x.lineWidth = 5;
      x.strokeRect(3, 3, 122, 122);
      x.fillStyle = 'rgba(240,226,196,.7)';
      x.fillRect(0, 56, 128, 16);
      x.fillStyle = '#e8785f';
      x.beginPath();
      x.moveTo(64, 104);
      x.bezierCurveTo(26, 80, 34, 44, 64, 58);
      x.bezierCurveTo(94, 44, 102, 80, 64, 104);
      x.fill();
      cache.crate = tex(c, 1, 1);
      return cache.crate;
    },

    /* ---- MUDITA door livery ---- */
    livery: function () {
      if (cache.livery) return cache.livery;
      var c = cv(512, 256), x = c.getContext('2d');
      x.fillStyle = '#1b2026'; x.fillRect(0, 0, 512, 256);
      x.fillStyle = '#f2a03c';
      x.beginPath();
      x.moveTo(0, 196); x.lineTo(240, 150); x.lineTo(250, 184); x.lineTo(0, 232);
      x.closePath(); x.fill();
      x.fillStyle = 'rgba(242,160,60,.3)';
      x.beginPath();
      x.moveTo(250, 148); x.lineTo(430, 114); x.lineTo(440, 148); x.lineTo(258, 182);
      x.closePath(); x.fill();
      x.fillStyle = '#ffffff';
      x.font = '700 70px "Chakra Petch", Segoe UI, sans-serif';
      x.fillText('MUDITA', 26, 92);
      x.fillStyle = 'rgba(255,255,255,.6)';
      x.font = '600 25px "Chakra Petch", Segoe UI, sans-serif';
      x.fillText('DSCE  DONATION  UNIT', 30, 126);
      cache.livery = tex(c, 1, 1);
      return cache.livery;
    },

    /* ---- boost pad chevrons ---- */
    boostPad: function () {
      if (cache.pad) return cache.pad;
      var c = cv(128, 256), x = c.getContext('2d');
      x.clearRect(0, 0, 128, 256);
      x.fillStyle = 'rgba(255,170,40,.3)';
      x.fillRect(0, 0, 128, 256);
      x.fillStyle = '#ffd45e';
      for (var i = 0; i < 3; i++) {
        var y = 190 - i * 72;
        x.beginPath();
        x.moveTo(16, y); x.lineTo(64, y - 46); x.lineTo(112, y);
        x.lineTo(112, y + 22); x.lineTo(64, y - 24); x.lineTo(16, y + 22);
        x.closePath(); x.fill();
      }
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      cache.pad = t;
      return t;
    },

    /* ---- ramp surface: hazard chevrons so the kicker reads ---- */
    /* ---- the ramp deck ----
       The old deck was grey tarmac with a yellow hazard chevron, which
       is what a builder puts on a loading dock: correct, and completely
       forgettable. These are event furniture, so they get an event
       livery - deep indigo, white kerb stripes, and a run of chevrons
       climbing in cyan-to-magenta. Amber is left alone throughout,
       because amber means boost everywhere else in this game and a ramp
       painted in it reads as something to collect. */
    rampFace: function (twisted) {
      var key = twisted ? 'rampFaceT' : 'rampFace';
      if (cache[key]) return cache[key];
      var S = 512, c = cv(S, S), x = c.getContext('2d');

      var base = x.createLinearGradient(0, S, 0, 0);
      base.addColorStop(0, twisted ? '#2a1c4e' : '#1e2550');
      base.addColorStop(1, twisted ? '#3b2068' : '#27306b');
      x.fillStyle = base; x.fillRect(0, 0, S, S);

      /* kerb stripes down both edges */
      x.fillStyle = '#f3f6ff';
      x.fillRect(0, 0, 26, S); x.fillRect(S - 26, 0, 26, S);
      x.fillStyle = 'rgba(0,0,0,.30)';
      for (var b = 0; b < S; b += 64) {
        x.fillRect(0, b, 26, 32); x.fillRect(S - 26, b + 32, 26, 32);
      }

      /* chevrons climbing the deck. v runs 0 at the foot to 1 at the
         lip, so they point the way you are about to be thrown. */
      for (var i = 0; i < 5; i++) {
        var y = S - 40 - i * 96;
        var g2 = x.createLinearGradient(0, y, 0, y - 70);
        g2.addColorStop(0, twisted ? '#ff3d9a' : '#2ec6ff');
        g2.addColorStop(1, twisted ? '#8f5cff' : '#8ae6ff');
        x.fillStyle = g2;
        x.beginPath();
        x.moveTo(54, y); x.lineTo(S / 2, y - 72); x.lineTo(S - 54, y);
        x.lineTo(S - 54, y - 30); x.lineTo(S / 2, y - 102); x.lineTo(54, y - 30);
        x.closePath(); x.fill();
      }

      /* a wash of grip speckle so it is not a flat vinyl sticker */
      x.globalAlpha = 0.5; noise(x, S, S, 2600, 0.1); x.globalAlpha = 1;
      x.fillStyle = 'rgba(0,0,0,.28)';
      x.fillRect(0, 0, S, 12); x.fillRect(0, S - 12, S, 12);

      cache[key] = tex(c, 1, 1);
      return cache[key];
    },

    /* ---- the hologram chevron hanging over a ramp lip ---- */
    holoArrow: function (twisted) {
      var key = twisted ? 'holoT' : 'holo';
      if (cache[key]) return cache[key];
      var W = 256, H = 256, c = cv(W, H), x = c.getContext('2d');
      x.clearRect(0, 0, W, H);
      var tint = twisted ? ['rgba(240,99,127,', 'rgba(247,154,172,']
                         : ['rgba(79,196,189,', 'rgba(176,215,211,'];
      for (var i = 0; i < 3; i++) {
        var y = H - 24 - i * 74, a = 0.95 - i * 0.26;
        var g = x.createLinearGradient(0, y, 0, y - 60);
        g.addColorStop(0, tint[0] + a.toFixed(2) + ')');
        g.addColorStop(1, tint[1] + (a * 0.45).toFixed(2) + ')');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(26, y); x.lineTo(W / 2, y - 62); x.lineTo(W - 26, y);
        x.lineTo(W - 26, y - 26); x.lineTo(W / 2, y - 88); x.lineTo(26, y - 26);
        x.closePath(); x.fill();
      }
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      cache[key] = t;
      return t;
    },

    bunting: function () {
      if (cache.bunting) return cache.bunting;
      var c = cv(256, 64), x = c.getContext('2d');
      x.clearRect(0, 0, 256, 64);
      x.strokeStyle = '#6b5436'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(0, 8); x.lineTo(256, 8); x.stroke();
      var cols = ['#e8785f', '#f2c14e', '#6fc9a8', '#6fa8dc', '#b79ae0'];
      for (var i = 0; i < 8; i++) {
        x.fillStyle = cols[i % cols.length];
        x.beginPath();
        x.moveTo(i * 32 + 2, 9); x.lineTo(i * 32 + 30, 9); x.lineTo(i * 32 + 16, 50);
        x.closePath(); x.fill();
      }
      var t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      t.encoding = THREE.sRGBEncoding;
      cache.bunting = t;
      return t;
    },

    /* ---- soft radial glow ---- */
    glow: function () {
      if (cache.glow) return cache.glow;
      var c = cv(128, 128), x = c.getContext('2d');
      var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      cache.glow = new THREE.CanvasTexture(c);
      return cache.glow;
    },

    /* ---- the column of light over the drop-off ----
       A vertical fade, solid at the tarmac and gone by the top. The
       horizontal streaks stop the cylinder reading as a flat gel: at
       the silhouette edges they bunch up and give it some body. */
    beam: function () {
      if (cache.beam) return cache.beam;
      var c = cv(64, 256), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 256, 0, 0);
      g.addColorStop(0.00, 'rgba(126,247,183,.80)');
      g.addColorStop(0.18, 'rgba(72,222,146,.42)');
      g.addColorStop(0.55, 'rgba(46,196,128,.14)');
      g.addColorStop(1.00, 'rgba(46,196,128,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 256);
      for (var i = 0; i < 7; i++) {
        x.fillStyle = 'rgba(220,255,235,.10)';
        x.fillRect(Math.floor(Math.random() * 60), 0, 2, 256);
      }
      var t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.encoding = THREE.sRGBEncoding;
      cache.beam = t;
      return t;
    },

    /* ---- the painted apron on the ground ----
       One square canvas on one disc, rather than a stack of rings and
       chevrons as separate meshes. CircleGeometry lays UV 0..1 across
       its bounding square, so a circle drawn centred on a square canvas
       lands exactly on the disc and everything outside it is alpha 0. */
    dropPad: function () {
      if (cache.dropPad) return cache.dropPad;
      var S = 512, R = S / 2, c = cv(S, S), x = c.getContext('2d');

      var g = x.createRadialGradient(R, R, 0, R, R, R);
      g.addColorStop(0.00, 'rgba(84,226,154,.46)');
      g.addColorStop(0.55, 'rgba(56,206,134,.32)');
      g.addColorStop(0.86, 'rgba(46,194,126,.48)');
      g.addColorStop(1.00, 'rgba(46,194,126,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(R, R, R, 0, 6.2832); x.fill();

      function ring(rad, width, style) {
        x.strokeStyle = style; x.lineWidth = width;
        x.beginPath(); x.arc(R, R, rad, 0, 6.2832); x.stroke();
      }
      ring(R * 0.90, 11, 'rgba(228,255,240,.95)');
      ring(R * 0.80, 3, 'rgba(228,255,240,.45)');

      /* chevrons round the rim, all pointing at the middle: the one
         marking everybody already reads without being taught */
      for (var k = 0; k < 16; k++) {
        var a = k * Math.PI / 8;
        x.save();
        x.translate(R + Math.cos(a) * R * 0.70, R + Math.sin(a) * R * 0.70);
        x.rotate(a);
        x.fillStyle = 'rgba(228,255,240,.80)';
        x.beginPath();
        x.moveTo(16, 0); x.lineTo(40, -22); x.lineTo(40, -9);
        x.lineTo(29, 0); x.lineTo(40, 9); x.lineTo(40, 22);
        x.closePath(); x.fill();
        x.restore();
      }

      /* dashed inner circle, then the bullseye you park on */
      x.strokeStyle = 'rgba(228,255,240,.55)'; x.lineWidth = 6;
      for (var d = 0; d < 24; d++) {
        var a2 = d * Math.PI / 12;
        x.beginPath();
        x.arc(R, R, R * 0.44, a2, a2 + 0.16);
        x.stroke();
      }
      x.fillStyle = 'rgba(150,250,200,.30)';
      x.beginPath(); x.arc(R, R, R * 0.30, 0, 6.2832); x.fill();
      ring(R * 0.30, 5, 'rgba(236,255,245,.85)');

      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      cache.dropPad = t;
      return t;
    },

    /* ---- confetti fleck ---- */
    fleck: function () {
      if (cache.fleck) return cache.fleck;
      var c = cv(32, 32), x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(8, 2, 16, 28);
      var t = new THREE.CanvasTexture(c);
      cache.fleck = t;
      return t;
    },

    /* ---- bright daytime sky with clouds ---- */
    sky: function () {
      if (cache.sky) return cache.sky;
      /* Golden hour. Deep indigo overhead falling through violet and
         rose to a hot band on the horizon.

         The band has to sit at v = 0.5, not at the bottom of the
         image: this is painted onto a sphere, so v = 0 is straight up
         and v = 1 is straight down. Everything past the middle is
         under the world, and a sunset painted down there is a sunset
         nobody ever sees. */
      var w = 1024, h = 512, c = cv(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, '#16244a');
      g.addColorStop(0.20, '#2f3f78');
      g.addColorStop(0.34, '#5d5490');
      g.addColorStop(0.43, '#9c6693');
      g.addColorStop(0.48, '#d47f84');
      g.addColorStop(0.51, '#f5a06a');
      g.addColorStop(0.55, '#ffc87e');
      g.addColorStop(0.60, '#ffe3ae');
      g.addColorStop(0.72, '#c08a63');
      g.addColorStop(1.00, '#4a3a2e');
      x.fillStyle = g; x.fillRect(0, 0, w, h);

      /* the sun's own glow, sitting on the horizon line itself */
      var sun = x.createRadialGradient(w * 0.30, h * 0.52, 10, w * 0.30, h * 0.52, 260);
      sun.addColorStop(0, 'rgba(255,246,218,.95)');
      sun.addColorStop(0.32, 'rgba(255,196,118,.44)');
      sun.addColorStop(1, 'rgba(255,170,90,0)');
      x.fillStyle = sun; x.fillRect(0, 0, w, h);

      /* Clouds lit from underneath, which is the whole look of an
         evening sky: dark on top, catching the last of it below. */
      var rnd = M.util.seeded(77);
      for (var i = 0; i < 26; i++) {
        /* kept in the upper half - the lower half is under the world */
        var cx = rnd() * w, cy = 40 + rnd() * 215;
        var s = 24 + rnd() * 52;
        var low = cy / h;                       /* nearer the horizon = hotter */
        var alpha = 0.42 + rnd() * 0.34;
        for (var p = 0; p < 7; p++) {
          var warm = low > 0.37;
          x.fillStyle = warm
            ? 'rgba(255,186,132,' + (alpha * 0.30).toFixed(3) + ')'
            : 'rgba(92,86,134,' + (alpha * 0.34).toFixed(3) + ')';
          x.beginPath();
          x.arc(cx + (rnd() - 0.5) * s * 2.6, cy + (rnd() - 0.5) * s * 0.55,
            s * (0.45 + rnd() * 0.6), 0, 6.3);
          x.fill();
        }
      }
      cache.sky = tex(c, 1, 1);
      return cache.sky;
    },

    /* ----------------------------------------------------------
       Lit windows, as an emissive map for the facade above.

       Same grid, same seed arithmetic, so a window that glows here
       is a window that exists there. Black everywhere else, because
       emissive adds light: anything not black would make the whole
       wall glow and the evening would be over.
       ---------------------------------------------------------- */
    facadeLit: function (idx) {
      var key = 'facLit' + idx;
      if (cache[key]) return cache[key];

      var w = 256, h = 256, c = cv(w, h), x = c.getContext('2d');
      x.fillStyle = '#000000';
      x.fillRect(0, 0, w, h);

      var rnd = M.util.seeded(9100 + idx * 131);
      var cols = 4, pad = 18;
      var cw = (w - pad * 2) / cols;
      for (var r = 0; r < 4; r++) {
        for (var i = 0; i < cols; i++) {
          if (rnd() > 0.46) continue;          /* most of them are dark */
          var ww = cw - 26, wh = 26;
          var wx = pad + i * cw + 13, wy = r * 64 + 24;
          /* warm at the glass, hotter in the middle of the pane */
          var gl = x.createLinearGradient(wx, wy, wx, wy + wh);
          gl.addColorStop(0, 'rgba(255,214,150,.95)');
          gl.addColorStop(1, 'rgba(255,170,96,.70)');
          x.fillStyle = gl;
          x.fillRect(wx, wy, ww, wh);
        }
      }
      cache[key] = tex(c, 1, 1);
      return cache[key];
    },

    /* ---- signage board ---- */
    sign: function (title, sub, accent, bg) {
      var key = 'sign:' + title + sub;
      if (cache[key]) return cache[key];
      var c = cv(1024, 256), x = c.getContext('2d');
      x.fillStyle = bg || '#ffffff'; x.fillRect(0, 0, 1024, 256);
      x.strokeStyle = accent || '#f2a03c'; x.lineWidth = 10;
      x.strokeRect(14, 14, 996, 228);
      x.fillStyle = '#1f4168';            /* the poster's own text blue */
      x.font = '700 92px "Chakra Petch", Segoe UI, sans-serif';
      x.textAlign = 'center';
      x.fillText(title, 512, 128);
      x.fillStyle = accent || '#f2a03c';
      x.font = '600 36px "Chakra Petch", Segoe UI, sans-serif';
      x.fillText(sub, 512, 190);
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      cache[key] = t;
      return t;
    }
  };

})(window.MUD);
