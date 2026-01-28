// CanvasAudio Plugin Registry (simple, no build step)
(function(){
  const PLUGINS = [];

  // AutoTune plugin (from autotune.js): real-time pitch detection + correction (chromatic snap)
  // NOTE: This is "live" pitch correction, not offline rendering.
    // AutoTune plugin (simplified) inspired by common pitch-correction design:
  // 1) Track fundamental pitch in (near) real time
  // 2) Map to nearest note in selected Key/Scale with hysteresis (note tracking)
  // 3) Apply smoothed pitch-shift toward target (Retune) with optional Humanize on sustained notes
  //
  // NOTE: Antares Auto-Tune is proprietary. This implementation is an approximation using
  // Tone.PitchShift (which is known to be a simple shifter and can artifact on large shifts).
  function createAutoTune(trackCtx){
    const A4 = 440;

    const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const SCALE_INTERVALS = {
      "Chromatic": [0,1,2,3,4,5,6,7,8,9,10,11],
      "Major":     [0,2,4,5,7,9,11],
      "Minor":     [0,2,3,5,7,8,10],
      "Pentatonic Major": [0,2,4,7,9],
      "Pentatonic Minor": [0,3,5,7,10]
    };

    function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
    function freqToMidi(freq){ return 69 + 12 * Math.log2(freq / A4); }
    function midiToFreq(m){ return A4 * Math.pow(2, (m - 69) / 12); }
    function pc(m){ return ((m % 12) + 12) % 12; }

    function keyNameToPc(name){
      const i = NOTE_NAMES.indexOf(name);
      return i >= 0 ? i : 0;
    }

    function getNoteName(midi){
      const octave = Math.floor(midi / 12) - 1;
      const noteIndex = pc(midi);
      return NOTE_NAMES[noteIndex] + octave;
    }

    function buildAllowedPcSet(keyPc, intervals){
      const allowed = new Set();
      for(const iv of intervals) allowed.add((keyPc + iv) % 12);
      return allowed;
    }

    function nearestAllowedMidi(midiFloat, allowedPc){
      const base = Math.round(midiFloat);
      let best = base;
      let bestDist = Infinity;
      for(let delta=0; delta<=12; delta++){
        for(const cand of [base - delta, base + delta]){
          if(allowedPc.has(pc(cand))){
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

    // --- Pitch detection: YIN (time-domain), good robustness for monophonic vocals ---
    // Returns {freq, confidence} or {freq:-1, confidence:0}
    function yinDetect(signal, sampleRate, fmin=60, fmax=800){
      const N = signal.length;
      // Remove DC
      let mean = 0;
      for(let i=0;i<N;i++) mean += signal[i];
      mean /= N;
      const x = new Float32Array(N);
      for(let i=0;i<N;i++) x[i] = signal[i] - mean;

      // RMS gate
      let rms = 0;
      for(let i=0;i<N;i++){ const v=x[i]; rms += v*v; }
      rms = Math.sqrt(rms / N);
      if(rms < 0.008) return {freq:-1, confidence:0}; // ~-42 dBFS

      const tauMin = Math.floor(sampleRate / fmax);
      const tauMax = Math.floor(sampleRate / fmin);
      const maxTau = Math.min(tauMax, Math.floor(N/2)-1);
      if(maxTau <= tauMin+2) return {freq:-1, confidence:0};

      const d = new Float32Array(maxTau+1);
      // Difference function d(tau)
      for(let tau=1; tau<=maxTau; tau++){
        let sum = 0;
        for(let i=0; i< N - tau; i++){
          const diff = x[i] - x[i+tau];
          sum += diff*diff;
        }
        d[tau] = sum;
      }
      // Cumulative mean normalized difference function
      const cmnd = new Float32Array(maxTau+1);
      cmnd[0] = 1;
      let runningSum = 0;
      for(let tau=1; tau<=maxTau; tau++){
        runningSum += d[tau];
        cmnd[tau] = d[tau] * tau / (runningSum || 1);
      }

      // Absolute threshold
      const thresh = 0.15; // lower = stricter; 0.1-0.2 typical
      let tauEstimate = -1;
      for(let tau=tauMin; tau<=maxTau; tau++){
        if(cmnd[tau] < thresh){
          // find local minimum
          while(tau+1 <= maxTau && cmnd[tau+1] < cmnd[tau]) tau++;
          tauEstimate = tau;
          break;
        }
      }
      if(tauEstimate === -1) return {freq:-1, confidence:0};

      // Parabolic interpolation for better precision
      let betterTau = tauEstimate;
      if(tauEstimate > 1 && tauEstimate < maxTau){
        const s0 = cmnd[tauEstimate-1];
        const s1 = cmnd[tauEstimate];
        const s2 = cmnd[tauEstimate+1];
        const denom = (2*s1 - s2 - s0);
        if(Math.abs(denom) > 1e-9){
          betterTau = tauEstimate + (s2 - s0) / (2*denom);
        }
      }
      const freq = sampleRate / betterTau;
      const confidence = 1 - cmnd[tauEstimate];
      if(freq < fmin || freq > fmax) return {freq:-1, confidence:0};
      return {freq, confidence};
    }

    // --- Nodes ---
    const state = {
      key: "C",
      scale: "Chromatic",
      // Retune speed in seconds: smaller = faster/harder (Antares style)
      retune: 0.07,
      // Humanize 0..1: more humanize = gentler on sustained notes
      humanize: 0.0,
      gateDb: -30,
      enabled: true
    };

    const inputNode = new Tone.Gain(1);
    const gate = new Tone.Gate(state.gateDb, 0.2);

    // PitchShift artifacts are reduced if windowSize in 0.03..0.1 (Tone docs)
    const pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.08,
      delayTime: 0,
      feedback: 0
    });
    try{ pitchShift.wet.value = 1; }catch(e){}

    // Tap AFTER gate so silence doesn't confuse detection
    const analyser = new Tone.Analyser("waveform", 4096);

    inputNode.connect(gate);
    gate.connect(pitchShift);
    gate.connect(analyser);

    const outputNode = pitchShift;

    // --- Tracking + smoothing ---
    let running = false;
    let timerId = null;

    let lastFreq = -1;
    let lastMidi = null;

    let targetMidi = null;        // tracked target note (with hysteresis)
    let lockedSince = 0;          // ms timestamp when target locked
    let currentShift = 0;         // semitones
    let lastUpdateTs = 0;

    function setShiftSmooth(targetShift, dtSec){
      // Retune is "time to move most of the way" to target.
      const baseT = clamp(state.retune, 0.005, 0.5);

      // Humanize: only applies when holding the same target note for a bit
      const now = performance.now();
      const heldMs = targetMidi !== null ? (now - lockedSince) : 0;

      // If sustained note (>250ms), slow down correction by up to ~6x when humanize=1
      const human = clamp(state.humanize, 0, 1);
      const sustainFactor = (heldMs > 250) ? (1 + human * 5) : 1;

      const T = baseT * sustainFactor;
      const alpha = 1 - Math.exp(-dtSec / (T || 0.001));

      currentShift = currentShift + (targetShift - currentShift) * alpha;

      // Apply (best-effort across Tone versions)
      try{
        if(pitchShift.pitch && typeof pitchShift.pitch.rampTo === "function"){
          pitchShift.pitch.rampTo(currentShift, Math.min(0.05, T));
        }else if(typeof pitchShift.pitch === "number"){
          pitchShift.pitch = currentShift;
        }else if(pitchShift.pitch && typeof pitchShift.pitch === "object" && "value" in pitchShift.pitch){
          pitchShift.pitch.value = currentShift;
        }
      }catch(e){}
    }

    function update(){
      if(!running) return;
      const now = performance.now();
      const dtSec = lastUpdateTs ? ((now - lastUpdateTs)/1000) : 0.03;
      lastUpdateTs = now;

      try{
        const buf = analyser.getValue();
        const {freq, confidence} = yinDetect(buf, Tone.context.sampleRate);

        if(freq === -1 || confidence < 0.5){
          // No reliable pitch: decay correction toward 0 smoothly to avoid zipper noise
          setShiftSmooth(0, dtSec);
          lastFreq = -1;
          lastMidi = null;
          return;
        }

        // Median-ish smoothing: limit implausible jumps frame-to-frame
        if(lastFreq > 0){
          const ratio = freq / lastFreq;
          if(ratio > 1.35 || ratio < 0.74){
            // discard very large single-frame jumps (often octave errors)
            return;
          }
        }
        lastFreq = freq;

        const midiFloat = freqToMidi(freq);
        lastMidi = midiFloat;

        const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS["Chromatic"];
        const allowedPc = buildAllowedPcSet(keyNameToPc(state.key), intervals);

        // Hysteresis / note tracking:
        // If we already have a target note, keep it unless we move well past the midpoint
        // to a different allowed note. This prevents rapid toggling (clicks/pops).
        if(targetMidi === null){
          targetMidi = nearestAllowedMidi(midiFloat, allowedPc);
          lockedSince = now;
        }else{
          const near = nearestAllowedMidi(midiFloat, allowedPc);

          if(near !== targetMidi){
            // Midpoint test in semitones
            const mid = (near + targetMidi) / 2;
            const distToTarget = Math.abs(midiFloat - targetMidi);
            const distToNear = Math.abs(midiFloat - near);

            // Switch only if clearly closer to the new note AND we've crossed midpoint
            if(distToNear + 0.10 < distToTarget && ((targetMidi < near && midiFloat > mid) || (targetMidi > near && midiFloat < mid))){
              targetMidi = near;
              lockedSince = now;
            }
          }
        }

        let desiredShift = targetMidi - midiFloat;

        // Micro-correction deadband (keeps natural vibrato)
        const deadband = 0.08 + clamp(state.humanize, 0, 1) * 0.10; // semitones
        if(Math.abs(desiredShift) < deadband) desiredShift = 0;

        // Humanize also reduces overall correction strength a bit (more natural)
        const strength = 1 - clamp(state.humanize, 0, 1) * 0.45; // keep at least ~55%
        desiredShift *= strength;

        // Clamp extreme shifts (Tone.PitchShift artifacts explode on big intervals)
        desiredShift = clamp(desiredShift, -6, 6);

        if(state.enabled){
          setShiftSmooth(desiredShift, dtSec);
        }else{
          setShiftSmooth(0, dtSec);
        }
      }catch(e){}
    }

    function start(){
      if(running) return;
      running = true;
      lastFreq = -1;
      lastMidi = null;
      targetMidi = null;
      currentShift = 0;
      lockedSince = performance.now();
      lastUpdateTs = 0;
      // ~33 Hz update keeps CPU low and reduces zipper noise
      timerId = setInterval(update, 30);
    }

    function stop(){
      running = false;
      if(timerId){ clearInterval(timerId); timerId = null; }
      // reset correction smoothly
      try{
        if(pitchShift.pitch && typeof pitchShift.pitch.rampTo === "function"){
          pitchShift.pitch.rampTo(0, 0.05);
        }else if(typeof pitchShift.pitch === "number"){
          pitchShift.pitch = 0;
        }else if(pitchShift.pitch && typeof pitchShift.pitch === "object" && "value" in pitchShift.pitch){
          pitchShift.pitch.value = 0;
        }
      }catch(e){}
    }

    function getState(){
      return {
        key: state.key,
        scale: state.scale,
        retune: state.retune,
        humanize: state.humanize,
        gateDb: state.gateDb,
        enabled: state.enabled
      };
    }

    function setState(s){
      if(!s) return;
      if(typeof s.key === "string") state.key = s.key;
      if(typeof s.scale === "string") state.scale = s.scale;
      if(typeof s.retune === "number") state.retune = clamp(s.retune, 0.005, 0.5);
      if(typeof s.humanize === "number") state.humanize = clamp(s.humanize, 0, 1);
      if(typeof s.gateDb === "number") state.gateDb = s.gateDb;
      if(typeof s.enabled === "boolean") state.enabled = s.enabled;
      try{ gate.threshold.value = state.gateDb; }catch(e){}
    }

    function mountUI(container){
      container.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.className = "plugin-ui";

      const row1 = document.createElement("div");
      row1.style.display = "flex";
      row1.style.gap = "10px";
      row1.style.alignItems = "center";
      row1.style.flexWrap = "wrap";

      // Key selector
      const keyLabel = document.createElement("label");
      keyLabel.textContent = "Key";
      keyLabel.style.display = "flex";
      keyLabel.style.gap = "6px";
      keyLabel.style.alignItems = "center";

      const keySel = document.createElement("select");
      for(const n of NOTE_NAMES){
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = n;
        keySel.appendChild(opt);
      }
      keySel.value = state.key;
      keySel.onchange = () => { state.key = keySel.value; };

      keyLabel.appendChild(keySel);
      row1.appendChild(keyLabel);

      // Scale selector
      const scaleLabel = document.createElement("label");
      scaleLabel.textContent = "Scale";
      scaleLabel.style.display = "flex";
      scaleLabel.style.gap = "6px";
      scaleLabel.style.alignItems = "center";

      const scaleSel = document.createElement("select");
      for(const name of Object.keys(SCALE_INTERVALS)){
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        scaleSel.appendChild(opt);
      }
      scaleSel.value = state.scale;
      scaleSel.onchange = () => { state.scale = scaleSel.value; };

      scaleLabel.appendChild(scaleSel);
      row1.appendChild(scaleLabel);

      wrap.appendChild(row1);

      // Retune
      const retuneRow = document.createElement("div");
      retuneRow.style.marginTop = "10px";
      const retuneLbl = document.createElement("label");
      retuneLbl.textContent = "Retune";
      retuneLbl.style.display = "flex";
      retuneLbl.style.alignItems = "center";
      retuneLbl.style.gap = "8px";

      const retune = document.createElement("input");
      retune.type = "range";
      retune.min = "0.005";
      retune.max = "0.25";
      retune.step = "0.005";
      retune.value = String(state.retune);

      const retuneVal = document.createElement("span");
      retuneVal.textContent = state.retune.toFixed(3) + "s";

      retune.oninput = () => {
        state.retune = parseFloat(retune.value);
        retuneVal.textContent = state.retune.toFixed(3) + "s";
      };

      retuneLbl.appendChild(retune);
      retuneLbl.appendChild(retuneVal);
      retuneRow.appendChild(retuneLbl);
      wrap.appendChild(retuneRow);

      // Humanize
      const humRow = document.createElement("div");
      humRow.style.marginTop = "10px";
      const humLbl = document.createElement("label");
      humLbl.textContent = "Humanize";
      humLbl.style.display = "flex";
      humLbl.style.alignItems = "center";
      humLbl.style.gap = "8px";

      const hum = document.createElement("input");
      hum.type = "range";
      hum.min = "0";
      hum.max = "1";
      hum.step = "0.01";
      hum.value = String(state.humanize);

      const humVal = document.createElement("span");
      humVal.textContent = Math.round(state.humanize * 100) + "%";

      hum.oninput = () => {
        state.humanize = parseFloat(hum.value);
        humVal.textContent = Math.round(state.humanize * 100) + "%";
      };

      humLbl.appendChild(hum);
      humLbl.appendChild(humVal);
      humRow.appendChild(humLbl);
      wrap.appendChild(humRow);

      // Gate
      const gateRow = document.createElement("div");
      gateRow.style.marginTop = "10px";
      const gateLbl = document.createElement("label");
      gateLbl.textContent = "Gate";
      gateLbl.style.display = "flex";
      gateLbl.style.alignItems = "center";
      gateLbl.style.gap = "8px";

      const gateSlider = document.createElement("input");
      gateSlider.type = "range";
      gateSlider.min = "-60";
      gateSlider.max = "-10";
      gateSlider.step = "1";
      gateSlider.value = String(state.gateDb);

      const gateVal = document.createElement("span");
      gateVal.textContent = state.gateDb + " dB";

      gateSlider.oninput = () => {
        state.gateDb = parseInt(gateSlider.value, 10);
        gateVal.textContent = state.gateDb + " dB";
        try{ gate.threshold.value = state.gateDb; }catch(e){}
      };

      gateLbl.appendChild(gateSlider);
      gateLbl.appendChild(gateVal);
      gateRow.appendChild(gateLbl);
      wrap.appendChild(gateRow);

      // Enabled
      const enRow = document.createElement("div");
      enRow.style.marginTop = "10px";
      const en = document.createElement("input");
      en.type = "checkbox";
      en.checked = !!state.enabled;
      en.onchange = () => { state.enabled = en.checked; };

      const enLbl = document.createElement("label");
      enLbl.style.display = "flex";
      enLbl.style.alignItems = "center";
      enLbl.style.gap = "8px";
      enLbl.appendChild(en);
      enLbl.appendChild(document.createTextNode("Enabled"));
      enRow.appendChild(enLbl);
      wrap.appendChild(enRow);

      // Status (optional)
      const status = document.createElement("div");
      status.style.marginTop = "12px";
      status.style.opacity = "0.8";
      status.style.fontSize = "12px";
      status.textContent = "Note snap is monophonic; large pitch jumps are clamped to reduce artifacts.";
      wrap.appendChild(status);

      container.appendChild(wrap);

      // Ensure UI reflects restored state
      keySel.value = state.key;
      scaleSel.value = state.scale;
      retune.value = String(state.retune);
      retuneVal.textContent = state.retune.toFixed(3) + "s";
      hum.value = String(state.humanize);
      humVal.textContent = Math.round(state.humanize * 100) + "%";
      gateSlider.value = String(state.gateDb);
      gateVal.textContent = state.gateDb + " dB";
      en.checked = !!state.enabled;
    }

    return {
      id: "autotune",
      name: "AutoTune",
      input: inputNode,
      output: outputNode,
      start,
      stop,
      getState,
      setState,
      mountUI,
      dispose(){
        stop();
        try{ inputNode.disconnect(); }catch(e){}
        try{ gate.disconnect(); }catch(e){}
        try{ pitchShift.disconnect(); }catch(e){}
        try{ analyser.dispose(); }catch(e){}
        try{ inputNode.dispose(); }catch(e){}
        try{ gate.dispose(); }catch(e){}
        try{ pitchShift.dispose(); }catch(e){}
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