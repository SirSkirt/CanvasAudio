// src/transport.js
import { state } from "./stateManager.js";
import { Tone, playPatternStep, playAudioClip, stopAllActiveSources, ensureAudioRunning } from "./audioEngine.js";

export function updateBPM(val) {
  state.bpm = parseInt(val);
  Tone.Transport.bpm.value = state.bpm;
}

export async function togglePlay() {
  if(state.isPlaying) {
    stopTransport();
  } else {
    await ensureAudioRunning();
    updateBPM(state.bpm);
    Tone.Transport.start();
    state.isPlaying = true;
    document.getElementById('play-btn').classList.add('active');
  }
}

export function stopTransport() {
  Tone.Transport.stop();
  stopAllActiveSources();

  state.isPlaying = false;
  state.currentStep = 0;
  document.getElementById('play-btn').classList.remove('active');

  document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
  document.getElementById('playhead').style.left = '120px';
}

export function setMode(mode) {
  state.mode = mode;
  document.getElementById('mode-pat').classList.toggle('active', mode === 'PATTERN');
  document.getElementById('mode-song').classList.toggle('active', mode === 'SONG');
  stopTransport();
}

export function installClock(onTickVisuals) {
  Tone.Transport.scheduleRepeat((time) => {
    const step = state.currentStep;

    // visuals delegated
    onTickVisuals(step, time);

    // audio
    if(state.mode === 'PATTERN') {
      if(state.selectedResType === 'pattern') {
        playPatternStep(state.patterns[state.selectedResId].grid, step % 16, time);
      }
    } else if (state.mode === 'SONG') {
      const currentBar = Math.floor(step / 16);
      const stepInBar = step % 16;

      state.playlist.forEach(track => {
        track.forEach(clip => {
          if(currentBar >= clip.startBar && currentBar < clip.startBar + clip.lengthBars) {
            if(clip.type === 'pattern') {
              playPatternStep(state.patterns[clip.id].grid, stepInBar, time);
            }
            if(clip.type === 'audio' && currentBar === clip.startBar && stepInBar === 0) {
              playAudioClip(clip.id, time);
            }
          }
        });
      });
    }

    state.currentStep++;
  }, "16n");
}
