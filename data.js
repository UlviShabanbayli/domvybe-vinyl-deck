// data.js — the label: window.SLOWBURN = { tracks, artists, releases }. The one source of truth for the page: the deck
// reads it through catalog.js, the sections below it (sections.js) read it directly. Loaded before catalog.js.
//
// The music facts match music/compose.py and music/SIDE_A_validation.json: one side, 143.0 s, eight pieces, each
// starting ~1.0 s after the last one's tail. start/end are seconds on that side. The artists are fictional; the music
// is original. Everything else (sleeve shapes, portrait motifs, years, prices) is for the sections.

(() => {
  // palette shared with the concept's sleeve (bold black / vermilion / teal / cream) plus one warm amber
  const INK = '#141414', VERMILION = '#E8492C', TEAL = '#2F8F8A', CREAM = '#F1E7D2', AMBER = '#E0A23B';

  const tracks = [
    { id: 'a1', n: 1, title: 'Late Light', artistId: 'lune', start: 0.0, end: 17.4 },
    { id: 'a2', n: 2, title: 'Paper Moon', artistId: 'teo', start: 18.4, end: 36.14 },
    { id: 'a3', n: 3, title: 'Amber Hour', artistId: 'saltmarsh', start: 37.1, end: 51.83 },
    { id: 'a4', n: 4, title: 'Slow Burn', artistId: 'odile', start: 52.8, end: 70.4 },
    { id: 'a5', n: 5, title: 'Night Ferry', artistId: 'lune', start: 71.4, end: 88.8 },
    { id: 'a6', n: 6, title: 'Velvet Static', artistId: 'teo', start: 89.8, end: 107.54 },
    { id: 'a7', n: 7, title: 'Low Sun', artistId: 'saltmarsh', start: 108.5, end: 123.23 },
    { id: 'a8', n: 8, title: 'Last Call', artistId: 'odile', start: 124.2, end: 143.0 },
  ].map((t) => ({ ...t, len: +(t.end - t.start).toFixed(2) }));

  // each portrait is a small abstract composition, not a person: `motif` picks the drawing in sections.js
  const artists = [
    { id: 'lune', name: 'Lune Avery', genre: 'Deep house', city: 'Glasgow', since: 2019, colour: VERMILION, ground: INK, motif: 'moon',
      bio: 'Night-bus chords and a kick drum that never hurries. Records in a converted laundry.' },
    { id: 'teo', name: 'Teo Marlowe', genre: 'Lo-fi hip-hop', city: 'Lisbon', since: 2021, colour: TEAL, ground: TEAL, motif: 'reels',
      bio: 'Swung drums, a tape machine with a wobble, and a vibraphone bought for the price of its case.' },
    { id: 'saltmarsh', name: 'Saltmarsh Trio', genre: 'Ambient', city: 'Norfolk coast', since: 2020, colour: AMBER, ground: CREAM, ink: INK, motif: 'tide',
      bio: 'Bells, vibes and a lot of room. Three friends who only meet when the tide is out.' },
    { id: 'odile', name: 'Odile Brask', genre: 'Melodic house', city: 'Copenhagen', since: 2022, colour: INK, ground: VERMILION, ink: INK, motif: 'steps',
      bio: 'Long arpeggios, minor keys and endings that hold the last chord a bar longer than you expect.' },
  ].map((a) => ({ ...a, trackIds: tracks.filter((t) => t.artistId === a.id).map((t) => t.id) }));

  // each release is a run of tracks from the side; sleeve = the palette (ground, a, b, c) and the drawing (`art`)
  const releases = [
    { id: 'late-light', cat: 'SB-038', title: 'Late Light', kind: 'EP', year: 2025, price: 26, trackIds: ['a1', 'a2', 'a3'],
      note: 'Three warm pieces for the hour after work: a slow house groove, a swung beat, a room full of bells.',
      sleeve: { art: 'sunset', size: 12, run: 500, ground: CREAM, a: VERMILION, b: INK, c: TEAL }, labelColours: ['#F06A3B', '#F4B860', '#2B2622'] },
    { id: 'night-ferry', cat: 'SB-039', title: 'Night Ferry', kind: 'EP', year: 2026, price: 26, trackIds: ['a4', 'a5', 'a6'],
      note: 'Crossing in the dark: a minor-key house track, the ferry\'s bell and a lo-fi coda with deep tape wow.',
      sleeve: { art: 'crossing', size: 12, run: 500, ground: INK, a: TEAL, b: CREAM, c: VERMILION }, labelColours: ['#2F8F8A', '#9ED3C6', '#101414'] },
    { id: 'last-call', cat: 'SB-040', title: 'Last Call', kind: 'Single', year: 2026, price: 19, trackIds: ['a7', 'a8'],
      note: 'A double A-side to close the night: ambient vibes with no drums, then an arpeggio that holds on.',
      sleeve: { art: 'closing', size: 10, run: 300, ground: VERMILION, a: INK, b: CREAM, c: TEAL }, labelColours: ['#141414', '#E8492C', '#F1E7D2'] },
  ];

  const byId = (list) => (id) => list.find((x) => x.id === String(id));

  window.SLOWBURN = {
    tracks, artists, releases, sideSeconds: 143.0,
    track: byId(tracks), artist: byId(artists), release: byId(releases),
    releaseOf: (trackId) => releases.find((r) => r.trackIds.includes(String(trackId))),
    shop: { currency: 'USD', shipping: 6, freeFrom: 60 },      // one flat rate, free from a threshold
    colours: { INK, VERMILION, TEAL, CREAM, AMBER },
  };
})();
