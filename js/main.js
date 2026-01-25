import { state, createEmptyGrid } from "./stateManager.js";
import { ensureAudioStarted, decodeUserAudioFile, playPatternStep, playAudioClip, stopAllSources } from "./audioEngine.js";
import {
  generateRuler,
  renderResources,
  renderPlaylist,
  renderChannelRack,
  selectResource,
  setModeButtons,
  setPlayButtonActive,
  resetVisuals,
  updateStepHighlights,
  updateSongPlayhead
} from "./uiRenderer.js";

// --- INITIALIZATION ---
function init() {
  generateRuler();
  renderResources();
  renderPlaylist(addClipToTrack);
  renderChannelRack();
  selectResource("pattern", "pat1");
  Tone.Transport.bpm.value = 128;
  wireUI();
}

function wireUI() {
  // Mode buttons
  document.getElementById("mode-pat").addEventListener("click", () => setMode("PATTERN"));
  document.getElementById("mode-song").addEventListener("click", () => setMode("SONG"));

  // Transport buttons
  document.getElementById("play-btn").addEventListener("click", () => togglePlay());
  document.getElementById("stop-btn").addEventListener("click", () => stopTransport());

  // BPM
  document.getElementById("bpm-input").addEventListener("change", (e) => updateBPM(e.target.value));

  // Fullscreen
  document.getElementById("fullscreen-btn").addEventListener("click", () => toggleFullscreen());

  // New pattern
  document.getElementById("new-pattern-btn").addEventListener("click", () => createNewPattern());

  // Clear pattern
  document.getElementById("clear-pattern-btn").addEventListener("click", () => clearCurrentPattern());

  // Import audio
  const fileInput = document.getElementById("audio-upload");
  document.getElementById("import-audio-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleAudioUpload(e.target));
}

// --- FULLSCREEN FUNCTION ---
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.log(`Error enabling full-screen: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// --- PATTERNS ---
function createNewPattern() {
  const id = "pat" + Date.now();
  state.patterns[id] = { id, name: `Pattern ${Object.keys(state.patterns).length + 1}`, grid: createEmptyGrid() };
  selectResource("pattern", id);
  renderResources();
}

function clearCurrentPattern() {
  if (state.selectedResType === "pattern") {
    state.patterns[state.selectedResId].grid = createEmptyGrid();
    renderChannelRack();
  }
}

// --- AUDIO IMPORT ---
async function handleAudioUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const id = "audio" + Date.now();

  try {
    const decoded = await decodeUserAudioFile(file);

    state.audioClips[id] = {
      id,
      name: decoded.name,
      buffer: decoded.buffer,
      duration: decoded.duration
    };

    renderResources();
    selectResource("audio", id);
    console.log("Audio decoded successfully!");
  } catch (err) {
    console.error("Decoding error:", err);
    alert("Error decoding audio file. Try a standard MP3 or WAV.");
  } finally {
    // allow re-uploading same file
    input.value = "";
  }
}

// --- PLAYLIST MUTATION ---
function addClipToTrack(trackIndex, startBar) {
  if (!state.selectedResId) return;

  let length = 1;

  if (state.selectedResType === "audio") {
    const clip = state.audioClips[state.selectedResId];
    if (!clip) return;
    const secondsPerBar = (60 / state.bpm) * 4;
    length = Math.ceil(clip.duration / secondsPerBar);
    if (length < 1) length = 1;
  }

  state.playlist[trackIndex].push({
    type: state.selectedResType,
    id: state.selectedResId,
    startBar: startBar,
    lengthBars: length
  });

  renderPlaylist(addClipToTrack);
}

// --- TRANSPORT ---
function setMode(mode) {
  state.mode = mode;
  setModeButtons(mode);
  stopTransport();
}

function updateBPM(val) {
  state.bpm = parseInt(val);
  Tone.Transport.bpm.value = state.bpm;
}

async function togglePlay() {
  if (state.isPlaying) {
    stopTransport();
  } else {
    await ensureAudioStarted();
    updateBPM(state.bpm);
    Tone.Transport.start();
    state.isPlaying = true;
    setPlayButtonActive(true);
  }
}

function stopTransport() {
  Tone.Transport.stop();
  stopAllSources();

  state.isPlaying = false;
  state.currentStep = 0;
  setPlayButtonActive(false);

  resetVisuals();
}

// --- CLOCK ---
Tone.Transport.scheduleRepeat((time) => {
  const step = state.currentStep;

  // Visuals
  Tone.Draw.schedule(() => {
    updateStepHighlights(step);

    if (state.mode === "SONG") {
      updateSongPlayhead(step);
    }
  }, time);

  // Audio Logic
  if (state.mode === "PATTERN") {
    if (state.selectedResType === "pattern") {
      playPatternStep(state.patterns[state.selectedResId].grid, step % 16, time);
    }
  } else if (state.mode === "SONG") {
    const currentBar = Math.floor(step / 16);
    const stepInBar = step % 16;

    state.playlist.forEach((track) => {
      track.forEach((clip) => {
        if (currentBar >= clip.startBar && currentBar < clip.startBar + clip.lengthBars) {
          if (clip.type === "pattern") {
            playPatternStep(state.patterns[clip.id].grid, stepInBar, time);
          }
          if (clip.type === "audio" && currentBar === clip.startBar && stepInBar === 0) {
            playAudioClip(clip.id, time);
          }
        }
      });
    });
  }

  state.currentStep++;
}, "16n");

window.addEventListener("load", init);
