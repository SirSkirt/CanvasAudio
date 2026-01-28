// CanvasAudio Plugin Registry (simple, no build step)
(function(){
  const PLUGINS = [];

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  // NOTE: This is a deliberately simplified "AutoTune" effect:
  // - Uses Tone.PitchShift (constant semitone shift) with optional smoothing.
  // - Key/scale controls are UI-only for now (future quantization can use these).
  function createAutoTuneLite(trackCtx){
    const node = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0, wet: 1.0 });
    const state = {
      id: "autotune",
      name: "AutoTune (Lite)",
      key: "C",
      scale: "major",
      retune: 0.15,
      flex: 0.0,
      humanize: 0.0,
      semitones: 0
    };

    // Tone.PitchShift.pitch is a plain number in many Tone.js builds.
    // To support a "retune" feel without relying on AudioParam ramps,
    // we implement a small JS ramp that updates node.pitch over time.
    let _rampTimer = null;
    let _rampStartT = 0;
    let _rampFrom = 0;
    let _rampTo = 0;
    function stopRamp(){
      if(_rampTimer){
        clearInterval(_rampTimer);
        _rampTimer = null;
      }
    }
    function startRamp(from, to, seconds){
      stopRamp();
      _rampStartT = performance.now();
      _rampFrom = from;
      _rampTo = to;
      const durMs = Math.max(10, (seconds || 0.15) * 1000);
      _rampTimer = setInterval(()=>{
        const t = (performance.now() - _rampStartT) / durMs;
        if(t >= 1){
          node.pitch = _rampTo;
          stopRamp();
          return;
        }
        node.pitch = _rampFrom + (_rampTo - _rampFrom) * t;
      }, 33); // ~30fps is enough for audible smoothing
    }

    function setSemitones(semi){
      state.semitones = semi;

      // Always set the underlying effect parameter.
      // Use a simple JS ramp to approximate retune smoothing.
      const target = semi;
      const cur = (typeof node.pitch === "number") ? node.pitch : (parseFloat(node.pitch) || 0);
      const rt = clamp(state.retune, 0.01, 2.0);
      if(rt <= 0.02){
        stopRamp();
        node.pitch = target;
      }else{
        startRamp(cur, target, rt);
      }
    }

    
    function setState(next){
      if(!next) return;
      if(typeof next.key === "string") state.key = next.key;
      if(typeof next.scale === "string") state.scale = next.scale;
      if(typeof next.retune === "number") state.retune = clamp(next.retune, 0.01, 2.0);
      if(typeof next.flex === "number") state.flex = clamp(next.flex, 0.0, 1.0);
      if(typeof next.humanize === "number") state.humanize = clamp(next.humanize, 0.0, 1.0);
      if(typeof next.semitones === "number") state.semitones = Math.round(clamp(next.semitones, -12, 12));
      setSemitones(state.semitones);
    }

function mountUI(container){
      container.innerHTML = "";

      const title = document.createElement("div");
      title.className = "fxwin-title";
      title.textContent = "AutoTune (Lite)";
      container.appendChild(title);

      const row1 = document.createElement("div");
      row1.className = "fxwin-row";
      row1.innerHTML = `
        <label>Key</label>
        <select id="fx_at_key">
          ${["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"].map(n=>`<option value="${n}">${n}</option>`).join("")}
        </select>
        <label style="margin-left:12px;">Scale</label>
        <select id="fx_at_scale">
          <option value="major">Major</option>
          <option value="minor">Minor</option>
        </select>
      `;
      container.appendChild(row1);

      const row2 = document.createElement("div");
      row2.className = "fxwin-row";
      row2.innerHTML = `
        <label>Semitones</label>
        <input id="fx_at_semi" type="range" min="-12" max="12" step="1" value="0"/>
        <span id="fx_at_semi_val" class="fxwin-value">0</span>
      `;
      container.appendChild(row2);

      const row3 = document.createElement("div");
      row3.className = "fxwin-row";
      row3.innerHTML = `
        <label>Retune</label>
        <input id="fx_at_retune" type="range" min="0.01" max="1.0" step="0.01" value="0.15"/>
        <span id="fx_at_retune_val" class="fxwin-value">0.15s</span>
      `;
      container.appendChild(row3);

      const row4 = document.createElement("div");
      row4.className = "fxwin-row fxwin-note";
      row4.textContent = "Note: This is a simplified pitch shifter. Key/Scale controls are reserved for future note-quantized tuning.";
      container.appendChild(row4);

      const keyEl = container.querySelector("#fx_at_key");
      const scaleEl = container.querySelector("#fx_at_scale");
      const semiEl = container.querySelector("#fx_at_semi");
      const semiVal = container.querySelector("#fx_at_semi_val");
      const retEl = container.querySelector("#fx_at_retune");
      const retVal = container.querySelector("#fx_at_retune_val");

      keyEl.value = state.key;
      scaleEl.value = state.scale;
      semiEl.value = String(state.semitones);
      semiVal.textContent = String(state.semitones);
      retEl.value = String(state.retune);
      retVal.textContent = state.retune.toFixed(2) + "s";

      keyEl.addEventListener("change", ()=>{ state.key = keyEl.value; });
      scaleEl.addEventListener("change", ()=>{ state.scale = scaleEl.value; });

      semiEl.addEventListener("input", ()=>{
        const v = parseInt(semiEl.value,10) || 0;
        semiVal.textContent = String(v);
        setSemitones(v);
      });

      retEl.addEventListener("input", ()=>{
        const v = parseFloat(retEl.value) || 0.15;
        state.retune = v;
        retVal.textContent = v.toFixed(2) + "s";
      });

      // Initialize
      setSemitones(state.semitones);
    }

    return {
      id: state.id,
      name: state.name,
      node,
      mountUI,
      getState: ()=>({ ...state }),
      setState: (s)=>{ setState(s); },
      setEnabled: (on)=>{ try{ node.wet.value = on ? 1.0 : 0.0; }catch(e){} },
      dispose: ()=>{ stopRamp(); try{ node.dispose(); }catch(e){} }
    };
  }

  PLUGINS.push({
    id: "autotune",
    name: "AutoTune (Lite)",
    create: createAutoTuneLite
  });

  window.CA_PLUGINS = PLUGINS;
})();
