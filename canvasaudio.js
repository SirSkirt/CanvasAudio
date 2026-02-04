// Canvas Audio - App Orchestrator (state + wiring)
// UI: ui.js and mobile-ui.js draw on canvas and emit events.
// Audio: audioengine.js owns Tone.js graph + transport.

import { createAudioEngine } from "./audioengine.js";
import { createDesktopUI } from "./ui.js";
import { detectDeviceMode, createMobileUI } from "./mobile-ui.js";

const canvas = document.getElementById("app");

function createInitialState(deviceMode) {
  return {
    device: { mode: deviceMode },
    project: { bpm: 120, timeSig: "4/4", lengthBars: 64 },
    transport: { isPlaying: false, position: "0:0:0" },
    tracks: [
      {
        id: "t1",
        name: "Track 1",
        type: "audio",
        mute: false,
        solo: false,
        volumeDb: 0,
        pan: 0,
        clips: [
          { id: "c1", type: "audio", start: "0:0:0", duration: "1:0:0", assetId: null }
        ]
      }
    ],
    ui: {
      selectedTrackId: "t1",
      selectedClipId: null,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      message: "Tap Play to start audio"
    }
  };
}

const deviceMode = detectDeviceMode();
const state = createInitialState(deviceMode);

const audio = createAudioEngine();
await audio.init(state.project);

let ui;
if (deviceMode === "mobile") {
  ui = createMobileUI(canvas, onUIEvent);
} else {
  ui = createDesktopUI(canvas, onUIEvent);
}

ui.setState(state);
ui.mount();
ui.render();

function setState(patchFn) {
  patchFn(state);
  ui.setState(state);
  ui.render();
}

async function onUIEvent(evt) {
  switch (evt.type) {
    case "transport.togglePlay": {
      // First user gesture should unlock audio.
      await audio.ensureStarted();

      if (state.transport.isPlaying) {
        audio.stop();
        setState(s => {
          s.transport.isPlaying = false;
          s.ui.message = "Stopped";
        });
      } else {
        audio.play();
        setState(s => {
          s.transport.isPlaying = true;
          s.ui.message = "Playing";
        });
      }
      break;
    }

    case "transport.stop": {
      await audio.ensureStarted();
      audio.stop();
      setState(s => {
        s.transport.isPlaying = false;
        s.ui.message = "Stopped";
      });
      break;
    }

    case "project.setBpm": {
      const bpm = Math.max(40, Math.min(300, Number(evt.bpm) || 120));
      audio.setBpm(bpm);
      setState(s => {
        s.project.bpm = bpm;
        s.ui.message = `BPM: ${bpm}`;
      });
      break;
    }

    case "ui.resize": {
      ui.resize();
      ui.render();
      break;
    }

    default: {
      // Unknown events are ignored to keep the scaffold stable.
      break;
    }
  }
}

// Keep canvas crisp on resize/orientation changes
window.addEventListener("resize", () => onUIEvent({ type: "ui.resize" }));
window.addEventListener("orientationchange", () => onUIEvent({ type: "ui.resize" }));
