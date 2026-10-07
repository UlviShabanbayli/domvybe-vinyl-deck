// art.js — the procedural art of the sections, as SVG: three sleeves, their records, four artist portraits. The concept
// sleeve's language: flat bold shapes in black / vermilion / teal / cream, one stippled block, paper grain.
//
// NOT loaded by the page. tools/render_art.py runs it once and saves every picture as WebP in site/art/; the page shows
// those bitmaps. (Live SVG with grain costs raster time every time a picture scrolls in — measured 25–290 ms frames;
// a decoded bitmap costs nothing.) Change a picture here, then re-run: _studio/.venv/bin/python DV41_vinyl/tools/render_art.py

(() => {
  const S = window.SLOWBURN;
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">${body}</svg>`;

  // grain without SVG filters: two small noise tiles made once on a canvas and used as pattern fills. (feTurbulence
  // is painted on the main thread every time an image scrolls in: 30–60 ms frames. A pattern of a bitmap is free.)
  function noiseTile(size, density, rgb, aMin, aMax, seed) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size);
    let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < size * size; i++) {
      if (rnd() >= density) continue;
      const o = i * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255 * (aMin + (aMax - aMin) * rnd());
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  const GRAIN = { speck: noiseTile(128, 0.3, [24, 20, 16], 0.3, 0.85, 7), paper: noiseTile(128, 0.16, [40, 32, 22], 0.05, 0.22, 19) };
  // speckle: dark grains over a shape (the concept's stippled teal block) — use fill="url(#sp)" on a copy of the shape;
  // paper: a light grain over the whole square. `seed` only shifts the tile so no two pictures share the same grain.
  const tile = (id, href, seed) => `<pattern id="${id}" width="128" height="128" patternUnits="userSpaceOnUse" patternTransform="translate(${(seed * 37) % 128} ${(seed * 53) % 128})"><image href="${href}" width="128" height="128"/></pattern>`;
  const speckle = (id, seed) => tile(id, GRAIN.speck, seed) + tile('pp', GRAIN.paper, seed + 3);
  const paper = () => '<rect width="600" height="600" fill="url(#pp)"/>';
  // a horizontal wave across the whole square: crest every `len` px
  const wave = (y, amp, len, x0 = -40) => {
    let d = `M ${x0} ${y} q ${len / 4} ${-amp} ${len / 2} 0`;
    for (let x = x0 + len / 2; x < 640; x += len / 2) d += ` t ${len / 2} 0`;
    return d;
  };

  const SLEEVES = {
    // Late Light: a vermilion sun going down behind stripes, two black strokes, the stippled teal block
    sunset: ({ ground, a, b, c }) => `<defs>${speckle('sp', 3)}</defs>
      <rect width="600" height="600" fill="${ground}"/>
      <g transform="rotate(-7 205 225)"><rect x="70" y="150" width="270" height="150" fill="${c}"/><rect x="70" y="150" width="270" height="150" fill="url(#sp)"/></g>
      <circle cx="250" cy="610" r="290" fill="${a}"/>
      <g stroke="${ground}"><path d="M-10 468H610" stroke-width="9"/><path d="M-10 504H610" stroke-width="14"/><path d="M-10 546H610" stroke-width="20"/></g>
      <g fill="none" stroke="${b}" stroke-linecap="butt"><path d="M330 -40C380 120 470 210 640 240" stroke-width="78"/><path d="M478 -40C505 40 560 92 640 104" stroke-width="38"/></g>
      ${paper()}`,
    // Night Ferry: a cream moon (stippled), a vermilion ferry on teal water at night
    crossing: ({ ground, a, b, c }) => `<defs>${speckle('sp', 7)}</defs>
      <rect width="600" height="600" fill="${ground}"/>
      <circle cx="440" cy="160" r="80" fill="${b}"/><circle cx="440" cy="160" r="80" fill="url(#sp)"/>
      <rect x="300" y="226" width="22" height="64" fill="${c}"/><rect x="176" y="258" width="118" height="42" fill="${b}"/>
      <path d="M110 298H372L336 344H152Z" fill="${c}"/>
      <g fill="none" stroke-linecap="round">${[0, 1, 2, 3, 4, 5].map((i) =>
        `<path d="${wave(346 + i * 46, 22, 150, -40 - (i % 2) * 37)}" stroke="${i % 3 === 2 ? b : a}" stroke-width="${18 + i * 2}" opacity="${1 - i * 0.08}"/>`).join('')}</g>
      ${paper()}`,
    // Last Call: a black record on vermilion, a cream quarter moon, the stippled teal square, a closing black wedge
    closing: ({ ground, a, b, c }) => `<defs>${speckle('sp', 5)}</defs>
      <rect width="600" height="600" fill="${ground}"/>
      <circle cx="0" cy="0" r="190" fill="${b}"/>
      <rect x="392" y="66" width="146" height="146" fill="${c}"/><rect x="392" y="66" width="146" height="146" fill="url(#sp)"/>
      <circle cx="290" cy="360" r="206" fill="${a}"/>
      <g fill="none" stroke="${b}" opacity=".16">${[80, 100, 120, 140, 160, 180, 196].map((r) => `<circle cx="290" cy="360" r="${r}" stroke-width="1.6"/>`).join('')}</g>
      <circle cx="290" cy="360" r="58" fill="${b}"/><circle cx="290" cy="360" r="9" fill="${a}"/>
      <path d="M430 600L600 430V520L520 600Z" fill="${a}"/>
      ${paper()}`,
  };

  // the record that slides out of the sleeve: black vinyl, faint grooves, a sheen, the release's label colours
  function discSVG([l0, l1, l2]) {
    const grooves = [];
    for (let r = 128; r < 292; r += 5.5) grooves.push(`<circle cx="300" cy="300" r="${r.toFixed(1)}"/>`);
    const wedge = (a0, a1, r) => {
      const p = (a) => `${(300 + r * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(300 + r * Math.sin(a * Math.PI / 180)).toFixed(1)}`;
      return `M300 300L${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}Z`;
    };
    return svg(`<defs><radialGradient id="sh" cx="300" cy="300" r="300" gradientUnits="userSpaceOnUse"><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></radialGradient></defs>
      <circle cx="300" cy="300" r="298" fill="#111"/>
      <g fill="none" stroke="#fff" stroke-opacity=".045" stroke-width="1.4">${grooves.join('')}</g>
      <path d="${wedge(-62, -30, 296)}" fill="url(#sh)"/><path d="${wedge(118, 150, 296)}" fill="url(#sh)"/>
      <circle cx="300" cy="300" r="296" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>
      <circle cx="300" cy="300" r="104" fill="${l0}"/><path d="M196 300A104 104 0 0 0 404 300Z" fill="${l1}"/>
      <circle cx="300" cy="300" r="34" fill="${l2}"/><circle cx="300" cy="300" r="7" fill="#EFE6D5"/>`);
  }

  const PORTRAITS = {
    // Lune Avery: a crescent over grooves, one vermilion dot
    moon: (a) => `<defs>${speckle('sp', 21)}</defs><rect width="600" height="600" fill="${a.ground}"/>
      <g fill="none" stroke="${S.colours.CREAM}" stroke-opacity=".09" stroke-width="2">${[120, 150, 180, 210, 240, 270, 300, 330].map((r) => `<circle cx="300" cy="300" r="${r}"/>`).join('')}</g>
      <circle cx="320" cy="250" r="150" fill="${S.colours.CREAM}"/><circle cx="320" cy="250" r="150" fill="url(#sp)"/>
      <circle cx="384" cy="204" r="138" fill="${a.ground}"/><circle cx="472" cy="430" r="34" fill="${a.colour}"/>${paper()}`,
    // Teo Marlowe: two tape reels and the wow of the tape
    reels: (a) => {
      const reel = (cx) => `<circle cx="${cx}" cy="300" r="100" fill="${S.colours.CREAM}"/>${[90, 210, 330].map((d) =>
        `<circle cx="${(cx + 56 * Math.cos(d * Math.PI / 180)).toFixed(1)}" cy="${(300 + 56 * Math.sin(d * Math.PI / 180)).toFixed(1)}" r="25" fill="${a.ground}"/>`).join('')}<circle cx="${cx}" cy="300" r="12" fill="${S.colours.INK}"/>`;
      return `<defs>${speckle('sp', 31)}</defs><rect width="600" height="600" fill="${a.ground}"/>
        <path d="M-10 130C80 86 160 170 250 128S420 86 610 128" fill="none" stroke="${S.colours.INK}" stroke-width="10"/>
        ${reel(180)}${reel(420)}<circle cx="180" cy="300" r="100" fill="url(#sp)"/><circle cx="420" cy="300" r="100" fill="url(#sp)"/>
        <path d="M180 400L300 498L420 400" fill="none" stroke="${S.colours.INK}" stroke-width="8"/><rect x="270" y="490" width="60" height="26" rx="4" fill="${S.colours.INK}"/>${paper()}`;
    },
    // Saltmarsh Trio: an amber sun over the tide, three small bells
    tide: (a) => `<defs>${speckle('sp', 41)}</defs><rect width="600" height="600" fill="${a.ground}"/>
      <circle cx="300" cy="210" r="112" fill="${a.colour}"/><circle cx="300" cy="210" r="112" fill="url(#sp)"/>
      <g fill="${a.ink}">${[440, 480, 520].map((x) => `<circle cx="${x}" cy="96" r="13"/>`).join('')}</g>
      <g fill="none" stroke="${a.ink}" stroke-linecap="round">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="${wave(338 + i * 38, 14, 150, -40 - (i % 2) * 37)}" stroke-width="${5 + i * 2}"/>`).join('')}</g>${paper()}`,
    // Odile Brask: an arpeggio climbing in black steps, the held chord a cream line, a stippled cream disc
    steps: (a) => `<defs>${speckle('sp', 51)}</defs><rect width="600" height="600" fill="${a.ground}"/>
      <circle cx="150" cy="150" r="82" fill="${S.colours.CREAM}"/><circle cx="150" cy="150" r="82" fill="url(#sp)"/>
      <path d="M280 92H560" stroke="${S.colours.CREAM}" stroke-width="6"/>
      <g fill="${a.ink}">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const h = 60 + i * 50; return `<rect x="${64 + i * 62}" y="${600 - h}" width="50" height="${h}"/>`; }).join('')}</g>${paper()}`,
  };


  window.SlowBurnArt = {
    sleeve: (r) => svg(SLEEVES[r.sleeve.art](r.sleeve)),
    disc: (r) => discSVG(r.labelColours),
    portrait: (a) => svg(PORTRAITS[a.motif](a)),
  };
})();
