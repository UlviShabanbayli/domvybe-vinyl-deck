// label.js — the record's centre label, printed with the track that is playing. It is drawn into a canvas INSIDE the
// rotating label layer, so the type turns with the record like a real printed label; it is redrawn only when the
// track (or the record) changes, never per frame, and the new print cross-fades over the old one (two canvases).
//
//   DeckLabel.show({ track, release })   track: a Catalog track (or null: the record's own label), release: the record
//
// The paper is img/label-blank.webp (tools/slice.py: the concept's label with its centre type taken off, the rim line
// and the photographed '180 g' kept). A release with its own labelColours is tinted in them ('color' blend: its hues,
// the paper's light and grain). Type: the label's own face (Helvetica Neue, as tools/slice.py set the original), laid
// out like the original — the title where 'SLOW BURN' stood, the artist under it in caps, the side position where
// 'SIDE A' stood.

(() => {
  const LR = 113;                                  // concept px: the label layer's radius (style.css .label --r)
  const MAX_SIZE = 640, MIN_SIZE = 256;            // canvas px across: the label's device pixels, within these
  const SETTLE_MS = 250;                           // a track must stay lit this long before it is printed (an arm
                                                   // swinging across the record passes several)
  const FACE = '"Helvetica Neue", Helvetica, Inter, Arial, sans-serif';
  const INK = 'rgb(255 255 255 / .93)';

  const el = document.getElementById('label');
  const prints = [...el.querySelectorAll('canvas.label-art')];
  const original = el.querySelector('.label-print');
  const paper = new Image();
  paper.src = 'img/label-blank.webp';
  const paperReady = paper.decode().catch(() => {});

  let front = 0, shown = '', pending = null;
  let size = 0, k = 1;                             // the canvas being printed: px across, px per concept px
  // as many pixels as the label shows on this screen, no more (only the canvas about to be printed is resized: the one
  // on show keeps its print, CSS scales it)
  function fitCanvas(canvas) {
    size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.ceil(el.offsetWidth * devicePixelRatio)));
    k = size / (2 * LR);
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  }

  function text(g, s, x, y, size, { bold = false, track = 0, alpha = 0.93 } = {}) {
    g.font = `${bold ? 700 : 400} ${size * k}px ${FACE}`;
    g.letterSpacing = `${track * k}px`;
    g.fillStyle = alpha === 0.93 ? INK : `rgb(255 255 255 / ${alpha})`;
    g.fillText(s, (x + LR) * k, (y + LR) * k);
  }
  // the largest size (≤ max) at which s fits in width (concept px)
  function fit(g, s, max, width, bold, track) {
    g.font = `${bold ? 700 : 400} ${max * k}px ${FACE}`; g.letterSpacing = `${track * k}px`;
    const w = g.measureText(s).width / k;
    return w > width ? max * width / w : max;
  }

  function paint(canvas, { track, release, position, artist }) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, size, size);
    g.drawImage(paper, 0, 0, size, size);
    if (release && release.label) {                     // a release's own colours, the paper's light kept
      const grad = g.createLinearGradient(size * 0.15, size * 0.1, size * 0.85, size * 0.9);
      release.label.forEach((c, i, all) => grad.addColorStop(i / Math.max(1, all.length - 1), c));
      g.save(); g.globalCompositeOperation = 'color'; g.fillStyle = grad;
      g.beginPath(); g.arc(size / 2, size / 2, (LR - 14) * k, 0, 2 * Math.PI); g.fill(); g.restore();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgb(0 0 0 / .28)'; g.shadowBlur = 1.2 * k; g.shadowOffsetY = 0.3 * k;
    const title = track.title.toUpperCase();
    text(g, title, 0, -50, fit(g, title, 15, 150, true, 0.6), { bold: true, track: 0.6 });
    const who = artist.toUpperCase();
    text(g, who, 0, -36, fit(g, who, 6.4, 120, false, 0.9), { track: 0.9 });
    g.textAlign = 'center';
    text(g, position, -66, -4, 7.5, { bold: true, track: 0.6 });
    text(g, '33⅓ RPM', -66, 7, 6, { track: 0.5 });
    text(g, 'STEREO', 0, 46, 6.5, { bold: true, track: 0.8 });
    text(g, `SLOW BURN RECORDS · ${release && release.title !== 'Side A' ? release.title.toUpperCase() : 'SB-041'}`, 0, 56, 5.3, { track: 0.5 });
    text(g, '© 2026 SLOW BURN', 0, 65, 5.6, { track: 0.5 });
  }

  // printing takes a few ms and a texture upload: it waits until the track has settled, then happens in an idle moment
  // after a frame, never inside one
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 16));
  async function show({ track, release, position, artist }) {
    const key = track ? `${release.id}|${track.id}` : `${release.id}|-`;
    if (key === shown) return;
    shown = key;
    const first = pending === null;
    pending = { track, release, position, artist };
    if (!first) return;                                        // a print is already queued: it will take the latest
    await paperReady;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await new Promise(whenIdle);
    const job = pending; pending = null;
    if (!job.track) {                                          // no track: the record's own label (the concept's print)
      prints.forEach((c) => c.classList.remove('on'));
      original.classList.remove('off');
      return;
    }
    const back = prints[1 - front];
    fitCanvas(back);
    paint(back, job);
    back.classList.add('on'); prints[front].classList.remove('on');
    original.classList.add('off');
    front = 1 - front;
    el.dataset.title = job.track.title; el.dataset.artist = job.artist;      // what the label reads (for the tests)
  }

  window.DeckLabel = { show };
})();
