// geometry.js — the deck in numbers. Everything is in CONCEPT px (concepts/concept_master.jpg, 2000 × 1244), measured by
// tools/slice.py; the page places the same numbers with --m (one concept px) in style.css.
//
//   the record    spindle S, the playable edge R
//   the arm       bearing P, bearing → stylus length L, the arm picture's own bearing → stylus direction THETA0.
//                 Two arms: the concept's own (tools/arm.py cuts it out of the master; it turns about its yoke bolt) and
//                 ours (the Gemini chrome S-arm on the concept's housing). ?arm=ours picks ours; the default is the concept's.
//   the groove    time on the record ↔ radius: a lead-in spiral, the music, a run-out spiral, the locked groove
//
// A "program" is the piece of the side a record holds: the whole of Side A (0 … 143 s), or one release's tracks. The
// groove spreads whatever the program holds over the whole playable band, as a real pressing would.

(() => {
  const DECK_BOX = { x: 305, y: 337, w: 985, h: 753 };     // the deck block on the concept
  const SPINDLE = { x: 697.5, y: 702 };
  const RECORD_R = 322;
  const ARMS = {
    // rest: the stylus radius where the arm parks. The concept's arm parks just past the vinyl, over the platter's rim —
    // any further out and its headshell would sit on the VU meters
    concept: { P: { x: 1130.8, y: 482.5 }, L: 499.62, THETA0: 124.752, rest: 334, shadow: { low: [5, 8], high: [11, 17] } },   // tools/arm_geo.json
    ours: { P: { x: 1127.95, y: 523.16 }, L: 482.1, THETA0: -177.457, rest: 372, shadow: { low: [-6, 10], high: [-11, 19] } },
  };
  const ARM_NAME = new URLSearchParams(location.search).get('arm') === 'ours' ? 'ours' : 'concept';
  const ARM = ARMS[ARM_NAME];
  const BEARING = ARM.P, ARM_L = ARM.L, THETA0 = ARM.THETA0;    // THETA0 in degrees

  const LEAD = 1.8, RUNOUT = 2.6;                           // seconds of lead-in and run-out spiral
  const R_LEAD = 0.985 * RECORD_R;                          // where the lead-in starts
  const R_OUT = 0.962 * RECORD_R;                           // the first groove of music
  const R_IN = 0.40 * RECORD_R;                             // the last groove of music
  const R_LOCK = 0.36 * RECORD_R;                           // the locked groove

  // ------------------------------------------------------------------ the groove of one program: time ↔ radius
  // t is always seconds on the SIDE (the audio file); the program's own clock starts at `start`.
  function groove(start, end) {
    const len = end - start;
    return {
      start, end, len,
      rAt(t) {
        const u = t - start;
        if (u < -LEAD) return R_LEAD;
        if (u < 0) return R_OUT + (R_LEAD - R_OUT) * (-u / LEAD);
        if (u <= len) return R_OUT - (R_OUT - R_IN) * (u / len);
        if (u <= len + RUNOUT) return R_IN - (R_IN - R_LOCK) * ((u - len) / RUNOUT);
        return R_LOCK;
      },
      tAt(r) {
        let u;
        if (r >= R_LEAD) u = -LEAD;
        else if (r > R_OUT) u = -LEAD * (r - R_OUT) / (R_LEAD - R_OUT);
        else if (r >= R_IN) u = len * (R_OUT - r) / (R_OUT - R_IN);
        else if (r >= R_LOCK) u = len + RUNOUT * (R_IN - r) / (R_IN - R_LOCK);
        else u = len + RUNOUT;
        return start + u;
      },
    };
  }

  // ------------------------------------------------------------------ the arm: radius ↔ angle about its bearing
  const D = Math.hypot(BEARING.x - SPINDLE.x, BEARING.y - SPINDLE.y);
  const DIR_PS = Math.atan2(SPINDLE.y - BEARING.y, SPINDLE.x - BEARING.x);
  const phiAt = (r) => {
    const c = (D * D + ARM_L * ARM_L - r * r) / (2 * D * ARM_L);
    return DIR_PS - Math.acos(Math.min(1, Math.max(-1, c)));
  };
  const stylus = (phi) => ({ x: BEARING.x + ARM_L * Math.cos(phi), y: BEARING.y + ARM_L * Math.sin(phi) });
  const rOf = (phi) => { const s = stylus(phi); return Math.hypot(s.x - SPINDLE.x, s.y - SPINDLE.y); };

  window.DeckGeo = {
    DECK_BOX, S: SPINDLE, R: RECORD_R, P: BEARING, L: ARM_L, THETA0, ARM_NAME, ARM_SHADOW: ARM.shadow,
    LEAD, RUNOUT, R_LEAD, R_OUT, R_IN, R_LOCK,
    groove, phiAt, stylus, rOf,
    PHI_REST: phiAt(ARM.rest),           // parked
    // where the concept shows the arm: over the record, mid-side (the concept arm's own picture is drawn there)
    PHI_CONCEPT: ARM_NAME === 'concept' ? THETA0 * Math.PI / 180 : phiAt(243),
    PHI_MAX: phiAt(R_LOCK * 0.96),       // the furthest a hand can swing it in
  };
})();
