/* ===========================================================
   game.js - renderer, camera, state machine, UI wiring.
   =========================================================== */
(function (M) {
  'use strict';

  var U = M.util;
  var TIME_LIMIT = 43;
  var CARGO_FLOOR = 50;      /* below this at the gate and the run fails */
  var FIXED = 1 / 120;

  var G = M.Game = {
    state: 'menu',
    timeLeft: TIME_LIMIT,
    score: 0,
    runTime: 0,
    acc: 0,
    last: 0,
    camYaw: 0,
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    shake: 0,
    fov: 72,
    mmTick: 0,
    pendingRun: null,

    /* ======================================================= */
    init: function () {
      var cv = document.getElementById('scene');

      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.02;

      this.scene = new THREE.Scene();
      /* warm haze, matching the band the sky sits on at the horizon */
      this.scene.fog = new THREE.FogExp2(0xe0a378, 0.00050);

      this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.4, 3000);
      this.camera.position.set(0, 8, 20);

      this.buildLights();

      this.world = M.World.build(this.scene);
      M.Vehicle.build(this.scene);
      M.HUD.init();
      M.Minimap.init(this.world);
      M.Markers.init(this.world);

      this.bindUI();
      M.Input.init();
      M.Radio.init();
      M.Leaderboard.render(-1);
      this.renderControls();

      M.Vehicle.reset(this.world);
      this.placeCameraBehind(true);

      window.addEventListener('resize', this.onResize.bind(this));
      this.last = performance.now();
      requestAnimationFrame(this.frame.bind(this));
    },

    buildLights: function () {
      /* Golden hour. The sun is low and orange and does nearly all the
         work; the sky it leaves behind is a cool violet, so the bounce
         light is cold. That split - warm key, cold fill - is the whole
         reason an evening reads as an evening and not as a beige noon. */
      this.scene.add(new THREE.HemisphereLight(0x6f72b4, 0x4a4332, 0.42));
      this.scene.add(new THREE.AmbientLight(0x9a8ec0, 0.13));

      var sun = this.sun = new THREE.DirectionalLight(0xffb066, 1.65);
      sun.position.set(-200, 74, -110);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      var c = sun.shadow.camera;
      /* A low sun throws long shadows, so the box has to be wider than
         it was at midday or they are sliced off across the street. */
      c.left = -150; c.right = 150; c.top = 150; c.bottom = -150;
      c.near = 1; c.far = 900;
      sun.shadow.bias = -0.0009;
      sun.shadow.normalBias = 0.045;
      this.scene.add(sun);
      this.scene.add(sun.target);

      /* dusk-blue fill from the opposite side, so the matte black body
         still has an edge to read against the dark side of the street */
      var fill = new THREE.DirectionalLight(0x8fa8e0, 0.30);
      fill.position.set(170, 90, 140);
      this.scene.add(fill);
    },

    /* ======================================================= */
    bindUI: function () {
      var self = this;
      document.getElementById('btn-start').onclick = function () { self.startRun(); };
      document.getElementById('btn-retry').onclick = function () { self.startRun(); };
      document.getElementById('btn-menu').onclick = function () { self.toMenu(); };
      document.getElementById('btn-save').onclick = function () { self.saveRun(); };
      document.getElementById('btn-clear').onclick = function () {
        M.Leaderboard.clear();
        M.Leaderboard.render(-1);
      };
      document.getElementById('res-name').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); self.saveRun(); }
      });

      /* audio needs a gesture before it is allowed to make noise */
      var wake = function () { M.Audio.resume(); };
      window.addEventListener('pointerdown', wake);
      window.addEventListener('keydown', wake);
    },

    renderControls: function () {
      var list = M.CONTROLS.concat(M.Input.hasPad() ? M.CONTROLS_PAD : []);
      document.getElementById('ctl-grid').innerHTML = list.map(function (c) {
        return '<div class="ctl"><span class="key">' + c.key + '</span><span class="what">' + c.what + '</span></div>';
      }).join('');
    },

    /* ======================================================= */
    startRun: function () {
      this.state = 'countdown';
      this.countdown = 3.2;
      this.timeLeft = TIME_LIMIT;
      this.runTime = 0;
      this.score = 0;
      this.pendingRun = null;

      this.cardIn = 0;
      M.Vehicle.reset(this.world);
      this.world.reset();
      this.refreshRoute(true);
      this.totalLength = this.world.routeFrom(M.Vehicle.pos.x, M.Vehicle.pos.z).remaining;
      this.placeCameraBehind(true);

      M.HUD.reset();
      M.HUD.show(true);
      hide('menu'); hide('result');
      show('countdown');
      document.getElementById('cd-num').textContent = '3';
      document.getElementById('cd-num').className = '';
      document.getElementById('cd-sub').textContent = 'Get Ready';
      this.lastBeep = 4;
      M.Audio.resume();
      /* the radio comes on with the ignition, then gets out of the
         way of the lights - the countdown is 3.2 s and the GO tone
         rings on past it */
      M.Radio.start();
      M.Radio.duckFor(0.26, 3.7);
    },

    /* recompute the suggested road route when the nearest junction changes */
    refreshRoute: function (force) {
      var v = M.Vehicle, w = this.world;
      var r = w.routeFrom(v.pos.x, v.pos.z);
      this.remaining = r.remaining;
      if (force || r.node !== this._gpsNode) {
        this._gpsNode = r.node;
        w.setRoute(w.pathFrom(r.node));
      }
      return r;
    },

    toMenu: function () {
      this.state = 'menu';
      M.HUD.show(false);
      hide('result'); hide('countdown');
      show('menu');
      M.Leaderboard.render(-1);
      this.renderControls();
      M.Audio.silence();
      M.Vehicle.reset(this.world);
      this.placeCameraBehind(true);
    },

    finish: function (ok, title, sub, hold, tier) {
      this.state = 'result';
      M.Audio.silence();
      if (ok) M.Audio.win(); else M.Audio.lose();
      /* the fanfare runs to about 1.5 s and wants the room to itself */
      M.Radio.duckFor(0.22, 2.8);

      var v = M.Vehicle;
      var card = document.querySelector('.res-card');
      card.classList.toggle('fail', !ok);
      card.classList.toggle('perfect', tier === 'perfect');
      card.classList.toggle('pristine', tier === 'pristine');
      document.getElementById('res-tag').textContent =
        !ok ? 'Failed' : tier === 'perfect' ? 'Perfect Load'
          : tier === 'pristine' ? 'Pristine Load' : 'Delivered';
      document.getElementById('res-title').textContent = title;
      document.getElementById('res-sub').textContent = sub;
      document.getElementById('res-time').textContent = ok ? U.fmtTime(this.runTime) : '--.--';
      document.getElementById('res-cargo').textContent = Math.round(v.cargo) + '%';
      document.getElementById('res-score').textContent = Math.round(this.score).toLocaleString();

      var canSave = ok && M.Leaderboard.qualifies(this.runTime, v.cargo);
      var wrap = document.getElementById('res-name-wrap');
      wrap.style.display = canSave ? '' : 'none';
      if (canSave) {
        this.pendingRun = { time: this.runTime, cargo: v.cargo, score: this.score };
        var input = document.getElementById('res-name');
        input.value = '';
        setTimeout(function () { input.focus(); }, 80);
      }

      /* On a clean delivery the card waits a beat. The handover happens
         out in the world - the column turns gold, the board comes up out
         of the forecourt - and throwing a full-screen panel over the top
         of it the same frame means nobody ever sees it happen. */
      this.cardIn = hold || 0;
      if (!this.cardIn) {
        M.HUD.show(false);
        show('result');
      }
    },

    saveRun: function () {
      if (!this.pendingRun) return;
      var name = document.getElementById('res-name').value.trim() || 'ANON';
      this.pendingRun.name = name;
      var idx = M.Leaderboard.add(this.pendingRun);
      this.pendingRun = null;
      document.getElementById('res-name-wrap').style.display = 'none';
      M.Leaderboard.render(idx);
      M.HUD.big('SAVED', '#37d67a');
    },

    /* ======================================================= */
    frame: function (now) {
      requestAnimationFrame(this.frame.bind(this));

      var dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;          /* tab was hidden - do not teleport */

      this.handleHotkeys();
      M.Radio.update(dt);

      if (this.state !== 'drive' && this.world) this.world.update(dt, M.Vehicle.pos);

      if (this.cardIn > 0) {
        this.cardIn -= dt;
        if (this.cardIn <= 0) {
          this.cardIn = 0;
          M.HUD.show(false);
          show('result');
        }
      }
      if (this.state === 'countdown') this.tickCountdown(dt);
      if (this.state === 'drive') this.tickDrive(dt);
      else if (this.state !== 'drive') M.Vehicle.sync();

      this.updateCamera(dt);
      this.updateSun();

      /* keep the radar live through the countdown too, so it is not a
         black hole on screen while you are waiting for the lights */
      var live = this.state === 'drive' || this.state === 'countdown';
      this.mmTick += dt;
      if (live && this.mmTick > 0.033) {
        this.mmTick = 0;
        M.Minimap.draw(M.Vehicle.pos.x, M.Vehicle.pos.z, M.Vehicle.yaw);
      }
      /* badges track the camera, so they are placed every frame -
         a radar tick behind and they visibly swim on the screen */
      M.Markers.show(live);
      if (live) M.Markers.update(this.camera, M.Vehicle);

      this.renderer.render(this.scene, this.camera);
      M.Input.endFrame();

      if (!this.loaded) {
        this.loaded = true;
        var ld = document.getElementById('loading');
        ld.classList.add('done');
        setTimeout(function () { ld.style.display = 'none'; }, 500);
      }
    },

    handleHotkeys: function () {
      if (M.Input.justPressed('Escape') && this.state !== 'menu') this.toMenu();
      if (M.Input.justPressed('KeyR') && (this.state === 'drive' || this.state === 'result')) this.startRun();
      if (M.Input.justPressed('Enter') && this.state === 'menu') this.startRun();

      if (M.Input.justPressed('KeyM')) M.Radio.setMuted(!M.Radio.muted);
      if (M.Input.justPressed('BracketLeft')) M.Radio.step(-1);
      if (M.Input.justPressed('BracketRight')) M.Radio.step(1);
    },

    tickCountdown: function (dt) {
      this.countdown -= dt;
      var n = Math.ceil(this.countdown - 0.2);
      var el = document.getElementById('cd-num');

      if (n !== this.lastBeep && n >= 1 && n <= 3) {
        this.lastBeep = n;
        el.textContent = n;
        el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        M.Audio.beep(false);
      }
      if (this.countdown <= 0.2 && this.lastBeep !== 0) {
        this.lastBeep = 0;
        el.textContent = 'GO';
        el.className = 'go tick';
        document.getElementById('cd-sub').textContent = 'Deliver the donations';
        M.Audio.beep(true);
      }
      if (this.countdown <= -0.45) {
        hide('countdown');
        this.state = 'drive';
      }
    },

    tickDrive: function (dt) {
      var v = M.Vehicle, w = this.world;
      var inp = M.Input.read();
      v.setSteerVisual(inp.steer);

      /* fixed-step physics keeps the handling identical at any framerate */
      this.acc += dt;
      var steps = 0;
      while (this.acc >= FIXED && steps < 8) {
        v.update(FIXED, inp, w);
        this.acc -= FIXED;
        steps++;
      }
      if (steps === 8) this.acc = 0;

      this.timeLeft -= dt;
      this.runTime += dt;

      this.consumeEvents();
      w.update(dt, v.pos);

      this.gpsTimer = (this.gpsTimer || 0) + dt;
      if (this.gpsTimer > 0.18) { this.gpsTimer = 0; this.refreshRoute(false); }

      M.Audio.engine(v.kmh(), inp.throttle, v.boosting, !v.grounded);

      M.HUD.update({
        timeLeft: this.timeLeft,
        timeLimit: TIME_LIMIT,
        kmh: v.kmh(),
        boostPct: v.boostPct(),
        boosting: v.boosting,
        cargo: v.cargo,
        remaining: this.remaining || 0,
        totalLength: this.totalLength || 1,
        score: this.score
      });

      /* ---- end conditions ---- */
      if (v.cargo <= 0) {
        this.finish(false, 'Cargo Destroyed',
          'Every crate is wrecked. There is nothing left to deliver.');
        return;
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish(false, 'Out of Time',
          'The 43 second window closed before the tempo reached the orphanage.');
        return;
      }
      var dfx = v.pos.x - w.finish.x, dfz = v.pos.z - w.finish.z;
      if (dfx * dfx + dfz * dfz < 13 * 13 && v.pos.y < 6) {
        if (v.cargo < CARGO_FLOOR) {
          this.finish(false, 'Donations Ruined',
            'You reached the drop-off with ' + Math.round(v.cargo) + '% cargo intact. ' +
            CARGO_FLOOR + '% was the minimum.');
        } else {
          /* How intact the load was. Getting every crate across is the
             hardest thing in this game - it means forty-three seconds through
             cross traffic without once getting it wrong - so it is worth
             more than the same card with a different number on it. */
          var cg = Math.round(v.cargo);
          var tier = cg >= 100 ? 'perfect' : cg >= 90 ? 'pristine' : '';
          var bonus = tier === 'perfect' ? 2500 : tier === 'pristine' ? 1000 : 0;
          this.score += bonus;

          w.celebrate(tier);
          if (tier) {
            M.HUD.big(tier === 'perfect' ? 'PERFECT DELIVERY' : 'PRISTINE LOAD',
              tier === 'perfect' ? '#ffd25e' : '#8ae6ff');
            M.Audio.fanfare(tier === 'perfect');
          }

          var title = tier === 'perfect' ? 'Perfect Delivery'
            : tier === 'pristine' ? 'Pristine Delivery' : 'Delivery Complete';
          var sub = tier === 'perfect'
            ? 'Every crate across, not a mark on the load. +' + bonus.toLocaleString() + ' bonus.'
            : tier === 'pristine'
              ? 'Handed over with ' + cg + '% intact - barely a scuff. +' +
                bonus.toLocaleString() + ' bonus.'
              : 'Donations handed over with ' + cg + '% of the load intact.';

          /* hold the card back longer when there is more to watch */
          this.finish(true, title, sub, tier === 'perfect' ? 2.6 : tier ? 1.9 : 1.3, tier);
        }
      }
    },

    consumeEvents: function () {
      var evs = M.Vehicle.drainEvents();
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i];
        if (e.type === 'stunt') {
          this.score += e.data.score;
          M.HUD.toast(e.data.names.join(' + '), e.data.boost + ' BOOST');
          M.Audio.stunt();
        } else if (e.type === 'pad') {
          M.Audio.pad();
        } else if (e.type === 'crate') {
          this.world.dropCrate(e.data);
          M.HUD.toast(e.data.left ? 'CRATE LOST' : 'LAST CRATE LOST', null);
          M.Audio.thud(9);
        } else if (e.type === 'hit') {
          if (e.data.damage > 3) {
            M.HUD.hitFlash();
            this.shake = Math.min(1.1, this.shake + e.data.force * 0.035);
          }
          M.Audio.thud(e.data.force);
        } else if (e.type === 'badland') {
          M.HUD.toast('ROUGH LANDING', null);
          M.HUD.hitFlash();
          this.shake = Math.min(1.0, this.shake + 0.5);
          M.Audio.thud(14);
        }
      }
    },

    /* ======================================================= */
    placeCameraBehind: function (snap) {
      var v = M.Vehicle;
      this.camYaw = v.yaw;
      if (snap) {
        var f = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
        this.camPos.copy(v.pos).addScaledVector(f, -13).add(new THREE.Vector3(0, 5.2, 0));
        this.camLook.copy(v.pos);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);
      }
    },

    updateCamera: function (dt) {
      var v = M.Vehicle;
      var menu = this.state === 'menu';

      if (menu) {
        /* slow orbit of the truck on the menu, showing it off */
        var t = performance.now() / 1000;
        var a = t * 0.17;
        this.camera.fov = U.damp(this.camera.fov, 42, 4, dt);
        this.camera.position.set(
          v.pos.x + Math.sin(a) * 15,
          v.pos.y + 4.4 + Math.sin(t * 0.4) * 0.7,
          v.pos.z + Math.cos(a) * 15
        );
        this.camera.lookAt(v.pos.x, v.pos.y + 1.1, v.pos.z);
        this.camera.updateProjectionMatrix();
        return;
      }

      this.camYaw += U.angleDelta(this.camYaw, v.yaw) * (1 - Math.exp(-7 * dt));
      var f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));

      var speedT = U.clamp(v.speed / 60, 0, 1);
      var back = 12.2 + speedT * 2.6 + (v.grounded ? 0 : 2.2);
      var up = 4.6 + speedT * 0.8 + (v.grounded ? 0 : 1.4);

      var want = new THREE.Vector3().copy(v.pos).addScaledVector(f, -back);
      want.y = v.pos.y + up;
      /* never let the camera sink below the road */
      var gy = this.world.groundAt(want.x, want.z, want.y, this._camGround || (this._camGround = {})).y;
      if (want.y < gy + 2.2) want.y = gy + 2.2;

      var rate = v.grounded ? 9 : 5.5;
      this.camPos.x = U.damp(this.camPos.x, want.x, rate, dt);
      this.camPos.y = U.damp(this.camPos.y, want.y, rate * 0.8, dt);
      this.camPos.z = U.damp(this.camPos.z, want.z, rate, dt);

      var look = new THREE.Vector3().copy(v.pos).addScaledVector(f, 9.5);
      look.y = v.pos.y + 1.9;
      this.camLook.x = U.damp(this.camLook.x, look.x, 12, dt);
      this.camLook.y = U.damp(this.camLook.y, look.y, 12, dt);
      this.camLook.z = U.damp(this.camLook.z, look.z, 12, dt);

      this.camera.position.copy(this.camPos);

      /* impact shake */
      if (this.shake > 0.001) {
        this.shake = U.damp(this.shake, 0, 7, dt);
        this.camera.position.x += (Math.random() - 0.5) * this.shake;
        this.camera.position.y += (Math.random() - 0.5) * this.shake;
        this.camera.position.z += (Math.random() - 0.5) * this.shake;
      }

      this.camera.lookAt(this.camLook);

      var wantFov = 70 + speedT * 9 + (v.boosting ? 9 : 0);
      this.camera.fov = U.damp(this.camera.fov, wantFov, 5, dt);
      this.camera.updateProjectionMatrix();
    },

    /* keep the shadow frustum over the truck */
    updateSun: function () {
      var p = M.Vehicle.pos;
      /* low and off to one side, so the shadows rake down the street */
      this.sun.position.set(p.x - 210, p.y + 78, p.z - 115);
      this.sun.target.position.set(p.x, p.y, p.z);
      this.sun.target.updateMatrixWorld();
    },

    onResize: function () {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  };

  function show(id) { document.getElementById(id).classList.remove('screen-hidden'); }
  function hide(id) { document.getElementById(id).classList.add('screen-hidden'); }

  /* 'menu' uses .screen (always displayed) - normalise it to the same toggle */
  window.addEventListener('DOMContentLoaded', function () {
    if (typeof THREE === 'undefined') {
      document.getElementById('loading').innerHTML =
        '<div class="ld-txt" style="max-width:420px;text-align:center;line-height:2">' +
        'Three.js could not be loaded.<br>Check your internet connection and reload.</div>';
      return;
    }
    try {
      M.Game.init();
    } catch (err) {
      console.error(err);
      document.getElementById('loading').innerHTML =
        '<div class="ld-txt" style="max-width:520px;text-align:center;line-height:2">' +
        'Could not start: ' + String(err && err.message || err) + '</div>';
    }
  });

})(window.MUD);
