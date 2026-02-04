import { createDesktopUI } from "./ui.js";

export function detectDeviceMode() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return (coarse && small) ? "mobile" : "desktop";
}

export function createMobileUI(canvas, emit) {
  const ui = createDesktopUI(canvas, emit);
  // Mobile uses same rendering; could increase hit areas later.
  return ui;
}
