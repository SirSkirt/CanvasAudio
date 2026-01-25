// src/main.js
import { state, createNewPattern as createNewPatternState, clearCurrentPatternGrid } from "./stateManager.js";
import { handleAudioUpload as handleAudioUploadEngine, Tone } from "./audioEngine.js";
import { generateRuler, renderResources, renderPlaylist, renderChannelRack, setRackTitle, setRackRowsHtml } from "./uiRenderer.js";
import { setMode, togglePlay, stopTransport, updateBPM, installClock } from "./transport.js";

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log(`Error enabling full-screen: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

function selectResource(type, id) {
  state.selectedResType = type;
  state.selectedResId = id;

  document.querySelectorAll('.resource-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`res-${id}`);
  if(el) el.classList.add('selected');

  if(type === 'pattern') {
    renderChannelRack();
    setRackTitle("SEQUENCER: " + state.patterns[id].name);
  } else {
    setRackTitle("AUDIO CLIP SELECTED (Not editable in sequencer)");
    setRackRowsHtml(`<div style="padding:20px; color:#666; text-align:center;">Drag this clip or click in the Playlist to add it.</div>`);
  }
}

function createNewPattern() {
  const id = createNewPatternState();
  selectResource('pattern', id);
  renderResources(selectResource);
}

async function handleAudioUpload(input) {
  const id = await handleAudioUploadEngine(input);
  // FileReader callback completes later; redraw after a microtask to keep wiring minimal.
  setTimeout(() => {
    renderResources(selectResource);
    if (id) selectResource('audio', id);
  }, 0);
}

function addClipToTrack(trackIndex, startBar) {
  if(!state.selectedResId) return;

  let length = 1;

  if(state.selectedResType === 'audio') {
    const clip = state.audioClips[state.selectedResId];
    if(!clip) return;
    const secondsPerBar = (60 / state.bpm) * 4;
    length = Math.ceil(clip.duration / secondsPerBar);
    if(length < 1) length = 1;
  }

  state.playlist[trackIndex].push({
    type: state.selectedResType,
    id: state.selectedResId,
    startBar: startBar,
    lengthBars: length
  });
  renderPlaylist(addClipToTrack);
}

function clearCurrentPattern() {
  if(state.selectedResType === 'pattern') {
    clearCurrentPatternGrid();
    renderChannelRack();
  }
}

function init() {
  generateRuler();
  renderResources(selectResource);
  renderPlaylist(addClipToTrack);
  renderChannelRack();
  selectResource('pattern', 'pat1');
  updateBPM(128);
}

installClock((step, time) => {
  Tone.Draw.schedule(() => {
    document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
    document.querySelectorAll(`.step[data-step="${step%16}"]`).forEach(s => s.classList.add('playing'));

    if(state.mode === 'SONG') {
      const px = 120 + (step * 3.75);
      const playhead = document.getElementById('playhead');
      playhead.style.left = px + 'px';

      const scrollBox = document.getElementById('playlist-scroll');
      if(px > scrollBox.scrollLeft + scrollBox.clientWidth) {
        scrollBox.scrollLeft = px - 150;
      }
    }
  }, time);
});

window.addEventListener('load', init);

// expose API for inline handlers
window.setMode = setMode;
window.togglePlay = togglePlay;
window.stopTransport = stopTransport;
window.updateBPM = updateBPM;
window.toggleFullscreen = toggleFullscreen;
window.createNewPattern = createNewPattern;
window.clearCurrentPattern = clearCurrentPattern;
window.handleAudioUpload = handleAudioUpload;
