// worklet.js — the needle. It runs on the audio thread and reads the side at whatever speed the record turns:
// faster, slower, stopped, backwards. The speed comes from one of two places, stepped every SAMPLE:
//   the motor   motor.js's DeckMotor (the page sends START/STOP, 33/45 and the pitch; the glides happen here, per
//               sample, so a fader drag or a speed change bends the pitch with no zipper and no steps)
//   a hand      while a hand is on the record the page sends the hand's speed every frame; it is glided over ~7 ms
// The read position is fractional and only ever advances by the current speed, so it stays continuous through all of
// it; the anti-alias averaging follows the speed sample by sample.
//
// Nothing here allocates while rendering: render() only does arithmetic on preallocated state, and the position
// report reuses one object.
//
// What comes out:
//   the music      read with cubic interpolation at a moving position; when the needle runs fast, a few reads per
//                  sample are averaged so it does not fizz (a cheap low-pass that follows the speed)
//   the surface    hiss and crackle that only exist while the groove moves under the needle, denser when faster
//   the needle     it SEATS: on a drop the soft thump and a few crackles of the lead-in come first, then the music
//                  swells in over SEAT_IN (smoothstep) while a low-pass opens from 2 kHz to full — the stylus settling
//                  into the groove. On a lift the music fades over SEAT_OUT with the low-pass closing, then the
//                  lift click. And the soft click of the locked groove at the end of the side.
//   the program    the record on the deck holds one piece of the side (a release, or all of it): outside it the
//                  groove is silent (lead-in, run-out), with a 5 ms fade at either edge
//
// The same DeckCore is used by an AudioWorkletProcessor, or — where AudioWorklet is missing — by a
// ScriptProcessorNode on the main thread (audio.js loads this file as a plain script then).

const SEAT_IN = 0.32, SEAT_OUT = 0.12;              // seconds
const SEAT_CUTOFF = 2000;                             // Hz, the low-pass at the start of a landing (opens ×10)
const smoothstep = (x) => x * x * (3 - 2 * x);

class DeckCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.L = null; this.R = null; this.len = 0; this.srcRate = 48000;
    this.pos = 0;                                     // where the needle is, in samples of the music
    this.rate = 0;                                    // the record's speed, 1 = 33⅓ RPM, negative = backwards
    this.motor = new globalThis.DeckMotor();
    this.hand = false; this.handRate = 0;             // a hand on the record, and its speed
    this.kHand = 1 - Math.exp(-1 / (sampleRate * 0.007));
    this.dt = 1 / sampleRate;
    this.surface = 1;                                 // hiss, rumble and pops (0 for the offline tests)
    this.down = false; this.seat = 0;                 // the needle in the groove, and how far it has seated (0 … 1)
    this.seatIn = 1 / (SEAT_IN * sampleRate); this.seatOut = 1 / (SEAT_OUT * sampleRate);
    this.lpL = 0; this.lpR = 0;                       // the seating low-pass
    this.liftClick = 0;                               // samples until the lift click
    this.seed = 0x2545F491;
    this.pop = 0; this.popDecay = 0.6; this.popPan = 0;
    this.hiss = 0; this.rumble = 0;
    this.dcL = 0; this.dcR = 0; this.dcxL = 0; this.dcxR = 0;
    this.thump = 0; this.thumpT = 0; this.click = 0;
    this.lockAt = Infinity; this.lastRev = 0;
    this.from = 0; this.to = Infinity;                // the program, in samples of the music
    this.edge = 0.005 * 48000;
    this.reportN = Math.round(sampleRate * 0.05); this.count = 0;
    this.onReport = null;
  }

  noise() { this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5; return ((this.seed >>> 0) / 4294967296) * 2 - 1; }

  message(m) {
    switch (m.type) {
      case 'load': this.L = m.L; this.R = m.R; this.len = m.L.length; this.srcRate = m.sampleRate; this.edge = 0.005 * m.sampleRate; break;
      case 'program': this.from = m.from * this.srcRate; this.to = m.to * this.srcRate; this.lockAt = m.lockAt * this.srcRate; break;
      case 'motor': this.motor.set(m); break;
      case 'hand': this.hand = true; this.handRate = m.v; break;
      case 'release': if (this.hand) { this.hand = false; this.motor.takeOver(this.rate); } break;
      case 'surface': this.surface = m.v; break;
      case 'down':                                    // the needle lands: jump there (it was silent), thump
        this.pos = m.pos * this.srcRate; this.down = true; this.seat = 0; this.liftClick = 0;
        this.thump = Math.max(this.thump, m.vel); this.thumpT = 0; this.click = 0.5 * m.vel;
        this.lastRev = Math.floor((this.pos - this.lockAt) / (1.8 * this.srcRate));
        break;
      case 'up': if (this.down) { this.down = false; this.liftClick = Math.round(SEAT_OUT * this.sr); } break;
    }
  }

  // the music at a fractional position: cubic (Catmull-Rom) between four samples; silence off either end
  read(buf, p) {
    const i = Math.floor(p);
    if (i < 1 || i >= this.len - 2) return 0;
    const f = p - i, a = buf[i - 1], b = buf[i], c = buf[i + 1], d = buf[i + 2];
    return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  }

  render(outL, outR, n) {
    const ratio = this.srcRate / this.sr;
    for (let s = 0; s < n; s++) {
      this.rate = this.hand ? this.rate + (this.handRate - this.rate) * this.kHand : this.motor.step(this.dt);
      this.seat = this.down ? Math.min(1, this.seat + this.seatIn) : Math.max(0, this.seat - this.seatOut);
      if (this.liftClick > 0 && --this.liftClick === 0) this.click = 0.35;
      const step = this.rate * ratio, speed = Math.abs(this.rate);
      let l = 0, r = 0;
      if (this.L && this.seat > 0) {
        // averaging a few reads across the step when the needle runs fast: a low-pass that follows the speed
        const taps = Math.abs(step) > 1.5 ? Math.min(6, Math.ceil(Math.abs(step))) : 1;
        for (let t = 0; t < taps; t++) { const p = this.pos + step * (t / taps); l += this.read(this.L, p); r += this.read(this.R, p); }
        l /= taps; r /= taps;
        // the program's edges: silence outside, a short fade at the boundary
        const p = this.pos;
        const edge = p < this.from + this.edge ? Math.max(0, (p - this.from) / this.edge)
          : p > this.to - this.edge ? Math.max(0, (this.to - p) / this.edge) : 1;
        l *= edge; r *= edge;
        // the surface: hiss and crackle exist only while the groove moves under the needle
        const move = Math.min(1.6, speed);
        this.hiss += (this.noise() - this.hiss) * 0.35;
        this.rumble += (this.noise() * 0.5 - this.rumble) * 0.004;
        let surf = (this.hiss * 0.0045 + this.rumble * 0.02) * move * this.surface;
        if (Math.random() < (7 + 5 * Math.min(speed, 3)) * speed / this.sr) {   // a pop: mostly tiny ticks, now and then a bigger one
          const u = Math.random();
          this.pop = (0.015 + 0.22 * u * u * u * u) * (Math.random() < 0.5 ? -1 : 1);
          this.popDecay = 0.45 + 0.45 * Math.random(); this.popPan = Math.random() * 0.6 - 0.3;
        }
        const pop = this.pop * (0.6 + 0.4 * this.noise()) * this.surface; this.pop *= this.popDecay;
        // the locked groove: past the run-out, the needle goes round the same circle and clicks once a turn
        if (this.pos > this.lockAt) {
          const rev = Math.floor((this.pos - this.lockAt) / (1.8 * this.srcRate));
          if (rev !== this.lastRev) { this.lastRev = rev; this.thump = Math.max(this.thump, 0.28 * Math.min(1, speed)); this.thumpT = 0; this.click = 0.18; }
        }
        // a DC blocker on the music: a slow drag would otherwise push the speaker
        const yl = l - this.dcxL + 0.9985 * this.dcL; this.dcxL = l; this.dcL = yl;
        const yr = r - this.dcxR + 0.9985 * this.dcR; this.dcxR = r; this.dcR = yr;
        // seating: the music swells in behind a low-pass that opens; the surface comes in first
        const music = smoothstep(this.seat), grit = smoothstep(Math.min(1, this.seat * (this.down ? 4 : 1)));
        if (music < 1) {
          const a = 1 - Math.exp(-2 * Math.PI * SEAT_CUTOFF * Math.pow(10, music) / this.sr);
          this.lpL += (yl - this.lpL) * a; this.lpR += (yr - this.lpR) * a;
        } else { this.lpL = yl; this.lpR = yr; }
        l = this.lpL * music + (surf + pop * (1 - this.popPan)) * grit;
        r = this.lpR * music + (surf + pop * (1 + this.popPan)) * grit;
      }
      // the needle's own sounds: the thump of the arm's weight (two low sines), the tick of the stylus
      if (this.thump > 1e-4 || this.click > 1e-4) {
        const t = this.thumpT / this.sr;
        const th = this.thump * (Math.sin(2 * Math.PI * 52 * t) * Math.exp(-t / 0.075) * 0.55 + Math.sin(2 * Math.PI * 104 * t) * Math.exp(-t / 0.03) * 0.25);
        const ck = this.click * this.noise(); this.click *= 0.82;
        l += th + ck; r += th + ck;
        this.thumpT++; if (t > 0.4) this.thump = 0;
      }
      outL[s] = l; outR[s] = r;
      if (this.L) this.pos += step;
      if (++this.count >= this.reportN) { this.count = 0; if (this.onReport) this.onReport(this.pos / this.srcRate, this.rate); }
    }
  }
}

if (typeof registerProcessor === 'function') {
  class DeckProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.core = new DeckCore(sampleRate);
      const report = { pos: 0, rate: 0 };
      this.core.onReport = (pos, rate) => { report.pos = pos; report.rate = rate; this.port.postMessage(report); };
      this.port.onmessage = (e) => this.core.message(e.data);
    }
    process(inputs, outputs) {
      const out = outputs[0];
      this.core.render(out[0], out[1] || out[0], out[0].length);
      return true;
    }
  }
  registerProcessor('deck', DeckProcessor);
} else if (typeof window !== 'undefined') {
  window.DeckCore = DeckCore;
}
