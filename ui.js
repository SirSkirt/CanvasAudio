// Canvas Audio - Canvas UI (glass design)
// Visuals + input only. Emits events; does not mutate app state.

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function createDesktopUI(canvas, emit) {
  const ctx = canvas.getContext("2d", { alpha: true });

  let state = null;
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // Drag state (audio asset -> timeline)
  let drag = null; // { kind:"asset", assetId, name, x, y, startX, startY, moved }

  // Hit regions (set each render)
  const hit = {
    play: null,
    stop: null,
    rec: null,
    mixer: null,
    bpmBox: null,

    tracksAdd: null,
    trackRows: [],

    audioImport: null,
    audioFolderBtn: null,
    audioItems: [], // {assetId, rect}

    timeline: null, // {x,y,w,h, gx,gy,gw,gh, lanes}
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
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp, { passive: false });

    // Drag/drop from OS (desktop)
    canvas.addEventListener("dragover", onDragOver, { passive: false });
    canvas.addEventListener("dragleave", onDragLeave, { passive: false });
    canvas.addEventListener("drop", onDrop, { passive: false });
  }

  function unmount() {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("dragover", onDragOver);
    canvas.removeEventListener("dragleave", onDragLeave);
    canvas.removeEventListener("drop", onDrop);
  }

  function rectContains(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
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

  function drawBackground(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.bgTop);
    g.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
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

  // OS drag/drop (desktop)
  let isDragOverAudio = false;
  function onDragOver(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const over = rectContains(hit.audioImport, x, y);
    if (over !== isDragOverAudio) { isDragOverAudio = over; render(); }
  }
  function onDragLeave(e) {
    e.preventDefault();
    if (isDragOverAudio) { isDragOverAudio = false; render(); }
  }
  function onDrop(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    const canDrop = rectContains(hit.audioImport, x, y);

    isDragOverAudio = false;
    render();

    if (!canDrop || !files || !files.length) return;
    const arr = Array.from(files).filter(f => (f.type || "").startsWith("audio/") || f.name.match(/\.(wav|mp3|ogg|m4a|flac|aiff)$/i));
    if (arr.length) emit({ type: "audio.importFiles", files: arr });
  }

  function onPointerDown(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);

    // Start a drag if pressing on an audio item; do not preview yet.
    for (const it of hit.audioItems) {
      if (rectContains(it.rect, x, y)) {
        const asset = (state.assets?.audio || []).find(a => a.id === it.assetId);
        drag = { kind: "asset", assetId: it.assetId, name: asset?.name || "Audio", x, y, startX: x, startY: y, moved: false };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    if (rectContains(hit.play, x, y)) return emit({ type: "transport.togglePlay" });
    if (rectContains(hit.stop, x, y)) return emit({ type: "transport.stop" });
    if (rectContains(hit.rec, x, y)) return emit({ type: "transport.toggleRecord" });
    if (rectContains(hit.mixer, x, y)) return emit({ type: "ui.openMixer" });

    if (rectContains(hit.bpmBox, x, y)) {
      const screenRect = {
        left: rect.left + hit.bpmBox.x,
        top: rect.top + hit.bpmBox.y,
        width: hit.bpmBox.w,
        height: hit.bpmBox.h
      };
      openBpmEditor(screenRect);
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

    for (const row of hit.trackRows) {
      if (rectContains(row.rect, x, y)) {
        emit({ type: "ui.selectTrack", trackId: row.trackId });
        return;
      }
    }
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    drag.x = (e.clientX - rect.left);
    drag.y = (e.clientY - rect.top);

    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY;
    if (!drag.moved && (Math.abs(dx) + Math.abs(dy) > 6)) drag.moved = true;

    render();
  }

  function onPointerUp(e) {
    if (!drag) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);

    const wasMoved = drag.moved;

    // If it was a tap (no drag), preview the audio
    if (!wasMoved) {
      emit({ type: "audio.preview", assetId: drag.assetId });
      drag = null;
      render();
      return;
    }

    // Drop onto timeline -> create a clip
    if (hit.timeline && rectContains(hit.timeline, x, y)) {
      const t = hit.timeline;
      // Convert x to beats within visible range (16 bars * 4 beats = 64 beats)
      const relX = clamp(x - t.gx, 0, t.gw);
      const beats = (relX / t.gw) * t.totalBeats;

      // Convert y to lane
      const relY = clamp(y - t.gy, 0, t.gh);
      const laneIdx = clamp(Math.floor((relY / t.gh) * t.lanes), 0, t.lanes - 1);
      const trackId = (state.tracks[laneIdx] || state.tracks[0]).id;

      emit({ type: "timeline.dropAssetAsClip", assetId: drag.assetId, trackId, startBeats: beats });
    }

    drag = null;
    render();
  }

  function renderDragGhost() {
    if (!drag || drag.kind !== "asset") return;

    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    const label = drag.name.length > 22 ? (drag.name.slice(0, 19) + "…") : drag.name;

    const boxW = clamp(ctx.measureText(label).width + 40, 160, 260);
    const boxH = 34;
    const x = clamp(drag.x + 12, 10, w - boxW - 10);
    const y = clamp(drag.y - 10, 10, h - boxH - 10);

    ctx.save();
    ctx.globalAlpha = 0.95;
    roundRectPath(x, y, boxW, boxH, 12);
    ctx.fillStyle = "rgba(2,6,23,0.75)";
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = theme.text;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("CLIP", x + 12, y + boxH/2 + 0.5);

    ctx.fillStyle = theme.textDim;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(label, x + 48, y + boxH/2 + 0.5);
    ctx.restore();
  }

  function renderClips() {
    if (!hit.timeline) return;
    const t = hit.timeline;

    const tracks = state.tracks || [];
    for (let lane = 0; lane < t.lanes; lane++) {
      const track = tracks[lane];
      if (!track) continue;
      const clips = track.clips || [];

      for (const c of clips) {
        const start = c.startBeats || 0;
        const dur = c.durationBeats || 1;

        const x = t.gx + (start / t.totalBeats) * t.gw;
        const w = Math.max(18, (dur / t.totalBeats) * t.gw);
        const laneY0 = t.gy + (t.gh * lane / t.lanes);
        const laneH = t.gh / t.lanes;
        const y = laneY0 + 8;
        const h = laneH - 16;

        roundRectPath(x, y, w, h, 10);
        ctx.fillStyle = "rgba(56,189,248,0.16)";
        ctx.fill();
        ctx.strokeStyle = "rgba(56,189,248,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Name
        const name = (c.name || "Clip");
        const label = name.length > 18 ? (name.slice(0, 15) + "…") : name;
        ctx.fillStyle = theme.text;
        ctx.font = "700 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(label, x + 10, y + 8);
      }
    }
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

    // Transport buttons
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

    // Status (right)
    ctx.fillStyle = theme.textDim;
    ctx.font = "500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    const msg = state.ui.message || "";
    const msgW = ctx.measureText(msg).width;
    ctx.fillText(msg, (pad + (w - pad*2)) - msgW - 16, pad + topBarH/2 + 0.5);

    // Main split
    const mainTop = pad + topBarH + 12;
    const mainH = h - mainTop - pad;
    const tracksW = clamp(Math.floor(w * 0.28), 260, 420);
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

    // Allocate fixed Audio Files height so it's always visible
    const audioPanelH = clamp(220, 200, Math.floor(innerH * 0.45));
    const listTop = innerY + headerH + 6;
    const listH = innerH - (headerH + 6) - audioPanelH - 18;

    // Clip to tracks panel
    ctx.save();
    ctx.beginPath();
    roundRectPath(tracksRect.x, tracksRect.y, tracksRect.w, tracksRect.h, 18);
    ctx.clip();

    // Track list
    hit.trackRows = [];
    const rowH = 58;
    const rowGap = 10;
    const tracks = state.tracks || [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
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

    // AUDIO FILES panel
    const audioY = tracksRect.y + tracksRect.h - innerPad - audioPanelH;
    const audioRect = { x: innerX, y: audioY, w: innerW, h: audioPanelH };

    // Header label
    ctx.fillStyle = theme.textDim;
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("AUDIO FILES", audioRect.x + 2, audioRect.y - 10);

    // Folder icon button (drawn)
    hit.audioFolderBtn = { x: audioRect.x + audioRect.w - 34, y: audioRect.y - 22, w: 28, h: 18 };
    glassPanel(hit.audioFolderBtn.x, hit.audioFolderBtn.y, hit.audioFolderBtn.w, hit.audioFolderBtn.h, 8);
    // draw folder
    ctx.save();
    ctx.translate(hit.audioFolderBtn.x + 7, hit.audioFolderBtn.y + 5);
    ctx.strokeStyle = "rgba(226,232,240,0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 4, 14, 8, 2) : roundRectPath(hit.audioFolderBtn.x+7, hit.audioFolderBtn.y+9, 14, 8, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1, 4);
    ctx.lineTo(6, 4);
    ctx.lineTo(7.5, 2.2);
    ctx.lineTo(13, 2.2);
    ctx.stroke();
    ctx.restore();

    // Import box
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

    // Hint
    ctx.fillStyle = theme.textDim;
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("Tap folder, click box, or drop audio here", audioRect.x + 14, audioRect.y + 12);

    // Audio list (draggable rows)
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

    ctx.restore(); // end clip to tracks panel

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
    const totalBeats = bars * beatsPerBar;

    // Store for dropping
    hit.timeline = { x: timelineRect.x, y: timelineRect.y, w: timelineRect.w, h: timelineRect.h, gx, gy, gw, gh, lanes: clamp(tracks.length, 3, 10), totalBeats };

    // verticals
    for (let b = 0; b <= totalBeats * 4; b++) { // 16th grid
      const x = gx + (gw * b / (totalBeats * 4));
      const isBeat = (b % 4) === 0;
      const isBar = (b % (beatsPerBar * 4)) === 0;
      ctx.strokeStyle = isBar ? "rgba(255,255,255,0.12)" : (isBeat ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, gy);
      ctx.lineTo(x + 0.5, gy + gh);
      ctx.stroke();
    }

    // horizontals
    const lanes = hit.timeline.lanes;
    for (let r = 0; r <= lanes; r++) {
      const y = gy + (gh * r / lanes);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, y + 0.5);
      ctx.lineTo(gx + gw, y + 0.5);
      ctx.stroke();
    }

    // bar numbers
    ctx.fillStyle = theme.textDim;
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    for (let i = 0; i < bars; i++) {
      const x = gx + (gw * (i * beatsPerBar) / totalBeats);
      ctx.fillText(String(i + 1), x + 6, gy + 6);
    }

    // Clips
    renderClips();

    ctx.restore();

    // Drag ghost on top
    ctx.save();
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    renderDragGhost();
    ctx.restore();

    // Title
    ctx.fillStyle = "rgba(226,232,240,0.14)";
    ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Canvas Audio", pad + 18, h - pad - 18);
  }

  return { mount, unmount, render, resize, setState };
}
