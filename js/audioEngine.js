import { state } from "./stateManager.js";

// --- AUDIO ENGINE (HYBRID) ---

// 1. SAMPLES
const drumSamples = new Tone.Players({
  Kick: "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
  Snare: "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
}).toDestination();

// 2. SYNTHS
const hatSynth = new Tone.MetalSynth({
  envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5
}).toDestination();
hatSynth.volume.value = -15;

const clapSynth = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
}).toDestination();
clapSynth.volume.value = -10;

let activeSources = [];

// --- AUDIO CONTEXT ---
export async function ensureAudioStarted() {
  if (Tone.context.state !== "running") {
    await Tone.start();
  }
}

// --- PREVIEW ---
export function previewInstrument(idx) {
  if (idx === 0) {
    if (drumSamples.player("Kick").loaded) drumSamples.player("Kick").start();
  } else if (idx === 1) {
    if (drumSamples.player("Snare").loaded) drumSamples.player("Snare").start();
  } else if (idx === 2) {
    hatSynth.triggerAttackRelease("32n");
  } else if (idx === 3) {
    clapSynth.triggerAttackRelease("16n");
  }
}

// --- PATTERN PLAYBACK ---
export function playPatternStep(grid, stepIdx, time) {
  // 0: Kick
  if (grid[0][stepIdx]) {
    if (drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(time, 0, "16n");
  }
  // 1: Snare
  if (grid[1][stepIdx]) {
    if (drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(time, 0, "16n");
  }
  // 2: HiHat
  if (grid[2][stepIdx]) {
    hatSynth.triggerAttackRelease("32n", time);
  }
  // 3: Clap
  if (grid[3][stepIdx]) {
    clapSynth.triggerAttackRelease("16n", time);
  }
}

// --- AUDIO CLIP PLAYBACK ---
export function playAudioClip(id, time) {
  const clipData = state.audioClips[id];

  // Check if existing raw buffer
  if (!clipData || !clipData.buffer) {
    return;
  }

  try {
    // Direct usage of raw AudioBuffer
    const source = new Tone.BufferSource({
      buffer: clipData.buffer
    }).toDestination();

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

export function stopAllSources() {
  activeSources.forEach((source) => {
    try { source.stop(); } catch (e) {}
  });
  activeSources = [];
}

// --- AUDIO IMPORT (NATIVE DECODER FIX) ---
export async function decodeUserAudioFile(file) {
  // 1. Wake up Audio Context
  await ensureAudioStarted();

  // 2. Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  // 3. Native Decode (Bypasses Tone's URL loader)
  const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);

  return {
    name: file.name,
    buffer: audioBuffer, // raw AudioBuffer
    duration: audioBuffer.duration
  };
}
