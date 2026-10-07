// catalog.js — the one source of truth for the music: the side (site/audio/side-a.*, 143.0 s,
// music/SIDE_A_validation.json), its eight tracks, the artists who made them and the three releases cut from it.
// The deck reads it directly; data.js builds window.SLOWBURN for the page sections from it. The artists are fictional;
// the music is original. Track ids are their place on the side (0 … 7).

(() => {
  const TRACKS = [
    { id: 0, title: 'Late Light', t0: 0.0, len: 17.4, artist: 'lune' },
    { id: 1, title: 'Paper Moon', t0: 18.4, len: 17.74, artist: 'teo' },
    { id: 2, title: 'Amber Hour', t0: 37.1, len: 14.73, artist: 'saltmarsh' },
    { id: 3, title: 'Slow Burn', t0: 52.8, len: 17.6, artist: 'odile' },
    { id: 4, title: 'Night Ferry', t0: 71.4, len: 17.4, artist: 'lune' },
    { id: 5, title: 'Velvet Static', t0: 89.8, len: 17.74, artist: 'teo' },
    { id: 6, title: 'Low Sun', t0: 108.5, len: 14.73, artist: 'saltmarsh' },
    { id: 7, title: 'Last Call', t0: 124.2, len: 18.8, artist: 'odile' },
  ];

  const ARTISTS = [
    { id: 'lune', name: 'Lune Avery', genre: 'Deep house', bio: 'Night-bus chords and a kick drum that never hurries. Records in a converted laundry.' },
    { id: 'teo', name: 'Teo Marlowe', genre: 'Lo-fi hip-hop', bio: 'Swung drums, a tape machine with a wobble, and a vibraphone bought for the price of its case.' },
    { id: 'saltmarsh', name: 'Saltmarsh Trio', genre: 'Ambient', bio: 'Bells, vibes and a lot of room. Three friends who only meet when the tide is out.' },
    { id: 'odile', name: 'Odile Brask', genre: 'Melodic house', bio: 'Long arpeggios, minor keys and endings that hold the last chord a bar longer than you expect.' },
  ];

  // each release is a run of tracks from the side, with its own sleeve (palette) and label colours (label)
  const RELEASES = [
    { id: 'late-light', cat: 'SB-038', title: 'Late Light', kind: 'EP', format: '12″ · 180 g', price: 26, tracks: [0, 1, 2],
      note: 'Three warm pieces for the hour after work: a slow house groove, a swung beat, a room full of bells.',
      palette: { ground: '#F1E7D2', a: '#E8492C', b: '#141414', c: '#2F8F8A' }, label: ['#F06A3B', '#F4B860', '#2B2622'] },
    { id: 'night-ferry', cat: 'SB-039', title: 'Night Ferry', kind: 'EP', format: '12″ · 180 g', price: 26, tracks: [3, 4, 5],
      note: 'Crossing in the dark: a minor-key house track, the ferry\'s bell and a lo-fi coda with deep tape wow.',
      palette: { ground: '#141414', a: '#2F8F8A', b: '#F1E7D2', c: '#E8492C' }, label: ['#2F8F8A', '#9ED3C6', '#101414'] },
    { id: 'last-call', cat: 'SB-040', title: 'Last Call', kind: 'Single', format: '10″ · 180 g', price: 19, tracks: [6, 7],
      note: 'A double A-side to close the night: ambient vibes with no drums, then an arpeggio that holds on.',
      palette: { ground: '#E8492C', a: '#141414', b: '#F1E7D2', c: '#2F8F8A' }, label: ['#141414', '#E8492C', '#F1E7D2'] },
  ];

  // the whole side, as the deck holds it when the page opens (the concept's label: SB-041, Side A, 8 tracks)
  const SIDE_A = { id: 'side-a', cat: 'SB-041', title: 'Side A', kind: 'Sampler', tracks: TRACKS.map((t) => t.id), label: null };
  const SIDE_SECONDS = 143.0;

  const track = (id) => TRACKS[+id];
  const clock = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  window.Catalog = {
    TRACKS, ARTISTS, RELEASES, SIDE_A, SIDE_SECONDS,
    track,
    artist: (id) => ARTISTS.find((a) => a.id === id),
    artistName: (trackId) => ARTISTS.find((a) => a.id === track(trackId).artist).name,
    release: (id) => (id === SIDE_A.id ? SIDE_A : RELEASES.find((r) => r.id === id)),
    releaseOf: (trackId) => RELEASES.find((r) => r.tracks.includes(+trackId)) || SIDE_A,
    // the stretch of the side a record holds; the whole side runs to the end of the file
    span: (release) => {
      const first = track(release.tracks[0]), last = track(release.tracks.at(-1));
      return { start: first.t0, end: release === SIDE_A ? SIDE_SECONDS : last.t0 + last.len };
    },
    clock, duration: clock,
    money: (v) => `$${v.toFixed(2)}`,
  };
})();
