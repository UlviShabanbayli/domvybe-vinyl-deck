// sections.js — everything below the deck, and the nav that reaches it.
//
//   1 art        the sleeves, records and artist portraits: WebP rendered from art.js (tools/render_art.py)
//   2 the deck   a thin bridge to window.__deck: cue a track, put a release on; what is playing comes from the deck's
//                events (deck:record, deck:state, deck:track), its state() is read once at start
//   3 render     Artists, Releases, Store from data.js
//   4 the bag    localStorage-backed, a leather drawer, an order summary (no payment), Done empties it
//   5 the nav    smooth scroll, scrollspy ink, aria-current, hash + deep links, heading focus, the dock, the phone menu
//   6 the letter newsletter field: validates on blur and submit, thanks inline, kept in this browser only
//   7 test API   window.__sections

(() => {
  const S = window.SLOWBURN, C = window.Catalog;           // C: only for the fallback when the deck has no cue()
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const behavior = () => (reduce.matches ? 'instant' : 'smooth');
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => `$${v.toFixed(2)}`;
  const clock = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const live = $('#sb-live');
  const say = (words) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = words; }); };
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: the page still works */ } },
  };
  const ICON = {
    play: '<svg class="i-play" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.2v9.6L10.6 6z"/></svg>',
    bars: '<span class="i-bars" aria-hidden="true"><i></i><i></i><i></i></span>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 11.5h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>',
    x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>',
  };

  // ================================================================================================================
  // 1 · ART — bitmaps rendered from art.js by tools/render_art.py (the grain is cheap to decode, dear to rasterise live)
  // ================================================================================================================
  const ART = {
    sleeve: (id) => `art/sleeve-${id}.webp`,
    disc: (id) => `art/disc-${id}.webp`,
    portrait: (id) => `art/artist-${id}.webp`,
  };
  // the leather's grain (sections.css --sb-grain): light flecks on the dark panels, a small tile made once on a canvas
  (function leatherGrain() {
    const size = 160, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size);
    let s = 29; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < size * size; i++) {
      if (rnd() >= 0.35) continue;
      const o = i * 4; img.data[o] = 255; img.data[o + 1] = 244; img.data[o + 2] = 226; img.data[o + 3] = 255 * (0.015 + 0.06 * rnd());
    }
    g.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--sb-grain', `url(${c.toDataURL('image/png')})`);
  })();

  // ================================================================================================================
  // 2 · THE DECK — feature-detected: cue/loadRelease and deck:* events when the deck has them, seek/putOn otherwise
  // ================================================================================================================
  // the deck names tracks its own way (catalog.js: 0 … 7 or 'a1' …); the two lists are the same side, so a track is
  // matched by its title, and neither file has to follow the other's id scheme
  const deckTracks = () => window.Catalog?.TRACKS || [];
  const toDeck = (id) => { const t = S.track(id), k = t && deckTracks().find((x) => x.title === t.title); return k ? k.id : id; };
  const fromDeck = (id) => {
    if (id === null || id === undefined || id === -1) return null;
    const k = deckTracks().find((x) => String(x.id) === String(id));
    return k ? (S.tracks.find((t) => t.title === k.title)?.id ?? null) : (S.track(id)?.id ?? null);
  };

  // what the deck last told us (its events: deck:record, deck:state {playing, needleDown}, deck:track {trackId});
  // read once from __deck.state() at start, then kept by the events alone
  const told = { record: null, motor: false, down: false, track: null };
  const deck = {
    api: () => window.__deck || null,
    read() {
      const playing = told.motor && told.down;
      return { record: told.record, playing, track: playing ? fromDeck(told.track) : null };
    },
    load(releaseId) {
      const d = this.api(); if (!d) return;
      if (d.loadRelease) d.loadRelease(releaseId); else if (d.putOn) d.putOn(releaseId);
    },
    // a track: on the record that is on if it is there, otherwise its own release goes on first
    cue(trackId) {
      const d = this.api(); if (!d) return;
      if (d.cue) { d.cue(toDeck(trackId)); return; }
      const on = C?.release(this.read().record);
      if (!on || !on.tracks.includes(toDeck(trackId))) this.load(S.releaseOf(trackId).id);
      d.seek(S.track(trackId).start);
      d.play?.();
    },
    play() { this.api()?.play?.(); },
    stop() { this.api()?.stop?.(); },
  };

  let seen = { record: undefined, playing: undefined, track: undefined };
  function syncDeck() {
    const now = deck.read();
    if (now.record === seen.record && now.playing === seen.playing && now.track === seen.track) return;
    seen = now;
    $$('.release').forEach((card) => {
      const on = card.dataset.release === now.record;
      if (card.dataset.onDeck !== String(on)) card.dataset.onDeck = String(on);
      const b = $('[data-put]', card), title = S.release(card.dataset.release).title;
      const [words, label] = !on ? ['Put on the deck', `Put ${title} on the deck`] : now.playing ? ['Stop', `Stop ${title}`] : ['Play it', `Play ${title}`];
      if (b.textContent !== words) { b.textContent = words; b.setAttribute('aria-label', label); }
    });
    $$('.sb [data-track]').forEach((row) => row.classList.toggle('is-playing', row.dataset.track === now.track));
    $$('[data-cue]').forEach((b) => {
      const on = b.dataset.cue === now.track, t = S.track(b.dataset.cue);
      if (b.getAttribute('aria-pressed') !== String(on)) {
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} ${t.title} by ${S.artist(t.artistId).name}`);
      }
    });
  }
  document.addEventListener('deck:record', (e) => { told.record = e.detail.releaseId; syncDeck(); });
  document.addEventListener('deck:state', (e) => { told.motor = !!e.detail.playing; told.down = !!e.detail.needleDown; syncDeck(); });
  document.addEventListener('deck:track', (e) => { told.track = e.detail.trackId; syncDeck(); });
  try {
    const s0 = window.__deck?.state?.();
    if (s0) Object.assign(told, { record: s0.record ?? null, motor: !!s0.playing, down: !!s0.needleDown, track: s0.track ?? null });
  } catch { /* the deck's first events fill it in */ }

  // ================================================================================================================
  // 3 · RENDER
  // ================================================================================================================
  const artistName = (id) => S.artist(id).name;
  const trackSide = (t) => `A${t.n}`;
  const monoInkOf = (a) => (a.ground === S.colours.CREAM ? S.colours.INK : S.colours.CREAM);

  function renderArtists() {
    $('#artist-list').innerHTML = S.artists.map((a) => {
      const mono = a.name.split(' ').map((w) => w[0]).join('');
      const monoInk = monoInkOf(a);
      const rows = a.trackIds.map((id) => {
        const t = S.track(id), r = S.releaseOf(id);
        return `<li data-track="${id}"><button type="button" class="cue" data-cue="${id}" aria-pressed="false" aria-label="Play ${esc(t.title)} by ${esc(a.name)}">${ICON.play}${ICON.bars}</button>`
          + `<span class="tt">${esc(t.title)}<small>${esc(r.title)} ${esc(r.kind)} · ${trackSide(t)}<span class="du-in"> · ${clock(t.len)}</span></small></span><span class="du">${clock(t.len)}</span></li>`;
      }).join('');
      return `<li class="artist" style="--artist-colour:${a.colour === S.colours.INK ? 'var(--sb-ink-900)' : a.colour}">
        <div class="portrait" style="--ground:${a.ground};--mono-ink:${monoInk}"><img src="${ART.portrait(a.id)}" alt="" width="600" height="600" loading="lazy" decoding="async"><span class="mono" aria-hidden="true">${esc(mono)}</span></div>
        <div class="artist-body"><h3>${esc(a.name)}</h3><p class="artist-meta"><b>${esc(a.genre)}</b> · ${esc(a.city)} · since ${a.since}</p><p class="artist-bio">${esc(a.bio)}</p></div>
        <ul class="artist-tracks" aria-label="Tracks by ${esc(a.name)}">${rows}</ul></li>`;
    }).join('');
  }

  function renderReleases() {
    $('#release-list').innerHTML = S.releases.map((r) => {
      const rows = r.trackIds.map((id, i) => {
        const t = S.track(id);
        return `<li data-track="${id}"><span class="no">${i + 1}</span><span><span class="ti">${esc(t.title)}</span><small>${esc(artistName(t.artistId))}</small></span><span class="du">${clock(t.len)}</span></li>`;
      }).join('');
      return `<li class="release" data-release="${r.id}" data-on-deck="false">
        <div class="rel-art"><img class="disc" src="${ART.disc(r.id)}" alt="" width="600" height="600" loading="lazy" decoding="async">
          <img class="sleeve" src="${ART.sleeve(r.id)}" alt="${esc(r.title)} sleeve: abstract shapes in black, vermilion, teal and cream" width="600" height="600" loading="lazy" decoding="async">
          <p class="on-deck"><i class="led-dot" aria-hidden="true"></i>Now on the deck</p></div>
        <p class="rel-meta"><span class="kind">${esc(r.kind)}</span><span>${esc(r.cat)}</span><span>${r.year}</span></p>
        <h3>${esc(r.title)}</h3><p class="rel-note">${esc(r.note)}</p>
        <ol class="rel-tracks" aria-label="${esc(r.title)} tracklist">${rows}</ol>
        <div class="rel-foot"><button type="button" class="btn btn-ink" data-put="${r.id}" aria-label="Put ${esc(r.title)} on the deck">Put on the deck</button>
          <a class="rel-buy" href="#store" data-nav="store">Buy · ${money(r.price)}</a></div></li>`;
    }).join('');
  }

  const productSpec = (r) => `${r.sleeve.size}″ ${r.kind} · 180 g · 33⅓ rpm<br>Run of ${r.sleeve.run} · ${r.cat} · ${r.trackIds.length} tracks`;
  function renderProducts() {
    $('#product-list').innerHTML = S.releases.map((r) => `<li class="product" data-product="${r.id}">
      <div class="product-art"><img src="${ART.sleeve(r.id)}" alt="${esc(r.title)} sleeve" width="600" height="600" loading="lazy" decoding="async"></div>
      <h3>${esc(r.title)}</h3><p class="product-spec">${productSpec(r)}</p>
      <div class="product-row"><span class="price" aria-label="Price ${money(r.price)}">${money(r.price)}</span>
        <button type="button" class="btn btn-metal" data-add="${r.id}" aria-label="Add ${esc(r.title)} to bag">Add to bag</button></div>
      <p class="in-bag" data-in-bag="${r.id}"></p></li>`).join('');
  }

  renderArtists(); renderReleases(); renderProducts();


  document.addEventListener('click', (e) => {
    const cue = e.target.closest('[data-cue]');
    if (cue) {
      const id = cue.dataset.cue;
      if (cue.getAttribute('aria-pressed') === 'true') deck.stop(); else deck.cue(id);
      return;
    }
    const put = e.target.closest('[data-put]');
    if (put) {
      const id = put.dataset.put, now = deck.read();
      if (now.record !== id) { deck.load(id); showDeck(); say(`${S.release(id).title} is on the deck.`); }
      else if (now.playing) deck.stop();
      else deck.play();
    }
  });

  // ================================================================================================================
  // 4 · THE BAG — { releaseId: qty } in localStorage; a drawer with two views: the bag, then the order summary
  // ================================================================================================================
  const BAG_KEY = 'slowburn.bag.v1', MAX_QTY = 9;
  let bag = sanitize(store.get(BAG_KEY, {}));
  function sanitize(raw) {
    const out = {};
    for (const [id, q] of Object.entries(raw || {})) if (S.release(id) && q > 0) out[id] = Math.min(MAX_QTY, Math.floor(q));
    return out;
  }
  const lines = () => S.releases.filter((r) => bag[r.id]).map((r) => ({ release: r, qty: bag[r.id], total: r.price * bag[r.id] }));
  const count = () => Object.values(bag).reduce((n, q) => n + q, 0);
  function totals() {
    const subtotal = lines().reduce((s, l) => s + l.total, 0);
    const shipping = subtotal === 0 || subtotal >= S.shop.freeFrom ? 0 : S.shop.shipping;
    return { subtotal, shipping, total: subtotal + shipping };
  }

  // once per idle moment, however many changes asked for it; drawer.open() draws a pending one first
  let pending = null;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  function soon(fn) { if (pending) return; pending = fn; idle(() => { const f = pending; pending = null; f?.(); }, { timeout: 400 }); }
  function flushSoon() { const f = pending; pending = null; f?.(); }
  function setQty(id, qty) {
    const before = count();
    if (qty <= 0) delete bag[id]; else bag[id] = Math.min(MAX_QTY, qty);
    store.set(BAG_KEY, bag);
    showCounts(count() > before);
    // kept current while hidden, so opening it lays nothing out; while hidden it is redrawn when the page is idle, not in
    // the frame of the click (an Add to bag was a 15–17 ms frame at 4× CPU with it inline)
    if (view === 'bag') { if (drawer.isOpen()) renderBag(); else soon(renderBag); }
  }
  const add = (id) => setQty(id, (bag[id] || 0) + 1);

  function showCounts(bump = false) {
    const n = count();
    $$('[data-bag-count]').forEach((el) => {
      el.textContent = n; el.hidden = n === 0;
      if (bump && !reduce.matches) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
    $$('[data-bag-open]').forEach((b) => b.setAttribute('aria-label', n ? `Bag, ${n} item${n > 1 ? 's' : ''}` : 'Bag, empty'));
    $$('[data-bag-text]').forEach((el) => { el.textContent = n ? `(${n})` : ''; });
    $$('[data-in-bag]').forEach((p) => {
      const q = bag[p.dataset.inBag] || 0;
      const html = q ? `${q} in your bag · <button type="button" data-bag-open>View bag</button>` : '';
      if (p.innerHTML !== html) p.innerHTML = html;
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const r = S.release(b.dataset.add);
    add(r.id);
    b.textContent = 'Added ✓'; b.dataset.added = 'true';
    clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = 'Add to bag'; b.dataset.added = 'false'; }, 1400);
    say(`${r.title} added to your bag. ${count()} item${count() > 1 ? 's' : ''} in the bag.`);
  });

  // a full-screen dialog with a scrim and a panel that slides; Esc, the scrim and the × close it; focus returns.
  // Opening must not lay the page out again: on a page this heavy any layout change made in a click (showModal()'s
  // inert page, overflow:hidden on <html>, a dialog box appearing) costs a 25–40 ms frame (measured). So each sheet is
  // shown once, at start, and stays laid out, hidden (visibility); opening only flips visibility and slides a transform.
  // aria-modal + our own focus trap stand in for showModal(); the page under it cannot scroll because the wheel and
  // touch are stopped at the sheet unless something inside it can scroll.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let current = null;                                         // the sheet that is open, for the focus trap
  document.addEventListener('focusin', (e) => {
    if (current && !current.dialog.contains(e.target)) current.first()?.focus({ preventScroll: true });
  });
  // can something between the target and the sheet scroll? (then the gesture is its own; otherwise it is stopped)
  function scrollsInside(target, dialog) {
    for (let el = target; el && el !== dialog; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return true;
    }
    return false;
  }
  function sheet(dialog, { onOpen, onClose } = {}) {
    const panel = $('.panel', dialog);
    dialog.setAttribute('aria-modal', 'true');
    dialog.show();                                            // laid out once, hidden by CSS until .is-open
    let opener = null, closing = 0;
    const isOpen = () => dialog.classList.contains('is-open');
    const focusables = () => $$(FOCUSABLE, dialog).filter((el) => el.offsetParent);
    const self = { dialog, first: () => focusables()[0] };
    function open(from) {
      if (isOpen()) return;
      opener = from || document.activeElement;
      clearTimeout(closing);
      current = self;
      dialog.classList.add('is-open');
      onOpen?.();
    }
    // restore: false when the close hands focus somewhere else (a nav link moves it to its section's heading)
    let restore = true, then = null;
    function close({ restore: back = true, after = null } = {}) {
      if (!isOpen()) { after?.(); return; }
      restore = back; then = after;
      if (current === self) current = null;
      dialog.classList.remove('is-open');
      onClose?.();
      if (reduce.matches) { finish(); return; }
      const done = (e) => { if (e && (e.target !== panel || e.propertyName !== 'transform')) return; panel.removeEventListener('transitionend', done); clearTimeout(closing); finish(); };
      panel.addEventListener('transitionend', done);
      closing = setTimeout(done, 450);
    }
    function finish() {
      // an opener inside a sheet that has closed since (Bag from the phone menu) hands focus to a visible menu button
      const back = opener?.closest('.sb-dialog:not(.is-open)') ? $$('[data-menu-open]').find((m) => m.offsetParent) : opener;
      if (restore && back && back.isConnected && !current) back.focus({ preventScroll: true });
      const next = then; then = null; next?.();
    }
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    const stop = (e) => { if (isOpen() && !scrollsInside(e.target, dialog)) e.preventDefault(); };
    dialog.addEventListener('wheel', stop, { passive: false });
    dialog.addEventListener('touchmove', stop, { passive: false });
    dialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    return { open, close, isOpen };
  }

  const bagEl = document.createElement('dialog');
  bagEl.className = 'sb-dialog bag'; bagEl.setAttribute('aria-labelledby', 'bag-h');
  bagEl.innerHTML = `<div class="scrim" data-close></div><div class="panel sb-leather">
    <header class="panel-head"><h2 id="bag-h" tabindex="-1">Bag</h2><span class="count" id="bag-n"></span><button type="button" class="x" data-close aria-label="Close bag">${ICON.x}</button></header>
    <div class="panel-body" id="bag-body"></div><footer class="panel-foot" id="bag-foot"></footer></div>`;
  document.body.append(bagEl);
  let view = 'bag', order = null;
  const drawer = sheet(bagEl, { onOpen: () => { flushSoon(); if (view !== 'bag') { view = 'bag'; renderBag(); } $('#bag-h').focus(); } });

  function sumsHTML(t) {
    const ship = t.subtotal === 0 ? '—' : t.shipping === 0 ? 'Free' : money(t.shipping);
    return `<dl class="sums"><div><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd></div>
      <div><dt>Shipping${t.shipping ? ` <small>· free from ${money(S.shop.freeFrom)}</small>` : ''}</dt><dd>${ship}</dd></div>
      <div class="total"><dt>Total</dt><dd>${money(t.total)}</dd></div></dl>`;
  }

  function renderBag() {
    const ls = lines(), n = count(), focusKey = document.activeElement?.dataset?.key;
    $('#bag-h').textContent = 'Bag';
    $('#bag-n').textContent = n ? `${n} item${n > 1 ? 's' : ''}` : '';
    $('#bag-body').innerHTML = ls.length ? `<ul class="bag-items">${ls.map(({ release: r, qty, total }) => `<li class="bag-item">
        <img src="${ART.sleeve(r.id)}" alt="" width="68" height="68">
        <div><h3>${esc(r.title)}</h3><p class="spec">${r.sleeve.size}″ ${esc(r.kind)} · 180 g vinyl</p>
          <div class="qty" role="group" aria-label="Quantity of ${esc(r.title)}">
            <button type="button" data-key="${r.id}:-" data-qty="${r.id}" data-step="-1" aria-label="One less" ${qty <= 1 ? 'disabled' : ''}>−</button>
            <output aria-live="polite">${qty}</output>
            <button type="button" data-key="${r.id}:+" data-qty="${r.id}" data-step="1" aria-label="One more" ${qty >= MAX_QTY ? 'disabled' : ''}>+</button>
          </div><button type="button" class="rm" data-key="${r.id}:x" data-remove="${r.id}">Remove</button></div>
        <span class="line">${money(total)}</span></li>`).join('')}</ul>`
      : `<div class="bag-empty"><p>Your bag is empty.</p><button type="button" class="btn btn-metal" data-key="browse" data-browse>Browse the store</button></div>`;
    $('#bag-foot').innerHTML = `${sumsHTML(totals())}<button type="button" class="btn btn-metal btn-wide" data-key="checkout" data-checkout ${ls.length ? '' : 'disabled'}>Checkout</button>`;
    $('#bag-foot').hidden = !ls.length;
    if (focusKey) (bagEl.querySelector(`[data-key="${focusKey}"]:not(:disabled)`) || $('#bag-h')).focus({ preventScroll: true });
  }

  function checkout() {
    if (!count()) return;
    const d = new Date();
    order = { no: `SB-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`, lines: lines(), totals: totals() };
    view = 'order'; renderOrder();
  }
  function renderOrder() {
    $('#bag-h').textContent = 'Order summary'; $('#bag-n').textContent = '';
    $('#bag-body').innerHTML = `<p class="order-head">Order placed</p><p class="order-no">${order.no}</p>
      <p class="order-copy">Thank you. This is a demo shop: no payment was taken and nothing will ship. On a real order this is where your receipt would be.</p>
      <ul class="order-lines">${order.lines.map(({ release: r, qty, total }) => `<li><span>${esc(r.title)} <small>· ${r.sleeve.size}″ ${esc(r.kind)} × ${qty}</small></span><span>${money(total)}</span></li>`).join('')}</ul>
      ${sumsHTML(order.totals)}<p class="order-addr">Packed by hand in a rigid mailer · ships in 3–5 days.</p>`;
    $('#bag-foot').hidden = false;
    $('#bag-foot').innerHTML = '<button type="button" class="btn btn-metal btn-wide" data-key="done" data-done>Done</button>';
    $('#bag-h').focus();
    say(`Order ${order.no} placed. Total ${money(order.totals.total)}.`);
  }
  function done() {
    bag = {}; store.set(BAG_KEY, bag); order = null; showCounts();
    // the empty bag is drawn once the drawer has slid away, not while it is still on screen
    drawer.close({ after: () => { view = 'bag'; renderBag(); } });
    say('Your bag is empty.');
  }

  bagEl.addEventListener('click', (e) => {
    const q = e.target.closest('[data-qty]');
    if (q) { setQty(q.dataset.qty, (bag[q.dataset.qty] || 0) + +q.dataset.step); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) { const t = S.release(rm.dataset.remove).title; setQty(rm.dataset.remove, 0); say(`${t} removed from your bag.`); return; }
    if (e.target.closest('[data-checkout]')) { checkout(); return; }
    if (e.target.closest('[data-done]')) { done(); return; }
    if (e.target.closest('[data-browse]')) { drawer.close({ restore: false }); go('store'); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bag-open]');
    if (b) { menu.close({ restore: false }); drawer.open(b); }
  });

  // ================================================================================================================
  // 5 · THE NAV
  // ================================================================================================================
  const IDS = ['home', 'artists', 'releases', 'store', 'about'];
  const LABEL = { home: 'Home', artists: 'Artists', releases: 'Releases', store: 'Store', about: 'About' };
  const sections = IDS.slice(1).map((id) => document.getElementById(id));
  const heroNav = $('#nav'), h1 = $('.headline');
  h1.setAttribute('tabindex', '-1');
  const hashFor = (id) => (id === 'home' ? location.pathname + location.search : `#${id}`);
  const idFromHash = (hash) => { const id = (hash || '').replace('#', ''); return id === 'top' ? 'home' : IDS.includes(id) ? id : null; };

  // the dock: the hero's black bar, brought down once the hero nav has scrolled away
  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.innerHTML = `<a class="dock-brand" href="#top" data-nav="home" tabindex="-1">Slow Burn Records</a>
    <nav class="dock-links" aria-label="Sections">${IDS.map((id) => `<a href="${id === 'home' ? '#top' : `#${id}`}" data-nav="${id}">${LABEL[id].toUpperCase()}</a>`).join('')}<i class="nav-ink" aria-hidden="true"></i></nav>
    <button type="button" class="dock-bag" data-bag-open aria-label="Bag, empty" aria-haspopup="dialog">${ICON.bag}<span class="bag-count" data-bag-count hidden>0</span></button>
    <button type="button" class="dock-menu" data-menu-open aria-label="Menu" aria-haspopup="dialog" aria-expanded="false">${ICON.menu}</button>`;
  document.body.prepend(dock);
  dock.inert = true;
  new IntersectionObserver(([e]) => {
    const on = !e.isIntersecting && e.boundingClientRect.top < 0;
    dock.classList.toggle('is-on', on); dock.inert = !on;
  }).observe(heroNav);

  // the phone menu: a leather sheet with the five links and the bag
  const menuEl = document.createElement('dialog');
  menuEl.className = 'sb-dialog menu'; menuEl.setAttribute('aria-label', 'Menu');
  menuEl.innerHTML = `<div class="scrim" data-close></div><div class="panel sb-leather">
    <header class="panel-head"><span>Slow Burn Records</span><button type="button" class="x" data-close aria-label="Close menu">${ICON.x}</button></header>
    <ul class="menu-links">${IDS.map((id) => `<li><a href="${id === 'home' ? '#top' : `#${id}`}" data-nav="${id}">${LABEL[id]}</a></li>`).join('')}</ul>
    <button type="button" class="btn btn-metal sheet-bag" data-bag-open aria-haspopup="dialog">${ICON.bag}<span>Bag</span> <span class="bag-count-text" data-bag-text></span></button></div>`;
  document.body.append(menuEl);
  const menu = sheet(menuEl, { onClose: () => $$('[data-menu-open]').forEach((b) => b.setAttribute('aria-expanded', 'false')), onOpen: () => { mark($('.menu-links', menuEl), shown); $$('[data-menu-open]').forEach((b) => b.setAttribute('aria-expanded', 'true')); ($('.menu-links [aria-current]', menuEl) || $('.menu-links a', menuEl)).focus(); } });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-menu-open]'); if (b) menu.open(b); });

  // the ink: one bar per nav that slides under the current link; link boxes measured once, again on resize
  const inks = [heroNav, $('.dock-links', dock)].map((nav) => ({ nav, ink: $('.nav-ink', nav), boxes: null }));
  function measure(k) {
    k.boxes = {};
    for (const a of $$('a[data-nav]', k.nav)) {
      const dockBar = k.nav !== heroNav, cs = getComputedStyle(a);
      const hx = parseFloat(cs.getPropertyValue('--hit-x')) || 0, hy = parseFloat(cs.getPropertyValue('--hit-y')) || 0;   // touch: the box is bigger than the word
      k.boxes[a.dataset.nav] = { x: a.offsetLeft + hx, y: a.offsetTop + a.offsetHeight - hy - (dockBar ? 9 : k.ink.offsetHeight), w: a.offsetWidth - 2 * hx };
    }
  }
  function moveInk(id) {
    for (const k of inks) {
      if (!k.ink || !k.nav.offsetParent) continue;            // hidden (the phone hides the hero links)
      if (!k.boxes) measure(k);
      const b = k.boxes[id]; if (!b || !b.w) continue;
      k.ink.style.transform = `translate(${b.x}px, ${b.y}px) scaleX(${b.w})`;
      k.ink.classList.add('is-set');
    }
  }
  new ResizeObserver(() => { inks.forEach((k) => { k.boxes = null; }); moveInk(shown); }).observe(document.documentElement);

  // which section is "here": the one crossing a thin band 40 % down the window
  let active = 'home', lock = null, lockTimer = 0, spyReady = false;
  const crossing = new Set();
  let shown = null;                                          // the id the links and inks show
  function setActive(id) {
    active = id;
    if (id === shown) return;
    shown = id;
    // the nav on screen changes now, the other two a frame later: repainting all three link sets in one frame (one of
    // them over the concept's full-size backdrop) costs a 25–40 ms frame (measured); one at a time stays in budget
    // (the phone menu is marked when it opens: a change inside a hidden sheet still costs a paint)
    const onScreen = dock.classList.contains('is-on') ? $('.dock-links', dock) : heroNav;
    const other = onScreen === heroNav ? $('.dock-links', dock) : heroNav;
    mark(onScreen, id);
    moveInk(id);
    requestAnimationFrame(() => { if (shown === id) mark(other, id); });
    if (menu.isOpen()) mark($('.menu-links', menuEl), id);
  }
  function mark(group, id) {
    $$('a[data-nav]', group).forEach((a) => { if (a.dataset.nav === id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
  }
  function spy() {
    if (lock) return;
    let id = IDS.slice(1).find((s) => crossing.has(s));
    if (!id) id = sections[0].getBoundingClientRect().top > innerHeight * 0.4 ? 'home' : 'about';
    if (id === active) return;
    setActive(id);
    if (spyReady) history.replaceState(null, '', hashFor(id));
  }
  const spyIO = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) crossing.add(e.target.id); else crossing.delete(e.target.id); }
    spy();
  }, { rootMargin: '-40% 0px -58% 0px' });
  sections.forEach((s) => spyIO.observe(s));

  // a programmatic scroll holds the ink on its target until the scroll ends
  // ... and, while it runs, a still pointer rests on the shield (sections.css): otherwise Chromium hit-tests and
  // re-hovers whatever slides under the cursor every frame (measured: a 25–33 ms frame after a mouse-clicked link).
  // The dock and the sheets stay above it; a real hand (moving pointer, wheel, touch, key) lifts it at once.
  const shield = document.createElement('div');
  shield.className = 'scroll-shield'; shield.setAttribute('aria-hidden', 'true');
  document.body.append(shield);
  function hold(id) {
    lock = id; clearTimeout(lockTimer);
    shield.classList.add('is-on');
    const hands = ['pointermove', 'wheel', 'touchstart', 'keydown'];
    const release = (e) => {
      if (e?.type === 'pointermove' && !e.movementX && !e.movementY) return;   // Chromium's own after-scroll moves
      removeEventListener('scrollend', release); hands.forEach((t) => removeEventListener(t, release, true));
      clearTimeout(lockTimer); shield.classList.remove('is-on'); lock = null; spy();
    };
    addEventListener('scrollend', release);
    hands.forEach((t) => addEventListener(t, release, { capture: true, passive: true }));
    lockTimer = setTimeout(release, 1600);
  }

  function go(id, { push = true, instant = false } = {}) {
    if (!IDS.includes(id)) return;
    const how = instant ? 'instant' : behavior();
    setActive(id); hold(id);                                 // (marks the menu's links too while it is still open)
    // the heading takes focus; with the menu open the focus trap holds focus in it, so it waits for the sheet to close
    const heading = id === 'home' ? h1 : $('h2', document.getElementById(id));
    const focus = () => heading.focus({ preventScroll: true });
    if (menu.isOpen()) menu.close({ restore: false, after: focus }); else focus();
    if (push) { const url = hashFor(id); if (url === location.hash || (id === 'home' && !location.hash)) history.replaceState(null, '', url); else history.pushState(null, '', url); }
    if (id === 'home') scrollTo({ top: 0, behavior: how });
    else document.getElementById(id).scrollIntoView({ behavior: how, block: 'start' });
  }
  function showDeck() {
    setActive('home'); hold('home'); history.replaceState(null, '', hashFor('home'));
    document.getElementById('deck').scrollIntoView({ behavior: behavior(), block: 'center' });
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(a.dataset.nav);
  });
  addEventListener('popstate', () => go(idFromHash(location.hash) || 'home', { push: false }));

  // a deep link (#store) lands on its section once the fonts have set the page's height
  async function landOnHash() {
    document.fonts?.ready.then(() => { inks.forEach((k) => { k.boxes = null; }); moveInk(shown); });
    const id = idFromHash(location.hash);
    if (id && id !== 'home') {
      try { await document.fonts.ready; } catch { /* fine */ }
      go(id, { push: false, instant: true });
    } else setActive('home');
    requestAnimationFrame(() => { spyReady = true; });
  }

  // ================================================================================================================
  // 6 · THE LETTER — validated on blur and on submit; the thanks replaces the field; kept in this browser only
  // ================================================================================================================
  const LETTER_KEY = 'slowburn.letter.v1';
  const form = $('#letter'), input = $('#letter-email'), err = $('#letter-error'), row = $('#letter-row'), thanks = $('#letter-thanks');
  const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
  function problem(v) {
    v = v.trim();
    if (!v) return 'Enter your email address.';
    if (!EMAIL.test(v)) return 'Enter an email like name@example.com.';
    return '';
  }
  function showProblem(p) { err.textContent = p; input.setAttribute('aria-invalid', p ? 'true' : 'false'); }
  function showThanks(email, focus) {
    row.hidden = true; thanks.hidden = false;
    thanks.innerHTML = `Thanks — you're on the list.<small>We'll write to ${esc(email)} once a month. <button type="button" data-letter-reset>Use another address</button></small>`;
    if (focus) thanks.focus();
  }
  input.addEventListener('blur', () => { if (input.value.trim()) showProblem(problem(input.value)); });
  input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') showProblem(problem(input.value)); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = problem(input.value);
    showProblem(p);
    if (p) { input.focus(); return; }
    const email = input.value.trim();
    store.set(LETTER_KEY, { email, at: new Date().toISOString() });
    showThanks(email, true);
  });
  thanks.addEventListener('click', (e) => {
    if (!e.target.closest('[data-letter-reset]')) return;
    store.set(LETTER_KEY, null);
    thanks.hidden = true; row.hidden = false; input.value = ''; showProblem(''); input.focus();
  });
  const signed = store.get(LETTER_KEY, null);
  if (signed?.email) showThanks(signed.email, false);

  // ================================================================================================================
  // start + 7 · TEST API
  // ================================================================================================================
  showCounts(); renderBag(); syncDeck(); landOnHash();

  window.__sections = {
    go, active: () => active,
    bag: {
      add, set: setQty, remove: (id) => setQty(id, 0), clear: () => { bag = {}; store.set(BAG_KEY, bag); showCounts(); },
      items: () => ({ ...bag }), count, totals, open: () => drawer.open(), close: () => drawer.close(), isOpen: drawer.isOpen,
      checkout: () => { drawer.open(); checkout(); }, done, view: () => view,
    },
    menu: { open: () => menu.open(), close: () => menu.close(), isOpen: menu.isOpen },
    letter: { submit: (email) => { input.value = email; form.requestSubmit(); return { error: err.textContent, thanked: !thanks.hidden }; } },
    deck: { read: () => deck.read(), sync: syncDeck, cue: (id) => deck.cue(id), load: (id) => deck.load(id) },
  };
})();
