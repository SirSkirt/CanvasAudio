// Canvas Audio - Desktop Canvas UI (visuals + input only)
// No business logic: emits events via provided callback.

export function createDesktopUI(canvas, emit) {
  const ctx = canvas.getContext("2d", { alpha: false });

  let state = null;
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // Simple retained layout for hit-testing
  const hit = {
    play: { x: 0, y: 0, w: 0, h: 0 },
    stop: { x: 0, y: 0, w: 0, h: 0 },
    bpm: { x: 0, y: 0, w: 0, h: 0 }
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
    canvas.addEventListener("pointermove", (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener("pointerup", (e) => e.preventDefault(), { passive: false });
  }

  function unmount() {
    canvas.removeEventListener("pointerdown", onPointerDown);
  }

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function onPointerDown(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);

    if (inRect(x, y, hit.play)) {
      emit({ type: "transport.togglePlay" });
      return;
    }
    if (inRect(x, y, hit.stop)) {
      emit({ type: "transport.stop" });
      return;
    }
    if (inRect(x, y, hit.bpm)) {
      const next = prompt("Set BPM (40-300):", String(state?.project?.bpm ?? 120));
      if (next !== null) emit({ type: "project.setBpm", bpm: next });
      return;
    }
  }

  function drawButton(r, label) {
    ctx.fillStyle = "#1a2230";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#2c3a52";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.fillStyle = "#e8eefc";
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + 12, r.y + r.h / 2);
  }

  function render() {
    if (!state) return;

    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    // Background
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, w, h);

    // Top transport bar
    const barH = 56;
    ctx.fillStyle = "#101826";
    ctx.fillRect(0, 0, w, barH);

    // Buttons
    hit.play = { x: 14, y: 12, w: 120, h: 32 };
    hit.stop = { x: 144, y: 12, w: 90, h: 32 };
    hit.bpm  = { x: 244, y: 12, w: 120, h: 32 };

    const playLabel = state.transport.isPlaying ? "Pause" : "Play";
    drawButton(hit.play, playLabel);
    drawButton(hit.stop, "Stop");
    drawButton(hit.bpm, `BPM: ${state.project.bpm}`);

    // Message (status)
    ctx.fillStyle = "#a8b3c7";
    ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(state.ui.message || "", 380, barH / 2);

    // Main area: placeholder timeline grid
    const top = barH + 12;
    const left = 14;
    const rightPad = 14;
    const bottomPad = 14;
    const areaW = w - left - rightPad;
    const areaH = h - top - bottomPad;

    ctx.fillStyle = "#0d111a";
    ctx.fillRect(left, top, areaW, areaH);

    ctx.strokeStyle = "#1c2636";
    ctx.lineWidth = 1;

    // Vertical bar lines
    const bars = 16;
    for (let i = 0; i <= bars; i++) {
      const x = left + (areaW * i / bars);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, top + areaH);
      ctx.stroke();
    }

    // Track lanes
    const lanes = 6;
    for (let j = 0; j <= lanes; j++) {
      const y = top + (areaH * j / lanes);
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(left + areaW, y + 0.5);
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = "#e8eefc";
    ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("Canvas Audio (scaffold)", left, top + 10);

    ctx.fillStyle = "#7f8aa3";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("Canvas-rendered UI. Tone.js transport only. Modular file layout.", left, top + 34);
  }

  return { mount, unmount, render, resize, setState };
}
