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

    const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const SCALE_INTERVALS = {
      "Chromatic": [0,1,2,3,4,5,6,7,8,9,10,11],
      "Major":     [0,2,4,5,7,9,11],
      "Minor":     [0,2,3,5,7,8,10],
      "Pentatonic Major": [0,2,4,7,9],
      "Pentatonic Minor": [0,3,5,7,10]
    };

    function keyNameToPc(name){
      const i = NOTE_NAMES.indexOf(name);
      return i >= 0 ? i : 0;
    }

    function nearestAllowedMidi(midiFloat, keyPc, intervals){
      // Find nearest midi integer whose pitch class is in (keyPc + intervals) mod 12
      const allowed = new Set(intervals.map(iv => (keyPc + iv) % 12));
      const base = Math.round(midiFloat);
      let best = base;
      let bestDist = Infinity;

      // Search outward up to an octave; cheap and good enough
      for(let delta=0; delta<=12; delta++){
        for(const cand of [base - delta, base + delta]){
          if(allowed.has(((cand % 12) + 12) % 12)){
            const d = Math.abs(cand - midiFloat);
            if(d < bestDist){
              bestDist = d;
              best = cand;
            }
          }
        }
        if(bestDist !== Infinity) break;
      }
      return best;
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
      // Musical context
      key: "C",
      scale: "Chromatic",
      // 0 = hard snap, 1 = very gentle / natural
      humanize: 0.0,
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

    const uiEls = { note:null, freq:null, corr:null, retuneVal:null, gateVal:null, humanizeVal:null };

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

          const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS["Chromatic"];
          const keyPc = keyNameToPc(state.key);
          const targetMidi = nearestAllowedMidi(midiNum, keyPc, intervals);

          let semitoneDiff = targetMidi - midiNum;

          // Humanize: soften correction + add tiny natural drift, and ignore micro-corrections
          const hz = clamp(state.humanize, 0, 1);
          const deadband = 0.10 + hz * 0.20; // semitones
          if(Math.abs(semitoneDiff) < deadband) semitoneDiff = 0;

          const strength = Math.max(0.15, 1 - hz); // keep at least a little correction
          const jitter = (hz > 0) ? (hz * ((Math.random() * 0.10) - 0.05)) : 0; // +/- 0.05 st max
          semitoneDiff = (semitoneDiff * strength) + jitter;

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


      const rowKeyScale = document.createElement("div");
      rowKeyScale.className = "fxwin-row";
      rowKeyScale.innerHTML = `
        <label>Key / Scale</label>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <select id="fx_at_key"></select>
          <select id="fx_at_scale"></select>
        </div>
      `;
      container.appendChild(rowKeyScale);

      const rowHum = document.createElement("div");
      rowHum.className = "fxwin-row";
      rowHum.innerHTML = `
        <label>Humanize</label>
        <input id="fx_at_humanize" type="range" min="0" max="1" step="0.01" value="${state.humanize}">
        <span id="fx_at_humanize_val">${Math.round(state.humanize*100)}%</span>
      `;
      container.appendChild(rowHum);
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
      uiEls.humanizeVal = container.querySelector("#fx_at_humanize_val");

      const keySel = container.querySelector("#fx_at_key");
      const scaleSel = container.querySelector("#fx_at_scale");
      const hum = container.querySelector("#fx_at_humanize");

      // Populate Key
      NOTE_NAMES.forEach(n=>{
        const o=document.createElement("option");
        o.value=n; o.textContent=n;
        if(n===state.key) o.selected=true;
        keySel.appendChild(o);
      });

      // Populate Scale
      Object.keys(SCALE_INTERVALS).forEach(s=>{
        const o=document.createElement("option");
        o.value=s; o.textContent=s;
        if(s===state.scale) o.selected=true;
        scaleSel.appendChild(o);
      });

      keySel.addEventListener("change", ()=>{
        state.key = keySel.value || "C";
      });

      scaleSel.addEventListener("change", ()=>{
        state.scale = scaleSel.value || "Chromatic";
      });

      hum.addEventListener("input", ()=>{
        state.humanize = clamp(parseFloat(hum.value) || 0, 0, 1);
        if(uiEls.humanizeVal) uiEls.humanizeVal.textContent = Math.round(state.humanize*100) + "%";
      });

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
      if(typeof next.key === "string") state.key = next.key;
      if(typeof next.scale === "string") state.scale = next.scale;
      if(typeof next.humanize === "number") state.humanize = clamp(next.humanize, 0, 1);
      if(typeof next.retune === "number") state.retune = clamp(next.retune, 0.005, 0.5);
      if(typeof next.gateDb === "number") state.gateDb = Math.round(clamp(next.gateDb, -60, -10));
      if(typeof next.enabled === "boolean") state.enabled = next.enabled;

      // If UI is currently mounted, keep controls in sync
      try{
        const root = document;
        const keySel = root.querySelector("#fx_at_key");
        const scaleSel = root.querySelector("#fx_at_scale");
        const hum = root.querySelector("#fx_at_humanize");
        const humVal = root.querySelector("#fx_at_humanize_val");
        const ret = root.querySelector("#fx_at_retune");
        const retVal = root.querySelector("#fx_at_retune_val");
        const gateEl = root.querySelector("#fx_at_gate");
        const gateVal = root.querySelector("#fx_at_gate_val");
        const enEl = root.querySelector("#fx_at_en");

        if(keySel) keySel.value = state.key;
        if(scaleSel) scaleSel.value = state.scale;
        if(hum) hum.value = String(state.humanize);
        if(humVal) humVal.textContent = Math.round(state.humanize*100) + "%";
        if(ret) ret.value = String(state.retune);
        if(retVal) retVal.textContent = state.retune.toFixed(3) + "s";
        if(gateEl) gateEl.value = String(state.gateDb);
        if(gateVal) gateVal.textContent = state.gateDb + " dB";
        if(enEl) enEl.checked = !!state.enabled;
      }catch(e){}

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