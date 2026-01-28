/**
 * CanvasAudio Plugin Registry
 * v0.5.1 - Preserving Autotune Logic
 */

(function(){
  // 1. Initialize the Global Registry Object
  window.CA_PLUGINS = window.CA_PLUGINS || {};

  // --- AUTOTUNE FACTORY (YOUR ORIGINAL CODE) ---
  function createAutoTune(){
    const A4 = 440;
    const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    
    // Standard Intervals
    const SCALE_INTERVALS = {
      "Chromatic": [0,1,2,3,4,5,6,7,8,9,10,11],
      "Major":     [0,2,4,5,7,9,11],
      "Minor":     [0,2,3,5,7,8,10],
      "Pentatonic": [0,2,4,7,9]
    };

    // --- Helpers ---
    function freqToMidi(freq){ return 69 + 12 * Math.log2(freq / A4); }
    // function midiToFreq(m){ return A4 * Math.pow(2, (m - 69) / 12); } // Unused
    function pc(m){ return ((m % 12) + 12) % 12; } // Pitch Class (0-11)
    
    function keyNameToPc(name){
      const i = NOTE_NAMES.indexOf(name);
      return i >= 0 ? i : 0;
    }

    function buildAllowedPcSet(keyPc, intervals){
      const allowed = new Set();
      for(const iv of intervals) allowed.add((keyPc + iv) % 12);
      return allowed;
    }

    // Find nearest allowed note, preferring the current octave
    function nearestAllowedMidi(midiFloat, allowedPc){
      const base = Math.round(midiFloat);
      let best = base;
      let bestDist = Infinity;
      
      // Check neighbors
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

    // --- YIN Pitch Detection (Robust) ---
    function yinDetect(signal, sampleRate){
      const N = signal.length;
      let rms = 0;
      for(let i=0;i<N;i++) rms += signal[i]*signal[i];
      rms = Math.sqrt(rms/N);
      
      if(rms < 0.01) return {freq: -1, confidence: 0}; // Noise Gate

      // Simplified Autocorrelation
      let bestOffset = -1;
      let bestCorrelation = 0;
      
      const minLag = Math.floor(sampleRate / 1000);
      const maxLag = Math.floor(sampleRate / 80);

      for(let lag = minLag; lag < maxLag; lag++) {
          let sum = 0;
          for(let i = 0; i < N - lag; i++) {
              sum += signal[i] * signal[i+lag];
          }
          const correlation = sum / N; 
          if(correlation > bestCorrelation) {
              bestCorrelation = correlation;
              bestOffset = lag;
          }
      }

      if(bestCorrelation < 0.001) return {freq: -1, confidence: 0};
      return { freq: sampleRate / bestOffset, confidence: bestCorrelation };
    }

    // --- Audio Graph ---
    // We use Tone.Gain to ensure compatibility with standard connections
    const inputNode = new Tone.Gain(1);
    const outputNode = new Tone.Gain(1);
    
    const pitchShifter = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.1, 
      delayTime: 0,
      feedback: 0
    });

    const analyser = new Tone.Analyser("waveform", 1024);

    inputNode.connect(pitchShifter);
    pitchShifter.connect(outputNode);
    inputNode.connect(analyser); 

    // --- State ---
    const state = {
      key: "C",
      scale: "Chromatic",
      retune: 0.1, 
      enabled: true
    };

    let running = false;
    let timerId = null;
    let targetMidi = null;

    // --- Loop ---
    function update(){
      if(!state.enabled) return;

      const buffer = analyser.getValue();
      const { freq, confidence } = yinDetect(buffer, Tone.context.sampleRate);

      if(freq <= 0 || confidence < 0.05) {
        pitchShifter.pitch.rampTo(0, 0.2);
        return;
      }

      const midiFloat = freqToMidi(freq);
      const keyPc = keyNameToPc(state.key);
      const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS["Chromatic"];
      const allowed = buildAllowedPcSet(keyPc, intervals);
      let nearest = nearestAllowedMidi(midiFloat, allowed);

      if(targetMidi !== null && Math.abs(nearest - targetMidi) > 0 && Math.abs(midiFloat - targetMidi) < 0.4) {
          nearest = targetMidi;
      }
      targetMidi = nearest;

      let shift = nearest - midiFloat;
      if(shift > 12) shift = 12;
      if(shift < -12) shift = -12;

      pitchShifter.pitch.rampTo(shift, state.retune); 
    }

    function start(){
      if(running) return;
      running = true;
      timerId = setInterval(update, 30);
    }

    function stop(){
      running = false;
      if(timerId) clearInterval(timerId);
      pitchShifter.pitch.rampTo(0, 0.1);
    }

    start();

    // RETURN THE ADVANCED OBJECT
    return {
      name: "AutoTune",
      input: inputNode,
      output: outputNode,
      start,
      stop,
      setState: (s) => Object.assign(state, s),
      getState: () => ({...state}),
      mountUI: (container) => {
        container.innerHTML = '';
        const style = "margin-bottom:10px; display:flex; align-items:center; gap:10px; font-size:12px; color:#ccc;";
        
        // Key / Scale UI
        const row1 = document.createElement('div');
        row1.style.cssText = style;
        
        const kSel = document.createElement('select');
        NOTE_NAMES.forEach(n => {
            const o = document.createElement('option');
            o.value=n; o.textContent=n; 
            kSel.appendChild(o);
        });
        kSel.value = state.key;
        kSel.onchange = (e) => state.key = e.target.value;

        const sSel = document.createElement('select');
        Object.keys(SCALE_INTERVALS).forEach(k => {
            const o = document.createElement('option');
            o.value=k; o.textContent=k;
            sSel.appendChild(o);
        });
        sSel.value = state.scale;
        sSel.onchange = (e) => state.scale = e.target.value;

        row1.append("Key:", kSel, "Scale:", sSel);
        container.appendChild(row1);

        // Speed UI
        const row2 = document.createElement('div');
        row2.style.cssText = style;
        
        const spd = document.createElement('input');
        spd.type = 'range'; spd.min = '0.01'; spd.max = '0.4'; spd.step = '0.01';
        spd.value = state.retune;
        
        const lbl = document.createElement('span');
        lbl.textContent = Math.round(state.retune * 1000) + 'ms';
        
        spd.oninput = (e) => {
            state.retune = parseFloat(e.target.value);
            lbl.textContent = Math.round(state.retune * 1000) + 'ms';
        };

        row2.append("Speed:", spd, lbl);
        container.appendChild(row2);
      },
      dispose: () => {
        stop();
        inputNode.dispose();
        outputNode.dispose();
        pitchShifter.dispose();
        analyser.dispose();
      }
    };
  }

  // 2. REGISTER PLUGINS (The Fix)
  window.CA_PLUGINS['Autotune'] = {
      name: "Autotune",
      create: createAutoTune
  };

  // Bonus Reverb (Simple)
  window.CA_PLUGINS['Reverb'] = {
      name: "Reverb",
      create: () => { 
          const r = new Tone.Reverb({ decay: 2, wet: 0.5 });
          return { input: r, output: r, name: "Reverb" }; // Wrapper for consistency
      }
  };

})();
