// --- CONSTANTS ---
export const instruments = [
  { name: "Kick", note: "C1" },
  { name: "Snare", note: "D1" },
  { name: "HiHat", note: "E1" }, // Synthesized
  { name: "Clap", note: "F1" }   // Synthesized
];

// --- DATA HELPERS ---
export function createEmptyGrid() {
  return instruments.map(() => new Array(16).fill(false));
}

// --- STATE ---
export const state = {
  isPlaying: false,
  mode: "PATTERN", // 'PATTERN' | 'SONG'
  bpm: 128,
  currentStep: 0,

  patterns: { pat1: { id: "pat1", name: "Pattern 1", grid: createEmptyGrid() } },
  audioClips: {},

  selectedResType: "pattern",
  selectedResId: "pat1",

  playlist: []
};

// 8 tracks
for (let i = 0; i < 8; i++) state.playlist.push([]);
