/* ===========================================================
   world.js - an open grid city.

   There are no invisible walls anywhere. The only things that
   stop you are buildings, walls and props, and every one of
   them is a real box you can see. Parks, plazas, courtyards,
   alleys and construction lots are all driveable, which is
   where the shortcuts live.

   Also provides: ground height (including building roofs you
   can land on), surface type, and the GPS that suggests a
   road route without ever forcing you onto it.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;

  var GRID = 9;              /* intersections per axis            */
  var ROAD_HALF = 14;        /* 28 m of tarmac                    */
  var SW = 3.5;              /* pavement width                    */

  /* How far apart the streets sit is the one number the whole city is
     built from: block contents, ramp run-ups, nitro spacing and traffic
     spans are all derived from it. At 172 m the gate and the orphanage
     are 2064 m apart by road and a clean run lands around 39 s against
     the 40 s window, so only a near-perfect one gets there.

     There used to be a shorter 152 m city on the menu beside it. One
     race is the better answer: every name on the board drove the same
     town, so the times all mean the same thing. */
  var PITCH = 172;
  var X0 = -(GRID - 1) * PITCH / 2;
  var BLOCK_IN = PITCH - ROAD_HALF * 2;

  /* A block in from the rim at both ends. On the very corner the
     gate has open country down two sides of it, which is a poor
     first thing to see; this way the city wraps both gates. */
  var START_I = 1, START_J = 1;
  var FINISH_I = 7, FINISH_J = 7;

  /* Block plan. Rows are j (south to north), columns are i.
       B  one solid tower, no way through
       b  four buildings round a courtyard - squeeze between them
       A  two slabs with a straight alley punched through
       P  park: grass, trees, fountain, fully driveable
       G  plaza: paving, planters, stalls, fully driveable
       S  construction site: dirt, scaffolding and ramps           */
  var BLOCKS = [
    'BbGbAbBb',
    'bPBBSGbA',
    'GbSbAbPb',
    'bBbGbBbS',
    'PbAbSbGb',
    'bGBSbPbB',
    'BbAbGbbP',
    'bSbBbAbB'
  ];

  var SURF_GRIP = { road: 1.0, walk: 0.96, plaza: 0.95, roof: 0.94, dirt: 0.84, grass: 0.77 };
  var SURF_DRAG = { road: 0.0, walk: 0.13, plaza: 0.11, roof: 0.13, dirt: 0.40, grass: 0.64 };

  function nodeX(i) { return X0 + i * PITCH; }

  var _scratch = [];

  var W = M.World = {
    group: null,
    ramps: [],
    pads: [],
    spill: [],          /* crates shaken out of the bed */
    traffic: [],
    trafficBounds: null,
    boxes: [],          /* every solid thing, as an axis-aligned box */
    hash: null,
    cell: 44,
    decor: [],          /* footprints for the radar */
    start: new THREE.Vector3(),
    startYaw: Math.PI / 2,
    finish: new THREE.Vector3(),
    gps: null,
    time: 0,

    GRID: GRID, PITCH: PITCH, ROAD_HALF: ROAD_HALF, X0: X0,
    nodeX: nodeX,
    BLOCKS: BLOCKS,

    /* ------------------------------------------------------- */
    build: function (scene) {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.ramps.length = 0;
      this.pads.length = 0;
      this.traffic.length = 0;
      this.boxes.length = 0;
      this.decor.length = 0;
      this.rnd = U.seeded(20251018);


      this.start.set(nodeX(START_I), 0, nodeX(START_J));
      this.finish.set(nodeX(FINISH_I), 0, nodeX(FINISH_J));
      this.startYaw = Math.PI / 2;            /* facing +x */

      buildSky(this, scene);
      buildGround(this);
      buildRoads(this);
      buildBlocks(this);
      buildStreetRamps(this);
      buildPads(this);
      buildTraffic(this);
      buildOutskirts(this);
      buildGates(this);
      buildHash(this);
      buildGPS(this);
      buildRouteMesh(this);
      buildConfetti(this);
      buildSpill(this);

      return this;
    },

    /* ----------------------------------------------------------
       Ground height and surface under a point. Flat everywhere
       except on ramps and on the roofs of buildings you have
       managed to get on top of.
       ---------------------------------------------------------- */
    groundAt: function (x, z, y, out) {
      out = out || {};
      out.y = 0;
      out.nx = 0; out.ny = 1; out.nz = 0;
      out.ramp = null;
      out.surface = surfaceAt(x, z);

      var i;
      for (i = 0; i < this.ramps.length; i++) {
        var r = this.ramps[i];
        var dx = x - r.x, dz = z - r.z;
        var lz = dx * r.fx + dz * r.fz;
        var lx = dx * r.rx + dz * r.rz;
        if (lz < -0.5 || lz > r.len || Math.abs(lx) > r.half) continue;
        var clz = Math.max(0, lz), h, nx, ny, nz, slope;
        if (r.twistTan) {
          /* Ruled surface: height rises with distance up the ramp and
             tilts with distance across it, the tilt growing from none
             at the foot to the full bank at the lip. The normal is the
             gradient of exactly that, turned back into world axes - the
             tyres have to feel the bank, or the twist is only paint. */
          var f = clz / r.len;
          h = clz * r.tan + lx * r.twistTan * f;
          slope = r.tan + lx * r.twistTan / r.len;
          var across = r.twistTan * f;
          nx = -across * r.rx - slope * r.fx;
          nz = -across * r.rz - slope * r.fz;
          ny = 1;
          var inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx *= inv; ny *= inv; nz *= inv;
        } else {
          h = clz * r.tan;
          slope = r.tan;
          nx = -r.fx * r.sin; ny = r.cos; nz = -r.fz * r.sin;
        }
        if (h > out.y) {
          out.y = h;
          out.nx = nx; out.ny = ny; out.nz = nz;
          out.ramp = r;
          out.rampTan = slope;
          out.surface = 'road';
        }
      }

      /* roofs: only once you are actually up at that height */
      if (y !== undefined && y > 2) {
        var list = this.query(x, z);
        for (i = 0; i < list.length; i++) {
          var b = list[i];
          if (!b.walkable) continue;
          if (x < b.x - b.hw || x > b.x + b.hw) continue;
          if (z < b.z - b.hd || z > b.z + b.hd) continue;
          if (y > b.top - 0.9 && b.top > out.y) {
            out.y = b.top;
            out.nx = 0; out.ny = 1; out.nz = 0;
            out.ramp = null;
            out.surface = 'roof';
          }
        }
      }
      return out;
    },

    gripAt: function (surface) { return SURF_GRIP[surface] || 1; },
    dragAt: function (surface) { return SURF_DRAG[surface] || 0; },

    /* boxes near a point, from the spatial hash */
    query: function (x, z) {
      _scratch.length = 0;
      var cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
      for (var a = -1; a <= 1; a++) {
        for (var b = -1; b <= 1; b++) {
          var bucket = this.hash[(cx + a) + ':' + (cz + b)];
          if (!bucket) continue;
          for (var k = 0; k < bucket.length; k++) {
            var box = bucket[k];
            if (_scratch.indexOf(box) === -1) _scratch.push(box);
          }
        }
      }
      return _scratch;
    },

    /* ----------------------------------------------------------
       GPS. Two separate answers, because they are different
       questions:

         remaining  how far is left, as the crow and a bold
                    driver would go. Falls smoothly as you cut
                    through a park, so the HUD never jumps.

         node       which junction the suggested route should
                    start from. Must be one you could reach by
                    driving down the street you are on - routing
                    diagonally sends the line through a building.
       ---------------------------------------------------------- */
    routeFrom: function (x, z) {
      var g = this.gps;
      var lo = nodeX(0) - ROAD_HALF, hi = nodeX(GRID - 1) + ROAD_HALF;
      var node = -1, nodeCost = Infinity;
      var remaining = Infinity;

      function street(i, j, cost) {
        if (i < 0 || i >= GRID || j < 0 || j >= GRID) return;
        var c = cost + g.dist[j * GRID + i];
        if (c < nodeCost) { nodeCost = c; node = j * GRID + i; }
      }

      /* on an east-west street: the two junctions either side of us */
      var gj = Math.round((z - X0) / PITCH);
      if (gj >= 0 && gj < GRID && Math.abs(z - nodeX(gj)) <= ROAD_HALF && x >= lo && x <= hi) {
        var fi = (x - X0) / PITCH;
        street(U.clamp(Math.floor(fi), 0, GRID - 1), gj, Math.abs(x - nodeX(U.clamp(Math.floor(fi), 0, GRID - 1))));
        street(U.clamp(Math.ceil(fi), 0, GRID - 1), gj, Math.abs(x - nodeX(U.clamp(Math.ceil(fi), 0, GRID - 1))));
      }
      /* on a north-south street */
      var gi = Math.round((x - X0) / PITCH);
      if (gi >= 0 && gi < GRID && Math.abs(x - nodeX(gi)) <= ROAD_HALF && z >= lo && z <= hi) {
        var fj = (z - X0) / PITCH;
        street(gi, U.clamp(Math.floor(fj), 0, GRID - 1), Math.abs(z - nodeX(U.clamp(Math.floor(fj), 0, GRID - 1))));
        street(gi, U.clamp(Math.ceil(fj), 0, GRID - 1), Math.abs(z - nodeX(U.clamp(Math.ceil(fj), 0, GRID - 1))));
      }

      /* straight-line estimate over every junction in reach, for the
         distance readout and as the fallback when off the street grid */
      var ri = U.clamp(Math.round((x - X0) / PITCH), 0, GRID - 1);
      var rj = U.clamp(Math.round((z - X0) / PITCH), 0, GRID - 1);
      for (var a = -1; a <= 1; a++) {
        for (var b = -1; b <= 1; b++) {
          var i = ri + a, j = rj + b;
          if (i < 0 || i >= GRID || j < 0 || j >= GRID) continue;
          var dx = x - nodeX(i), dz = z - nodeX(j);
          var c = Math.sqrt(dx * dx + dz * dz) + g.dist[j * GRID + i];
          if (c < remaining) remaining = c;
          if (node < 0 && c < nodeCost) { nodeCost = c; node = j * GRID + i; }
        }
      }

      return { node: node, remaining: remaining };
    },

    /* node list from a start node to the finish, preferring straight on */
    pathFrom: function (node) {
      var g = this.gps, out = [node], guard = 0;
      while (g.dist[node] > 0 && guard++ < 160) {
        var i = node % GRID, j = (node / GRID) | 0;
        var byI = -1, byJ = -1;
        var cand = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
        for (var k = 0; k < cand.length; k++) {
          var ci = cand[k][0], cj = cand[k][1];
          if (ci < 0 || ci >= GRID || cj < 0 || cj >= GRID) continue;
          var nn = cj * GRID + ci;
          if (g.dist[nn] !== g.dist[node] - PITCH) continue;
          if (ci !== i) byI = nn; else byJ = nn;
        }
        if (byI < 0 && byJ < 0) break;

        /* Close down whichever axis has further to go, and alternate on a
           tie. That staircases the route through the middle of town.

           It has to decide this from the current node alone: the route is
           rebuilt several times a second from wherever you are, so any
           rule that depends on how you arrived gets reset on every rebuild
           and the path collapses onto the two outside edges. */
        var di = Math.abs(FINISH_I - i), dj = Math.abs(FINISH_J - j);
        var wantI = di > dj ? true : dj > di ? false : ((i + j) % 2 === 0);
        var pick = wantI ? (byI >= 0 ? byI : byJ) : (byJ >= 0 ? byJ : byI);

        node = pick;
        out.push(node);
      }
      return out;
    },

    setRoute: function (nodes) {
      var key = nodes.join(',');
      if (key === this._routeKey) return;
      this._routeKey = key;
      this.routeNodes = nodes;

      /* One quad per straight run plus a square patch at each corner.
         Carrying a single cross-section through a node cannot work: at a
         90 degree turn the end edge of the incoming segment ends up lying
         along the road instead of across it, which tears the ribbon open
         at every corner. */
      var pos = [], uv = [], idx = [], half = 2.2, run = 0, quads = 0;

      function quad(ax, az, bx, bz, rx, rz, u0, u1) {
        pos.push(ax - rx * half, 0.09, az - rz * half);
        pos.push(ax + rx * half, 0.09, az + rz * half);
        pos.push(bx - rx * half, 0.09, bz - rz * half);
        pos.push(bx + rx * half, 0.09, bz + rz * half);
        uv.push(0, u0, 1, u0, 0, u1, 1, u1);
        var a = quads * 4;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        quads++;
      }

      for (var k = 0; k < nodes.length - 1; k++) {
        var i0 = nodes[k] % GRID, j0 = (nodes[k] / GRID) | 0;
        var i1 = nodes[k + 1] % GRID, j1 = (nodes[k + 1] / GRID) | 0;
        var x0 = nodeX(i0), z0 = nodeX(j0), x1 = nodeX(i1), z1 = nodeX(j1);
        var dx = x1 - x0, dz = z1 - z0;
        var seg = Math.hypot(dx, dz) || 1;
        var tx = dx / seg, tz = dz / seg;

        /* stop short of a corner so the patch there is drawn once */
        var backOff = k > 0 ? half : 0;
        var fwdOff = k < nodes.length - 2 ? half : 0;
        quad(x0 + tx * backOff, z0 + tz * backOff,
          x1 - tx * fwdOff, z1 - tz * fwdOff,
          tz, -tx, (run + backOff) / 11, (run + seg - fwdOff) / 11);
        run += seg;

        /* the corner itself, square and axis aligned */
        if (k < nodes.length - 2) {
          quad(x1 - half, z1, x1 + half, z1, 0, 1, run / 11, run / 11 + 0.4);
        }
      }
      var g = this.routeMesh.geometry;
      g.dispose();
      var ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      ng.setIndex(idx);
      this.routeMesh.geometry = ng;
      this.routeMesh.visible = nodes.length > 1;
    },

    /* ---- per-frame world animation ---- */
    update: function (dt, carPos) {
      this.time += dt;
      var t = M.tex.routeStrip();
      t.offset.y = -this.time * 0.55;

      updatePads(this, dt);
      for (var h = 0; h < this.ramps.length; h++) {
        var rh = this.ramps[h];
        if (!rh.holo) continue;
        rh.holo.position.y = rh.holoY + Math.sin(this.time * 2.1 + h) * 0.45;
        rh.holo.material.opacity = 0.72 + Math.sin(this.time * 3.4 + h) * 0.22;
      }
      updateTraffic(this, dt, carPos);
      updateConfetti(this, dt);
      updateSpill(this, dt);
      updateParty(this, dt);
      updateDrop(this, dt, carPos);
    },

    /* ----------------------------------------------------------
       A crate shaken out of the bed. The tempo hands over the
       crate's world position and how fast it was going; from
       there it is the road's problem.
       ---------------------------------------------------------- */
    dropCrate: function (d) {
      var c = this.spill[this._spillNext % this.spill.length];
      this._spillNext++;
      c.life = SPILL_LIFE;
      c.x = d.x; c.y = d.y; c.z = d.z;
      /* thrown back over the tailgate, not dropped straight down */
      c.vx = d.vx * 0.55 + (Math.random() - 0.5) * 3;
      c.vy = 2.2 + Math.random() * 1.8;
      c.vz = d.vz * 0.55 + (Math.random() - 0.5) * 3;
      c.rx = (Math.random() - 0.5) * 9;
      c.ry = (Math.random() - 0.5) * 9;
      c.rz = (Math.random() - 0.5) * 9;
      c.ax = Math.random() * 6.3; c.ay = Math.random() * 6.3; c.az = Math.random() * 6.3;
      c.rest = 0;
      c.mesh.visible = true;
      return c;
    },

    burst: function (x, y, z, spread) {
      var w = spread || 6;
      for (var i = 0; i < this.confetti.length; i++) {
        var c = this.confetti[i];
        c.life = 1.4 + Math.random() * 1.4;
        c.sprite.visible = true;
        c.sprite.position.set(x + (Math.random() - 0.5) * w, y + Math.random() * 2, z + (Math.random() - 0.5) * w);
        c.vx = (Math.random() - 0.5) * 14;
        c.vy = 9 + Math.random() * 13;
        c.vz = (Math.random() - 0.5) * 14;
      }
    },

    /* ----------------------------------------------------------
       The in-world payoff for a delivery, fired once.

       `tier` is how intact the load was when it arrived, and it is
       worth showing out here rather than only on the result card:
       bringing every crate across is the hardest thing in the game
       and it should look like the forecourt knows it. A clean run
       gets the gold column; a pristine one keeps the confetti
       coming; a perfect one throws it in gold, from four corners,
       for a good three seconds.
       ---------------------------------------------------------- */
    celebrate: function (tier) {
      var d = this.drop;
      if (d && !d.won) {
        d.won = 0.0001;
        d.beam.material.color.setHex(0xffd79a);
        d.core.material.color.setHex(0xfff0cc);
        d.apron.material.color.setHex(0xffe9bd);
        for (var i = 0; i < d.rings.length; i++) d.rings[i].m.material.color.setHex(0xffe3ae);
      }

      this.partyTier = tier || '';
      if (tier === 'perfect') {
        /* every fleck turned gold for the duration, put back on reset */
        for (var g = 0; g < this.confetti.length; g++) {
          this.confetti[g].sprite.material.color.setHex(GOLD[g % GOLD.length]);
        }
        this.party = 3.0;
      } else if (tier === 'pristine') {
        this.party = 1.7;
      } else {
        this.party = 0;
      }
      this.partyTick = 0;
      this.burst(this.finish.x, 3, this.finish.z, tier === 'perfect' ? 26 : 6);
    },

    reset: function () {
      var d = this.drop;
      if (d) {
        d.won = 0;
        d.sign.visible = false;
        d.wave.visible = false;
        d.beam.material.color.setHex(0xffffff);
        d.core.material.color.setHex(0xffffff);
        d.apron.material.color.setHex(0xffffff);
        for (var i = 0; i < d.rings.length; i++) d.rings[i].m.material.color.setHex(0xb6ffd8);
      }
      this.pads.forEach(function (p) { p.cooldown = 0; });
      updatePads(this, 0);
      this.traffic.forEach(function (t) {
        t.x = t.x0; t.z = t.z0; t.shove = 0; t.cruise = t.speed; t.vx = 0; t.vz = 0;
      });
      updateTraffic(this, 0, null);
      this.confetti.forEach(function (c) {
        c.life = 0;
        c.sprite.visible = false;
        c.sprite.material.color.setHex(c.col);   /* undo a gold party */
      });
      this.spill.forEach(function (c) { c.life = 0; c.mesh.visible = false; });
      this._spillNext = 0;
      this.party = 0;
      this.partyTier = '';
      this._routeKey = null;
    }
  };

  /* ===========================================================
     surface lookup
     =========================================================== */
  function surfaceAt(x, z) {
    var lo = nodeX(0) - ROAD_HALF, hi = nodeX(GRID - 1) + ROAD_HALF;
    var gi = Math.round((x - X0) / PITCH), gj = Math.round((z - X0) / PITCH);

    if (gi >= 0 && gi < GRID && Math.abs(x - nodeX(gi)) <= ROAD_HALF &&
      z >= lo && z <= hi) return 'road';
    if (gj >= 0 && gj < GRID && Math.abs(z - nodeX(gj)) <= ROAD_HALF &&
      x >= lo && x <= hi) return 'road';

    var bi = Math.floor((x - X0) / PITCH), bj = Math.floor((z - X0) / PITCH);
    if (bi < 0 || bi >= GRID - 1 || bj < 0 || bj >= GRID - 1) return 'grass';
    var t = BLOCKS[bj][bi];
    if (t === 'P') return 'grass';
    if (t === 'G') return 'plaza';
    if (t === 'S') return 'dirt';
    return 'walk';
  }
  W.surfaceAt = surfaceAt;

  /* ===========================================================
     quad-soup helper - everything flat is merged into one mesh
     =========================================================== */
  function Quads() { this.pos = []; this.uv = []; this.idx = []; this.n = 0; }
  Quads.prototype.add = function (x0, z0, x1, z1, y, u, v, swap) {
    this.pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    if (swap) this.uv.push(0, 0, 0, u, v, 0, v, u);
    else this.uv.push(0, 0, u, 0, 0, v, u, v);
    var a = this.n * 4;
    this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    this.n++;
  };
  Quads.prototype.mesh = function (map, receive) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: map, roughness: 0.95, metalness: 0
    }));
    m.receiveShadow = !!receive;
    return m;
  };

  /* ===========================================================
     world pieces
     =========================================================== */
  function buildSky(w, scene) {
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 32, 20),
      new THREE.MeshBasicMaterial({
        map: M.tex.sky(), side: THREE.BackSide, fog: false, depthWrite: false
      })
    );
    sky.renderOrder = -1;
    scene.add(sky);
    w.sky = sky;
  }

  function buildGround(w) {
    var g = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      /* polygonOffset pushes this away from the camera in depth. The
         city surfaces sit only centimetres above it, and at the grazing
         angles you drive at that tie is too close to call - without the
         offset the open ground wins and paints over the tarmac. */
      new THREE.MeshStandardMaterial({
        map: M.tex.grass().clone(), roughness: 1,
        polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 12
      })
    );
    g.material.map.repeat.set(620, 620);
    g.material.map.needsUpdate = true;
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.3;
    g.receiveShadow = true;
    w.group.add(g);
  }

  function buildRoads(w) {
    var seg = new Quads(), jun = new Quads(), walk = new Quads();
    var i, j;

    /* streets running east-west */
    for (j = 0; j < GRID; j++) {
      for (i = 0; i < GRID - 1; i++) {
        var x0 = nodeX(i) + ROAD_HALF, x1 = nodeX(i + 1) - ROAD_HALF;
        seg.add(x0, nodeX(j) - ROAD_HALF, x1, nodeX(j) + ROAD_HALF, 0, (x1 - x0) / 14, 1, true);
      }
    }
    /* streets running north-south */
    for (i = 0; i < GRID; i++) {
      for (j = 0; j < GRID - 1; j++) {
        var z0 = nodeX(j) + ROAD_HALF, z1 = nodeX(j + 1) - ROAD_HALF;
        seg.add(nodeX(i) - ROAD_HALF, z0, nodeX(i) + ROAD_HALF, z1, 0, 1, (z1 - z0) / 14);
      }
    }
    /* intersections */
    for (i = 0; i < GRID; i++) {
      for (j = 0; j < GRID; j++) {
        jun.add(nodeX(i) - ROAD_HALF, nodeX(j) - ROAD_HALF,
          nodeX(i) + ROAD_HALF, nodeX(j) + ROAD_HALF, 0.002, 1.6, 1.6);
      }
    }
    /* pavement ring round every block */
    for (i = 0; i < GRID - 1; i++) {
      for (j = 0; j < GRID - 1; j++) {
        var bx0 = nodeX(i) + ROAD_HALF, bx1 = nodeX(i + 1) - ROAD_HALF;
        var bz0 = nodeX(j) + ROAD_HALF, bz1 = nodeX(j + 1) - ROAD_HALF;
        walk.add(bx0, bz0, bx1, bz0 + SW, 0.055, BLOCK_IN / 6, SW / 6);
        walk.add(bx0, bz1 - SW, bx1, bz1, 0.055, BLOCK_IN / 6, SW / 6);
        walk.add(bx0, bz0 + SW, bx0 + SW, bz1 - SW, 0.055, SW / 6, BLOCK_IN / 6);
        walk.add(bx1 - SW, bz0 + SW, bx1, bz1 - SW, 0.055, SW / 6, BLOCK_IN / 6);
      }
    }
    w.group.add(seg.mesh(M.tex.road(), true));
    w.group.add(jun.mesh(M.tex.junction(), true));
    w.group.add(walk.mesh(M.tex.walk(), true));
  }

  /* ---- a solid thing in the world ---- */
  function addBox(w, x, z, hw, hd, top, walkable) {
    var b = { x: x, z: z, hw: hw, hd: hd, top: top, walkable: !!walkable };
    w.boxes.push(b);
    return b;
  }

  function buildHash(w) {
    w.hash = Object.create(null);
    for (var k = 0; k < w.boxes.length; k++) {
      var b = w.boxes[k];
      var i0 = Math.floor((b.x - b.hw) / w.cell), i1 = Math.floor((b.x + b.hw) / w.cell);
      var j0 = Math.floor((b.z - b.hd) / w.cell), j1 = Math.floor((b.z + b.hd) / w.cell);
      for (var i = i0; i <= i1; i++) {
        for (var j = j0; j <= j1; j++) {
          var key = i + ':' + j;
          (w.hash[key] || (w.hash[key] = [])).push(b);
        }
      }
    }
  }

  /* ===========================================================
     blocks
     =========================================================== */
  function buildBlocks(w) {
    var surfaces = {
      grass: new Quads(), plaza: new Quads(), dirt: new Quads(), walk: new Quads()
    };
    var houses = [];
    for (var h = 0; h < M.HOUSE_COLORS.length; h++) houses.push([]);

    for (var i = 0; i < GRID - 1; i++) {
      for (var j = 0; j < GRID - 1; j++) {
        var t = BLOCKS[j][i];
        var bx0 = nodeX(i) + ROAD_HALF + SW, bx1 = nodeX(i + 1) - ROAD_HALF - SW;
        var bz0 = nodeX(j) + ROAD_HALF + SW, bz1 = nodeX(j + 1) - ROAD_HALF - SW;
        var cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
        var size = bx1 - bx0;

        var key = t === 'P' ? 'grass' : t === 'G' ? 'plaza' : t === 'S' ? 'dirt' : 'walk';
        surfaces[key].add(bx0, bz0, bx1, bz1, 0.05, size / 9, size / 9);

        if (t === 'B') soloTower(w, houses, cx, cz, size);
        else if (t === 'b') courtyard(w, houses, cx, cz, size);
        else if (t === 'A') alleyBlock(w, houses, cx, cz, size, i % 2 === 0);
        else if (t === 'P') park(w, cx, cz, size);
        else if (t === 'G') plaza(w, cx, cz, size);
        else if (t === 'S') site(w, cx, cz, size);
      }
    }

    w.group.add(surfaces.grass.mesh(M.tex.grass(), true));
    w.group.add(surfaces.plaza.mesh(M.tex.plaza(), true));
    w.group.add(surfaces.dirt.mesh(M.tex.dirt(), true));
    w.group.add(surfaces.walk.mesh(M.tex.walk(), true));

    /* one instanced mesh per facade colour */
    houses.forEach(function (list, idx) {
      if (!list.length) return;
      var mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        /* Lights on. The emissive map is the same window grid with
           most panes left black, so only the lit ones glow - which is
           what turns a row of blocks into a city at dusk. */
        new THREE.MeshStandardMaterial({
          map: M.tex.facade(idx), roughness: 0.8, metalness: 0.02,
          emissive: 0xffffff, emissiveMap: M.tex.facadeLit(idx), emissiveIntensity: 1.25
        }),
        list.length
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(),
        p = new THREE.Vector3(), s = new THREE.Vector3();
      list.forEach(function (b, k) {
        p.set(b.x, b.h / 2, b.z);
        s.set(b.w, b.h, b.d);
        m4.compose(p, q, s);
        mesh.setMatrixAt(k, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      w.group.add(mesh);
    });
  }

  /* one building: collider + instance + a flat roof cap */
  function house(w, houses, x, z, bw, bd, h) {
    var idx = Math.floor(w.rnd() * M.HOUSE_COLORS.length);
    houses[idx].push({ x: x, z: z, w: bw, d: bd, h: h });
    addBox(w, x, z, bw / 2, bd / 2, h, true);
    w.decor.push({ x: x, z: z, w: bw, d: bd });

    var cap = new THREE.Mesh(
      new THREE.BoxGeometry(bw + 0.8, 0.9, bd + 0.8),
      new THREE.MeshStandardMaterial({
        /* the parapet takes the building's own colour, knocked back,
           so the city still reads as colourful from the air */
        color: new THREE.Color(M.HOUSE_COLORS[idx]).multiplyScalar(0.68),
        roughness: 0.9
      })
    );
    cap.position.set(x, h + 0.2, z);
    cap.castShadow = true;
    w.group.add(cap);
  }

  function soloTower(w, houses, cx, cz, size) {
    var s = size - 4;
    house(w, houses, cx, cz, s, s, 26 + w.rnd() * 30);
  }

  function courtyard(w, houses, cx, cz, size) {
    /* four buildings round an open middle - squeezable both ways */
    var lot = size / 2, bs = lot - 9;
    for (var a = -1; a <= 1; a += 2) {
      for (var b = -1; b <= 1; b += 2) {
        house(w, houses,
          cx + a * (lot / 2 + 1.5), cz + b * (lot / 2 + 1.5),
          bs, bs, 16 + w.rnd() * 22);
      }
    }
    /* planters in the corners of the courtyard, never in the gaps */
    for (var c = -1; c <= 1; c += 2) {
      var pl = new THREE.Mesh(
        new THREE.BoxGeometry(3, 1.1, 3),
        new THREE.MeshStandardMaterial({ color: 0xc98a62, roughness: 0.95 })
      );
      pl.position.set(cx + c * (lot / 2 + 1.5), 0.55, cz - c * (lot / 2 + 1.5));
      pl.castShadow = true;
      w.group.add(pl);
    }
  }

  function alleyBlock(w, houses, cx, cz, size, northSouth) {
    var s = size, gap = 13;
    var slab = (s - gap) / 2;
    for (var k = -1; k <= 1; k += 2) {
      var off = k * (gap / 2 + slab / 2);
      if (northSouth) house(w, houses, cx + off, cz, slab, s, 20 + w.rnd() * 20);
      else house(w, houses, cx, cz + off, s, slab, 20 + w.rnd() * 20);
    }
  }

  function park(w, cx, cz, size) {
    var r = size / 2;
    /* everything here is pushed off the middle so both diagonals
       stay open - the park is meant to be a shortcut */
    cx -= r * 0.46; cz += r * 0.46;
    /* fountain in the middle - a real obstacle, drive round it */
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5.6, 1.5, 18),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 0.85 })
    );
    base.position.set(cx, 0.75, cz);
    base.castShadow = base.receiveShadow = true;
    w.group.add(base);
    var water = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 4.4, 0.2, 18),
      new THREE.MeshStandardMaterial({ color: 0x66c2e8, roughness: 0.2, metalness: 0.3 })
    );
    water.position.set(cx, 1.5, cz);
    w.group.add(water);
    var spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 3.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 })
    );
    spout.position.set(cx, 2.8, cz);
    w.group.add(spout);
    addBox(w, cx, cz, 5.6, 5.6, 4.4, false);

    cx += r * 0.46; cz -= r * 0.46;            /* back to the block centre */

    /* trees round the rim, well clear of the diagonals */
    var ring = r - 5;
    for (var a = 0; a < 8; a++) {
      var ang = a / 8 * Math.PI * 2 + 0.39;
      var tx = cx + Math.cos(ang) * ring, tz = cz + Math.sin(ang) * ring;
      w.group.add(treeMesh(w, tx, tz, 1 + w.rnd() * 0.5));
      addBox(w, tx, tz, 0.9, 0.9, 6, false);
    }
    /* flower beds for colour */
    for (var f = 0; f < 4; f++) {
      var bed = new THREE.Mesh(
        new THREE.BoxGeometry(7, 0.5, 7),
        new THREE.MeshStandardMaterial({
          color: [0xef8fa8, 0xf6d65c, 0xb79ae0, 0xf2896f][f], roughness: 1
        })
      );
      bed.position.set(cx + (f % 2 ? 1 : -1) * (r - 5), 0.3, cz + (f < 2 ? -1 : 1) * (r - 5));
      bed.receiveShadow = true;
      w.group.add(bed);
    }
  }

  function plaza(w, cx, cz, size) {
    var r = size / 2;
    /* market stalls round the rim, open middle to drive through */
    var cols = [0xe8785f, 0xf2c14e, 0x6fc9a8, 0x6fa8dc];
    for (var k = 0; k < 6; k++) {
      var ang = k / 6 * Math.PI * 2 + 0.5;
      var sx = cx + Math.cos(ang) * (r - 6), sz = cz + Math.sin(ang) * (r - 6);
      var stall = new THREE.Group();
      var top = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.4, 5),
        new THREE.MeshStandardMaterial({ color: cols[k % 4], roughness: 0.8 })
      );
      top.position.y = 3.1; top.castShadow = true;
      stall.add(top);
      for (var c = -1; c <= 1; c += 2) {
        for (var d = -1; d <= 1; d += 2) {
          var leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 3, 0.25),
            new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.9 })
          );
          leg.position.set(c * 2.7, 1.5, d * 2.2);
          stall.add(leg);
        }
      }
      var counter = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 1.1, 4.4),
        new THREE.MeshStandardMaterial({ color: 0xe3d9c4, roughness: 0.9 })
      );
      counter.position.y = 0.55; counter.castShadow = true;
      stall.add(counter);
      stall.position.set(sx, 0, sz);
      stall.rotation.y = -ang;
      w.group.add(stall);
      addBox(w, sx, sz, 3.2, 3.0, 3.4, false);
    }
    /* bunting across the square */
    for (var b = -1; b <= 1; b += 2) {
      var strip = new THREE.Mesh(
        new THREE.PlaneGeometry(size - 10, 2.4),
        new THREE.MeshStandardMaterial({
          map: M.tex.bunting().clone(), transparent: true,
          side: THREE.DoubleSide, roughness: 1, alphaTest: 0.3
        })
      );
      strip.material.map.repeat.set(7, 1);
      strip.material.map.needsUpdate = true;
      strip.position.set(cx, 6.4, cz + b * 9);
      w.group.add(strip);
    }
  }

  function site(w, cx, cz, size) {
    /* Construction lot. The kickers used to live out here, which meant
       the best stunts in the game were off the route, behind a hoarding,
       in the one place you have no reason to drive. They are all out on
       the streets now; this is a dirt shortcut with obstacles. */
    var r = size / 2;

    /* scaffold tower in the corner */
    var tower = new THREE.Group();
    var barMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.5, metalness: 0.7 });
    for (var lv = 0; lv < 4; lv++) {
      for (var e = -1; e <= 1; e += 2) {
        var bar = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 0.3), barMat);
        bar.position.set(0, lv * 4 + 2, e * 5); tower.add(bar);
        var bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 10), barMat);
        bar2.position.set(e * 5, lv * 4 + 2, 0); tower.add(bar2);
      }
    }
    for (var p = -1; p <= 1; p += 2) {
      for (var q = -1; q <= 1; q += 2) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.36, 16, 0.36), barMat);
        post.position.set(p * 5, 8, q * 5);
        post.castShadow = true;
        tower.add(post);
      }
    }
    tower.position.set(cx + r - 10, 0, cz + r - 10);
    w.group.add(tower);
    addBox(w, cx + r - 10, cz + r - 10, 5.4, 5.4, 16, false);

    /* material piles and a site hut */
    var hut = new THREE.Mesh(
      new THREE.BoxGeometry(9, 3.2, 6),
      new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.8 })
    );
    hut.position.set(cx + r - 9, 1.6, cz - r + 8);
    hut.castShadow = true;
    w.group.add(hut);
    addBox(w, cx + r - 9, cz - r + 8, 4.5, 3, 3.2, true);

    for (var s = 0; s < 3; s++) {
      var pile = new THREE.Mesh(
        new THREE.BoxGeometry(5, 1.6, 3),
        new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 1 })
      );
      pile.position.set(cx - r + 10 + s * 7, 0.8, cz + r - 8);
      pile.castShadow = true;
      w.group.add(pile);
      addBox(w, cx - r + 10 + s * 7, cz + r - 8, 2.5, 1.5, 1.6, true);
    }
  }

  function treeMesh(w, x, z, sc) {
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.42, 3.6, 7),
      new THREE.MeshStandardMaterial({ color: 0x7a5435, roughness: 1 })
    );
    trunk.position.y = 1.8;
    g.add(trunk);
    var leafCols = [0x5fa83f, 0x74bd4a, 0x4e9637];
    for (var k = 0; k < 3; k++) {
      var blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.3 - k * 0.45, 0),
        new THREE.MeshStandardMaterial({
          color: leafCols[k % 3], roughness: 0.95, flatShading: true
        })
      );
      blob.position.set((w.rnd() - 0.5) * 1.3, 4.2 + k * 1.5, (w.rnd() - 0.5) * 1.3);
      blob.castShadow = true;
      g.add(blob);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(sc);
    return g;
  }

  /* ===========================================================
     open country past the last junction
     =========================================================== */
  function buildOutskirts(w) {
    /* The street grid has to stop somewhere. What it must not do is
       stop into nothing, which just reads as the edge of the map, so
       the city sits in open country: fields, hedge lines and orchards
       running well past anywhere the delivery takes you. Still no wall
       - drive out there if you like, it only costs you the clock. */
    var rim = nodeX(GRID - 1) + ROAD_HALF + SW;
    var OUT = 760;

    /* fields, laid just above the open ground */
    var fields = new Quads();
    var fy = -0.22;
    for (var fx = -OUT; fx < OUT; fx += 95) {
      for (var fz = -OUT; fz < OUT; fz += 95) {
        if (Math.abs(fx) < rim && Math.abs(fz) < rim) continue;
        if (w.rnd() < 0.45) continue;
        var pw = 62 + w.rnd() * 26, pd = 62 + w.rnd() * 26;
        fields.add(fx, fz, fx + pw, fz + pd, fy, pw / 11, pd / 11);
      }
    }
    var fieldMesh = fields.mesh(M.tex.grass(), true);
    fieldMesh.material.color.setHex(0xd8d2a4);
    fieldMesh.material.roughness = 1;
    w.group.add(fieldMesh);

    /* orchards and hedge lines, instanced so the whole ring is 3 draws */
    var raw = [];
    for (var n = 0; n < 900 && raw.length < 420; n++) {
      raw.push([(w.rnd() * 2 - 1) * OUT, (w.rnd() * 2 - 1) * OUT, 0.8 + w.rnd() * 0.6]);
    }
    for (var h = 0; h < 26; h++) {
      var hx = (w.rnd() * 2 - 1) * OUT, hz = (w.rnd() * 2 - 1) * OUT;
      var along = w.rnd() < 0.5;
      for (var q = 0; q < 14; q++) {
        raw.push([hx + (along ? q * 5.5 : 0), hz + (along ? 0 : q * 5.5), 0.55]);
      }
    }
    /* Filter every tree, not just where a row started: a hedge laid down
       outside the rim is 70 m long and will happily grow across a street. */
    var spots = [], keepOut = rim + 7;
    for (var f = 0; f < raw.length; f++) {
      if (Math.abs(raw[f][0]) < keepOut && Math.abs(raw[f][1]) < keepOut) continue;
      spots.push(raw[f]);
    }

    var trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 3.6, 6);
    var leafGeo = new THREE.IcosahedronGeometry(2.6, 0);
    var trunks = new THREE.InstancedMesh(trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x7a5435, roughness: 1 }), spots.length);
    var leaves = new THREE.InstancedMesh(leafGeo,
      new THREE.MeshStandardMaterial({ color: 0x5fa83f, roughness: 0.95, flatShading: true }),
      spots.length);
    leaves.castShadow = true;

    var m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(),
      vp = new THREE.Vector3(), vs = new THREE.Vector3();
    for (var k = 0; k < spots.length; k++) {
      var sx = spots[k][0], sz = spots[k][1], sc = spots[k][2];
      vp.set(sx, 1.8 * sc, sz); vs.set(sc, sc, sc);
      trunks.setMatrixAt(k, m4.compose(vp, qt, vs));
      vp.set(sx, 4.9 * sc, sz);
      leaves.setMatrixAt(k, m4.compose(vp, qt, vs));
      addBox(w, sx, sz, 1.5 * sc, 1.5 * sc, 7 * sc, false);
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    w.group.add(trunks, leaves);
  }

  /* ===========================================================
     nitro - floating, not painted on the road
     =========================================================== */
  var PAD_Y = 2.9;

  function buildPads(w) {
    function pad(x, z, y) {
      w.pads.push({ x: x, y: y === undefined ? PAD_Y : y, z: z, cooldown: 0, phase: w.pads.length * 0.8 });
    }

    /* down the middle of the street, where the racing line is */
    for (var i = 0; i < GRID - 1; i++) {
      for (var j = 0; j < GRID; j++) {
        if ((i + j) % 2) continue;
        pad(nodeX(i) + PITCH / 2, nodeX(j));
      }
    }
    for (var j2 = 0; j2 < GRID - 1; j2++) {
      for (var i2 = 0; i2 < GRID; i2++) {
        if ((i2 + j2) % 2 === 0) continue;
        pad(nodeX(i2), nodeX(j2) + PITCH / 2);
      }
    }
    /* and one in the middle of every park and plaza, to reward cutting through */
    for (var bi = 0; bi < GRID - 1; bi++) {
      for (var bj = 0; bj < GRID - 1; bj++) {
        var t = BLOCKS[bj][bi];
        if (t !== 'P' && t !== 'G') continue;
        var cx = nodeX(bi) + PITCH / 2, cz = nodeX(bj) + PITCH / 2;
        pad(cx - 20, cz - 20);
        pad(cx, cz);
        pad(cx + 20, cz + 20);
      }
    }

    /* A line of three strung out past every barrel-roll lip, along the
       arc you leave on. There is no way to reach these with four wheels
       down, which is the point: the roll has to pay for itself. */
    for (var k = 0; k < w.ramps.length; k++) {
      var r = w.ramps[k];
      if (!r.twist) continue;
      var lx = r.x + r.fx * r.len, lz = r.z + r.fz * r.len;
      var ly = deckY(r, 0, r.len);
      for (var a = 1; a <= 3; a++) {
        pad(lx + r.fx * (a * 11), lz + r.fz * (a * 11), ly + 3.2 + a * 1.4 - a * a * 0.42);
      }
    }

    var N = w.pads.length;
    /* Instanced, because a bottle made of four meshes times a hundred
       pickups is four hundred draw calls for scenery you fly past. */
    var core = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1.0, 0),
      /* Lit, not luminous. At full emissive under this sun it clipped
         to a white blob with no shape at all - you could see that
         something was there and not what. */
      new THREE.MeshStandardMaterial({
        color: 0xffa522, emissive: 0xc24e00, emissiveIntensity: 0.45,
        roughness: 0.35, metalness: 0.15, flatShading: true
      }), N);
    var ring = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1.55, 0.11, 4, 11),
      new THREE.MeshStandardMaterial({
        color: 0xffd98a, emissive: 0xb86a00, emissiveIntensity: 0.4, roughness: 0.4
      }), N);
    core.frustumCulled = false;
    ring.frustumCulled = false;
    w.padMesh = { core: core, ring: ring };
    w.group.add(core, ring);
    updatePads(w, 0);
  }

  var _pq = new THREE.Quaternion(), _pe = new THREE.Euler(),
    _pv = new THREE.Vector3(), _ps = new THREE.Vector3(), _pm = new THREE.Matrix4();

  function updatePads(w, dt) {
    var m = w.padMesh;
    if (!m) return;
    for (var i = 0; i < w.pads.length; i++) {
      var p = w.pads[i];
      if (p.cooldown > 0) p.cooldown -= dt;
      /* A collected bottle is scaled away rather than hidden: an
         instance has no visible flag of its own to turn off. */
      var sc = p.cooldown > 0 ? 0.0001 : 1;
      var bob = Math.sin(w.time * 2.2 + p.phase) * 0.3;

      _pv.set(p.x, p.y + bob, p.z);
      _ps.set(sc, sc, sc);
      _pe.set(0, w.time * 1.7 + p.phase, 0.42);
      _pq.setFromEuler(_pe);
      m.core.setMatrixAt(i, _pm.compose(_pv, _pq, _ps));

      _pe.set(-Math.PI / 2, 0, -w.time * 2.4 - p.phase);
      _pq.setFromEuler(_pe);
      m.ring.setMatrixAt(i, _pm.compose(_pv, _pq, _ps));
    }
    m.core.instanceMatrix.needsUpdate = true;
    m.ring.instanceMatrix.needsUpdate = true;
  }

  /* ===========================================================
     traffic
     =========================================================== */
  /* Four body shapes rather than one box repeated. Each is a scale on
     the shared geometry plus where its glasshouse sits, so the whole
     fleet still costs the same handful of draw calls. */
  var CAR_KINDS = [
    { s: [1.00, 1.00, 1.00], cab: [0.88, 0.95, 1.00, 0.12], roof: 1.00 },  /* saloon   */
    { s: [0.94, 0.92, 0.84], cab: [0.86, 1.05, 1.20, 0.02], roof: 0.96 },  /* hatchback */
    { s: [1.08, 1.50, 1.14], cab: [0.94, 1.15, 1.75, 0.06], roof: 1.04 },  /* van      */
    { s: [1.04, 1.02, 1.20], cab: [0.90, 1.00, 0.82, -0.34], roof: 0.98 }  /* pickup   */
  ];

  function buildTraffic(w) {
    var cols = [0xd96b5a, 0x4f8fd6, 0xe5c15a, 0x5bbf9b, 0xdddddd, 0x7a6fd0,
      0xc8553d, 0x3f6f9e, 0xe8e2d4, 0x6f8f5e];
    var lo = nodeX(0) - PITCH * 0.5, hi = nodeX(GRID - 1) + PITCH * 0.5;
    var span = hi - lo;
    var PER = 13;                /* cars per street, per direction pair */
    /* Inner lanes. The kickers have the outer ones, and a car driving
       through a ramp deck looks like a bug even when it is only paint -
       so the two keep out of each other's way. It also means the lane
       with the stunts in it is the lane with nothing coming, and taking
       the clean line means threading oncoming traffic. */
    var LANE = 4.6;

    function car(x, z, yaw, speed) {
      /* Not parked on the line. A car spawned on the start gate is an
         unavoidable hit in the first second, before you have touched
         the wheel. They wrap round to here soon enough anyway. */
      if (Math.hypot(x - w.start.x, z - w.start.z) < 80) return;
      if (Math.hypot(x - w.finish.x, z - w.finish.z) < 55) return;
      var kind = Math.floor(w.rnd() * CAR_KINDS.length);
      var K = CAR_KINDS[kind];
      var halfW = 1.05 * K.s[0] + 0.15, halfL = 2.3 * K.s[2] + 0.1;
      var sideways = Math.abs(Math.sin(yaw)) > 0.5;
      w.traffic.push({
        x: x, z: z, yaw: yaw,
        fx: Math.sin(yaw), fz: Math.cos(yaw),
        cy: Math.cos(yaw), sy: Math.sin(yaw),
        speed: speed, cruise: speed,
        vx: 0, vz: 0, shove: 0,
        kind: kind,
        hw: sideways ? halfL : halfW,
        hd: sideways ? halfW : halfL,
        top: 1.1 * K.s[1] + 0.9,
        col: Math.floor(w.rnd() * cols.length), x0: x, z0: z
      });
    }

    for (var j = 0; j < GRID; j++) {
      for (var n = 0; n < PER; n++) {
        var dir = n % 2 ? 1 : -1;
        car(lo + w.rnd() * span, nodeX(j) + dir * LANE,
          dir > 0 ? Math.PI / 2 : -Math.PI / 2, 18 + w.rnd() * 11);
      }
    }
    for (var i = 0; i < GRID; i++) {
      for (var n2 = 0; n2 < PER; n2++) {
        var dir2 = n2 % 2 ? 1 : -1;
        car(nodeX(i) - dir2 * LANE, lo + w.rnd() * span,
          dir2 > 0 ? 0 : Math.PI, 18 + w.rnd() * 11);
      }
    }

    /* Instanced: two hundred cars as individual groups would be a
       couple of thousand draw calls on their own. Eight here, with
       every matrix rewritten each frame. */
    var N = w.traffic.length;
    function layer(geo, matOpts, per) {
      var mesh = new THREE.InstancedMesh(geo,
        new THREE.MeshStandardMaterial(matOpts), N * (per || 1));
      mesh.frustumCulled = false;
      return mesh;
    }
    var body = layer(new THREE.BoxGeometry(2.1, 1.1, 4.6), { roughness: 0.42, metalness: 0.35 });
    var cab = layer(new THREE.BoxGeometry(1.9, 0.8, 2.2),
      { color: 0x141c26, roughness: 0.12, metalness: 0.45 });
    var roof = layer(new THREE.BoxGeometry(1.82, 0.12, 2.0), { roughness: 0.42, metalness: 0.35 });
    var bar = layer(new THREE.BoxGeometry(2.16, 0.3, 0.26),
      { color: 0x2b3038, roughness: 0.6, metalness: 0.3 }, 2);
    /* headlights and tails carry at dusk in a way they never did at
       noon - turned up, they are most of what tells you a car is there */
    var lamp = layer(new THREE.BoxGeometry(0.38, 0.2, 0.12),
      { color: 0xfff6e2, emissive: 0xffeccb, emissiveIntensity: 2.1, roughness: 0.3 }, 2);
    var tail = layer(new THREE.BoxGeometry(0.34, 0.18, 0.12),
      { color: 0x3a0806, emissive: 0xf02a18, emissiveIntensity: 2.2, roughness: 0.4 }, 2);
    var wheel = layer(new THREE.BoxGeometry(0.5, 0.62, 0.62), { color: 0x15181c, roughness: 0.95 }, 4);
    var hub = layer(new THREE.BoxGeometry(0.54, 0.3, 0.3),
      { color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 }, 4);
    body.castShadow = true;
    cab.castShadow = true;

    var tc = new THREE.Color();
    for (var k = 0; k < N; k++) {
      tc.setHex(cols[w.traffic[k].col]);
      body.setColorAt(k, tc);
      roof.setColorAt(k, tc);
    }
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (roof.instanceColor) roof.instanceColor.needsUpdate = true;

    w.trafficMesh = {
      body: body, cab: cab, roof: roof, bar: bar,
      lamp: lamp, tail: tail, wheel: wheel, hub: hub
    };
    w.group.add(body, cab, roof, bar, lamp, tail, wheel, hub);
    w.trafficBounds = { lo: lo, hi: hi, span: span };
    updateTraffic(w, 0, null);
  }

  var _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(),
    _tv = new THREE.Vector3(), _ts = new THREE.Vector3(1, 1, 1),
    _tbs = new THREE.Vector3(1, 1, 1), _tup = new THREE.Vector3(0, 1, 0);

  function updateTraffic(w, dt, car) {
    var b = w.trafficBounds, m = w.trafficMesh;
    if (!m) return;
    for (var i = 0; i < w.traffic.length; i++) {
      var t = w.traffic[i];
      var K = CAR_KINDS[t.kind];

      /* Lift off for whatever is filling the lane ahead. Without this a
         car simply drives through the tempo, and because it re-penetrates
         every frame it carries you off down the street with it. */
      var hold = 1;
      if (car) {
        var ax = car.x - t.x, az = car.z - t.z;
        var ahead = ax * t.fx + az * t.fz;
        var side = Math.abs(ax * t.fz - az * t.fx);
        if (ahead > -2 && ahead < 14 && side < 3.4) hold = U.clamp((ahead - 1) / 13, 0, 1);
      }
      t.cruise = U.damp(t.cruise, t.speed * hold, 7, dt);

      t.x += (t.fx * t.cruise + t.vx) * dt;
      t.z += (t.fz * t.cruise + t.vz) * dt;
      t.vx = U.damp(t.vx, 0, 3.4, dt);
      t.vz = U.damp(t.vz, 0, 3.4, dt);

      if (t.shove !== 0) {
        var push = t.shove * dt * 6;
        t.x += -t.fz * push;
        t.z += t.fx * push;
        t.shove = U.damp(t.shove, 0, 2.2, dt);
        if (Math.abs(t.shove) < 0.05) t.shove = 0;
      }

      if (t.x < b.lo) t.x += b.span; else if (t.x > b.hi) t.x -= b.span;
      if (t.z < b.lo) t.z += b.span; else if (t.z > b.hi) t.z -= b.span;

      _tq.setFromAxisAngle(_tup, t.yaw);
      var cy = t.cy, sy = t.sy, sx = K.s[0], sh = K.s[1], sl = K.s[2];
      var halfL = 2.3 * sl;

      /* local (lx, ly, lz) placed into the world without rebuilding a
         rotation per part - traffic only ever faces down an axis */
      function put(mesh, slot, lx, ly, lz, scl) {
        _tv.set(t.x + lx * cy + lz * sy, ly, t.z - lx * sy + lz * cy);
        mesh.setMatrixAt(slot, _tm.compose(_tv, _tq, scl || _ts));
      }

      _tbs.set(sx, sh, sl);
      put(m.body, i, 0, 0.55 * sh + 0.2, 0, _tbs);
      _tbs.set(K.cab[0], K.cab[1], K.cab[2]);
      put(m.cab, i, 0, 1.1 * sh + 0.5, K.cab[3], _tbs);
      _tbs.set(K.roof, 1, K.cab[2]);
      put(m.roof, i, 0, 1.1 * sh + 0.94, K.cab[3], _tbs);

      put(m.bar, i * 2, 0, 0.52, halfL + 0.06);
      put(m.bar, i * 2 + 1, 0, 0.52, -halfL - 0.06);
      for (var e = 0; e < 2; e++) {
        var ex = (e ? 1 : -1) * 0.66 * sx;
        put(m.lamp, i * 2 + e, ex, 0.85 * sh + 0.1, halfL + 0.02);
        put(m.tail, i * 2 + e, ex, 0.9 * sh + 0.12, -halfL - 0.02);
      }
      for (var q = 0; q < 4; q++) {
        var ox = (q < 2 ? -1 : 1) * 1.05 * sx, oz = (q % 2 ? 1 : -1) * 1.5 * sl;
        put(m.wheel, i * 4 + q, ox, 0.31, oz);
        put(m.hub, i * 4 + q, ox, 0.31, oz);
      }
    }
    for (var key in m) {
      m[key].instanceMatrix.needsUpdate = true;
    }
  }

  /* ===========================================================
     Batch - merges a pile of little boxes into one geometry.

     Scenery like a ramp rig is forty-odd parts, and forty-odd parts
     times eighty ramps is three thousand draw calls and a single
     digit frame rate. They never move relative to each other, so they
     have no business being separate objects: this stamps each part's
     geometry into one buffer and hands back one mesh per material.
     =========================================================== */
  function Batch() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }

  Batch.prototype.add = function (geo, matrix) {
    var g = geo.clone().applyMatrix4(matrix);
    var p = g.attributes.position.array, n = g.attributes.normal.array;
    var u = g.attributes.uv ? g.attributes.uv.array : null;
    var base = this.pos.length / 3, i;
    for (i = 0; i < p.length; i++) this.pos.push(p[i]);
    for (i = 0; i < n.length; i++) this.nor.push(n[i]);
    /* keep the uv channel in step whether or not this part had one,
       or a textured part merged after an untextured one reads its
       neighbour's coordinates */
    if (u) { for (i = 0; i < u.length; i++) this.uv.push(u[i]); }
    else { for (i = 0; i < p.length / 3 * 2; i++) this.uv.push(0); }
    if (g.index) {
      var ix = g.index.array;
      for (i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    } else {
      for (i = 0; i < p.length / 3; i++) this.idx.push(base + i);
    }
    g.dispose();
  };

  Batch.prototype.mesh = function (material) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  };

  /* the vehicle is built from the same kind of pile of little parts */
  M.Batch = Batch;

  Batch.prototype.empty = function () { return this.idx.length === 0; };

  /* placement helpers: one scratch object does all the maths */
  var _bo = new THREE.Object3D();

  function stamp(batch, geo, x, y, z, rz, sz) {
    _bo.position.set(x, y, z);
    _bo.rotation.set(0, 0, rz || 0);
    _bo.scale.set(1, 1, sz || 1);
    _bo.updateMatrix();
    batch.add(geo, _bo.matrix);
  }

  function stampAim(batch, geo, x, y, z, tx, ty, tz, sz) {
    _bo.position.set(x, y, z);
    _bo.scale.set(1, 1, sz || 1);
    _bo.lookAt(tx, ty, tz);
    _bo.updateMatrix();
    batch.add(geo, _bo.matrix);
  }

  /* ===========================================================
     kickers out on the street grid

     Every kicker in the city is here, on a street, in the outer lane
     and hard up against the kerb - which is where the paint already
     marks a lane off anyway. Nothing sits out in a park or a lot: open
     ground is for cutting corners, and a ramp you can only find by
     leaving the road is a ramp nobody ever hits.

     One lane wide, so taking one is a line you commit to rather than
     something the whole road funnels you into, and the two inner lanes
     stay clear for the traffic and for the driver who wants no part of
     it. Roughly half the street segments in the grid get one, scattered
     along the block and alternating sides, so there is no long stretch
     of empty tarmac and no two setups that read the same.
     =========================================================== */
  function buildStreetRamps(w) {
    var RW = 7;                   /* deck width: one lane, no more   */
    var LANE = 10.5;              /* outer lane centre from the middle */
    var CLEAR = ROAD_HALF + 6;    /* keep the rig clear of junctions */
    var RUN = PITCH - CLEAR * 2 - 21;

    /* Which kickers are barrel rolls. Roughly one in three, and the
       bank alternates, so you are not always thrown the same way - a
       roll you have done fifty times stops being a decision. */
    function twistFor(i, j, horizontal) {
      var k = i + j + (horizontal ? 0 : 1);
      if (k % 3) return 0;
      return k % 6 === 0 ? 30 : -30;
    }

    /* one street segment: from junction (i, j) to the next one along.
       All three draws happen whatever we decide, so the seeded stream
       stays in step and the city is identical every run. */
    function place(i, j, horizontal) {
      var take = w.rnd(), alongR = w.rnd(), sideR = w.rnd();
      if (take > 0.5) return;

      var lat = (sideR < 0.5 ? -1 : 1) * LANE;
      var along = CLEAR + alongR * RUN;
      var x = horizontal ? nodeX(i) + along : nodeX(i) + lat;
      var z = horizontal ? nodeX(j) + lat : nodeX(j) + along;
      /* nothing right on top of either end: being launched before you
         have finished reading the clock is not a stunt, it is an ambush */
      if (Math.hypot(x - w.start.x, z - w.start.z) < 70) return;
      if (Math.hypot(x - w.finish.x, z - w.finish.z) < 70) return;
      /* the signboard belongs on the pavement beside the deck, never
         propped back across the lanes the cars are using */
      var signSide = (horizontal ? -lat : lat) > 0 ? 1 : -1;
      addRamp(w, x, z, horizontal ? Math.PI / 2 : 0, RW, 17, 21,
        false, twistFor(i, j, horizontal), signSide);
    }

    for (var i = 0; i < GRID - 1; i++) {
      for (var j = 0; j < GRID; j++) place(i, j, true);
    }
    for (var i2 = 0; i2 < GRID; i2++) {
      for (var j2 = 0; j2 < GRID - 1; j2++) place(i2, j2, false);
    }
  }

  /* ===========================================================
     ramps - properly dressed, not bare wedges
     =========================================================== */
  function addRamp(w, x, z, yaw, width, len, deg, dressed, twistDeg, signSide) {
    var rad = deg * Math.PI / 180;
    var tw = (twistDeg || 0) * Math.PI / 180;
    var r = {
      x: x, z: z, yaw: yaw, dressed: dressed !== false,
      /* which side of the deck the signboard stands on, in ramp-local
         x - a kicker in the left-hand lane wants it on the left */
      signSide: signSide || -1,
      fx: Math.sin(yaw), fz: Math.cos(yaw),
      rx: Math.cos(yaw), rz: -Math.sin(yaw),
      half: width / 2, len: len,
      tan: Math.tan(rad), sin: Math.sin(rad), cos: Math.cos(rad),
      rise: len * Math.tan(rad),
      /* A twisted deck is the barrel-roll kicker. The surface banks
         progressively - flat at the foot, `twistDeg` over at the lip -
         so it corkscrews you on the way up and hands you the roll,
         rather than asking you to start one from nothing in mid-air. */
      twist: tw, twistTan: Math.tan(tw)
    };
    w.ramps.push(r);
    w.group.add(rampRig(r));
    return r;
  }

  /* deck height in ramp-local coordinates, measured from the foot */
  function deckY(r, lx, lz) {
    var f = r.len > 0 ? lz / r.len : 0;
    return lz * r.tan + lx * r.twistTan * f;
  }

  function rampRig(r) {
    var hw = r.half, L = r.len, H = r.rise, tw = !!r.twist;
    var group = new THREE.Group();
    var ACCENT = tw ? 0xff3d9a : 0x2ec6ff;
    var ACCENT2 = tw ? 0xff8ac4 : 0x8ae6ff;
    var CSS = tw ? '#ff3d9a' : '#2ec6ff';

    /* --- the driving surface ---
       A flat kicker is two triangles. A twisted one has to be stepped
       along its length: the bank it hands you is the whole point of it,
       and a single quad cannot be warped. */
    var SEG = tw ? 12 : 1;
    var pos = [], uv = [], idx = [];
    for (var k = 0; k <= SEG; k++) {
      var lz = k / SEG * L;
      pos.push(-hw, deckY(r, -hw, lz), lz, hw, deckY(r, hw, lz), lz);
      uv.push(0, k / SEG, 1, k / SEG);
      if (k < SEG) {
        var o = k * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: M.tex.rampFace(tw), roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide
    }));
    deck.receiveShadow = true;
    group.add(deck);

    /* Everything else on the rig is rigid relative to the deck, so it
       all goes into three batches - one per material - and comes out
       as three meshes however many pieces it is made of. */
    var bSteel = new Batch(), bPaint = new Batch(), bNeon = new Batch();

    var railGeo = new THREE.BoxGeometry(0.22, 0.22, 1);
    var neonGeo = new THREE.BoxGeometry(0.1, 0.1, 1);
    var studGeo = new THREE.BoxGeometry(0.16, 1.0, 0.16);
    var RSEG = tw ? 10 : 3;
    var _a = new THREE.Vector3(), _b = new THREE.Vector3();
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      for (var q = 0; q < RSEG; q++) {
        var z0 = q / RSEG * L, z1 = (q + 1) / RSEG * L;
        _a.set(s3 * hw, deckY(r, s3 * hw, z0), z0);
        _b.set(s3 * hw, deckY(r, s3 * hw, z1), z1);
        var segLen = _a.distanceTo(_b);
        stampAim(bPaint, railGeo, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + 0.98, (_a.z + _b.z) / 2,
          _b.x, _b.y + 0.98, _b.z, segLen);
        stampAim(bNeon, neonGeo, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + 0.30, (_a.z + _b.z) / 2,
          _b.x, _b.y + 0.30, _b.z, segLen);
      }
      for (var pp = 0; pp <= RSEG; pp += (tw ? 3 : 1)) {
        var pz = pp / RSEG * L;
        stamp(bSteel, studGeo, s3 * hw, deckY(r, s3 * hw, pz) + 0.5, pz);
      }
    }

    /* --- understructure: posts and cross braces --- */
    if (r.dressed) {
      var bays = 3;
      for (var k2 = 1; k2 <= bays; k2++) {
        var zz = k2 / bays * L;
        for (var sp = -1; sp <= 1; sp += 2) {
          var hh = Math.max(0.2, deckY(r, sp * (hw - 0.4), zz));
          stamp(bSteel, new THREE.BoxGeometry(0.26, hh, 0.26), sp * (hw - 0.4), hh / 2, zz);
        }
        var ch = Math.max(0.2, deckY(r, 0, zz));
        stamp(bSteel, new THREE.BoxGeometry(hw * 2 - 0.8, 0.22, 0.22), 0, ch * 0.5, zz);
      }
    }

    /* --- the lip, lit up. On a twisted deck it banks over with the
           surface, so its angle is the angle you leave at. --- */
    var lipL = deckY(r, -hw, L), lipR = deckY(r, hw, L);
    stamp(bNeon, new THREE.BoxGeometry(Math.hypot(hw * 2, lipR - lipL) + 0.5, 0.34, 1.1),
      0, (lipL + lipR) / 2 + 0.16, L, -Math.atan2(lipR - lipL, hw * 2));

    /* beacons on the lip corners, so the launch point is unmissable */
    var beaconGeo = new THREE.CylinderGeometry(0.17, 0.22, 1.5, 7);
    for (var s4 = -1; s4 <= 1; s4 += 2) {
      stamp(bNeon, beaconGeo, s4 * (hw + 0.25), deckY(r, s4 * hw, L) + 0.9, L);
    }

    /* --- a board on a post saying which kind this is --- */
    if (!r.dressed) {
      var sx2 = r.signSide * (hw + 1.5);
      stamp(bSteel, new THREE.BoxGeometry(0.18, 3.4, 0.18), sx2, 1.7, -0.6);
      var plate = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 1.15),
        new THREE.MeshStandardMaterial({
          map: M.tex.sign(tw ? 'BARREL ROLL' : 'STUNT RAMP',
            tw ? 'HIT IT FAST' : 'FLIP FOR BOOST', CSS),
          roughness: 0.8, side: THREE.DoubleSide
        })
      );
      plate.position.set(sx2, 3.5, -0.6);
      plate.rotation.y = Math.PI;
      group.add(plate);
    }

    if (r.dressed) {
      /* --- banner arch over the kicker --- */
      for (var a2 = -1; a2 <= 1; a2 += 2) {
        stamp(bSteel, new THREE.BoxGeometry(0.4, H + 7, 0.4), a2 * (hw + 1.6), (H + 7) / 2, -1.5);
        stamp(bNeon, new THREE.BoxGeometry(0.14, H + 6.4, 0.14),
          a2 * (hw + 1.6) - a2 * 0.28, (H + 7) / 2, -1.5);
      }
      stamp(bSteel, new THREE.BoxGeometry(hw * 2 + 4, 0.45, 0.45), 0, H + 7, -1.5);

      var board = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2 + 3, 2.6),
        new THREE.MeshStandardMaterial({
          map: M.tex.sign(tw ? 'BARREL ROLL' : 'STUNT RAMP',
            tw ? 'HIT IT FAST' : 'FLIP FOR BOOST', CSS),
          roughness: 0.8, side: THREE.DoubleSide
        })
      );
      board.position.set(0, H + 5.4, -1.5);
      /* a plane faces local +Z, which is the way the ramp throws you -
         turn it round so the driver reads it on the approach */
      board.rotation.y = Math.PI;
      group.add(board);

      var bunt = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2 + 4, 1.8),
        new THREE.MeshStandardMaterial({
          map: M.tex.bunting().clone(), transparent: true, alphaTest: 0.3,
          side: THREE.DoubleSide, roughness: 1
        })
      );
      bunt.material.map.repeat.set(5, 1);
      bunt.material.map.needsUpdate = true;
      bunt.position.set(0, H + 3.6, -1.5);
      group.add(bunt);

      /* --- pylons funnelling you in, in the ramp's own colour --- */
      var bCone = new Batch(), bBand = new Batch();
      var coneGeo = new THREE.ConeGeometry(0.46, 1.45, 8);
      var bandGeo = new THREE.CylinderGeometry(0.3, 0.37, 0.26, 8);
      var baseGeo = new THREE.BoxGeometry(1.05, 0.12, 1.05);
      for (var c = 0; c < 3; c++) {
        for (var sc = -1; sc <= 1; sc += 2) {
          var cx2 = sc * (hw + 1.2 + c * 0.9), cz2 = -3 - c * 3.4;
          stamp(bCone, coneGeo, cx2, 0.78, cz2);
          stamp(bBand, bandGeo, cx2, 0.74, cz2);
          stamp(bCone, baseGeo, cx2, 0.06, cz2);
        }
      }
      var coneMesh = bCone.mesh(new THREE.MeshStandardMaterial({
        color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.3, roughness: 0.7
      }));
      coneMesh.castShadow = true;
      group.add(coneMesh);
      group.add(bBand.mesh(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9 })));
    }

    var steelMesh = bSteel.mesh(new THREE.MeshStandardMaterial({
      color: 0xb8bcc2, roughness: 0.45, metalness: 0.75
    }));
    steelMesh.castShadow = true;
    group.add(steelMesh);
    group.add(bPaint.mesh(new THREE.MeshStandardMaterial({
      color: 0x2b2f52, roughness: 0.5, metalness: 0.3
    })));
    group.add(bNeon.mesh(new THREE.MeshStandardMaterial({
      color: ACCENT2, emissive: ACCENT, emissiveIntensity: 1.5, roughness: 0.35
    })));

    /* --- the chevron hanging over the lip --- */
    var holo = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 1.9, hw * 1.9),
      new THREE.MeshBasicMaterial({
        map: M.tex.holoArrow(tw), transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.9
      })
    );
    holo.position.set(0, deckY(r, 0, L) + 5.0, L - 0.4);
    holo.rotation.y = Math.PI;
    holo.renderOrder = 4;
    group.add(holo);
    r.holo = holo;
    r.holoY = holo.position.y;

    group.position.set(r.x, 0, r.z);
    group.rotation.y = r.yaw;
    return group;
  }

  /* ===========================================================
     start and finish
     =========================================================== */
  function buildGates(w) {
    gate(w, w.start.x, w.start.z, Math.PI / 2, 'DSCE', 'MUDITA DONATION DRIVE', '#f2a03c');
    dropZone(w, w.finish.x, w.finish.z);
  }

  /* The far end is not a second gate. An arch has to be driven through,
     which means lining up on it, and after a run spent cutting corners
     that is the wrong note to end on - you should be able to arrive from
     any direction and simply be there. So the orphanage is marked the way
     a landing site is: the ground painted, a column of light above it so
     you can see it over the rooftops, and nothing solid anywhere near. */
  function dropZone(w, x, z) {
    var d = w.drop = { t: 0, won: 0, x: x, z: z };

    d.apron = new THREE.Mesh(
      new THREE.CircleGeometry(17, 56),
      new THREE.MeshBasicMaterial({
        map: M.tex.dropPad(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12
      })
    );
    d.apron.rotation.x = -Math.PI / 2;
    d.apron.position.set(x, 0.08, z);
    d.apron.renderOrder = 3;
    w.group.add(d.apron);

    /* Open-ended cylinders, no caps and no depth write, so it reads as
       light rather than as a solid tube - and so driving in at the end
       does not slam a lid across the camera. */
    function column(rtop, rbot, h, rep, op, additive) {
      var map = M.tex.beam().clone();
      map.repeat.set(rep, 1);
      map.needsUpdate = true;
      var m = new THREE.Mesh(
        new THREE.CylinderGeometry(rtop, rbot, h, 40, 1, true),
        new THREE.MeshBasicMaterial({
          map: map, transparent: true, depthWrite: false, opacity: op,
          side: THREE.DoubleSide,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        })
      );
      m.position.set(x, h / 2, z);
      m.renderOrder = 4;
      w.group.add(m);
      return m;
    }
    /* Only the thin core adds light. Two additive cylinders seen through
       each other, with the far wall of each one behind the near wall,
       stack four layers of green on the same pixels and the whole thing
       saturates to a white pillar - which hides the very ground markings
       it is meant to be pointing at. The wide shell is ordinary alpha. */
    d.beam = column(11.0, 13.2, 92, 7, 0.26, false);
    d.core = column(3.6, 5.0, 112, 3, 0.16, true);

    /* three rings riding up the column, staggered, so the light has a
       direction to it and the zone never looks switched off */
    d.rings = [];
    for (var i = 0; i < 3; i++) {
      var r = new THREE.Mesh(
        new THREE.RingGeometry(11.5, 14.2, 48),
        new THREE.MeshBasicMaterial({
          color: 0x7af0b4, transparent: true, depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 1, z);
      r.renderOrder = 4;
      w.group.add(r);
      d.rings.push({ m: r, phase: i / 3 });
    }

    /* Both of these stay hidden until the crates are handed over - the
       zone on its own is the marker, the board is the receipt. */
    d.sign = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 7.5),
      new THREE.MeshBasicMaterial({
        map: M.tex.sign('DONATIONS DELIVERED', 'THANK YOU - MUDITA x DSCE', '#37b96b'),
        transparent: true, side: THREE.DoubleSide, depthWrite: false
      })
    );
    d.sign.position.set(x, 15, z);
    d.sign.renderOrder = 5;
    d.sign.visible = false;
    w.group.add(d.sign);

    d.wave = new THREE.Mesh(
      new THREE.RingGeometry(15, 17.6, 56),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending
      })
    );
    d.wave.rotation.x = -Math.PI / 2;
    d.wave.position.set(x, 0.3, z);
    d.wave.renderOrder = 5;
    d.wave.visible = false;
    w.group.add(d.wave);
  }

  function updateDrop(w, dt, carPos) {
    var d = w.drop;
    if (!d) return;
    d.t += dt;

    var breathe = Math.sin(d.t * 2.3);
    d.apron.material.opacity = 0.80 + breathe * 0.16;
    d.apron.scale.setScalar(1 + breathe * 0.012);
    d.beam.material.opacity = 0.26 + breathe * 0.05;
    d.core.material.opacity = 0.16 + Math.sin(d.t * 3.1) * 0.05;
    d.core.rotation.y = d.t * 0.3;

    for (var i = 0; i < d.rings.length; i++) {
      var r = d.rings[i];
      var k = (d.t * 0.42 + r.phase) % 1;
      r.m.position.y = 0.6 + k * 40;
      r.m.scale.setScalar(1 + k * 0.28);
      r.m.material.opacity = (1 - k) * (1 - k) * 0.42;
    }

    if (!d.won) return;

    /* handed over: the column goes gold, a shockwave runs out across the
       forecourt and the board rises out of the middle of it */
    d.won += dt;
    var a = Math.min(d.won / 0.55, 1);
    d.wave.visible = true;
    d.wave.scale.setScalar(1 + a * 3.4);
    d.wave.material.opacity = (1 - a) * 0.8;

    var b = Math.min(d.won / 0.7, 1);
    b = 1 - (1 - b) * (1 - b) * (1 - b);
    d.sign.visible = true;
    d.sign.position.y = 6 + b * 10;
    d.sign.scale.setScalar(0.3 + b * 0.7);
    /* turned to face whoever just delivered, since you can arrive at
       this thing from any side */
    if (carPos) d.sign.rotation.y = Math.atan2(carPos.x - d.x, carPos.z - d.z);
  }

  function gate(w, x, z, yaw, title, sub, accent) {
    var g = new THREE.Group();
    var steel = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6, metalness: 0.25 });

    for (var s = -1; s <= 1; s += 2) {
      var p = new THREE.Mesh(new THREE.BoxGeometry(1.3, 12, 1.3), steel);
      p.position.set(0, 6, s * (ROAD_HALF + 2.2));
      p.castShadow = true;
      g.add(p);
      /* balloon cluster on each post */
      for (var b = 0; b < 5; b++) {
        var ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.85, 12, 10),
          new THREE.MeshStandardMaterial({
            color: [0xe8785f, 0xf2c14e, 0x6fc9a8, 0x6fa8dc, 0xb79ae0][b],
            roughness: 0.35, metalness: 0.05
          })
        );
        ball.position.set((w.rnd() - 0.5) * 2.2, 12.6 + b * 0.75,
          s * (ROAD_HALF + 2.2) + (w.rnd() - 0.5) * 2.2);
        g.add(ball);
      }
    }
    var beam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, (ROAD_HALF + 3) * 2), steel);
    beam.position.y = 12;
    beam.castShadow = true;
    g.add(beam);

    /* Built wide-side-first and turned once. Standing a tall plane up
       with a second rotation gets the shape right but leaves the texture
       lying on its side, squashed across the short axis - the lettering
       comes out as a smear. The -Y turn also puts the readable face
       towards the way you come in. */
    var board = new THREE.Mesh(
      new THREE.PlaneGeometry((ROAD_HALF + 1) * 2, 4.6),
      new THREE.MeshStandardMaterial({
        map: M.tex.sign(title, sub, accent), roughness: 0.8, side: THREE.DoubleSide
      })
    );
    board.position.y = 9;
    board.rotation.y = -Math.PI / 2;
    g.add(board);

    var bunt = new THREE.Mesh(
      new THREE.PlaneGeometry((ROAD_HALF + 3) * 2, 2.2),
      new THREE.MeshStandardMaterial({
        map: M.tex.bunting().clone(), transparent: true, alphaTest: 0.3,
        side: THREE.DoubleSide, roughness: 1
      })
    );
    bunt.material.map.repeat.set(8, 1);
    bunt.material.map.needsUpdate = true;
    bunt.rotation.y = Math.PI / 2;
    bunt.position.y = 5.6;
    g.add(bunt);

    g.position.set(x, 0, z);
    g.rotation.y = yaw - Math.PI / 2;
    w.group.add(g);
  }

  /* ===========================================================
     GPS
     =========================================================== */
  function buildGPS(w) {
    var n = GRID * GRID;
    var dist = new Float32Array(n).fill(Infinity);
    var goal = FINISH_J * GRID + FINISH_I;
    dist[goal] = 0;
    var queue = [goal];
    for (var q = 0; q < queue.length; q++) {
      var cur = queue[q];
      var i = cur % GRID, j = (cur / GRID) | 0;
      var nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
      for (var k = 0; k < nb.length; k++) {
        var ci = nb[k][0], cj = nb[k][1];
        if (ci < 0 || ci >= GRID || cj < 0 || cj >= GRID) continue;
        var nn = cj * GRID + ci;
        if (dist[nn] > dist[cur] + PITCH) {
          dist[nn] = dist[cur] + PITCH;
          queue.push(nn);
        }
      }
    }
    w.gps = { dist: dist, goal: goal };
  }

  function buildRouteMesh(w) {
    var mat = new THREE.MeshBasicMaterial({
      map: M.tex.routeStrip(), transparent: true, depthWrite: false,
      opacity: 0.85, side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    w.routeMesh = mesh;
    w.group.add(mesh);
  }

  /* ===========================================================
     confetti for the delivery
     =========================================================== */
  function buildConfetti(w) {
    var cols = [0xe8785f, 0xf2c14e, 0x6fc9a8, 0x6fa8dc, 0xb79ae0, 0xffffff];
    w.confetti = [];
    for (var i = 0; i < 140; i++) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: M.tex.fleck(), color: cols[i % cols.length],
        transparent: true, depthWrite: false
      }));
      s.scale.set(0.5, 0.8, 1);
      s.visible = false;
      w.group.add(s);
      w.confetti.push({ sprite: s, life: 0, col: cols[i % cols.length], vx: 0, vy: 0, vz: 0 });
    }
    w.party = 0;
    w.partyTick = 0;
    w.partyTier = '';
  }

  /* gold for a perfect load - every crate across, nothing to make up */
  var GOLD = [0xffd25e, 0xffb43a, 0xffe9a8, 0xf8a02c, 0xfff3d0];

  /* ----------------------------------------------------------
     A delivery worth more than one puff of confetti: keep firing
     it, from a ring of points round the forecourt rather than all
     from the middle, so it falls across the whole apron.
     ---------------------------------------------------------- */
  function updateParty(w, dt) {
    if (w.party <= 0) return;
    w.party -= dt;
    w.partyTick -= dt;
    if (w.partyTick > 0) return;
    w.partyTick = 0.42;

    var ring = w.partyTier === 'perfect' ? 15 : 7;
    var a = w.party * 2.1;
    w.burst(
      w.finish.x + Math.cos(a) * ring, 3.4,
      w.finish.z + Math.sin(a) * ring,
      w.partyTier === 'perfect' ? 16 : 8
    );
  }

  /* ===========================================================
     spilled crates

     Every crate the tempo sheds is a real thing that lands on the
     road behind you and stays there until it has finished rolling.
     A number ticking down on a panel is a statistic; a crate
     cartwheeling away in the mirror is the load coming apart.
     =========================================================== */
  var SPILL_LIFE = 9;
  var SPILL_N = 8;

  function buildSpill(w) {
    var mat = new THREE.MeshStandardMaterial({ map: M.tex.crate(), roughness: 0.9 });
    w.spill = [];
    w._spillNext = 0;
    for (var i = 0; i < SPILL_N; i++) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.8, 0.98), mat);
      m.castShadow = true;
      m.visible = false;
      w.group.add(m);
      w.spill.push({
        mesh: m, life: 0, rest: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0
      });
    }
  }

  var _sg = {};

  function updateSpill(w, dt) {
    for (var i = 0; i < w.spill.length; i++) {
      var c = w.spill[i];
      if (c.life <= 0) continue;
      c.life -= dt;

      c.vy -= 24 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;

      /* the ground under it, ramp decks and roofs included */
      var floor = w.groundAt(c.x, c.z, c.y, _sg).y + 0.4;
      if (c.y <= floor) {
        c.y = floor;
        if (c.vy < -1.4) {
          /* bounce, losing most of it, and scuff along the tarmac */
          c.vy = -c.vy * 0.34;
          c.vx *= 0.68; c.vz *= 0.68;
          c.rx *= 0.5; c.ry *= 0.5; c.rz *= 0.5;
        } else {
          /* down for good: slide to a stop and settle square on its
             base, or it sits there forever balanced on a corner */
          c.vy = 0;
          c.vx -= c.vx * Math.min(1, 5 * dt);
          c.vz -= c.vz * Math.min(1, 5 * dt);
          c.rest = Math.min(1, c.rest + dt * 3);
          c.rx = c.ry = c.rz = 0;
          c.ax = U.damp(c.ax, 0, 7, dt);
          c.az = U.damp(c.az, 0, 7, dt);
        }
      }

      c.ax += c.rx * dt; c.ay += c.ry * dt; c.az += c.rz * dt;
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.set(c.ax, c.ay, c.az);

      /* shrink away at the very end rather than blinking out */
      var s = c.life < 1 ? Math.max(0.001, c.life) : 1;
      c.mesh.scale.set(s, s, s);
      if (c.life <= 0) { c.life = 0; c.mesh.visible = false; }
    }
  }

  function updateConfetti(w, dt) {
    for (var i = 0; i < w.confetti.length; i++) {
      var c = w.confetti[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vy -= 17 * dt;
      c.sprite.position.x += c.vx * dt;
      c.sprite.position.y += c.vy * dt;
      c.sprite.position.z += c.vz * dt;
      c.sprite.material.rotation += dt * 6;
      if (c.life <= 0 || c.sprite.position.y < 0) {
        c.life = 0;
        c.sprite.visible = false;
      }
    }
  }

})(window.MUD);
