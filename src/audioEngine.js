// src/audioEngine.js
import * as Tone from "https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js";
import { state } from "./stateManager.js";

// 1. SAMPLES
export const drumSamples = new Tone.Players({
  "Kick": "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
  "Snare": "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
}).toDestination();

// 2. SYNTHS
export const hatSynth = new Tone.MetalSynth({
  envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5
}).toDestination();
hatSynth.volume.value = -15;

export const clapSynth = new Tone.NoiseSynth({
  noise: { type: 'white' },
  envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
}).toDestination();
clapSynth.volume.value = -10;

export let activeSources = [];

export async function ensureAudioRunning() {
  if (Tone.context.state !== 'running') {
    await Tone.start();
  }
}

export async function handleAudioUpload(input) {
  const file = input.files[0];
  if(!file) return;

  // 1. Wake up Audio Context
  await ensureAudioRunning();

  const id = 'audio' + Date.now();

  // 2. Read file as ArrayBuffer
  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;

    try {
      // 3. Native Decode (Bypasses Tone's URL loader)
      const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);

      state.audioClips[id] = {
        id,
        name: file.name,
        buffer: audioBuffer, // raw AudioBuffer
        duration: audioBuffer.duration
      };
      // UI is responsible for re-render/select after this returns.
      console.log("Audio decoded successfully!");
    } catch (err) {
      console.error("Decoding error:", err);
      alert("Error decoding audio file. Try a standard MP3 or WAV.");
    }
  };
  reader.readAsArrayBuffer(file);

  return id;
}

export function previewInstrument(idx) {
  if(idx === 0) { if(drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(); }
  else if(idx === 1) { if(drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(); }
  else if(idx === 2) { hatSynth.triggerAttackRelease("32n"); }
  else if(idx === 3) { clapSynth.triggerAttackRelease("16n"); }
}

export function playPatternStep(grid, stepIdx, time) {
  if(grid[0][stepIdx]) { if(drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(time, 0, "16n"); }
  if(grid[1][stepIdx]) { if(drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(time, 0, "16n"); }
  if(grid[2][stepIdx]) { hatSynth.triggerAttackRelease("32n", time); }
  if(grid[3][stepIdx]) { clapSynth.triggerAttackRelease("16n", time); }
}

export function playAudioClip(id, time) {
  const clipData = state.audioClips[id];
  if(!clipData || !clipData.buffer) return;

  try {
    const source = new Tone.BufferSource({ buffer: clipData.buffer }).toDestination();
    source.start(time);
    activeSources.push(source);

    source.onended = () => {
      const index = activeSources.indexOf(source);
      if (index > -1) activeSources.splice(index, 1);
    };
  } catch (e) {
    console.error("Audio playback error:", e);
  }
}

export function stopAllActiveSources() {
  activeSources.forEach(source => {
    try { source.stop(); } catch(e){}
  });
  activeSources = [];
}

export { Tone };
