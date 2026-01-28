[cite_start][cite: 5] // CanvasAudio Plugin Registry (simple, no build step)
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
      // Retune speed in seconds: smaller = faster/harder
      retune: 0.05, 
      humanize: 0.0,
      gateDb: -40, // Lowered default threshold to prevent cutting off quiet tails
      enabled: true
    };

    const inputNode = new Tone.Gain(1);
    const gate = new Tone.Gate(state.gateDb, 0.1); 

    // Tone.PitchShift: Increased windowSize to 0.1 to reduce "grainy" popping artifacts
    const pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.1, 
      delayTime: 0,
      feedback: 0
    });

    // Analyzer for detection
    const analyser = new Tone.Analyser("waveform", 2048); // Smaller buffer for faster reaction

    // Routing
    inputNode.connect(gate);
    gate.connect(pitchShift);
    
    // Analyze the raw input (pre-shift) for better tracking
    inputNode.connect(analyser);

    const outputNode = pitchShift;

    // --- Tracking variables ---
    let running = false;
    let timerId = null;
    let targetMidi = null;       
    let currentShift = 0;         

    // The update loop now runs at a fixed, reasonable rate (30ms ~ 33Hz)
    // We let the Tone.rampTo handle the smoothing between updates.
    const UPDATE_RATE_MS = 30;

    function update(){
      if(!running || !state.enabled) return;

      try{
        const buf = analyser.getValue();
        // Use current context sample rate
        const {freq, confidence} = yinDetect(buf, Tone.context.sampleRate);

        // If no confident pitch found, relax pitch shift back to 0
        if(freq === -1 || confidence < 0.4){ 
           // Slow relaxation to neutral to avoid drop-out pops
           pitchShift.pitch.rampTo(0, 0.2);
           targetMidi = null;
           return;
        }

        const midiFloat = freqToMidi(freq);
        const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS["Chromatic"];
        const allowedPc = buildAllowedPcSet(keyNameToPc(state.key), intervals);

        // Hysteresis: Don't switch target note until we are significantly closer to a new one
        // This prevents "flickering" between two semitones
        let newTarget = nearestAllowedMidi(midiFloat, allowedPc);
        
        if (targetMidi !== null && newTarget !== targetMidi) {
             // Only switch if we are clearly closer to the new target (0.4 semitone buffer)
             if (Math.abs(midiFloat - newTarget) > Math.abs(midiFloat - targetMidi) - 0.2) {
                 newTarget = targetMidi; // Stick to old note
             }
        }
        targetMidi = newTarget;

        // Calculate shift
        let desiredShift = targetMidi - midiFloat;

        // Clamp extreme shifts to avoid massive glitches (Tone.PitchShift limitation)
        if (desiredShift > 12) desiredShift = 12;
        if (desiredShift < -12) desiredShift = -12;

        // Apply shift with smoothing (Retune Speed)
        // We use the retune speed as the ramp time. 
        // 0.01s = Robotic, 0.2s = Natural
        const rampTime = Math.max(0.01, state.retune);
        pitchShift.pitch.rampTo(desiredShift, rampTime);

      }catch(e){
        console.warn("Autotune error", e);
      }
    }

    function start(){
      if(running) return;
      running = true;
      // Fixed update rate prevents "stuttering" caused by varying timer intervals
      timerId = setInterval(update, UPDATE_RATE_MS);
    }

    function stop(){
      running = false;
      if(timerId){ clearInterval(timerId); timerId = null; }
      try{
        pitchShift.pitch.rampTo(0, 0.1);
      }catch(e){}
    }

    function getState(){
      return { ...state };
    }

    function setState(s){
      if(!s) return;
      if(typeof s.key === "string") state.key = s.key;
      if(typeof s.scale === "string") state.scale = s.scale;
      if(typeof s.retune === "number") state.retune = clamp(s.retune, 0.01, 0.4);
      if(typeof s.gateDb === "number") {
          state.gateDb = s.gateDb;
          try{ gate.threshold.value = state.gateDb; }catch(e){}
      }
      if(typeof s.enabled === "boolean") state.enabled = s.enabled;
    }

    function mountUI(container){
      container.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "plugin-ui";

      // Helper to create rows
      const createRow = () => {
          const r = document.createElement("div");
          r.style.cssText = "display:flex; gap:10px; align-items:center; margin-bottom:10px;";
          return r;
      };

      // 1. Key & Scale
      const row1 = createRow();
      
      const keySel = document.createElement("select");
      NOTE_NAMES.forEach(n => {
          const opt = document.createElement("option");
          opt.value = n; opt.textContent = n;
          keySel.appendChild(opt);
      });
      keySel.value = state.key;
      keySel.onchange = () => { state.key = keySel.value; };
      
      const scaleSel = document.createElement("select");
      Object.keys(SCALE_INTERVALS).forEach(n => {
          const opt = document.createElement("option");
          opt.value = n; opt.textContent = n;
          scaleSel.appendChild(opt);
      });
      scaleSel.value = state.scale;
      scaleSel.onchange = () => { state.scale = scaleSel.value; };

      row1.appendChild(document.createTextNode("Key:"));
      row1.appendChild(keySel);
      row1.appendChild(document.createTextNode("Scale:"));
      row1.appendChild(scaleSel);
      wrap.appendChild(row1);

      // 2. Retune Speed
      const row2 = createRow();
      const spdInput = document.createElement("input");
      spdInput.type = "range"; spdInput.min = "0.01"; spdInput.max = "0.4"; spdInput.step = "0.01";
      spdInput.value = state.retune;
      const spdLabel = document.createElement("span");
      spdLabel.textContent = (state.retune * 1000).toFixed(0) + " ms";
      
      spdInput.oninput = () => {
          state.retune = parseFloat(spdInput.value);
          spdLabel.textContent = (state.retune * 1000).toFixed(0) + " ms";
      };

      row2.appendChild(document.createTextNode("Speed:"));
      row2.appendChild(spdInput);
      row2.appendChild(spdLabel);
      wrap.appendChild(row2);

      // 3. Status Text
      const status = document.createElement("div");
      status.style.cssText = "font-size:11px; color:#888; margin-top:15px;";
      status.innerHTML = "Low speed = Robotic effect.<br>High speed = Natural correction.";
      wrap.appendChild(status);

      container.appendChild(wrap);
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
        inputNode.dispose();
        gate.dispose();
        pitchShift.dispose();
        analyser.dispose();
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
