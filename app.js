// app.js — the deck on the page: input → deck.js → pixels. deck.js owns the physics; this file reads the hands and the
// buttons, runs the clock and draws.
//
// Drawing never lays the page out again: every frame writes at most
//   transforms on the platter layers (the strobe ring and the label, each its own composited layer),
//   transforms (+ opacity while the lever moves) on the arm and its two pre-blurred shadow layers,
//   transforms on the two VU needles (HTML, so no SVG relayout),
// and only when the value changed. Text (track, time, speed) is written only when the words change, the label print
// only when the track changes. While the deck is scrolled out of view the physics and the sound keep running and the
// drawing waits.
//
// Events for the rest of the page (sections.js): `deck:track` { trackId } when the lit track changes, `deck:state`
// { playing, rpm, status, needleDown } when the motor, the needle or the speed readout changes, `deck:record`
// { releaseId } when another record goes on.

(() => {
  const G = window.DeckGeo, C = window.Catalog, D = window.Deck, audio = window.DeckAudio, st = D.st;
  const RAD = Math.PI / 180;
  const FADER_TRAVEL = 95;                          // concept px from centre to ±8 %
  const MAX_DT = 0.05;
  const READOUT_MS = 250;                           // the live rpm readout changes at most 4× a second, like a real display
  const STEADY = 0.0015;                            // rate within this of its goal reads as the nominal speed (< 0.05 rpm)
  const LIFT_SCALE = 0.025;                         // the arm grows this much at the top of the lever's travel
  const SHADOW_ALPHA = { low: 0.45, high: 0.32, idle: 0.002 };   // idle: never fully 0, so both stay rastered
  const WOBBLE = { ms: 320, hz: 8.5, decay: 0.09, px: 1.3, scale: 0.004 };   // the record's shudder when the needle lands
  const ARM_KEY_STEP = 0.6 * RAD;
  const cqw = (conceptPx) => (conceptPx / G.DECK_BOX.w) * 100;              // concept px → cqw of the deck

  // ------------------------------------------------------------------ elements
  const $ = (s, root = document) => root.querySelector(s);
  const deck = $('#deck'), ring = $('#ring'), label = $('#label'), arm = $('#arm'), armImg = $('#arm-img');
  const shadows = [$('#arm-shadow-near'), $('#arm-shadow-far')];
  const led = $('#led'), startStop = $('#startstop'), fader = $('#fader');
  const speedBox = $('.speed'), speedButtons = [...deck.querySelectorAll('.speed [data-rpm]')], speedToggle = $('#speed-toggle');
  const trackList = $('#tracks'), needles = [$('#vu-l'), $('#vu-r')], npNow = $('#np-now'), npRpm = $('#np-rpm');
  let rows = [];

  // ------------------------------------------------------------------ the arm on the page: the concept's, or ours
  (function mountArm() {
    const concept = G.ARM_NAME === 'concept';
    deck.dataset.arm = G.ARM_NAME;
    armImg.src = concept ? 'img/carm.webp' : 'img/arm.webp';
    shadows[0].src = `img/${concept ? 'carm' : 'arm'}-shadow-near.webp`;
    shadows[1].src = `img/${concept ? 'carm' : 'arm'}-shadow-far.webp`;
    const base = $(concept ? '.arm-base.under' : '.arm-base.over');
    base.src = concept ? 'img/carm-base.webp' : 'img/arm-base.webp';
    base.hidden = false;
    [armImg, ...shadows, base].forEach((img) => img.decode().catch(() => {}));   // decoded before the first lift
  })();

  // the pitch scale's ticks: 17, a long one every 4
  (function drawPitchTicks() {
    const ticks = $('.pitch-scale .ticks');
    for (let i = 0; i <= 16; i++) {
      const y = 730 + i * (200 / 16), long = i % 4 === 0;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', long ? 1189 : 1193); l.setAttribute('x2', 1202); l.setAttribute('y1', y); l.setAttribute('y2', y);
      ticks.appendChild(l);
    }
  })();

  // ------------------------------------------------------------------ controls
  function setSpeed(rpm) {
    D.setSpeed(rpm);
    speedBox.dataset.rpm = rpm;
    speedButtons.forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.rpm === rpm)));
  }
  function setPitch(percent) {
    const v = D.setPitch(percent);
    fader.style.transform = `translateY(${cqw((-v / D.PITCH_RANGE) * FADER_TRAVEL)}cqw)`;   // + is up, like the scale
    fader.setAttribute('aria-valuenow', v);
    fader.setAttribute('aria-valuetext', `${v > 0 ? '+' : ''}${v.toFixed(1)} %`);
  }

  // the sound opens on the press, the motor starts on the click: two short tasks instead of one long one
  startStop.addEventListener('pointerdown', () => audio.start());
  startStop.addEventListener('click', () => D.toggle());
  speedButtons.forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.rpm)));
  speedToggle.addEventListener('click', () => setSpeed(st.speed > 1 ? 33 : 45));
  trackList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-track]');
    if (b) cueTrack(b.dataset.track);
  });

  // the Now-playing rows for the record on the deck (the same markup the page opens with)
  function listTracks() {
    trackList.replaceChildren(...st.tracks.map((k, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.dataset.track = k.id;
      b.innerHTML = '<span class="no"></span><span class="ti"></span><span class="du"></span>';
      b.children[0].textContent = i + 1; b.children[1].textContent = k.title; b.children[2].textContent = C.duration(k.len);
      li.append(b); return li;
    }));
    rows = [...trackList.querySelectorAll('button')];
    view.track = undefined;
  }

  // ------------------------------------------------------------------ the records: cue a track, put a release on
  function cueTrack(id) {
    const k = C.track(id);
    if (!k) return;
    if (!st.tracks.includes(k)) putOn(C.releaseOf(id), false);
    D.seek(k.t0);
  }
  function putOn(release, cueFirst = true) {
    if (!release) return;
    D.load(release);
    listTracks();
    arm.setAttribute('aria-valuemax', Math.round(st.groove.len));
    if (cueFirst) D.seek(st.tracks[0].t0);
  }

  // ------------------------------------------------------------------ hands: the record, the arm, the fader
  const toConcept = (e) => {
    const b = deck.getBoundingClientRect(), box = G.DECK_BOX;
    return { x: box.x + (e.clientX - b.left) / b.width * box.w, y: box.y + (e.clientY - b.top) / b.height * box.h };
  };
  let hoverCursor = '';
  deck.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('#startstop, #fader, .speed')) return;
    const p = toConcept(e);
    const finger = e.pointerType === 'touch' ? G.DECK_BOX.w / deck.getBoundingClientRect().width : 0;
    if (D.onArm(p, finger)) { D.grabArm(p, e.pointerId); deck.classList.add('grab-arm'); }
    else if (D.onRecord(p)) D.grabRecord(p, e.pointerId);
    else return;
    deck.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  deck.addEventListener('pointermove', (e) => {
    if (st.armHeld && e.pointerId === st.armHeld.id) D.moveArm(toConcept(e));
    else if (st.hand && e.pointerId === st.hand.id) D.moveRecord(toConcept(e));
    else if (!e.buttons) {
      const cursor = D.onArm(toConcept(e)) ? 'grab' : '';
      if (cursor !== hoverCursor) { deck.style.cursor = cursor; hoverCursor = cursor; }
    }
  });
  const release = (e) => {
    if (st.armHeld && e.pointerId === st.armHeld.id) { D.releaseArm(); deck.classList.remove('grab-arm'); }
    if (st.hand && e.pointerId === st.hand.id) D.releaseRecord();
  };
  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', release);

  // the arm by keyboard: Enter/Space raises it (and lowers it again), ←/→ swing it while it is up, Esc sends it home
  arm.addEventListener('keydown', (e) => {
    const held = st.armHeld && st.armHeld.id === 'key';
    if (e.key === 'Enter' || e.key === ' ') { if (held) D.releaseArm(); else D.grabArm(null, 'key'); }
    else if (held && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) D.setArmAngle(st.phi + ARM_KEY_STEP);
    else if (held && (e.key === 'ArrowRight' || e.key === 'ArrowUp')) D.setArmAngle(st.phi - ARM_KEY_STEP);
    else if (e.key === 'Escape') { st.armHeld = null; D.park(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  });

  // pitch fader ±8 %: drag, ↑/↓ PgUp/PgDn, Home/0, double-click = 0
  let faderDrag = null;
  function grabFader(e) {
    faderDrag = { id: e.pointerId, y: toConcept(e).y, v: st.pitch * 100 };
    fader.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  }
  fader.addEventListener('pointerdown', grabFader);
  fader.addEventListener('pointermove', (e) => {
    if (faderDrag && e.pointerId === faderDrag.id) setPitch(faderDrag.v - (toConcept(e).y - faderDrag.y) / FADER_TRAVEL * D.PITCH_RANGE);
  });
  fader.addEventListener('pointerup', () => { faderDrag = null; });
  fader.addEventListener('dblclick', () => setPitch(0));
  fader.addEventListener('keydown', (e) => {
    const k = { ArrowUp: 0.5, ArrowDown: -0.5, PageUp: 2, PageDown: -2 }[e.key];
    if (k !== undefined) { setPitch(st.pitch * 100 + k); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'Home' || e.key === '0') { setPitch(0); e.preventDefault(); }
  });

  // touch: the controls sit closer together than two 44 px targets (START ↔ 33 is ~27 px apart on a phone), so their
  // grown touch boxes (style.css) overlap. A touch on any of them goes to the control whose PICTURE centre is nearest
  // the finger — each control owns its Voronoi cell, nothing is shared — and the browser's own target is overruled.
  const touchControls = [
    { el: startStop, centre: startStop.querySelector('img'), press: () => audio.start(), tap: () => D.toggle() },
    ...speedButtons.map((b) => ({ el: b, centre: b, tap: () => setSpeed(+b.dataset.rpm) })),
    { el: speedToggle, centre: speedToggle.querySelector('img'), tap: () => setSpeed(st.speed > 1 ? 33 : 45) },
    { el: fader, centre: fader.querySelector('img'), drag: grabFader },
  ];
  const contentCentre = (el) => {                  // the centre of the content box (the grown padding left out)
    const r = el.getBoundingClientRect(), c = getComputedStyle(el);
    const l = r.left + parseFloat(c.paddingLeft) + parseFloat(c.borderLeftWidth), t = r.top + parseFloat(c.paddingTop) + parseFloat(c.borderTopWidth);
    const w = r.width - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight), h = r.height - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom);
    return { x: l + w / 2, y: t + h / 2 };
  };
  let routedTap = null;
  deck.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.target.closest('#startstop, #fader, .speed button')) return;
    let best = null, bestD = Infinity;
    for (const k of touchControls) {
      const c = contentCentre(k.centre), d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
      if (d < bestD) { best = k; bestD = d; }
    }
    e.stopPropagation();                           // the controls' own pointerdown handlers do not run: this decides
    if (best.drag) { routedTap = null; best.drag(e); return; }
    routedTap = best;
    if (best.press) best.press();
    if (best.el === startStop) startStop.classList.add('pressed');
  }, { capture: true });
  const endPress = () => startStop.classList.remove('pressed');
  deck.addEventListener('pointerup', endPress); deck.addEventListener('pointercancel', () => { endPress(); routedTap = null; });
  deck.addEventListener('click', (e) => {
    if (!routedTap || !e.isTrusted) return;
    const k = routedTap; routedTap = null;
    e.stopPropagation(); e.preventDefault();
    k.tap();
  }, { capture: true });

  // keys: Space start/stop, ← → tracks (not while typing)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, dialog')) return;
    const tag = e.target.tagName;
    if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); D.toggle(); }
    else if (e.key === 'ArrowRight' && e.target !== fader) { e.preventDefault(); D.step(1); }
    else if (e.key === 'ArrowLeft' && e.target !== fader) { e.preventDefault(); D.step(-1); }
  });

  // ------------------------------------------------------------------ drawing
  const view = { readoutAt: 0, platter: '', arm: '', shadow: ['', ''], fade: ['', ''], motor: null, track: undefined, now: '', rpm: '', needle: ['', ''], armTime: -1 };
  let deckInView = true;
  new IntersectionObserver(([e]) => { deckInView = e.isIntersecting; }).observe(deck);

  const elapsed = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const signedPercent = (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

  function nowPlaying(track) {
    if (st.untouched && !st.down) return 'Press START/STOP';
    if (!st.down) return 'Needle up';
    if (st.t < st.groove.start) return 'Lead-in';
    if (st.t > st.groove.end) return 'Run-out';
    const k = C.track(track);
    return `${k.title} · ${elapsed(st.t - k.t0)}`;
  }
  // the speed: nominal (and pitch) while the platter holds it, the actual rpm while it ramps or a hand holds it (4 Hz)
  function speedWords(now) {
    if (!D.steady(STEADY)) {
      if (now - view.readoutAt < READOUT_MS) return view.rpm;     // text changes re-lay the panel out: not every frame
      view.readoutAt = now;
      return `${(Math.abs(D.rate()) * 100 / 3).toFixed(1)} rpm`;
    }
    const nominal = st.speed > 1 ? '45 rpm' : '33⅓ rpm';
    return st.pitch ? `${nominal} ${signedPercent(st.pitch * 100)}` : nominal;
  }

  // the platter: its angle, and for a moment after a needle drop a small damped shudder towards the needle
  function platterTransform(now) {
    const rot = `rotate(${((st.angle / RAD) % 360).toFixed(2)}deg)`;
    const t = now - st.landed;
    if (!st.landed || t > WOBBLE.ms) return rot;
    const w = st.landing * Math.exp(-t / 1000 / WOBBLE.decay) * Math.sin(2 * Math.PI * WOBBLE.hz * t / 1000);
    const s = G.stylus(st.phi), dx = s.x - G.S.x, dy = s.y - G.S.y, n = Math.hypot(dx, dy) || 1;
    return `translate(${cqw(dx / n * WOBBLE.px * w).toFixed(4)}cqw, ${cqw(dy / n * WOBBLE.px * w).toFixed(4)}cqw) scale(${(1 + WOBBLE.scale * w).toFixed(5)}) ${rot}`;
  }

  function drawDeck(now) {
    const platter = platterTransform(now);
    if (platter !== view.platter) { ring.style.transform = platter; label.style.transform = platter; view.platter = platter; }

    // the arm: turned about its bearing, a little larger as the lever raises it; its shadow further off and softer
    let d = st.phi / RAD - G.THETA0; d = ((d + 180) % 360 + 360) % 360 - 180;
    const h = st.lever.h, up = Math.max(0, h);
    const turn = `rotate(${d.toFixed(3)}deg) scale(${(1 + LIFT_SCALE * up).toFixed(4)})`;
    if (turn !== view.arm) { arm.style.transform = turn; view.arm = turn; }
    const { low, high } = G.ARM_SHADOW;
    const ox = cqw(low[0] + (high[0] - low[0]) * h).toFixed(3), oy = cqw(low[1] + (high[1] - low[1]) * h).toFixed(3);
    const cast = `translate(${ox}cqw, ${oy}cqw) ${turn}`;
    const fade = [Math.max(SHADOW_ALPHA.idle, SHADOW_ALPHA.low * (1 - up)).toFixed(3), Math.max(SHADOW_ALPHA.idle, SHADOW_ALPHA.high * up).toFixed(3)];
    for (let i = 0; i < 2; i++) {
      if (cast !== view.shadow[i]) { shadows[i].style.transform = cast; view.shadow[i] = cast; }
      if (fade[i] !== view.fade[i]) { shadows[i].style.opacity = fade[i]; view.fade[i] = fade[i]; }
    }
    for (let c = 0; c < 2; c++) {
      const n = `rotate(${st.vuDeg[c].toFixed(2)}deg)`;
      if (n !== view.needle[c]) { needles[c].style.transform = n; view.needle[c] = n; }
    }
  }

  // events leave the frame: they are sent from a task after it, so a listener's work never lengthens a frame
  const outbox = new Map();
  function emit(name, detail) {
    if (!outbox.size) setTimeout(() => { for (const [n, d] of outbox) document.dispatchEvent(new CustomEvent(n, { detail: d })); outbox.clear(); });
    outbox.set(name, detail);
  }

  function drawPanel() {
    if (st.motor !== view.motor) {
      led.classList.toggle('on', st.motor); startStop.setAttribute('aria-pressed', st.motor); view.motor = st.motor;
    }
    const track = D.litTrack();
    if (track !== view.track) {
      rows.forEach((b) => b.setAttribute('aria-current', String(track !== null && +b.dataset.track === track)));
      view.track = track;
      const k = track === null ? null : C.track(track);
      window.DeckLabel.show({ track: k, release: st.record, artist: k ? C.artistName(k.id) : '', position: k ? `A${st.tracks.indexOf(k) + 1}` : '' });
      emit('deck:track', { trackId: track });
    }
    const now = nowPlaying(track);
    if (now !== view.now) { npNow.textContent = now; view.now = now; }
    const rpm = speedWords(performance.now());
    if (rpm !== view.rpm || st.motor !== view.statePlaying || st.down !== view.stateDown) {
      npRpm.textContent = rpm; view.rpm = rpm; view.statePlaying = st.motor; view.stateDown = st.down;
      emit('deck:state', { playing: st.motor, rpm: +(Math.abs(D.rate()) * 100 / 3).toFixed(2), status: rpm, needleDown: st.down });
    }
    if (st.record !== view.record) { view.record = st.record; emit('deck:record', { releaseId: st.record.id }); }
    const at = Math.max(0, Math.round(D.armTime() - st.groove.start));
    if (at !== view.armTime) { arm.setAttribute('aria-valuenow', at); view.armTime = at; }
  }

  function draw(now) { if (deckInView) drawDeck(now); drawPanel(); }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000)); last = now;
    D.advance(dt, now);
    draw(now);
    requestAnimationFrame(tick);
  }

  listTracks(); setPitch(0); setSpeed(33); draw(performance.now());
  requestAnimationFrame(tick);
  // the side is decoded while the page is idle, so the first press only opens the sound
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
  addEventListener('load', () => whenIdle(() => audio.prepare(), { timeout: 2000 }));

  // ------------------------------------------------------------------ the page API (sections.js) and the test API
  window.__deck = {
    play: D.play, stop: D.stop, seek: D.seek, toggle: D.toggle, next: () => D.step(1), prev: () => D.step(-1),
    pitch: setPitch, speed: setSpeed,
    cue: cueTrack,                                             // lift → swing → lower → play that track
    loadRelease: (id) => putOn(C.release(id)),                 // that record on the deck, its first track cued
    state: () => ({
      playing: st.motor, audioReady: audio.ready, record: st.record.id, arm: G.ARM_NAME,
      visualRpm: +(st.omega * 60 / (2 * Math.PI)).toFixed(3), rate: +D.rate().toFixed(4), audioRate: audio.reportedRate(),
      angleDeg: +((st.angle / RAD) % 360).toFixed(2), needleDown: st.down, t: +st.t.toFixed(3), track: view.track,
      armDeg: +(st.phi / RAD).toFixed(3), armRadius: +G.rOf(st.phi).toFixed(1), lever: +st.lever.h.toFixed(3), leverPhase: st.lever.phase,
      pitch: st.pitch, speed: st.speed, vu: st.vu.map((v) => +v.toFixed(3)), rms: [...audio.level].map((v) => +v.toFixed(4)),
      vuDeg: st.vuDeg.map((v) => +v.toFixed(2)), status: [view.now, view.rpm],
      label: { title: label.dataset.title || '', artist: label.dataset.artist || '' },
    }),
    GEO: { ...G, rAt: (t) => st.groove.rAt(t), tAt: (r) => st.groove.tAt(r) },
    BASE_VISUAL_RPM: D.BASE_VISUAL_RPM,
  };
})();
