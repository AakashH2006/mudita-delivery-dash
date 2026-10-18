/* ===========================================================
   vehicle.js - the Mudita donation hauler.

   Modelled on the reference in assets/: matte black pickup,
   roof light bar, exo cage over the bed, bull bar, oversized
   knobby tyres on wide flares, amber accent flashes.

   Physics is hand-rolled arcade kinematics - not a simulation.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;
  var _nearTraffic = [];

  /* ---- handling constants (tuned for a 1500 m route in ~34-39 s) ---- */
  var ACCEL = 27;
  var BOOST_ACCEL = 48;
  var DRAG_LIN = 0.35;
  var DRAG_QUAD = 0.0045;   /* terminal ~46 m/s, ~69 m/s on boost */
  var BRAKE = 46;
  var REV_MAX = 13;
  var GRAVITY = 24;
  var GRIP = 7.5;
  var DRIFT_GRIP = 1.25;
  var TURN_BASE = 2.5;
  var TURN_FALL = 1.3;
  var DRIFT_TURN = 1.45;
  var RIDE = 0.95;
  var WHEEL_R = 0.85;

  /* Nitro is the whole difficulty dial. You cannot make the 40 second
     window on the engine alone, so the run is really a question of
     whether you can keep the meter fed - and it empties faster than it
     fills unless you are taking ramps and drifting corners on purpose. */
  var BOOST_MAX = 100;
  var BOOST_START = 60;
  var BOOST_DRAIN = 40;
  var BOOST_PER_DRIFT = 9;
  var BOOST_PAD = 16;

  /* One crate leaves the bed for every 15% of the load lost. Five
     crates and five steps, so by 25% the bed is visibly stripped -
     which is well under the 50% they have to arrive with. The top
     one goes first, then the pair by the tailgate, then the front. */
  var CRATE_STEP = 15;
  var CRATE_ORDER = [4, 2, 3, 0, 1];
  var _cratePos = new THREE.Vector3();

  var PITCH_RATE = 6.0;
  var ROLL_RATE = 7.0;
  var FULL_ROT = Math.PI * 2 * 0.94;   /* ~340 deg counts as a full rotation */

  var V = M.Vehicle = {
    root: null,
    events: [],

    /* ---- state ---- */
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, roll: 0,
    speed: 0, forwardSpeed: 0,
    grounded: true, airTime: 0,
    boost: BOOST_MAX, cargo: 100,
    drifting: false, boosting: false,
    pitchAccum: 0, rollAccum: 0,
    spinLeft: 0, spinRate: 0, spinDir: 1, rollLevel: false,
    cratesShed: 0,
    wheelSpin: 0,
    _gi: {},
    _loc: {},

    /* ======================================================= */
    build: function (scene) {
      this.root = buildTruck();
      scene.add(this.root);
      return this;
    },

    reset: function (world) {
      this.pos.set(world.start.x, RIDE, world.start.z);
      this.vel.set(0, 0, 0);
      this.yaw = world.startYaw;
      this.pitch = this.roll = 0;
      this.speed = this.forwardSpeed = 0;
      this.grounded = true; this.airTime = 0;
      this.boost = BOOST_START; this.cargo = 100;
      this.drifting = this.boosting = false;
      this.pitchAccum = this.rollAccum = 0;
      this.spinLeft = 0;
      this.rollLevel = false;
      this._lastRamp = null;
      this.events.length = 0;
      /* load the bed back up */
      this.cratesShed = 0;
      var st = this.root && this.root.userData;
      if (st && st.crates) st.crates.forEach(function (c) { c.visible = true; });
      this.sync();
    },

    /* ======================================================= */
    update: function (dt, inp, world) {
      var fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);   /* forward */
      var rx = fz, rz = -fx;                                   /* right   */

      var vf = this.vel.x * fx + this.vel.z * fz;
      var vl = this.vel.x * rx + this.vel.z * rz;

      /* ---------------- ground vs air ---------------- */
      var g = world.groundAt(this.pos.x, this.pos.z, this.pos.y, this._gi);
      this.surface = g.surface;
      var surfaceY = g.y + RIDE;
      var wasGrounded = this.grounded;

      if (this.pos.y <= surfaceY + 0.12 && this.vel.y <= 0.6) {
        if (!wasGrounded) this.land(g);
        this.grounded = true;
        this.airTime = 0;
        /* ride up slopes at a limited rate so a ramp hit from the
           side lifts you instead of teleporting you to its surface */
        var climb = surfaceY - this.pos.y;
        this.pos.y += U.clamp(climb, -70 * dt, 40 * dt);
        this.vel.y = 0;
        this._lastRamp = g.ramp;
        this._lastRampTan = g.rampTan;
      } else {
        /* leaving a kicker converts forward speed into launch speed */
        if (wasGrounded && this._lastRamp) {
          var lr = this._lastRamp;
          var vy = Math.abs(vf) * (this._lastRampTan || lr.tan);
          this.vel.y = Math.max(this.vel.y, vy);
          if (lr.twist) this.startRoll(lr, vy);
          this._lastRamp = null;
        }
        this.grounded = false;
        this.airTime += dt;
        this.vel.y -= GRAVITY * dt;
      }

      /* ---------------- throttle / brake ---------------- */
      var boosting = inp.boost && this.boost > 0.5;
      this.boosting = boosting;
      var accel = boosting ? BOOST_ACCEL : ACCEL;

      if (this.grounded) {
        if (inp.throttle > 0) vf += accel * inp.throttle * dt;
        if (inp.brake > 0) {
          if (vf > 0.5) vf -= BRAKE * inp.brake * dt;
          else vf -= ACCEL * 0.55 * inp.brake * dt;
        }
        if (vf < -REV_MAX) vf = -REV_MAX;
        /* drag */
        var sgn = vf < 0 ? -1 : 1;
        var av = Math.abs(vf);
        av -= (DRAG_LIN * av + DRAG_QUAD * av * av) * dt;
        av -= world.dragAt(g.surface) * av * dt;
        if (!inp.throttle && !inp.brake) av -= 4 * dt;   /* engine braking */
        vf = Math.max(0, av) * sgn;
      } else {
        /* boost still shoves you forward mid-air */
        if (boosting) vf += BOOST_ACCEL * 0.55 * dt;
        /* ...but the air has to push back. Without this there is no
           surface taking speed off you, so holding boost through a
           long flight accelerates without limit - a couple of big
           ramps in a row and the tempo is doing 400 km/h. */
        var sgnA = vf < 0 ? -1 : 1, avA = Math.abs(vf);
        avA -= (DRAG_LIN * 0.5 * avA + DRAG_QUAD * avA * avA) * dt;
        vf = Math.max(0, avA) * sgnA;
      }

      if (boosting && (inp.throttle > 0 || !this.grounded)) {
        this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
      } else {
        this.boosting = false;
      }

      /* ---------------- steering / drift ---------------- */
      var spd = Math.abs(vf);
      if (this.grounded) {
        this.drifting = inp.handbrake && spd > 11 && Math.abs(inp.steer) > 0.15;

        var turn = TURN_BASE - TURN_FALL * U.clamp(spd / 48, 0, 1);
        if (this.drifting) turn *= DRIFT_TURN;
        var authority = U.clamp(spd / 7, 0, 1);
        this.yaw -= inp.steer * turn * authority * dt * (vf < 0 ? -1 : 1);

        /* lateral grip bleeds off sideways speed; drifting lets it live */
        var grip = (this.drifting ? DRIFT_GRIP : GRIP) * world.gripAt(g.surface);
        vl *= Math.exp(-grip * dt);

        /* drifting charges the boost meter - the Asphalt loop */
        if (this.drifting && spd > 14) {
          this.boost = Math.min(BOOST_MAX, this.boost + BOOST_PER_DRIFT * dt);
        }
      } else {
        this.drifting = false;
        vl *= Math.exp(-0.25 * dt);
        /* air control: pitch flips, roll barrel-rolls */
        var dp = -inp.pitch * PITCH_RATE * dt;
        var dr = inp.roll * ROLL_RATE * dt;
        /* and the roll the banked ramp already started, paid out until
           it has turned exactly one revolution and no further */
        if (this.spinLeft > 0) {
          /* eased out over the last radian, so the roll settles onto
             its wheels instead of stopping dead in mid-air */
          var ease = U.clamp(this.spinLeft, 0.4, 1);
          var step = Math.min(this.spinRate * ease * dt, this.spinLeft);
          this.spinLeft -= step;
          dr += this.spinDir * step;
        }
        this.pitch += dp; this.roll += dr;
        this.pitchAccum += dp; this.rollAccum += dr;

        /* A bank the ramp gave you that it had no air to pay off: the
           tempo rights itself on the way up rather than flying along
           leaning over and snapping flat the instant it touches down.
           Touch the roll keys and it is yours again. */
        if (inp.roll) this.rollLevel = false;
        if (this.rollLevel && this.spinLeft <= 0) {
          this.roll = U.damp(this.roll, 0, 3.4, dt);
        }
        /* a sliver of yaw authority so you can aim the landing */
        this.yaw -= inp.steer * 0.55 * dt;
      }

      /* rebuild planar velocity */
      fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
      rx = fz; rz = -fx;
      this.vel.x = fx * vf + rx * vl;
      this.vel.z = fz * vf + rz * vl;
      this.forwardSpeed = vf;

      /* ---------------- integrate ---------------- */
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.pos.z += this.vel.z * dt;
      this.speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
      this.wheelSpin += this.forwardSpeed / WHEEL_R * dt;

      /* ---------------- body attitude ---------------- */
      if (this.grounded) {
        var slope = Math.asin(U.clamp(g.nx * fx + g.nz * fz, -1, 1));
        var dive = U.clamp((inp.brake - inp.throttle) * 0.035, -0.05, 0.05);
        this.pitch = U.damp(this.pitch, slope + dive, 11, dt);

        /* The body has to lie across the surface, not just along it.
           Without this the banked deck of a barrel-roll kicker tilts
           away under a truck that stays stubbornly level all the way
           up it, and then the roll appears out of nothing at the lip -
           which is exactly what made the sideways ramps look fake. Now
           the tempo is already half on its side when it leaves, and
           the spin in the air just carries on from there. */
        var bank = -Math.asin(U.clamp(g.nx * rx + g.nz * rz, -1, 1));
        var lean = -inp.steer * U.clamp(this.speed / 40, 0, 1) * 0.09;
        if (this.drifting) lean *= 1.7;
        this.roll = U.damp(this.roll, bank + lean, 11, dt);
      }

      /* ---------------- world interactions ---------------- */
      this.hitBoxes(world);
      this.grabPads(world, dt);

      this.sync();
    },

    /* ----------------------------------------------------------
       A barrel roll off a banked kicker is the ramp's doing, not the
       driver's: you line it up, carry the speed, and the deck throws
       you. So the roll is metered out to land exactly one revolution
       later, which puts you back on your wheels - fighting it with the
       roll key is what costs you, not forgetting to use it.

       Take the deck end to end and there is always enough hang time to
       come back round - it drops you six and a half metres, which is
       most of a second in the air on its own. What is refused is the
       scrappy entry: clip the foot, or slide on off the side halfway
       up, and you leave with the bank but with no height and no lift
       to pay for turning it. Then the roll is declined and the truck
       rights itself on the way up instead.
       ---------------------------------------------------------- */
    startRoll: function (r, vy) {
      /* How long there is to work with. Not 2*vy/g - that is the time
         to come back to the height you left at, and you leave at the
         top of the ramp and land on the road seven metres below it.
         Using the short figure refused rolls that had a third of a
         second to spare. */
      var fall = Math.max(0, this.pos.y - RIDE);
      var tAir = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * fall)) / GRAVITY;
      this.spinDir = r.twist > 0 ? 1 : -1;
      if (tAir < 0.75) {
        this.rollLevel = true;        /* banked, but no air to finish */
        this.spinLeft = 0;
        return;
      }
      /* The deck has already turned you part of the way over - that
         bank is the start of the revolution, not something to undo.
         Pick up where it left off and one turn later the wheels are
         pointing down again. The bank goes into the accumulator too,
         or a roll that was 30 degrees done before the lip scores as
         a fraction short of a full one. */
      this.rollLevel = false;
      this.rollAccum = this.roll;
      this.spinLeft = U.clamp(Math.PI * 2 - this.spinDir * this.roll,
        Math.PI, Math.PI * 2.4);
      this.spinRate = U.clamp(this.spinLeft / (tAir * 0.72), 4.5, 15);
    },

    /* ---- landed: score the stunt, or pay for the bad landing ---- */
    land: function (g) {
      var upY = Math.cos(this.pitch) * Math.cos(this.roll);
      var air = this.airTime;
      var flips = Math.floor(Math.abs(this.pitchAccum) / FULL_ROT);
      var rolls = Math.floor(Math.abs(this.rollAccum) / FULL_ROT);

      if (air > 0.25) {
        var clean = upY > 0.68;
        if (clean) {
          var gained = 0, score = 0, names = [];
          if (flips > 0) {
            gained += 34 * flips; score += 500 * flips;
            names.push(flips > 1 ? flips + 'x FRONT FLIP' : 'FLIP');
          }
          if (rolls > 0) {
            gained += 32 * rolls; score += 450 * rolls;
            names.push(rolls > 1 ? rolls + 'x BARREL ROLL' : 'BARREL ROLL');
          }
          if (air >= 1.1) {
            gained += 20; score += 300;
            names.push('BIG AIR');
          } else if (!names.length && air > 0.55) {
            gained += 8; score += 100;
            names.push('AIR TIME');
          }
          gained = Math.min(gained, 55);
          if (gained > 0) {
            this.boost = Math.min(BOOST_MAX, this.boost + gained);
            this.emit('stunt', { names: names, boost: gained, score: score });
          }
        } else {
          /* nose-in or on the roof - the crates take it */
          var dmg = 6 + (1 - upY) * 11;
          this.damage(dmg, 'landing');
          this.vel.x *= 0.55; this.vel.z *= 0.55;
          this.emit('badland', { damage: dmg });
        }
      }

      this.pitchAccum = this.rollAccum = 0;
      this.spinLeft = 0;
      this.rollLevel = false;
      this.airTime = 0;
      /* settle the body back onto the surface - across it as well as
         along it, so coming down on a banked deck does not flatten
         the truck out against the slope it is standing on */
      var sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      this.pitch = Math.asin(U.clamp(g.nx * sy + g.nz * cy, -1, 1));
      this.roll = -Math.asin(U.clamp(g.nx * cy - g.nz * sy, -1, 1));
    },

    /* ----------------------------------------------------------
       Collision against everything solid in the city. There are
       no invisible walls: if nothing is drawn there, you can
       drive there.
       ---------------------------------------------------------- */
    hitBoxes: function (world) {
      var list = world.query(this.pos.x, this.pos.z);
      var R = 2.35;

      /* Traffic moves, so it cannot live in the static hash. There are
         few enough cars to test them all against a cheap radius first. */
      var near = _nearTraffic;
      near.length = 0;
      for (var t = 0; t < world.traffic.length; t++) {
        var c = world.traffic[t];
        if (Math.abs(c.x - this.pos.x) < 9 && Math.abs(c.z - this.pos.z) < 9) near.push(c);
      }

      for (var i = 0; i < list.length + near.length; i++) {
        var b = i < list.length ? list[i] : near[i - list.length];
        var moving = i >= list.length;
        if (this.pos.y > b.top + 0.15) continue;        /* clean over the top */

        var cx = U.clamp(this.pos.x, b.x - b.hw, b.x + b.hw);
        var cz = U.clamp(this.pos.z, b.z - b.hd, b.z + b.hd);
        var dx = this.pos.x - cx, dz = this.pos.z - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;

        var d = Math.sqrt(d2), nx, nz;
        if (d > 1e-4) {
          nx = dx / d; nz = dz / d;
        } else {
          /* dead centre inside the box - shove out the nearest face */
          var l = this.pos.x - (b.x - b.hw), r = (b.x + b.hw) - this.pos.x;
          var k = this.pos.z - (b.z - b.hd), f = (b.z + b.hd) - this.pos.z;
          var m = Math.min(l, r, k, f);
          if (m === l) { nx = -1; nz = 0; d = -l; }
          else if (m === r) { nx = 1; nz = 0; d = -r; }
          else if (m === k) { nx = 0; nz = -1; d = -k; }
          else { nx = 0; nz = 1; d = -f; }
        }

        var push = R - d;
        if (moving) {
          /* Traffic is a hazard, not a wall: the car takes the whole
             separation and the tempo is never displaced by it. Splitting
             the push between them deadlocks - the car yields because the
             tempo is ahead, the tempo cannot drive through because the
             car is ahead, and both sit there grinding at 2 km/h. */
          b.x -= nx * push;
          b.z -= nz * push;
        } else {
          this.pos.x += nx * push;
          this.pos.z += nz * push;
        }

        var into = -(this.vel.x * nx + this.vel.z * nz);
        if (into > 0) {
          /* clipping a car costs far less than hitting masonry, and
             knocks it out of its lane rather than stopping you dead */
          /* Sustained contact must not keep billing you. This cancels the
             approach speed, so re-applying it every frame at 120 Hz pins
             the tempo at a crawl: acceleration per frame is 0.22 m/s, and
             the impulse takes back 1.25x the closing speed, which balances
             at well under walking pace. Below the threshold just separate,
             so you can always drive back off whatever you hit. */
          if (into > (moving ? 2.5 : 1.2)) {
            this.vel.x += nx * into * (moving ? 0.55 : 1.25);
            this.vel.z += nz * into * (moving ? 0.55 : 1.25);
          }

          /* Bleed speed only on a real impact. Resting contact leaves
             `into` barely above zero every frame, and a per-frame factor
             applied at 120 Hz multiplies out to a dead stop - lean on a
             car and you would never drive away from it again. */
          if (into > (moving ? 6 : 4)) {
            var keep = moving ? 0.88 : 0.62;
            this.vel.x *= keep;
            this.vel.z *= keep;
          }

          if (moving) {
            /* knock it clear so the contact actually ends */
            b.vx -= nx * into * 0.9;
            b.vz -= nz * into * 0.9;
            b.shove = U.clamp(b.shove + (nx * b.fz - nz * b.fx) * -1.6, -3.5, 3.5);
            /* Cross traffic at every junction means you will be clipped
               often however well you drive, so a brush has to be cheap.
               A square T-bone at speed still costs real cargo. */
            var tdmg = U.clamp((into - 7) * 0.42, 0, 10);
            if (tdmg > 0) {
              this.damage(tdmg, 'crash');
              this.emit('hit', { force: into, damage: tdmg });
            }
          } else {
            var dmg = U.clamp((into - 8) * 0.72, 0, 16);
            if (dmg > 0) {
              this.damage(dmg, 'crash');
              this.emit('hit', { force: into, damage: dmg });
            }
          }
        }
      }
    },

    /* ---- boost pads ---- */
    /* Nitro hangs in the air now, so collecting it is a line you take
       rather than a stripe you happen to cross. The world owns the
       cooldown clock; this only decides whether you are inside one. */
    grabPads: function (world, dt) {
      var pads = world.pads;
      for (var i = 0; i < pads.length; i++) {
        var p = pads[i];
        if (p.cooldown > 0) continue;
        var dx = this.pos.x - p.x, dz = this.pos.z - p.z;
        if (dx * dx + dz * dz > 11.6) continue;        /* 3.4 m across */
        var dy = this.pos.y + 0.9 - p.y;               /* measured at the cage */
        if (dy < -2.4 || dy > 2.4) continue;
        this.boost = Math.min(BOOST_MAX, this.boost + BOOST_PAD);
        p.cooldown = 9;
        this.emit('pad', { boost: BOOST_PAD });
      }
    },

    /* ----------------------------------------------------------
       Cargo integrity is a number on a panel, and a number on a
       panel is a statistic. Every CRATE_STEP of the load you lose,
       an actual crate comes out of the bed and cartwheels away up
       the road behind you - so the state of the delivery is
       something you can see in the mirror and something anyone
       watching can read off the back of the truck.
       ---------------------------------------------------------- */
    damage: function (amount, cause) {
      this.cargo = Math.max(0, this.cargo - amount);
      var due = Math.min(CRATE_ORDER.length, Math.floor((100 - this.cargo) / CRATE_STEP));
      while (this.cratesShed < due) this.shedCrate();
    },

    shedCrate: function () {
      var st = this.root && this.root.userData;
      var holder = st && st.crates && st.crates[CRATE_ORDER[this.cratesShed]];
      this.cratesShed++;
      if (!holder || !holder.visible) return;
      holder.visible = false;
      /* where that crate actually is right now, not where the truck
         is - it leaves from its own corner of the bed */
      var m = holder.children[0];
      m.updateWorldMatrix(true, false);
      m.getWorldPosition(_cratePos);
      this.emit('crate', {
        x: _cratePos.x, y: _cratePos.y, z: _cratePos.z,
        vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
        left: CRATE_ORDER.length - this.cratesShed
      });
    },

    emit: function (type, data) {
      this.events.push({ type: type, data: data || {} });
    },
    drainEvents: function () {
      var e = this.events.slice();
      this.events.length = 0;
      return e;
    },

    /* ---- push state into the scene graph ---- */
    sync: function () {
      var r = this.root;
      if (!r) return;
      r.position.copy(this.pos);
      r.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

      /* wheels: spin, and steer the fronts */
      var st = r.userData;
      for (var i = 0; i < st.wheels.length; i++) {
        st.wheels[i].rotation.x = -this.wheelSpin;
      }
      var steerAngle = U.clamp((st.lastSteer || 0), -0.5, 0.5);
      st.steerPivots[0].rotation.y = steerAngle;
      st.steerPivots[1].rotation.y = steerAngle;

      /* boost flame + light bar glow */
      var on = this.boosting;
      st.flames.forEach(function (f) {
        f.visible = on;
        if (on) {
          var s = 0.75 + Math.random() * 0.55;
          f.scale.set(s, s, s);
        }
      });
    },

    setSteerVisual: function (v) { this.root.userData.lastSteer = -v * 0.42; },

    kmh: function () { return this.speed * 3.6; },
    boostPct: function () { return this.boost / BOOST_MAX; }
  };

  /* ===========================================================
     the model
     =========================================================== */
  function mat(color, rough, metal, opts) {
    var o = { color: color, roughness: rough, metalness: metal };
    if (opts) for (var k in opts) o[k] = opts[k];
    return new THREE.MeshStandardMaterial(o);
  }

  function buildTruck() {
    var g = new THREE.Group();

    var BODY = mat(0x1c2127, 0.38, 0.62);     /* matte near-black        */
    var PANEL = mat(0x12161b, 0.52, 0.45);    /* darker panel breaks     */
    var TRIM = mat(0x23282f, 0.55, 0.6);
    var TUBE = mat(0x171c22, 0.34, 0.8);      /* cage + bull bar         */
    var GLASS = mat(0x070b10, 0.12, 0.85, { transparent: true, opacity: 0.86 });
    var RUBBER = mat(0x15181d, 0.92, 0.05);
    var RIM = mat(0x454d57, 0.28, 0.92);
    var AMBER = mat(0xff9a1f, 0.35, 0.3, { emissive: 0xff7a00, emissiveIntensity: 0.8 });
    var LIGHT = mat(0xffffff, 0.2, 0.1, { emissive: 0xffeedd, emissiveIntensity: 3.2 });
    var TAIL = mat(0x1a0000, 0.3, 0.2, { emissive: 0xe00800, emissiveIntensity: 1.5 });

    /* ---- main body ---- */
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.72, 1.05, 6.0), BODY);
    body.position.set(0, 0.52, 0);
    g.add(body);

    /* lower rocker panel */
    var rocker = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.38, 5.4), PANEL);
    rocker.position.set(0, 0.08, 0);
    g.add(rocker);

    /* ---- bonnet + cab ---- */
    var hood = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.42, 1.9), BODY);
    hood.position.set(0, 1.18, -1.95);
    g.add(hood);
    /* power bulge */
    var bulge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.3), PANEL);
    bulge.position.set(0, 1.44, -2.0);
    g.add(bulge);

    var cab = new THREE.Mesh(new THREE.BoxGeometry(2.56, 1.18, 2.5), BODY);
    cab.position.set(0, 1.63, -0.42);
    g.add(cab);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.14, 2.3), PANEL);
    roof.position.set(0, 2.25, -0.42);
    g.add(roof);

    /* windows */
    var wind = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.78, 0.1), GLASS);
    wind.position.set(0, 1.74, -1.63);
    wind.rotation.x = 0.22;
    g.add(wind);
    [-1, 1].forEach(function (s) {
      var side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.66, 2.1), GLASS);
      side.position.set(s * 1.3, 1.78, -0.42);
      g.add(side);
    });
    var rear = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1), GLASS);
    rear.position.set(0, 1.76, 0.8);
    g.add(rear);

    /* ---- cargo bed ---- */
    var bedFloor = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.9), PANEL);
    bedFloor.position.set(0, 1.08, 1.62);
    g.add(bedFloor);
    [-1, 1].forEach(function (s) {
      var wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 2.9), BODY);
      wall.position.set(s * 1.26, 1.44, 1.62);
      g.add(wall);
    });
    var tail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.72, 0.14), BODY);
    tail.position.set(0, 1.44, 3.02);
    g.add(tail);

    /* Donation crates. Each one hangs off its own Group so that
       mergeStatic leaves it alone: the load has to come apart crate by
       crate as the run goes badly, and a crate welded into one merged
       body mesh has no visibility of its own to turn off. */
    var crateMat = new THREE.MeshStandardMaterial({ map: M.tex.crate(), roughness: 0.9 });
    var crates = [
      [-0.62, 1.52, 0.86, 1.05], [0.62, 1.52, 0.86, 1.05],
      [-0.6, 1.5, 2.1, 0.95], [0.6, 1.5, 2.1, 0.95],
      [0, 2.18, 1.45, 0.82]
    ];
    var crateSlots = [];
    crates.forEach(function (c) {
      var holder = new THREE.Group();
      var m = new THREE.Mesh(new THREE.BoxGeometry(c[3], c[3] * 0.82, c[3]), crateMat);
      m.position.set(c[0], c[1], c[2]);
      m.rotation.y = (Math.random() - 0.5) * 0.18;
      m.castShadow = true;
      holder.add(m);
      g.add(holder);
      crateSlots.push(holder);
    });
    /* strap over the load */
    var strap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.07, 0.16), mat(0x2a2017, 0.9, 0));
    strap.position.set(0, 2.1, 1.3);
    g.add(strap);

    /* ---- exo roll cage over the bed ---- */
    var tubeGeo = new THREE.CylinderGeometry(0.075, 0.075, 1, 8);
    function tube(x, y, z, len, rotX, rotZ) {
      var t = new THREE.Mesh(tubeGeo, TUBE);
      t.position.set(x, y, z);
      t.scale.y = len;
      if (rotX) t.rotation.x = rotX;
      if (rotZ) t.rotation.z = rotZ;
      g.add(t);
      return t;
    }
    [-1, 1].forEach(function (s) {
      tube(s * 1.2, 1.95, 0.95, 1.3);                        /* front upright */
      tube(s * 1.2, 1.95, 2.55, 1.3);                        /* rear upright  */
      tube(s * 1.2, 2.58, 1.75, 1.7, Math.PI / 2);           /* top rail      */
    });
    tube(0, 2.58, 0.95, 2.4, 0, Math.PI / 2);                /* front hoop    */
    tube(0, 2.58, 2.55, 2.4, 0, Math.PI / 2);                /* rear hoop     */
    tube(0, 2.3, 0.3, 1.9, -0.75, Math.PI / 2);              /* cab brace     */

    /* ---- roof light bar ---- */
    var barBase = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.26), TUBE);
    barBase.position.set(0, 2.38, -0.9);
    g.add(barBase);
    var barLens = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.17, 0.2), LIGHT);
    barLens.position.set(0, 2.5, -0.95);
    g.add(barLens);
    var barGlow = glowSprite(0xfff0d6, 3.2);
    barGlow.position.set(0, 2.5, -1.3);
    g.add(barGlow);
    /* small pod lights on the cage */
    [-1, 1].forEach(function (s) {
      var pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.22), LIGHT);
      pod.position.set(s * 1.2, 2.45, 0.95);
      g.add(pod);
    });

    /* ---- front end: grille, bull bar, headlights ---- */
    var grille = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.66, 0.16), PANEL);
    grille.position.set(0, 1.0, -2.95);
    g.add(grille);
    for (var gi = 0; gi < 4; gi++) {
      var slat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.2), TRIM);
      slat.position.set(0, 0.78 + gi * 0.16, -2.99);
      g.add(slat);
    }

    var bumper = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.44, 0.4), TUBE);
    bumper.position.set(0, 0.52, -3.05);
    g.add(bumper);
    /* bull bar uprights + hoop */
    [-0.75, 0.75].forEach(function (x) {
      var up = new THREE.Mesh(tubeGeo, TUBE);
      up.position.set(x, 0.95, -3.18); up.scale.y = 1.0;
      g.add(up);
    });
    var hoop = new THREE.Mesh(tubeGeo, TUBE);
    hoop.position.set(0, 1.42, -3.18);
    hoop.scale.y = 1.6; hoop.rotation.z = Math.PI / 2;
    g.add(hoop);
    var skid = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 0.7), TRIM);
    skid.position.set(0, 0.26, -3.0);
    g.add(skid);

    [-1, 1].forEach(function (s) {
      var hl = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.14), LIGHT);
      hl.position.set(s * 0.86, 1.14, -2.98);
      g.add(hl);
      var hg = glowSprite(0xffeecf, 1.8);
      hg.position.set(s * 0.86, 1.14, -3.3);
      g.add(hg);
      /* amber marker lights, like the reference */
      var mk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), AMBER);
      mk.position.set(s * 0.4, 1.52, -2.9);
      g.add(mk);
    });

    /* tail lights */
    [-1, 1].forEach(function (s) {
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), TAIL);
      tl.position.set(s * 0.92, 1.3, 3.08);
      g.add(tl);
    });

    /* ---- livery panels on the doors ---- */
    var liveryMat = new THREE.MeshStandardMaterial({
      map: M.tex.livery(), roughness: 0.55, metalness: 0.2
    });
    [-1, 1].forEach(function (s) {
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), liveryMat);
      panel.position.set(s * 1.375, 0.95, -0.25);
      panel.rotation.y = s * Math.PI / 2;
      g.add(panel);
    });

    /* ---- fender flares + wheels ---- */
    var wheels = [], steerPivots = [];
    var tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.7, 16);
    var rimGeo = new THREE.CylinderGeometry(WHEEL_R * 0.56, WHEEL_R * 0.56, 0.74, 10);
    var hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.2, WHEEL_R * 0.2, 0.78, 8);
    var spokeGeo = new THREE.BoxGeometry(0.1, WHEEL_R * 0.98, 0.76);
    var lugGeo = new THREE.BoxGeometry(0.76, 0.16, 0.22);

    var corners = [
      [-1.42, -1.95, true], [1.42, -1.95, true],
      [-1.42, 1.85, false], [1.42, 1.85, false]
    ];
    corners.forEach(function (c) {
      var x = c[0], z = c[1], isFront = c[2];

      /* wide flare over the tyre */
      var flare = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 2.45), PANEL);
      flare.position.set(x * 1.04, 0.78, z);
      g.add(flare);

      /* the root sits at RIDE, so drop the hub so the tyre meets the road */
      var pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R - RIDE, z);
      g.add(pivot);

      var hub = new THREE.Group();
      pivot.add(hub);

      var tyre = new THREE.Mesh(tyreGeo, RUBBER);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      hub.add(tyre);

      /* knobby tread blocks */
      for (var t = 0; t < 14; t++) {
        var a = t / 14 * Math.PI * 2;
        var lug = new THREE.Mesh(lugGeo, RUBBER);
        lug.position.set(0, Math.cos(a) * WHEEL_R * 0.95, Math.sin(a) * WHEEL_R * 0.95);
        lug.rotation.x = -a;
        hub.add(lug);
      }
      var rim = new THREE.Mesh(rimGeo, RIM);
      rim.rotation.z = Math.PI / 2;
      hub.add(rim);
      for (var sp = 0; sp < 5; sp++) {
        var spoke = new THREE.Mesh(spokeGeo, RIM);
        spoke.rotation.x = sp / 5 * Math.PI;
        hub.add(spoke);
      }
      var cap = new THREE.Mesh(hubGeo, TRIM);
      cap.rotation.z = Math.PI / 2;
      hub.add(cap);

      /* caliper hangs off the upright, not the hub, so it stays put
         while the wheel turns inside it - visible through the spokes */
      var cal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.22), AMBER);
      cal.position.set(x > 0 ? -0.08 : 0.08, WHEEL_R * 0.54, 0);
      pivot.add(cal);

      wheels.push(hub);
      if (isFront) steerPivots.push(pivot);
    });

    /* ----------------------------------------------------------
       Working-truck detail. None of it is structural; it is all there
       so that the thing reads as a vehicle somebody maintains rather
       than a shape that drives - and most of it is what you actually
       see from the chase camera: mirrors, snorkel, steps, flaps, and
       the underside every time a kicker throws it.
       ---------------------------------------------------------- */
    var CHROME = mat(0x9aa3ad, 0.3, 0.85);
    var MATTE = mat(0x101418, 0.95, 0.05);

    /* wing mirrors */
    [-1, 1].forEach(function (s) {
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.07), TUBE);
      arm.position.set(s * 1.46, 1.86, -1.42);
      g.add(arm);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.26), PANEL);
      head.position.set(s * 1.66, 1.9, -1.42);
      g.add(head);
      var mg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.2), GLASS);
      mg.position.set(s * 1.71, 1.9, -1.42);
      g.add(mg);
    });

    /* snorkel up the right-hand A-pillar */
    var snork = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.95, 8), TUBE);
    snork.position.set(1.3, 1.78, -1.78);
    g.add(snork);
    var snorkHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.34), TUBE);
    snorkHead.position.set(1.3, 2.84, -1.7);
    g.add(snorkHead);
    var snorkRun = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), TUBE);
    snorkRun.rotation.x = Math.PI / 2;
    snorkRun.position.set(1.3, 0.9, -2.4);
    g.add(snorkRun);

    /* rock sliders down each side */
    [-1, 1].forEach(function (s) {
      var step = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 2.7), TUBE);
      step.position.set(s * 1.47, 0.18, 0);
      g.add(step);
      for (var b = 0; b < 2; b++) {
        var bracket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.13), TUBE);
        bracket.position.set(s * 1.26, 0.2, -0.85 + b * 1.7);
        g.add(bracket);
      }
      /* door handle */
      var dh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.42), CHROME);
      dh.position.set(s * 1.41, 1.3, -0.1);
      g.add(dh);
    });

    /* mud flaps behind all four wheels */
    [[-1.42, -1.32], [1.42, -1.32], [-1.42, 2.48], [1.42, 2.48]].forEach(function (c) {
      var flap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.05), MATTE);
      flap.position.set(c[0], 0.3, c[1]);
      g.add(flap);
    });

    /* winch and fairlead in the bull bar */
    var winch = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.82, 10), CHROME);
    winch.rotation.z = Math.PI / 2;
    winch.position.set(0, 0.84, -3.3);
    g.add(winch);
    var fair = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.08), TRIM);
    fair.position.set(0, 0.84, -3.46);
    g.add(fair);

    /* fog lights, tow hooks and indicators */
    [-1, 1].forEach(function (s) {
      var fog = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.1), LIGHT);
      fog.position.set(s * 1.06, 0.52, -3.24);
      g.add(fog);
      var hook = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.32), AMBER);
      hook.position.set(s * 0.5, 0.34, -3.22);
      g.add(hook);
      var ind = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.1), AMBER);
      ind.position.set(s * 1.3, 1.14, -2.93);
      g.add(ind);
      var indR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.08), AMBER);
      indR.position.set(s * 1.24, 1.3, 3.06);
      g.add(indR);
    });

    /* plates */
    var plateMat = mat(0xf0efe6, 0.7, 0.0);
    var pf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.26, 0.05), plateMat);
    pf.position.set(0, 0.52, -3.3);
    g.add(pf);
    var pr2 = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.26, 0.05), plateMat);
    pr2.position.set(0, 0.86, 3.12);
    g.add(pr2);

    /* exhaust run and twin tips */
    var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.3, 8), MATTE);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(0.55, 0.12, 0.8);
    g.add(pipe);
    [-0.46, 0.46].forEach(function (x2) {
      var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.46, 10), CHROME);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(x2, 0.22, 3.12);
      g.add(tip);
    });

    /* underside: live axles, diffs and a prop shaft */
    [-1.95, 1.85].forEach(function (z2) {
      var axle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.75, 8), MATTE);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, 0.04, z2);
      g.add(axle);
      var diff = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), MATTE);
      diff.position.set(0, 0.04, z2);
      g.add(diff);
    });
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.5, 6), CHROME);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0.07, 0);
    g.add(shaft);

    /* spare wheel on the tailgate, cans lashed in beside the load */
    /* Off to one side, not in the middle of the tailgate. The chase
       camera spends the whole run looking straight at that panel, and
       a black disc parked in the centre of it is all you can see. */
    var spare = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.26, 14), RUBBER);
    spare.rotation.x = Math.PI / 2;
    spare.position.set(-0.78, 1.32, 3.22);
    g.add(spare);
    var spareRim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.28, 10), RIM);
    spareRim.rotation.x = Math.PI / 2;
    spareRim.position.set(-0.78, 1.32, 3.23);
    g.add(spareRim);
    [-1, 1].forEach(function (s) {
      var can = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.44, 0.34), mat(0x4b5a3a, 0.85, 0.1));
      can.position.set(s * 1.0, 1.36, 2.78);
      g.add(can);
    });

    /* whip aerial off the back corner */
    var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.015, 2.4, 5), MATTE);
    ant.position.set(-1.2, 2.6, 2.86);
    ant.rotation.z = 0.17;
    g.add(ant);
    var pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22),
      mat(0xff9a1f, 0.8, 0, { side: THREE.DoubleSide }));
    pennant.position.set(-1.0, 3.6, 2.86);
    g.add(pennant);

    /* a second strap across the load, crossing the first */
    var strap2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 2.7), mat(0x2a2017, 0.9, 0));
    strap2.position.set(0.1, 2.1, 1.7);
    g.add(strap2);

    /* ---- boost flames out of the back ---- */
    var flames = [];
    [-0.72, 0.72].forEach(function (x) {
      var f = glowSprite(0xff6a10, 1.5);
      f.material.opacity = 0.75;
      f.position.set(x, 0.5, 3.35);
      f.visible = false;
      g.add(f);
      flames.push(f);
    });

    /* ----------------------------------------------------------
       Collapse the body down to one mesh per material.

       The tempo is about two hundred separate pieces, and unlike city
       scenery none of it is ever off screen - it is two hundred draw
       calls on every single frame of the run. The pieces never move
       relative to each other, so they are merged here: the wheels and
       the steering pivots stay their own objects because they turn,
       and the flame sprites stay because they are sprites.
       ---------------------------------------------------------- */
    wheels.forEach(mergeStatic);
    mergeStatic(g);

    /* shadows */
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });

    /* the body above is modelled nose-towards -Z; the physics forward
       axis is +Z, so hang it off a root that turns it to face forward */
    var root = new THREE.Group();
    g.rotation.y = Math.PI;
    root.add(g);
    root.userData = {
      wheels: wheels, steerPivots: steerPivots, flames: flames,
      crates: crateSlots, lastSteer: 0
    };
    return root;
  }

  /* merge every plain static mesh hanging directly off `parent`,
     one merged mesh per material; anything that is not a plain mesh
     (groups that rotate, sprites) is left exactly where it was */
  function mergeStatic(parent) {
    var bats = [], keep = [], i, k;
    for (i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (!c.isMesh || !c.geometry || !c.geometry.attributes.position) {
        keep.push(c);
        continue;
      }
      c.updateMatrix();
      var slot = null;
      for (k = 0; k < bats.length; k++) {
        if (bats[k].mat === c.material) { slot = bats[k]; break; }
      }
      if (!slot) { slot = { mat: c.material, b: new M.Batch() }; bats.push(slot); }
      slot.b.add(c.geometry, c.matrix);
    }
    parent.children.length = 0;
    for (i = 0; i < keep.length; i++) parent.add(keep[i]);
    for (i = 0; i < bats.length; i++) parent.add(bats[i].b.mesh(bats[i].mat));
  }

  function glowSprite(color, size) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: M.tex.glow(), color: color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85
    }));
    s.scale.set(size, size, size);
    return s;
  }

  V.BOOST_MAX = BOOST_MAX;
  V.RIDE = RIDE;

})(window.MUD);
