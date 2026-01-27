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

    function setSemitones(semi){
      state.semitones = semi;
      // Smooth changes using a tiny ramp (retune)
      try{
        const now = Tone.now();
        node.pitch.cancelAndHoldAtTime(now);
        node.pitch.linearRampToValueAtTime(semi, now + clamp(state.retune, 0.01, 2.0));
      }catch(e){
        node.pitch.value = semi;
      }
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
      setEnabled: (on)=>{ node.wet.value = on ? 1.0 : 0.0; }
    };
  }

  PLUGINS.push({
    id: "autotune",
    name: "AutoTune (Lite)",
    create: createAutoTuneLite,
    // Back-compat with canvasaudio.js which expects createUI(inst, mount)
    createUI: (inst, mount) => {
      if (inst && typeof inst.mountUI === "function") inst.mountUI(mount);
    }
  });

  window.CA_PLUGINS = PLUGINS;
})();
