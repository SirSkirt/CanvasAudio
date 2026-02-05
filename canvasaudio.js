import { createAudioEngine } from "./audioengine.js";
import { detectDeviceMode, createMobileUI } from "./mobile-ui.js";
import { createDesktopUI } from "./ui.js";

const canvas = document.getElementById("app");

function createInitialState(deviceMode) {
  return {
    device: { mode: deviceMode },
    project: { bpm: 120, timeSig: "4/4", lengthBars: 64 },
    transport: { isPlaying: false, isRecording: false, position: "0:0:0" },

    tracks: [
      { id: "t1", name: "Track 1", type: "audio", clips: [] },
      { id: "t2", name: "Track 2", type: "audio", clips: [] },
      { id: "t3", name: "Track 3", type: "audio", clips: [] },
    ],

    assets: {
      audio: [] // { id, name, bytes, type, durationSec }
    },

    ui: {
      selectedTrackId: "t1",
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      message: "Ready"
    }
  };
}

const deviceMode = detectDeviceMode();
const state = createInitialState(deviceMode);

const audio = createAudioEngine();
await audio.init(state.project);

let ui = (deviceMode === "mobile")
  ? createMobileUI(canvas, onUIEvent)
  : createDesktopUI(canvas, onUIEvent);

ui.setState(state);
ui.mount();
ui.render();

function setState(patchFn) {
  patchFn(state);
  ui.setState(state);
  ui.render();
}

function nextTrackId() {
  let n = 1;
  const ids = new Set(state.tracks.map(t => t.id));
  while (ids.has(`t${n}`)) n++;
  return `t${n}`;
}

function nextAssetId() {
  let n = 1;
  const ids = new Set(state.assets.audio.map(a => a.id));
  while (ids.has(`a${n}`)) n++;
  return `a${n}`;
}

async function onUIEvent(evt) {
  switch (evt.type) {
    case "transport.togglePlay": {
      await audio.ensureStarted();
      if (state.transport.isPlaying) {
        audio.pause();
        setState(s => { s.transport.isPlaying = false; s.ui.message = "Paused"; });
      } else {
        audio.play();
        setState(s => { s.transport.isPlaying = true; s.ui.message = "Playing"; });
      }
      break;
    }

    case "transport.stop": {
      await audio.ensureStarted();
      audio.stop();
      setState(s => {
        s.transport.isPlaying = false;
        s.transport.isRecording = false;
        s.ui.message = "Stopped";
      });
      break;
    }

    case "transport.toggleRecord": {
      await audio.ensureStarted();
      setState(s => {
        s.transport.isRecording = !s.transport.isRecording;
        s.ui.message = s.transport.isRecording ? "Record armed (scaffold)" : "Record off";
      });
      break;
    }

    case "ui.openMixer": {
      setState(s => { s.ui.message = "Mixer (not implemented yet)"; });
      break;
    }

    case "project.setBpm": {
      const bpm = Math.max(40, Math.min(300, Number(evt.bpm) || 120));
      audio.setBpm(bpm);
      setState(s => { s.project.bpm = bpm; s.ui.message = `BPM set to ${bpm}`; });
      break;
    }

    case "ui.selectTrack": {
      setState(s => { s.ui.selectedTrackId = evt.trackId; });
      break;
    }

    case "tracks.add": {
      const id = nextTrackId();
      setState(s => {
        const idx = s.tracks.length + 1;
        s.tracks.push({ id, name: `Track ${idx}`, type: "audio", clips: [] });
        s.ui.selectedTrackId = id;
        s.ui.message = "Track added";
      });
      break;
    }

    case "audio.importFiles": {
      const files = Array.from(evt.files || []);
      if (!files.length) break;

      await audio.ensureStarted();

      setState(s => { s.ui.message = "Importing audio…"; });
      const imported = await audio.importAudioFiles(files, nextAssetId);

      setState(s => {
        s.assets.audio.push(...imported);
        s.ui.message = `${imported.length} audio file(s) imported`;
      });
      break;
    }

    case "audio.preview": {
      await audio.ensureStarted();
      audio.previewAsset(evt.assetId);
      setState(s => { s.ui.message = "Preview"; });
      break;
    }

    case "ui.resize": {
      ui.resize();
      ui.render();
      break;
    }

    default:
      break;
  }
}

window.addEventListener("resize", () => onUIEvent({ type: "ui.resize" }));
window.addEventListener("orientationchange", () => onUIEvent({ type: "ui.resize" }));
