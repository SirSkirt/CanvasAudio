export function createAudioEngine() {
  let inited = false;

  async function init(project) {
    if (inited) return;
    Tone.Transport.bpm.value = project?.bpm ?? 120;
    Tone.Transport.timeSignature = (project?.timeSig ?? "4/4")
      .split("/")
      .map(n => Number(n) || 4);
    inited = true;
  }

  async function ensureStarted() {
    if (Tone.context.state !== "running") {
      await Tone.start();
    }
  }

  function play() { Tone.Transport.start(); }
  function pause() { Tone.Transport.pause(); }

  function stop() {
    Tone.Transport.stop();
    Tone.Transport.position = "0:0:0";
  }

  function setBpm(bpm) {
    Tone.Transport.bpm.rampTo(bpm, 0.05);
  }

  return { init, ensureStarted, play, pause, stop, setBpm };
}
