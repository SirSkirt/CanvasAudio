// CanvasAudio Plugin Registry (simple, no build step)
(function(){
  const PLUGINS = [];

  // AutoTune plugin (from autotune.js): real-time pitch detection + correction (chromatic snap)
  // NOTE: This is "live" pitch correction, not offline rendering.
  function createAutoTune(trackCtx){
    const A4 = 440;

    function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
    function freqToMidi(freq){ return 69 + 12 * Math.log2(freq / A4); }
    function getNoteName(midi){
      const notes = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
      const octave = Math.floor(midi / 12) - 1;
      const noteIndex = (Math.round(midi) % 12 + 12) % 12;
      return notes[noteIndex] + octave;
    }

    // Pitch Detection (Autocorrelation)
    function autoCorrelate(buffer, sampleRate){
      let size = buffer.length;
      let rms = 0;
      for(let i=0;i<size;i++){ const v = buffer[i]; rms += v*v; }
      rms = Math.sqrt(rms / size);

      // Ignore low-level noise / hum
      if(rms < 0.02) return -1;

      let r1 = 0, r2 = size - 1, thres = 0.2;
      for(let i=0;i<size/2;i++){ if(Math.abs(buffer[i]) < thres){ r1 = i; break; } }
      for(let i=1;i<size/2;i++){ if(Math.abs(buffer[size-i]) < thres){ r2 = size - i; break; } }

      buffer = buffer.slice(r1, r2);
      size = buffer.length;

      const c = new Array(size).fill(0);
      for(let i=0;i<size;i++){
        for(let j=0;j<size-i;j++){ c[i] += buffer[j] * buffer[j+i]; }
      }

      let d = 0;
      while(d+1 < size && c[d] > c[d+1]) d++;

      let maxval = -1, maxpos = -1;
      for(let i=d;i<size;i++){
        if(c[i] > maxval){ maxval = c[i]; maxpos = i; }
      }
      let T0 = maxpos;
      if(T0 <= 1 || T0+1 >= c.length) return -1;

      const x1 = c[T0-1], x2 = c[T0], x3 = c[T0+1];
      const a = (x1 + x3 - 2*x2) / 2;
      const b = (x3 - x1) / 2;
      if(a) T0 = T0 - b / (2*a);

      const freq = sampleRate / T0;
      if(!isFinite(freq) || freq <= 0) return -1;
      return freq;
    }

    const state = {
      id: "autotune",
      name: "AutoTune",
      // Retune/smoothing time in seconds (smaller = harder tuning)
      retune: 0.10,
      // Gate threshold in dB
      gateDb: -30,
      enabled: true
    };

    // Composite nodes: input -> gate -> pitchShift -> output
    const inputNode = new Tone.Gain(1);
    const gate = new Tone.Gate(state.gateDb, 0.2);
    const pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.1,
      delayTime: 0,
      feedback: 0
    });
    // Force fully-wet so there is no dry parallel path
    try{ pitchShift.wet.value = 1; }catch(e){}

    const analyser = new Tone.Analyser("waveform", 1024);

    inputNode.connect(gate);
    gate.connect(pitchShift);

    // Raw audio tap for detection
    inputNode.connect(analyser);

    const outputNode = pitchShift;

    let running = false;
    let rafId = null;

    const uiEls = { note:null, freq:null, corr:null, retuneVal:null, gateVal:null };

    function setPitch(semitoneDiff){
      const t = clamp(state.retune, 0.005, 0.5);
      try{
        if(pitchShift.pitch && typeof pitchShift.pitch.rampTo === "function"){
          pitchShift.pitch.rampTo(semitoneDiff, t);
        }else if(typeof pitchShift.pitch === "number"){
          pitchShift.pitch = semitoneDiff;
        }else if(pitchShift.pitch && typeof pitchShift.pitch === "object" && "value" in pitchShift.pitch){
          pitchShift.pitch.value = semitoneDiff;
        }
      }catch(e){}
    }

    function loop(){
      if(!running) return;
      try{
        const buf = analyser.getValue();
        const detectedFreq = autoCorrelate(buf, Tone.context.sampleRate);

        if(detectedFreq !== -1){
          const midiNum = freqToMidi(detectedFreq);
          const nearestMidi = Math.round(midiNum);
          const semitoneDiff = nearestMidi - midiNum;

          if(state.enabled){
            setPitch(semitoneDiff);
          }

          if(uiEls.note) uiEls.note.textContent = getNoteName(nearestMidi);
          if(uiEls.freq) uiEls.freq.textContent = Math.round(detectedFreq) + " Hz";
          if(uiEls.corr) uiEls.corr.textContent = semitoneDiff.toFixed(2);
        }
      }catch(e){}
      rafId = requestAnimationFrame(loop);
    }

    function start(){
      if(running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }
    function stop(){
      running = false;
      if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
    }

    // Start immediately; host still gates AudioContext with Start Audio button.
    start();

    function mountUI(container){
      container.innerHTML = "";

      const title = document.createElement("div");
      title.className = "fxwin-title";
      title.textContent = "AutoTune";
      container.appendChild(title);

      const info = document.createElement("div");
      info.className = "fxwin-row";
      info.innerHTML = `
        <label>Detected</label>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <span>Note: <b id="fx_at_note">--</b></span>
          <span>Freq: <b id="fx_at_freq">--</b></span>
          <span>Corr: <b id="fx_at_corr">--</b> st</span>
        </div>
      `;
      container.appendChild(info);

      const rowRet = document.createElement("div");
      rowRet.className = "fxwin-row";
      rowRet.innerHTML = `
        <label>Retune</label>
        <input id="fx_at_retune" type="range" min="0.005" max="0.5" step="0.005" value="${state.retune}">
        <span id="fx_at_retune_val">${state.retune.toFixed(3)}s</span>
      `;
      container.appendChild(rowRet);

      const rowGate = document.createElement("div");
      rowGate.className = "fxwin-row";
      rowGate.innerHTML = `
        <label>Gate</label>
        <input id="fx_at_gate" type="range" min="-60" max="-10" step="1" value="${state.gateDb}">
        <span id="fx_at_gate_val">${state.gateDb} dB</span>
      `;
      container.appendChild(rowGate);

      const rowEn = document.createElement("div");
      rowEn.className = "fxwin-row";
      rowEn.innerHTML = `
        <label>Enable</label>
        <input id="fx_at_en" type="checkbox" ${state.enabled ? "checked" : ""}>
      `;
      container.appendChild(rowEn);

      uiEls.note = container.querySelector("#fx_at_note");
      uiEls.freq = container.querySelector("#fx_at_freq");
      uiEls.corr = container.querySelector("#fx_at_corr");
      uiEls.retuneVal = container.querySelector("#fx_at_retune_val");
      uiEls.gateVal = container.querySelector("#fx_at_gate_val");

      const ret = container.querySelector("#fx_at_retune");
      const gateEl = container.querySelector("#fx_at_gate");
      const enEl = container.querySelector("#fx_at_en");

      ret.addEventListener("input", ()=>{
        state.retune = clamp(parseFloat(ret.value) || 0.10, 0.005, 0.5);
        if(uiEls.retuneVal) uiEls.retuneVal.textContent = state.retune.toFixed(3) + "s";
      });

      gateEl.addEventListener("input", ()=>{
        state.gateDb = Math.round(parseFloat(gateEl.value) || -30);
        try{ gate.threshold.value = state.gateDb; }catch(e){}
        if(uiEls.gateVal) uiEls.gateVal.textContent = state.gateDb + " dB";
      });

      enEl.addEventListener("change", ()=>{
        state.enabled = !!enEl.checked;
        if(!state.enabled) setPitch(0);
      });
    }

    function getState(){ return { ...state }; }
    function setState(next){
      if(!next) return;
      if(typeof next.retune === "number") state.retune = clamp(next.retune, 0.005, 0.5);
      if(typeof next.gateDb === "number") state.gateDb = Math.round(clamp(next.gateDb, -60, -10));
      if(typeof next.enabled === "boolean") state.enabled = next.enabled;

      try{ gate.threshold.value = state.gateDb; }catch(e){}
      if(!state.enabled) setPitch(0);
    }

    return {
      id: state.id,
      name: state.name,
      inputNode,
      outputNode,
      mountUI,
      getState,
      setState,
      setEnabled: (on)=>{ state.enabled = !!on; if(!state.enabled) setPitch(0); },
      dispose: ()=>{
        stop();
        try{ analyser.dispose(); }catch(e){}
        try{ pitchShift.dispose(); }catch(e){}
        try{ gate.dispose(); }catch(e){}
        try{ inputNode.dispose(); }catch(e){}
      }
    };
  }

  PLUGINS.push({
    id: "autotune",
    name: "AutoTune",
    create: createAutoTune
  });

  window.CA_PLUGINS = PLUGINS;
})();