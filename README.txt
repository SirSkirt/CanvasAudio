Canvas Audio PWA

Installable requirements (Chrome/Edge/etc):
1) Must be served over https (GitHub Pages is fine) or http://localhost during dev.
2) Must have manifest + service worker (already included).
3) Visit the site URL, then use the browser install prompt (or "Install" in the menu).

Deploy:
- Put these files at your site root (same folder as index.html).
- If you already host index.html + canvasaudio.js, add:
  - manifest.webmanifest
  - sw.js
  - icons/ folder
  - and ensure index.html links the manifest and registers the service worker (this index already does).

Notes:
- This caches only the app shell. User-imported audio files are not cached by the service worker.
