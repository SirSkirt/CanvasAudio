// Canvas Audio - Tone.js Audio Engine
// Owns Tone.js objects + buffers. UI/canvasaudio interact via methods.

export function createAudioEngine() {
  let inited = false;

  let click = null;
  let clickPart = null;

  // Asset buffers live here (not in app state)
  const buffers = new Map(); // assetId -> Tone.ToneAudioBuffer

  async function init(project) {
    if (inited) return;

    Tone.Transport.bpm.value = project?.bpm ?? 120;
    Tone.Transport.timeSignature = (project?.timeSig ?? "4/4")
      .split("/")
      .map(n => Number(n) || 4);

    // Metronome click (quarter notes)
    click = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 2,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.02 }
    }).toDestination();
    click.volume.value = -18;

    clickPart = new Tone.Part((time, step) => {
      if (!click) return;
      click.volume.value = step.isDownbeat ? -12 : -18;
      click.triggerAttackRelease(step.isDownbeat ? "C4" : "A3", "32n", time);
    }, []).start(0);

    rebuildMetronomeEvents();

    inited = true;
  }

  function rebuildMetronomeEvents() {
    if (!clickPart) return;
    clickPart.clear();

    // 4 bars of 4/4 -> 16 quarter notes; loop
    const stepSec = Tone.Time("4n").toSeconds();
    for (let i = 0; i < 16; i++) {
      clickPart.add(i * stepSec, { isDownbeat: (i % 4) === 0 });
    }
    clickPart.loop = true;
    clickPart.loopEnd = stepSec * 16;
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

  async function importAudioFiles(files, allocateId) {
    const out = [];
    for (const f of Array.from(files || [])) {
      const id = allocateId();
      const arr = await f.arrayBuffer();
      const audioBuffer = await Tone.context.rawContext.decodeAudioData(arr.slice(0));
      const tb = new Tone.ToneAudioBuffer(audioBuffer);
      buffers.set(id, tb);

      out.push({
        id,
        name: f.name,
        bytes: f.size,
        type: f.type || "audio/*",
        durationSec: audioBuffer.duration
      });
    }
    return out;
  }

  function previewAsset(assetId) {
    const buf = buffers.get(assetId);
    if (!buf) return;

    const player = new Tone.Player(buf).toDestination();
    player.volume.value = -6;
    player.start();

    player.onstop = () => {
      try { player.dispose(); } catch {}
    };
  }

  return {
    init,
    ensureStarted,
    play,
    pause,
    stop,
    setBpm,
    importAudioFiles,
    previewAsset
  };
}
