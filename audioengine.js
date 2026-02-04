// Canvas Audio - Tone.js Audio Engine
// Owns Tone.js objects. Provides transport controls and (later) tracks/clips/recording.

export function createAudioEngine() {
  let inited = false;

  async function init(project) {
    if (inited) return;
    // Configure transport defaults.
    Tone.Transport.bpm.value = project?.bpm ?? 120;
    Tone.Transport.timeSignature = (project?.timeSig ?? "4/4").split("/").map(n => Number(n) || 4);
    inited = true;
  }

  async function ensureStarted() {
    // Must be called inside a user gesture (e.g., pointerdown) at least once.
    if (Tone.context.state !== "running") {
      await Tone.start();
    }
  }

  function play() {
    // Placeholder: start transport. Later: schedule clips, metronome, etc.
    Tone.Transport.start();
  }

  function stop() {
    Tone.Transport.stop();
    Tone.Transport.position = "0:0:0";
  }

  function setBpm(bpm) {
    Tone.Transport.bpm.rampTo(bpm, 0.05);
  }

  return { init, ensureStarted, play, stop, setBpm };
}
