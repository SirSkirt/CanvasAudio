// Canvas Audio - Mobile detection + mobile UI wrapper
// Detection lives here. Mobile UI is canvas-based and emits the same events as desktop.

import { createDesktopUI } from "./ui.js";

export function detectDeviceMode() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return (coarse && small) ? "mobile" : "desktop";
}

export function createMobileUI(canvas, emit) {
  // For scaffold: reuse desktop UI renderer but adjust some behaviors.
  const ui = createDesktopUI(canvas, emit);

  // Wrap render to include mobile hint text.
  const baseRender = ui.render;
  ui.render = function() {
    baseRender();
    const ctx = canvas.getContext("2d", { alpha: false });
    const w = canvas.getBoundingClientRect().width;
    ctx.fillStyle = "#7f8aa3";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText("Mobile mode: tap buttons (touch-action disabled)", 14, canvas.getBoundingClientRect().height - 10);
  };

  return ui;
}
