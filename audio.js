// audio.js — the deck's sound. worklet.js's DeckCore reads the side at whatever speed the platter turns; this file gets
// the side ready, builds the graph on the first press and carries the needle's messages.
//
//   DeckAudio.prepare()        at load, while the page is idle: fetch, decode, copy into transferable arrays
//   DeckAudio.start()          on a user gesture: the AudioContext, the worklet, the analysers (idempotent)
//   .motor({ on, speed, pitch, calm })   the motor's goals; the audio thread glides to them per sample (motor.js)
//   .hand(rate) .release()     a hand holds the record at `rate` (sent only when it changes) / lets go
//   .down(t, vel) .up()        the needle lands at t (seconds on the side) / lifts
//   .program(from, to, lockAt) the piece of the side the record on the deck holds
//   .levels()                  → [rmsL, rmsR] of what is playing now (one reused array)
//   .pos()                     → where the needle really is (the audio thread's report, extrapolated), or null
//   .reportedRate()            → the speed the audio thread is actually playing at
//   .ready                     true once sound can play
//
// Why it is built this way — nothing here may stall a frame:
//   - decoding runs off the main thread (OfflineAudioContext at the file's own rate, no user gesture needed), and the
//     copy into the arrays the worklet takes over is done in slices between frames;
//   - the first AudioContext of a page opens the audio device, which blocks the main thread for ~200 ms (measured,
//     Chrome on macOS). A muted media element that loads a few ms of silence opens it ahead of time, off the main
//     thread, so the context created on the first press costs ~2 ms;
//   - per frame, levels() reads into preallocated buffers; nothing is posted unless a hand is on the record.

(() => {
  const FILE_RATE = 48000;                       // site/audio/side-a.* (music/SIDE_A_validation.json)
  const COPY_SLICE = 1 << 19;                    // samples copied per slice (~2 ms on a slow phone)
  const ANALYSER_SIZE = 1024;

  const can = document.createElement('audio');
  const url = can.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? 'audio/side-a.m4a' : 'audio/side-a.mp3';
  const nextSlice = () => new Promise((resolve) => setTimeout(resolve, 0));

  // ------------------------------------------------------------------ before the first press
  async function decodeSide() {
    const bytes = await fetch(url).then((r) => { if (!r.ok) throw new Error(`side-a: ${r.status}`); return r.arrayBuffer(); });
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const side = await new Offline(2, 1, FILE_RATE).decodeAudioData(bytes);
    const L = new Float32Array(side.length), R = new Float32Array(side.length);
    const right = side.numberOfChannels > 1 ? 1 : 0;
    for (let i = 0; i < side.length; i += COPY_SLICE) {
      const n = Math.min(COPY_SLICE, side.length - i);
      side.copyFromChannel(L.subarray(i, i + n), 0, i);
      side.copyFromChannel(R.subarray(i, i + n), right, i);
      await nextSlice();
    }
    return { L, R, sampleRate: side.sampleRate };
  }

  // a muted element loading 10 ms of silence: opens the audio output device off the main thread (see the header)
  function warmOutput() {
    const n = 480, wav = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (at, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, FILE_RATE, true); wav.setUint32(28, FILE_RATE * 2, true);
    wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, n * 2, true);
    const el = new Audio();
    el.muted = true; el.preload = 'auto';
    el.src = URL.createObjectURL(new Blob([wav.buffer], { type: 'audio/wav' }));
    el.load();
  }

  const A = {
    ready: false, ctx: null, node: null, send: null,
    side: null, starting: null, pending: [],
    analysers: [], wave: new Float32Array(ANALYSER_SIZE), level: [0, 0],
    report: { pos: 0, rate: 0, at: 0 }, sentHand: NaN, onReady: null,

    prepare() {
      if (!this.side) {
        this.side = decodeSide();
        this.side.catch(() => {});                // reported by start()
        try { warmOutput(); } catch { /* no media element: the first press just pays for the device */ }
      }
      return this.side;
    },

    start() {
      if (this.starting) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); return this.starting; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(false);
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.starting = this.build().catch((err) => { console.warn('DV41 audio unavailable:', err); return false; });
      return this.starting;
    },

    async build() {
      const ctx = this.ctx;
      const side = await this.prepare();
      const load = { type: 'load', L: side.L, R: side.R, sampleRate: side.sampleRate };
      const onReport = (pos, rate) => { this.report.pos = pos; this.report.rate = rate; this.report.at = performance.now(); };
      if (ctx.audioWorklet && window.AudioWorkletNode) {
        await ctx.audioWorklet.addModule('motor.js');           // shares the audio thread's global scope with worklet.js
        await ctx.audioWorklet.addModule('worklet.js');
        this.node = new AudioWorkletNode(ctx, 'deck', { numberOfInputs: 0, outputChannelCount: [2] });
        this.node.port.onmessage = (e) => onReport(e.data.pos, e.data.rate);
        this.node.port.postMessage(load, [load.L.buffer, load.R.buffer]);
        this.send = (m) => this.node.port.postMessage(m);
      } else {
        // no AudioWorklet: the same DeckCore on the main thread in a ScriptProcessor (motor.js is already on the page)
        await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'worklet.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
        const core = new window.DeckCore(ctx.sampleRate);
        core.onReport = onReport;
        core.message(load);
        this.node = ctx.createScriptProcessor(1024, 0, 2);
        this.node.onaudioprocess = (e) => core.render(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), e.outputBuffer.length);
        this.send = (m) => core.message(m);
      }
      const out = ctx.createGain(); out.gain.value = 0.9;
      this.node.connect(out).connect(ctx.destination);
      const split = ctx.createChannelSplitter(2);
      this.node.connect(split);
      for (let c = 0; c < 2; c++) {
        const an = ctx.createAnalyser(); an.fftSize = ANALYSER_SIZE; an.smoothingTimeConstant = 0;
        split.connect(an, c); this.analysers.push(an);
      }
      if (ctx.state === 'suspended') await ctx.resume();
      this.ready = true;
      if (this.onReady) this.onReady();          // deck.js sends the motor's state first, so both copies start in step
      for (const m of this.pending) this.send(m);
      this.pending.length = 0;
      return true;
    },

    // needle and program messages before the graph exists wait in order; the motor's and the hand's are not queued
    // (onReady sends the motor's whole state, the next frame sends the hand's speed)
    post(m) { if (this.ready) this.send(m); else this.pending.push(m); },
    motor(goals) { if (this.ready) this.send({ type: 'motor', ...goals }); },
    hand(v) {
      if (!this.ready || v === this.sentHand) return;
      this.sentHand = v; this.send({ type: 'hand', v });
    },
    release() { this.sentHand = NaN; this.post({ type: 'release' }); },
    down(t, vel = 0.8) { this.post({ type: 'down', pos: t, vel }); },
    up() { this.post({ type: 'up' }); },
    program(from, to, lockAt) { this.post({ type: 'program', from, to, lockAt }); },

    pos() {
      if (!this.ready || !this.report.at) return null;
      return this.report.pos + this.report.rate * (performance.now() - this.report.at) / 1000;
    },
    reportedRate() { return this.ready && this.report.at ? this.report.rate : null; },
    levels() {
      if (!this.ready) { this.level[0] = this.level[1] = 0; return this.level; }
      for (let c = 0; c < 2; c++) {
        this.analysers[c].getFloatTimeDomainData(this.wave);
        let s = 0;
        for (let i = 0; i < ANALYSER_SIZE; i++) s += this.wave[i] * this.wave[i];
        this.level[c] = Math.sqrt(s / ANALYSER_SIZE);
      }
      return this.level;
    },
  };

  window.DeckAudio = A;
})();
