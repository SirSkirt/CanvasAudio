Canvas Audio (Canvas UI + glass design scaffold)

UI requirements implemented:
- Canvas-rendered "glass" top bar
- Square buttons: Play/Pause, Stop, Record
- Mixer button (stub)
- BPM display with a sunken box; click/tap to type BPM
- Track list panel (selectable tracks)
- Timeline panel with bar/beat grid

Notes:
- BPM typing uses a temporary overlay <input> positioned over the canvas.
  This keeps the UI canvas-based while allowing real typing.
- Recording is scaffold-only (toggle state); no audio capture yet.

Run:
- Serve via a local web server (ES modules):
  - python -m http.server 8080


Update:
- Tracks header added with + button (adds a new track)
- Audio Files panel added (tap to import audio files; lists imported filenames)


Audio update:
- Tone.js metronome click enabled during transport play.
- Audio import decodes files into Tone buffers.
- Tap an imported audio filename to preview (one-shot audition).
- Pizzicato.js is included (not wired yet).


Audio import UI update:
- Audio Files panel supports drag-and-drop (drop audio onto the box).
- Folder button (📁) opens file picker.
