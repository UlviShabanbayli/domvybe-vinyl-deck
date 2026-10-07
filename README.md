# Vinyl deck — UI component

**[Live demo](https://domvybe.com/components/vinyl-deck/)** · [Step-by-step tutorial](https://domvybe.com/library/vinyl-deck/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-vinyl-deck/releases/latest/download/vinyl-deck-source.zip)

A record label's turntable you play by hand: start the platter, lower the needle, scratch and brake the record, glide between 33 and 45; the sound is read off the spinning record in an AudioWorklet.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step, no libraries.

- `index.html` — the component and its stage
- `style.css` — the look (colours are variables at the top)
- `sections.css` — the sections under the deck: releases, artists, now playing, the nav
- `data.js` — the label's words: releases, artists, sections
- `catalog.js` — the music: eight tracks on Side A, their start and length, the artists and the releases
- `geometry.js` — where everything is on the deck picture: spindle, record, the arm's bearing and length, groove ↔ radius
- `motor.js` — the speed model (start and stop curves, the 33/45 and pitch glides), shared by the picture and the sound
- `audio.js` — loading the side, the AudioContext, the worklet and the meters
- `worklet.js` — the needle on the audio thread: reads the side at the platter's speed, the landing, the lift and the surface
- `deck.js` — the deck's physics without the page: platter, hand, needle, cue lever, meters
- `label.js` — the record's label, printed on a canvas with the playing track
- `app.js` — input → deck → picture: the hands, the buttons, the keys, the clock and the drawing
- `sections.js` — the sections: release cards, artists, now playing, the nav
- `art.js` — the source of the sleeve and artist pictures in art/ (not loaded by the page; the pictures are rendered from it once)
- `img` — the turntable in layers (platter, ring, label, arm, controls), sliced from a concept image generated with Google Gemini
- `art` — the sleeves, records and artist portraits, drawn in code (art.js)
- `audio` — Side A, original music made for this demo (AAC and MP3)

The turntable is sliced into layers from a concept image generated with Google Gemini; the sleeves and the artist
portraits in `art/` are drawn by `art.js`; Side A is original music made for this demo. The label and its artists are
made up. The sound starts on your first press (browsers need a gesture), and the AudioWorklet needs the page served
over http(s), not opened as a file.

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.
