// motor.js — the platter's speed, as ONE model that runs in two places with the same constants:
//   on the audio thread (worklet.js), stepped every sample — this is the speed the music is played at;
//   on the main thread (deck.js), stepped every frame — this is the speed the platter is drawn at.
// Every update below is the exact solution over its step (or the step-size-independent slew limit), so a 1/48000 s step
// and a 1/120 s step land on the same curve: the picture and the sound cannot drift apart.
//
//   rate = motor × speed × pitch            (1 = 33⅓ rpm)
//   motor  0 → 1 on START along the spin-up curve, 1 → 0 on STOP along the brake curve (a slew-limited approach)
//   speed  glides to 1 (33⅓) or 45/33⅓ like a belt changing pulleys (one-pole, SPEED_TAU)
//   pitch  glides to 1 ± 8 % behind the fader (one-pole, PITCH_TAU): no zipper, no steps
//
// A hand on the record overrides all of it (worklet.js follows the hand's rate); when the hand lets go, `motor` is
// re-derived from the speed the record has, so the motor takes over from there without a jump.

(() => {
  const SPIN_UP = 0.6, BRAKE = 1.4;            // seconds from rest to 45 rpm speed and back
  const MOTOR_K = 9;                           // 1/s: the approach once the slew limit lets go
  const SPEED_TAU = 0.4;                       // s: 33 ↔ 45
  const PITCH_TAU = 0.09;                      // s: the fader
  const RPM_45 = 45 / (100 / 3);
  const SNAP = 1e-5;                           // the motor locks onto its goal this close (too small to hear)

  class DeckMotor {
    constructor() {
      this.on = false; this.calm = false;      // calm: prefers-reduced-motion — every change is instant
      this.motor = 0; this.speed = 1; this.pitch = 1;
      this.speedGoal = 1; this.pitchGoal = 1;
      this.dt = 0; this.kMotor = 0; this.kSpeed = 0; this.kPitch = 0;   // the step's coefficients, cached per dt
    }

    // goals (on, speed, pitch, calm), and optionally `now`: the other copy's current values, to start in step with it
    set({ on, speed, pitch, calm, now }) {
      if (now) { this.motor = now.motor; this.speed = now.speed; this.pitch = now.pitch; }
      if (on !== undefined) this.on = on;
      if (speed !== undefined) this.speedGoal = speed;
      if (pitch !== undefined) this.pitchGoal = pitch;
      if (calm !== undefined) this.calm = calm;
      if (this.calm) { this.motor = this.on ? 1 : 0; this.speed = this.speedGoal; this.pitch = this.pitchGoal; }
    }

    // a hand let go of a record turning at `rate`: the motor carries on from there
    takeOver(rate) {
      const k = this.speed * this.pitch;
      this.motor = k > 0 ? rate / k : 0;
      if (this.calm) this.motor = this.on ? 1 : 0;
    }

    step(dt) {
      if (this.calm) return this.rate();
      if (dt !== this.dt) {                    // the audio thread steps a fixed dt: no exp() per sample
        this.dt = dt;
        this.kMotor = 1 - Math.exp(-dt * MOTOR_K);
        this.kSpeed = 1 - Math.exp(-dt / SPEED_TAU);
        this.kPitch = 1 - Math.exp(-dt / PITCH_TAU);
      }
      const goal = this.on ? 1 : 0, diff = goal - this.motor;
      const slew = (RPM_45 / (this.on ? SPIN_UP : BRAKE)) * dt;
      const dv = Math.abs(diff) < SNAP ? diff : diff * this.kMotor;
      this.motor += Math.max(-slew, Math.min(slew, dv));
      this.speed += (this.speedGoal - this.speed) * this.kSpeed;
      this.pitch += (this.pitchGoal - this.pitch) * this.kPitch;
      return this.rate();
    }

    rate() { return this.motor * this.speed * this.pitch; }
    goalRate() { return (this.on ? 1 : 0) * this.speedGoal * this.pitchGoal; }
    snapshot() { return { on: this.on, speed: this.speedGoal, pitch: this.pitchGoal, calm: this.calm, now: { motor: this.motor, speed: this.speed, pitch: this.pitch } }; }
  }

  DeckMotor.RPM_45 = RPM_45;
  DeckMotor.SPIN_UP = SPIN_UP; DeckMotor.BRAKE = BRAKE; DeckMotor.SPEED_TAU = SPEED_TAU; DeckMotor.PITCH_TAU = PITCH_TAU;
  globalThis.DeckMotor = DeckMotor;
})();
