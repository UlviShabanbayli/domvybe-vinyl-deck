// deck.js — the turntable's physics: no DOM, just state and time. One clock moves three coupled things:
//   the platter   driven by the motor (spin-up / brake with inertia) or held by a hand (scratch)
//   the needle    in the groove its time advances with the platter; time → radius → the arm's angle
//   the sound     audio.js plays the side at the platter's speed (rate 1 = 33⅓ rpm), backwards too
//
// ONE source of truth for speed: motor.js's DeckMotor, rate = motor × speed × pitch (1 = 33⅓). The same model runs per
// sample on the audio thread (that is the sound) and per frame here (that is the picture): ω = BASE ω × rate, and the
// angle is ω integrated every frame. START/STOP, 33/45 and the fader only change the model's goals — on both copies at
// once — so the strobe dots, the label, the meters and the music cannot disagree, and every change glides.
//
// A hand on the record takes over from the motor. It grips with a little slip: the record's speed follows the hand's
// with HAND_GRIP (a still hand stops a spinning record in ~150 ms, the pitch sliding down with it), and the record's
// angle keeps the hand's movement 1 : 1 after that, so a scratch moves the music exactly as far as the hand. When the
// hand lets go, the motor takes the record from the speed it has and spins it back up (or lets it lie, in STOP).
//
// The arm moves like a real one, on a cue lever: every move is raise (the needle lifts, the music fades out) → swing →
// lower (the needle lands: a thump, the music seats in, the record shudders). A hand on the arm raises it at the touch
// and lowers it where it is let go; set down off the vinyl or on the rest post, the deck stops like an auto-stop deck.
// The motor never cares where the arm is: the platter keeps turning while the arm is in the air.
//
// The picture turns slower than a real deck: BASE_VISUAL_RPM visual turns per minute stand for 33⅓ (33⅓ on screen is a
// blur). A hand that moves the label a quarter turn moves the music by a quarter turn's worth of 33⅓ time.

(() => {
  const G = window.DeckGeo, C = window.Catalog, audio = window.DeckAudio;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const BASE_VISUAL_RPM = 10;                                  // what 33⅓ looks like on screen
  const OMEGA = (2 * Math.PI * BASE_VISUAL_RPM) / 60;          // visual rad/s at rate 1
  const RPM_45 = window.DeckMotor.RPM_45;                      // 45 / 33⅓ = 1.35
  const PITCH_RANGE = 8;                                       // ± %
  const HAND_GRIP = 20;                                        // 1/s: how fast the record takes the hand's speed
  const AUDIO_SYNC = { hold: 180, jump: 0.5, pull: 6 };        // ms after a drop; s off before jumping; 1/s pull
  const LOCKED_GIVE_UP = 3.6;                                  // s in the locked groove before the arm returns
  const ARM_SPRING = { k: 30, damping: 1.05 };                 // the arm swinging to a cue point
  const CUE_LEVER = { rise: 0.25, lower: 0.25, settle: 0.2, bounce: 0.14 };   // s, s, s, height of the settle
  const DROP = { cue: 0.75, hand: 0.6 };                       // needle-drop strength: the lever / a hand
  const VU = { ref: 0.16, max: 1.6, smooth: 0.075, rest: -132.6, full: -77.6, stop: -46, k: 420, damping: 0.62 };

  // ------------------------------------------------------------------ state
  const st = {
    motor: false, omega: 0, angle: 0, pitch: 0, speed: 1,      // the goals: speed 1 = 33⅓, RPM_45 = 45; pitch a fraction
    drive: new window.DeckMotor(),                             // the speed model (motor.js), stepped every frame
    hand: null,                                                // { last, target, id } while a hand holds the record
    down: false, t: -G.LEAD,                                   // the needle: in the groove? where, in side seconds
    phi: G.PHI_CONCEPT, phiV: 0, armHeld: null,                // the arm's angle about its bearing; a hand on it
    lever: { h: 0, phase: 'down', u: 0, from: 0 },             // the cue lever: h 0 = lowered … 1 = raised
    move: null,                                                // a planned move: raise → swing → lower (→ drop)
    landed: 0,                                                 // performance.now() of the last needle drop (the wobble)
    landing: 0,                                                // how hard it landed (0 … 1)
    untouched: true,                                           // nothing has moved the arm yet (the concept's pose)
    locked: 0, syncHold: 0,
    vu: [0, 0], vuDeg: [VU.rest, VU.rest], vuV: [0, 0],
    record: C.SIDE_A, groove: null, tracks: C.TRACKS,          // the record on the deck and its groove
  };

  // ------------------------------------------------------------------ the record on the deck
  function setRecord(release) {
    const { start, end } = C.span(release);
    st.record = release;
    st.groove = G.groove(start, end);
    st.tracks = release.tracks.map(C.track);
    audio.program(start, end, end + G.RUNOUT);
  }
  setRecord(C.SIDE_A);

  // the motor's goals go to both copies of the model at once
  function drive(goals) { st.drive.set(goals); audio.motor(goals); }
  audio.onReady = () => audio.motor(st.drive.snapshot());
  drive({ calm: reduce.matches });
  reduce.addEventListener('change', () => drive({ calm: reduce.matches }));

  const clampT = (t) => Math.max(st.groove.start - G.LEAD, Math.min(st.groove.end + G.RUNOUT, t));
  // the track (catalog id) at side time t on the record that is on
  function trackAt(t) {
    for (let i = st.tracks.length - 1; i >= 0; i--) if (t >= st.tracks[i].t0) return st.tracks[i].id;
    return st.tracks[0].id;
  }
  // where the arm is over the record (for a needle that is up: where it would land)
  const armOverRecord = () => { const r = G.rOf(st.phi); return !st.untouched && r <= G.R_LEAD + 2 && r >= G.R_LOCK; };
  const armTime = () => (st.down ? st.t : st.groove.tAt(G.rOf(st.phi)));

  // ------------------------------------------------------------------ actions
  function wake() { audio.start(); }
  function lift() { if (st.down) { st.down = false; audio.up(); } }
  function drop(t, vel) {
    st.t = clampT(t);
    st.down = true; st.locked = 0; st.syncHold = performance.now() + AUDIO_SYNC.hold; st.untouched = false;
    st.phi = G.phiAt(st.groove.rAt(st.t)); st.phiV = 0;
    audio.down(st.t, vel);
  }

  // the cue lever: raise (the needle lifts first), lower (the needle lands when it is down)
  function raise() {
    lift();
    if (st.lever.phase === 'up' || st.lever.phase === 'rising') return;
    st.lever.phase = 'rising'; st.lever.from = st.lever.h; st.lever.u = 0;
  }
  function lower() { st.lever.phase = 'lowering'; st.lever.from = Math.max(0, st.lever.h); st.lever.u = 0; }

  // a move: up, across, down. `then` is 'drop' (at side time t) or 'rest' (on the rest post)
  function plan(phi, then, t = 0) {
    st.move = { phi, then, t, stage: 'raise' };
    st.untouched = false;
    raise();                                                  // the needle comes up at once
    if (reduce.matches) {                                     // no animation: the arm is simply there
      lift(); st.phi = phi; st.phiV = 0; st.lever.h = 0; st.lever.phase = 'down'; st.move = null;
      if (then === 'drop') drop(t, DROP.cue);
    }
  }
  function cue(t) { plan(G.phiAt(st.groove.rAt(t)), 'drop', t); }
  function toRest() {
    if (st.lever.phase === 'down' && !st.down && Math.abs(st.phi - G.PHI_REST) < 1e-3) return;   // already home
    plan(G.PHI_REST, 'rest');
  }
  // the arm goes home and, like an auto-stop deck, the motor brakes to a stop
  function park() { toRest(); stop(); }
  function setMotor(on) { st.motor = on; drive({ on }); }
  function play() {
    wake(); setMotor(true);
    if (!st.down && !st.armHeld && !st.move) cue(armOverRecord() ? st.groove.tAt(G.rOf(st.phi)) : st.groove.start - G.LEAD);
  }
  function stop() { setMotor(false); }
  function toggle() { if (st.motor) stop(); else play(); }
  function seek(t) { wake(); setMotor(true); cue(Math.max(st.groove.start - G.LEAD, Math.min(st.groove.end, t))); }
  function step(dir) {
    const t = st.down ? st.t : (st.untouched ? st.groove.start : armTime());
    let i = st.tracks.findIndex((k) => k.id === trackAt(Math.max(st.groove.start, t)));
    if (dir > 0) { if (i >= st.tracks.length - 1) return; i++; }
    else if (t - st.tracks[i].t0 < 2) i = Math.max(0, i - 1);
    seek(st.tracks[i].t0);
  }
  // put another record on: the needle lifts, the arm goes home, the platter keeps whatever it was doing
  function load(release) { if (release !== st.record) { toRest(); setRecord(release); } }
  function setSpeed(rpm) { st.speed = rpm === 45 ? RPM_45 : 1; drive({ speed: st.speed }); }
  function setPitch(percent) {
    let v = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, Math.round(percent * 10) / 10));
    if (Math.abs(v) < 0.25) v = 0;                             // a detent at the centre
    if (v / 100 !== st.pitch) { st.pitch = v / 100; drive({ pitch: 1 + st.pitch }); }
    return v;
  }

  // ------------------------------------------------------------------ hands
  const angleAt = (p, c) => Math.atan2(p.y - c.y, p.x - c.x);
  const wrapPi = (d) => (d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
  // the grip starts where the record would coast to under a still hand, so its speed does not jump at the touch
  function grabRecord(p, id) {
    wake();
    st.hand = { last: angleAt(p, G.S), target: st.angle + st.omega / HAND_GRIP, id };
  }
  function moveRecord(p) {
    const a = angleAt(p, G.S);
    st.hand.target += wrapPi(a - st.hand.last); st.hand.last = a;
  }
  function releaseRecord() {
    st.hand = null;
    st.drive.takeOver(st.omega / OMEGA);
    audio.release();
  }
  // a hand on the arm: the lever rises at the touch, the arm follows the hand while held, lowers where it is let go
  function grabArm(p, id) {
    wake(); raise(); st.untouched = false; st.move = null; st.phiV = 0;
    st.armHeld = { off: p ? angleAt(p, G.P) - st.phi : 0, id };
  }
  function moveArm(p) { setArmAngle(angleAt(p, G.P) - st.armHeld.off); }
  function setArmAngle(phi) { st.phi = Math.max(G.PHI_REST, Math.min(G.PHI_MAX, phi)); }
  function releaseArm() {
    st.armHeld = null;
    const r = G.rOf(st.phi);
    if (r <= G.R_LEAD + 6 && r >= G.R_LOCK - 4) {              // over the vinyl: lower it here, the needle lands
      st.move = { phi: st.phi, then: 'drop', t: st.groove.tAt(Math.min(r, G.R_LEAD)), stage: 'lower', vel: DROP.hand };
      if (reduce.matches) { st.move = null; st.lever.h = 0; st.lever.phase = 'down'; drop(st.groove.tAt(Math.min(r, G.R_LEAD)), DROP.hand); }
      else lower();
    } else park();                                             // on the rest post, or off the vinyl: home, motor off
  }
  // is a concept-px point on the arm (the headshell, or near the tube)? `pxToConcept` > 0 for a finger: the targets
  // grow to at least 48 / 44 CSS px across
  function onArm(p, pxToConcept = 0) {
    const s = G.stylus(st.phi);
    if (Math.hypot(p.x - s.x, p.y - s.y) < Math.max(44, 24 * pxToConcept)) return true;
    const dx = s.x - G.P.x, dy = s.y - G.P.y;
    const k = Math.max(0, Math.min(1, ((p.x - G.P.x) * dx + (p.y - G.P.y) * dy) / (dx * dx + dy * dy)));
    return k > 0.15 && Math.hypot(p.x - (G.P.x + dx * k), p.y - (G.P.y + dy * k)) < Math.max(26, 22 * pxToConcept);
  }
  const onRecord = (p) => Math.hypot(p.x - G.S.x, p.y - G.S.y) < G.R;

  // ------------------------------------------------------------------ the clock
  function spinPlatter(dt) {
    if (st.hand) {
      // exact over the step: the angle closes on the hand's with time constant 1/HAND_GRIP
      const k = 1 - Math.exp(-dt * HAND_GRIP), before = st.angle;
      st.angle += (st.hand.target - st.angle) * k;
      st.omega = dt > 0 ? (st.angle - before) / dt : 0;
      audio.hand(st.omega / OMEGA);
    } else {
      st.omega = OMEGA * st.drive.step(dt);
      st.angle += st.omega * dt;
    }
  }

  function followGroove(dt, now, rate) {
    st.t += rate * dt;
    const heard = audio.pos();
    if (heard !== null && now > st.syncHold && st.t < st.groove.end) {
      if (Math.abs(heard - st.t) > AUDIO_SYNC.jump) st.t = heard;
      else st.t += (heard - st.t) * Math.min(1, dt * AUDIO_SYNC.pull);
    }
    st.t = Math.max(st.t, st.groove.start - G.LEAD);
    const lockAt = st.groove.end + G.RUNOUT;
    if (st.t >= lockAt) {
      st.t = lockAt;
      if (Math.abs(rate) > 0.2) st.locked += dt;
      if (st.locked > LOCKED_GIVE_UP) park();
    }
    st.phi = G.phiAt(st.groove.rAt(st.t));
  }

  // the lever's height over time: an eased rise, an ease-out fall, then a small settle as the stylus seats
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const easeOut = (u) => 1 - (1 - u) ** 3;
  function stepLever(dt) {
    const L = st.lever, c = CUE_LEVER;
    if (L.phase === 'rising') {
      L.u = Math.min(1, L.u + dt / c.rise); L.h = L.from + (1 - L.from) * easeInOut(L.u);
      if (L.u >= 1) L.phase = 'up';
    } else if (L.phase === 'lowering') {
      L.u = Math.min(1, L.u + dt / c.lower); L.h = L.from * (1 - easeOut(L.u));
      if (L.u >= 1) { L.phase = 'settling'; L.u = 0; landed(L.from); }
    } else if (L.phase === 'settling') {
      L.u = Math.min(1, L.u + dt / c.settle);
      L.h = -c.bounce * Math.sin(Math.PI * L.u) * (1 - L.u);   // the shadow dips a touch closer, once
      if (L.u >= 1) { L.phase = 'down'; L.h = 0; }
    }
  }
  // the lever is down: the needle lands if the move was a drop, and the record shudders
  function landed(height) {
    const m = st.move;
    if (m && m.then === 'drop') {
      drop(m.t, m.vel || DROP.cue);
      st.landed = performance.now(); st.landing = Math.min(1, height * (m.vel || DROP.cue) / DROP.cue);
      st.vuV[0] += 90 * st.landing; st.vuV[1] += 80 * st.landing;   // the meters flick on the thump
    }
    st.move = null;
  }
  function stepMove(dt) {
    const m = st.move;
    if (m.stage === 'raise') { raise(); if (st.lever.phase === 'up') m.stage = 'swing'; return; }
    if (m.stage === 'swing') {
      const { k, damping } = ARM_SPRING, c = 2 * Math.sqrt(k) * damping;
      st.phiV += (k * (m.phi - st.phi) - c * st.phiV) * dt;
      st.phi += st.phiV * dt;
      if (Math.abs(m.phi - st.phi) < 0.0015 && Math.abs(st.phiV) < 0.01) { st.phi = m.phi; st.phiV = 0; m.stage = 'lower'; lower(); }
    }
  }

  function swingMeters(dt) {
    const lv = audio.levels();
    for (let c = 0; c < 2; c++) {
      const amp = Math.min(VU.max, lv[c] / VU.ref);
      st.vu[c] += (amp - st.vu[c]) * (1 - Math.exp(-dt / VU.smooth));
      const goal = Math.min(VU.stop, VU.rest + (VU.full - VU.rest) * st.vu[c]);
      if (reduce.matches) { st.vuDeg[c] = goal; continue; }
      const d = 2 * Math.sqrt(VU.k) * VU.damping;
      st.vuV[c] += (VU.k * (goal - st.vuDeg[c]) - d * st.vuV[c]) * dt;
      st.vuDeg[c] += st.vuV[c] * dt;
    }
  }

  function advance(dt, now) {
    spinPlatter(dt);
    const rate = st.omega / OMEGA;                              // the music's speed: 1 = 33⅓
    if (st.down) followGroove(dt, now, rate);
    else if (!st.armHeld && st.move) stepMove(dt);
    stepLever(dt);
    swingMeters(dt);
  }

  // ------------------------------------------------------------------ what the view reads
  const rate = () => st.omega / OMEGA;
  const steady = (within = 1e-4) => !st.hand && Math.abs(st.drive.rate() - st.drive.goalRate()) < within;
  // the track the Now-playing list lights: under the needle, under the hovering arm, or the concept's row 2 at first
  // (null: none)
  function litTrack() {
    if (st.down || armOverRecord()) return trackAt(Math.max(st.groove.start, Math.min(st.groove.end - 0.01, armTime())));
    return st.untouched && st.record === C.SIDE_A ? st.tracks[1].id : null;
  }

  window.Deck = {
    st, BASE_VISUAL_RPM, OMEGA, RPM_45, PITCH_RANGE,
    play, stop, toggle, seek, step, cue, toRest, park, load, setSpeed, setPitch,
    grabRecord, moveRecord, releaseRecord, grabArm, moveArm, setArmAngle, releaseArm, onArm, onRecord,
    advance, rate, steady, litTrack, armTime, trackAt,
  };
})();
