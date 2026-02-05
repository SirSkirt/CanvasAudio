// Canvas Audio - Canvas UI (glass design)
// Visuals + input only. Emits events; does not mutate app state.

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function createDesktopUI(canvas, emit) {
  const ctx = canvas.getContext("2d", { alpha: true });

  let state = null;
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let isDragOverAudio = false;

  const hit = {
    play: null,
    stop: null,
    rec: null,
    mixer: null,
    bpmBox: null,

    tracksAdd: null,
    trackRows: [],

    audioFolderBtn: null,
    audioImport: null,
    audioItems: []
  };

  const theme = {
    bgTop: "#020617",
    bgBottom: "#0b1220",
    glassFill: "rgba(255,255,255,0.06)",
    glassStroke: "rgba(255,255,255,0.12)",
    glassShadow: "rgba(0,0,0,0.35)",
    text: "rgba(226,232,240,0.92)",
    textDim: "rgba(148,163,184,0.95)",
    accent: "rgba(56,189,248,0.9)",
    danger: "rgba(248,113,113,0.95)"
  };

  function setState(next) { state = next; }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function mount() {
    resize();
    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });

    // Drag/drop (desktop). Browsers require dragover preventDefault to allow dropping.
    canvas.addEventListener("dragover", onDragOver, { passive: false });
    canvas.addEventListener("dragleave", onDragLeave, { passive: false });
    canvas.addEventListener("drop", onDrop, { passive: false });
  }

  function unmount() {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("dragover", onDragOver);
    canvas.removeEventListener("dragleave", onDragLeave);
    canvas.removeEventListener("drop", onDrop);
  }

  function rectContains(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function onDragOver(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const over = rectContains(hit.audioImport, x, y);
    if (over !== isDragOverAudio) {
      isDragOverAudio = over;
      render();
    }
  }

  function onDragLeave(e) {
    e.preventDefault();
    if (isDragOverAudio) {
      isDragOverAudio = false;
      render();
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!rectContains(hit.audioImport, x, y)) {
      if (isDragOverAudio) {
        isDragOverAudio = false;
        render();
      }
      return;
    }

    const files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    isDragOverAudio = false;
    render();

    if (files && files.length) {
      const arr = Array.from(files).filter(f =>
        (f.type || "").startsWith("audio/") || f.name.match(/\.(wav|mp3|ogg|m4a|flac|aiff)$/i)
      );
      if (arr.length) emit({ type: "audio.importFiles", files: arr });
    }
  }

  function openBpmEditor(screenRect) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "40";
    input.max = "300";
    input.value = String(state?.project?.bpm ?? 120);
    input.className = "ca-overlay-input w-24 px-2 py-1 rounded-md bg-slate-900/80 text-slate-100 border border-white/10 shadow-lg";
    input.style.left = Math.round(screenRect.left) + "px";
    input.style.top = Math.round(screenRect.top) + "px";
    input.style.width = Math.round(screenRect.width) + "px";
    input.style.height = Math.round(screenRect.height) + "px";
    document.body.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const v = clamp(Number(input.value || 120), 40, 300);
      input.remove();
      emit({ type: "project.setBpm", bpm: v });
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") input.remove();
    });
    input.addEventListener("blur", () => {
      if (document.body.contains(input)) commit();
    }, { once: true });
  }

  function openAudioFilePicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.multiple = true;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const files = input.files;
      input.remove();
      if (files && files.length) emit({ type: "audio.importFiles", files });
    }, { once: true });

    input.click();
  }

  function onPointerDown(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);

    if (rectContains(hit.play, x, y)) return emit({ type: "transport.togglePlay" });
    if (rectContains(hit.stop, x, y)) return emit({ type: "transport.stop" });
    if (rectContains(hit.rec, x, y)) return emit({ type: "transport.toggleRecord" });
    if (rectContains(hit.mixer, x, y)) return emit({ type: "ui.openMixer" });

    if (rectContains(hit.bpmBox, x, y)) {
      openBpmEditor({
        left: rect.left + hit.bpmBox.x,
        top: rect.top + hit.bpmBox.y,
        width: hit.bpmBox.w,
        height: hit.bpmBox.h
      });
      return;
    }

    if (rectContains(hit.tracksAdd, x, y)) return emit({ type: "tracks.add" });

    if (rectContains(hit.audioFolderBtn, x, y)) {
      openAudioFilePicker();
      return;
    }

    if (rectContains(hit.audioImport, x, y)) {
      openAudioFilePicker();
      return;
    }

    for (const it of hit.audioItems) {
      if (rectContains(it.rect, x, y)) {
        emit({ type: "audio.preview", assetId: it.assetId });
        return;
      }
    }

    for (const row of hit.trackRows) {
      if (rectContains(row.rect, x, y)) {
        emit({ type: "ui.selectTrack", trackId: row.trackId });
        return;
      }
    }
  }

  function drawBackground(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.bgTop);
    g.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function glassPanel(x, y, w, h, r=14) {
    ctx.save();
    ctx.shadowColor = theme.glassShadow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    roundRectPath(x, y, w, h, r);
    ctx.fillStyle = theme.glassFill;
    ctx.fill();
    ctx.restore();

    roundRectPath(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = theme.glassStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawSquareButton(r, label, opts = {}) {
    glassPanel(r.x, r.y, r.w, r.h, 12);
    if (opts.active) {
      roundRectPath(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10);
      ctx.strokeStyle = opts.accent || theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = theme.text;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(label, r.x + r.w/2, r.y + r.h/2 + 0.5);
    ctx.textAlign = "left";
  }

  function drawSunkenBox(r, valueText) {
    glassPanel(r.x, r.y, r.w, r.h, 10);
    ctx.save();
    roundRectPath(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 8);
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = theme.text;
    ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(valueText, r.x + 10, r.y + r.h/2 + 0.5);
  }

  function drawFolderIcon(cx, cy, s) {
    // simple folder glyph (no emoji)
    const w = s, h = s * 0.74;
    const x = cx - w/2, y = cy - h/2;

    ctx.save();
    ctx.strokeStyle = "rgba(226,232,240,0.85)";
    ctx.lineWidth = 1.6;

    // tab
    roundRectPath(x, y + 2, w * 0.46, h * 0.35, 4);
    ctx.stroke();

    // body
    roundRectPath(x, y + h * 0.22, w, h * 0.78, 5);
    ctx.stroke();

    ctx.restore();
  }

  function render() {
    if (!state) return;

    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    drawBackground(w, h);

    const pad = 14;
    const topBarH = 64;

    // Top bar
    glassPanel(pad, pad, w - pad*2, topBarH, 18);

    // Transport
    const btn = { s: 44, gap: 10 };
    const bx = pad + 14;
    const by = pad + 10;

    hit.play = { x: bx, y: by, w: btn.s, h: btn.s };
    hit.stop = { x: bx + (btn.s + btn.gap) * 1, y: by, w: btn.s, h: btn.s };
    hit.rec  = { x: bx + (btn.s + btn.gap) * 2, y: by, w: btn.s, h: btn.s };

    const playLabel = state.transport.isPlaying ? "II" : "▶";
    drawSquareButton(hit.play, playLabel, { active: state.transport.isPlaying });
    drawSquareButton(hit.stop, "■");
    drawSquareButton(hit.rec, "●", { active: !!state.transport.isRecording, accent: theme.danger });

    // Mixer
    const mixW = 88;
    hit.mixer = { x: hit.rec.x + btn.s + 16, y: by, w: mixW, h: btn.s };
    glassPanel(hit.mixer.x, hit.mixer.y, hit.mixer.w, hit.mixer.h, 12);
    ctx.fillStyle = theme.text;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("MIXER", hit.mixer.x + 16, hit.mixer.y + hit.mixer.h/2 + 0.5);

    // BPM
    const bpmLabelX = hit.mixer.x + hit.mixer.w + 18;
    ctx.fillStyle = theme.textDim;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("BPM", bpmLabelX, pad + topBarH/2 + 0.5);

    hit.bpmBox = { x: bpmLabelX + 38, y: by + 10, w: 76, h: 24 };
    drawSunkenBox(hit.bpmBox, String(state.project.bpm));

    // Status right
    ctx.fillStyle = theme.textDim;
    ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    const msg = state.ui.message || "";
    const msgW = ctx.measureText(msg).width;
    ctx.fillText(msg, (pad + (w - pad*2)) - msgW - 16, pad + topBarH/2 + 0.5);

    // Main split
    const mainTop = pad + topBarH + 12;
    const mainH = h - mainTop - pad;
    const tracksW = clamp(Math.floor(w * 0.28), 240, 380);
    const gap = 12;

    const tracksRect = { x: pad, y: mainTop, w: tracksW, h: mainH };
    const timelineRect = { x: pad + tracksW + gap, y: mainTop, w: w - pad*2 - tracksW - gap, h: mainH };

    glassPanel(tracksRect.x, tracksRect.y, tracksRect.w, tracksRect.h, 18);
    glassPanel(timelineRect.x, timelineRect.y, timelineRect.w, timelineRect.h, 18);

    // Tracks panel internals
    const innerPad = 12;
    const innerX = tracksRect.x + innerPad;
    const innerY = tracksRect.y + innerPad;
    const innerW = tracksRect.w - innerPad*2;
    const innerH = tracksRect.h - innerPad*2;

    // TRACKS header + plus
    const headerH = 36;
    ctx.fillStyle = theme.textDim;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("TRACKS", innerX + 2, innerY + headerH/2 + 0.5);

    hit.tracksAdd = { x: innerX + innerW - 34, y: innerY + 6, w: 28, h: 24 };
    glassPanel(hit.tracksAdd.x, hit.tracksAdd.y, hit.tracksAdd.w, hit.tracksAdd.h, 10);
    ctx.fillStyle = theme.text;
    ctx.font = "800 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+", hit.tracksAdd.x + hit.tracksAdd.w/2, hit.tracksAdd.y + hit.tracksAdd.h/2 + 0.5);
    ctx.textAlign = "left";

    // Compute areas: track list then audio files box at bottom
    const listTop = innerY + headerH + 6;
    const audioPanelH = clamp(Math.floor(innerH * 0.30), 170, 260);
    const listH = innerH - (headerH + 6) - audioPanelH - 18;

    // Clip to tracks panel
    ctx.save();
    ctx.beginPath();
    roundRectPath(tracksRect.x, tracksRect.y, tracksRect.w, tracksRect.h, 18);
    ctx.clip();

    // Track rows
    hit.trackRows = [];
    const rowH = 58;
    const rowGap = 10;

    for (let i = 0; i < state.tracks.length; i++) {
      const t = state.tracks[i];
      const ry = listTop + i * (rowH + rowGap);
      if (ry > listTop + listH - rowH) break;

      const rr = { x: innerX, y: ry, w: innerW, h: rowH };
      hit.trackRows.push({ trackId: t.id, rect: rr });

      const selected = state.ui.selectedTrackId === t.id;

      roundRectPath(rr.x, rr.y, rr.w, rr.h, 14);
      ctx.fillStyle = selected ? "rgba(56,189,248,0.10)" : "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = selected ? theme.accent : "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = theme.text;
      ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(t.name, rr.x + 14, rr.y + 12);

      ctx.fillStyle = theme.textDim;
      ctx.font = "500 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(t.type.toUpperCase(), rr.x + 14, rr.y + 30);
    }

    // AUDIO FILES header + folder button + drop box
    const audioY = tracksRect.y + tracksRect.h - innerPad - audioPanelH;
    const audioRect = { x: innerX, y: audioY, w: innerW, h: audioPanelH };

    ctx.fillStyle = theme.textDim;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("AUDIO FILES", audioRect.x + 2, audioRect.y - 10);

    hit.audioFolderBtn = { x: audioRect.x + audioRect.w - 30, y: audioRect.y - 22, w: 28, h: 18 };
    glassPanel(hit.audioFolderBtn.x, hit.audioFolderBtn.y, hit.audioFolderBtn.w, hit.audioFolderBtn.h, 8);
    drawFolderIcon(hit.audioFolderBtn.x + hit.audioFolderBtn.w/2, hit.audioFolderBtn.y + hit.audioFolderBtn.h/2, 14);

    hit.audioImport = { x: audioRect.x, y: audioRect.y, w: audioRect.w, h: audioRect.h };
    roundRectPath(hit.audioImport.x, hit.audioImport.y, hit.audioImport.w, hit.audioImport.h, 16);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isDragOverAudio) {
      roundRectPath(hit.audioImport.x + 1, hit.audioImport.y + 1, hit.audioImport.w - 2, hit.audioImport.h - 2, 15);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = theme.textDim;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("Tap, folder, or drop audio here", audioRect.x + 14, audioRect.y + 12);

    // Audio list (click to preview)
    const list = (state.assets && state.assets.audio) ? state.assets.audio : [];
    hit.audioItems = [];
    ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    const maxRows = Math.floor((audioRect.h - 44) / 18);
    for (let i = 0; i < Math.min(list.length, maxRows); i++) {
      const a = list[i];
      const y = audioRect.y + 38 + i * 18;
      const name = a.name.length > 24 ? (a.name.slice(0, 21) + "…") : a.name;

      const r = { x: audioRect.x + 10, y: y - 3, w: audioRect.w - 20, h: 18 };
      hit.audioItems.push({ assetId: a.id, rect: r });

      roundRectPath(r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();

      ctx.fillStyle = "rgba(226,232,240,0.88)";
      ctx.fillText(name, audioRect.x + 14, y);

      if (typeof a.durationSec === "number") {
        const sec = Math.max(0, a.durationSec);
        const mm = String(Math.floor(sec / 60));
        const ss = String(Math.floor(sec % 60)).padStart(2, "0");
        const dur = `${mm}:${ss}`;
        const tw = ctx.measureText(dur).width;
        ctx.fillStyle = "rgba(148,163,184,0.95)";
        ctx.fillText(dur, audioRect.x + audioRect.w - 14 - tw, y);
      }
    }
    if (list.length > maxRows) {
      ctx.fillStyle = theme.textDim;
      ctx.fillText(`+${list.length - maxRows} more`, audioRect.x + 14, audioRect.y + 38 + maxRows * 18);
    }

    ctx.restore();

    // Timeline grid
    ctx.save();
    ctx.beginPath();
    roundRectPath(timelineRect.x, timelineRect.y, timelineRect.w, timelineRect.h, 18);
    ctx.clip();

    const gx = timelineRect.x + 14;
    const gy = timelineRect.y + 14;
    const gw = timelineRect.w - 28;
    const gh = timelineRect.h - 28;

    ctx.fillStyle = "rgba(2,6,23,0.35)";
    ctx.fillRect(gx, gy, gw, gh);

    const bars = 16;
    const beatsPerBar = 4;
    const totalCols = bars * beatsPerBar;

    for (let c = 0; c <= totalCols; c++) {
      const x = gx + (gw * c / totalCols);
      const isBar = (c % beatsPerBar) === 0;
      ctx.strokeStyle = isBar ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, gy);
      ctx.lineTo(x + 0.5, gy + gh);
      ctx.stroke();
    }

    const lanes = clamp(state.tracks.length, 3, 10);
    for (let r = 0; r <= lanes; r++) {
      const y = gy + (gh * r / lanes);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, y + 0.5);
      ctx.lineTo(gx + gw, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = theme.textDim;
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    for (let b = 0; b < bars; b++) {
      const x = gx + (gw * (b * beatsPerBar) / totalCols);
      ctx.fillText(String(b + 1), x + 6, gy + 6);
    }

    ctx.restore();

    // Title subtle
    ctx.fillStyle = "rgba(226,232,240,0.14)";
    ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Canvas Audio", pad + 18, h - pad - 18);
  }

  return { mount, unmount, render, resize, setState };
}
