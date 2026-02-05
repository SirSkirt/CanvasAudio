// Canvas Audio - Canvas UI (glass design)
// Visuals + input only. Emits events; does not mutate app state.

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function createDesktopUI(canvas, emit) {
  const ctx = canvas.getContext("2d", { alpha: true });

  let state = null;
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  const hit = {
    play: null,
    stop: null,
    rec: null,
    mixer: null,
    bpmBox: null,
    trackRows: [] // {trackId, rect}
  };

  let isDragOverAudio = false;

  const theme = {
    bgTop: "#020617",
    bgBottom: "#0b1220",
    glassFill: "rgba(255,255,255,0.06)",
    glassStroke: "rgba(255,255,255,0.12)",
    glassShadow: "rgba(0,0,0,0.35)",
    text: "rgba(226,232,240,0.92)",
    textDim: "rgba(148,163,184,0.95)",
    accent: "rgba(56,189,248,0.9)",     // cyan-ish accent
    danger: "rgba(248,113,113,0.95)"    // red-ish for record
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
    // Allow drop
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
      isDragOverAudio = false;
      render();
      return;
    }

    const files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    isDragOverAudio = false;
    render();

    if (files && files.length) {
      // Filter to audio/* where possible
      const arr = Array.from(files).filter(f => (f.type || "").startsWith("audio/") || f.name.match(/\.(wav|mp3|ogg|m4a|flac|aiff)$/i));
      if (arr.length) emit({ type: "audio.importFiles", files: arr });
    }
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
      // Create a temporary overlay input (Tailwind styled).
      const input = document.createElement("input");
      input.type = "number";
      input.min = "40";
      input.max = "300";
      input.value = String(state?.project?.bpm ?? 120);
      input.className = "ca-overlay-input w-24 px-2 py-1 rounded-md bg-slate-900/80 text-slate-100 border border-white/10 shadow-lg";
      input.style.left = Math.round(rect.left + hit.bpmBox.x) + "px";
      input.style.top = Math.round(rect.top + hit.bpmBox.y) + "px";
      input.style.width = Math.round(hit.bpmBox.w) + "px";
      input.style.height = Math.round(hit.bpmBox.h) + "px";
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
        if (ev.key === "Escape") { input.remove(); }
      });
      input.addEventListener("blur", () => {
        if (document.body.contains(input)) commit();
      }, { once: true });

      return;
    }

    // Track selection
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

    // subtle vignette
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
  }

  function glassPanel(x, y, w, h, r=14) {
    // shadow
    ctx.save();
    ctx.shadowColor = theme.glassShadow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;

    roundRectPath(x, y, w, h, r);
    ctx.fillStyle = theme.glassFill;
    ctx.fill();
    ctx.restore();

    // border
    roundRectPath(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = theme.glassStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
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

  function drawSquareButton(r, label, opts = {}) {
    glassPanel(r.x, r.y, r.w, r.h, 12);

    // pressed/active accent
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
    // outer glass
    glassPanel(r.x, r.y, r.w, r.h, 10);

    // inner "sunken" inset
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

  function render() {
    if (!state) return;

    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    drawBackground(w, h);

    // Layout
    const pad = 14;
    const topBarH = 64;

    // Top bar
    glassPanel(pad, pad, w - pad*2, topBarH, 18);

    // Transport squares
    const btn = { s: 44, gap: 10 };
    const bx = pad + 14;
    const by = pad + 10;

    hit.play = { x: bx, y: by, w: btn.s, h: btn.s };
    hit.stop = { x: bx + (btn.s + btn.gap) * 1, y: by, w: btn.s, h: btn.s };
    hit.rec  = { x: bx + (btn.s + btn.gap) * 2, y: by, w: btn.s, h: btn.s };

    const playLabel = state.transport.isPlaying ? "II" : "▶";
    drawSquareButton(hit.play, playLabel, { active: state.transport.isPlaying });
    drawSquareButton(hit.stop, "■");
    const recActive = !!state.transport.isRecording;
    drawSquareButton(hit.rec, "●", { active: recActive, accent: theme.danger });

    // Mixer button (wide)
    const mixW = 88;
    hit.mixer = { x: hit.rec.x + btn.s + 16, y: by, w: mixW, h: btn.s };
    glassPanel(hit.mixer.x, hit.mixer.y, hit.mixer.w, hit.mixer.h, 12);
    ctx.fillStyle = theme.text;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("MIXER", hit.mixer.x + 16, hit.mixer.y + hit.mixer.h/2 + 0.5);

    // BPM label + sunken input box
    const bpmLabelX = hit.mixer.x + hit.mixer.w + 18;
    ctx.fillStyle = theme.textDim;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("BPM", bpmLabelX, pad + topBarH/2 + 0.5);

    hit.bpmBox = { x: bpmLabelX + 38, y: by + 10, w: 76, h: 24 };
    drawSunkenBox(hit.bpmBox, String(state.project.bpm));

    // Status (right)
    ctx.fillStyle = theme.textDim;
    ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    const msg = state.ui.message || "";
    const msgW = ctx.measureText(msg).width;
    ctx.fillText(msg, (pad + (w - pad*2)) - msgW - 16, pad + topBarH/2 + 0.5);

    // Main split: tracks (left) + timeline (right)
    const mainTop = pad + topBarH + 12;
    const mainH = h - mainTop - pad;
    const tracksW = clamp(Math.floor(w * 0.28), 220, 360);
    const gap = 12;

    const tracksRect = { x: pad, y: mainTop, w: tracksW, h: mainH };
    const timelineRect = { x: pad + tracksW + gap, y: mainTop, w: w - pad*2 - tracksW - gap, h: mainH };

    glassPanel(tracksRect.x, tracksRect.y, tracksRect.w, tracksRect.h, 18);
    glassPanel(timelineRect.x, timelineRect.y, timelineRect.w, timelineRect.h, 18);

    // Track list
    hit.trackRows = [];
    ctx.save();
    ctx.beginPath();
    roundRectPath(tracksRect.x, tracksRect.y, tracksRect.w, tracksRect.h, 18);
    ctx.clip();

    const rowH = 64;
    const startY = tracksRect.y + 14;
    for (let i = 0; i < state.tracks.length; i++) {
      const t = state.tracks[i];
      const ry = startY + i * (rowH + 10);
      const rr = { x: tracksRect.x + 12, y: ry, w: tracksRect.w - 24, h: rowH };
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
      ctx.fillText(t.name, rr.x + 14, rr.y + 14);

      ctx.fillStyle = theme.textDim;
      ctx.font = "500 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(t.type.toUpperCase(), rr.x + 14, rr.y + 34);
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

    // inner soft fill
    ctx.fillStyle = "rgba(2,6,23,0.35)";
    ctx.fillRect(gx, gy, gw, gh);

    // bar columns + beats
    const bars = 16;
    const beatsPerBar = 4;
    const totalCols = bars * beatsPerBar;

    // verticals
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

    // horizontals: lanes for first N tracks
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

    // header labels (bars)
    ctx.fillStyle = theme.textDim;
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    for (let b = 0; b < bars; b++) {
      const x = gx + (gw * (b * beatsPerBar) / totalCols);
      ctx.fillText(String(b + 1), x + 6, gy + 6);
    }

    ctx.restore();

    // Title (subtle)
    ctx.fillStyle = "rgba(226,232,240,0.14)";
    ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Canvas Audio", pad + 18, h - pad - 18);
  }

  return { mount, unmount, render, resize, setState };
}
