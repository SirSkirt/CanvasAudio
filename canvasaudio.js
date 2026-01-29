/**
 * CanvasAudio Main Logic
 * v0.5.5 - Audio Playback Hardening
 */

const APP_STAGE = "Alpha";
const APP_VERSION = "0.5.5";
window.CA_VERSION = APP_VERSION;

const instruments = [
    { name: "Kick", note: "C1" }, 
    { name: "Snare", note: "D1" }, 
    { name: "HiHat", note: "E1" },
    { name: "Clap", note: "F1" }
];

let state = {
    audioReady: false,
    isPlaying: false,
    mode: 'PATTERN',
    bpm: 128,
    currentStep: 0,
    timeSig: 4, 
    
    armedTrack: 0,
    isRecording: false,
    mediaStream: null,
    mediaRecorder: null,
    recordingClipId: null,

    trackInputDeviceIds: Array(8).fill(null),
    trackFxSlots: Array.from({length: 8}, () => Array(10).fill(null)),
    trackFxSlotEnabled: Array.from({length: 8}, () => Array(10).fill(true)),
    
    patterns: { 'pat1': { id:'pat1', name: "Pattern 1", grid: createEmptyGrid(4) } },
    audioClips: {}, 
    playlist: [],
    
    selectedResType: 'pattern',
    selectedResId: 'pat1',
    playheadStep: 0,

    selectedClip: null, 
    clipboard: null, 
    
    mixer: {
        trackNames: Array.from({length:8}, (_,i)=>`Track ${i+1}`),
        volumes: Array(8).fill(1),
        pans: Array(8).fill(0),
        mutes: Array(8).fill(false),
        solos: Array(8).fill(false)
    }
};

if(state.playlist.length === 0) for(let i=0; i<8; i++) state.playlist.push([]);

// AUDIO ENGINE
const drumSamples = new Tone.Players({
    "Kick": "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
    "Snare": "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
}).toDestination();

const hatSynth = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.1, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).toDestination(); hatSynth.volume.value = -15;
const clapSynth = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0 } }).toDestination(); clapSynth.volume.value = -10;
let activeSources = [];

// --- SAFE PLAY FUNCTIONS ---
function safePlayDrum(name, time) {
    if(!drumSamples) return;
    try {
        if(drumSamples.has(name)) drumSamples.player(name).start(time);
    } catch(e) {}
}

function playAudioClip(id, time, trackIndex, rawOffset) {
    const clipData = state.audioClips[id];
    if(!clipData || !clipData.buffer) return;

    // 1. Validate Offset (The Crash Fix)
    let offset = rawOffset || 0;
    if (offset < 0) offset = 0;
    if (offset >= clipData.buffer.duration) return; // Don't play if we are past the end

    const ctx = Tone.context.rawContext;
    const src = ctx.createBufferSource();
    src.buffer = clipData.buffer;
    
    const t = ensureTrackAudio(trackIndex);
    src.connect(t.input);

    // 2. Wrap in robust Try/Catch to prevent "Script Error" crash
    try { 
        // We calculate duration to ensure we don't play past buffer end
        const duration = clipData.buffer.duration - offset;
        src.start(time, offset, duration); 
    } catch(e) { 
        console.error("Audio Playback Error:", e);
    }

    activeSources.push(src);
    src.onended = () => { 
        const i = activeSources.indexOf(src); 
        if(i>-1) activeSources.splice(i,1); 
    };
}

// --- UI CONTROL FUNCTIONS ---
function setMode(m) {
    state.mode = m;
    document.getElementById('mode-pat').className = m === 'PATTERN' ? 'active' : '';
    document.getElementById('mode-song').className = m === 'SONG' ? 'active' : '';
    stopTransport();
}

function updateBPM(val) {
    state.bpm = parseInt(val);
    Tone.Transport.bpm.value = state.bpm;
}

function updateTimeSig(val) {
    state.timeSig = parseInt(val);
    Tone.Transport.timeSignature = state.timeSig;
}

function clearCurrentPattern() {
    if (!state.selectedResId || !state.patterns[state.selectedResId]) return;
    state.patterns[state.selectedResId].grid = createEmptyGrid(4);
    renderChannelRack();
}


// --- EDIT TOOLS ---
function editTool(action) {
    if (action === 'paste') { pasteClipAtPlayhead(); return; }
    if (!state.selectedClip) { alert("Please select a clip first."); return; }
    const { trackIndex, clipIndex } = state.selectedClip;
    const track = state.playlist[trackIndex];
    if (!track || !track[clipIndex]) return;
    const clip = track[clipIndex];

    switch (action) {
        case 'select': break;
        case 'delete': track.splice(clipIndex, 1); state.selectedClip = null; renderPlaylist(); break;
        case 'mute': clip.muted = !clip.muted; renderPlaylist(); break;
        case 'split': splitClipAtPlayhead(trackIndex, clipIndex); break;
        case 'copy': state.clipboard = JSON.parse(JSON.stringify(clip)); console.log("Copied"); break;
        case 'trimStart': trimClipStart(trackIndex, clipIndex); break;
        case 'trimEnd': trimClipEnd(trackIndex, clipIndex); break;
    }
}

function splitClipAtPlayhead(trackIndex, clipIndex) {
    const track = state.playlist[trackIndex];
    const clip = track[clipIndex];
    const playheadBar = state.currentStep / 16;
    if (playheadBar > clip.startBar && playheadBar < (clip.startBar + clip.lengthBars)) {
        const firstLen = playheadBar - clip.startBar;
        const secondLen = clip.lengthBars - firstLen;
        clip.lengthBars = firstLen;
        const newClip = JSON.parse(JSON.stringify(clip));
        newClip.startBar = playheadBar;
        newClip.lengthBars = secondLen;
        if(newClip.type === 'audio') newClip.offset = (newClip.offset || 0) + (firstLen * (60/state.bpm * state.timeSig));
        track.push(newClip);
        state.selectedClip = null; 
        renderPlaylist();
    }
}

function trimClipEnd(trackIndex, clipIndex) {
    const clip = state.playlist[trackIndex][clipIndex];
    const playheadBar = state.currentStep / 16;
    if (playheadBar > clip.startBar && playheadBar < (clip.startBar + clip.lengthBars)) {
        clip.lengthBars = playheadBar - clip.startBar;
        renderPlaylist();
    }
}

function trimClipStart(trackIndex, clipIndex) {
    const clip = state.playlist[trackIndex][clipIndex];
    const playheadBar = state.currentStep / 16;
    if (playheadBar > clip.startBar && playheadBar < (clip.startBar + clip.lengthBars)) {
        const diff = playheadBar - clip.startBar;
        clip.startBar = playheadBar;
        clip.lengthBars -= diff;
        if(clip.type === 'audio') clip.offset = (clip.offset || 0) + (diff * (60/state.bpm * state.timeSig));
        renderPlaylist();
    }
}

function pasteClipAtPlayhead() {
    if (!state.clipboard) return;
    const playheadBar = state.currentStep / 16;
    const trackIndex = state.selectedClip ? state.selectedClip.trackIndex : 0; 
    const newClip = JSON.parse(JSON.stringify(state.clipboard));
    newClip.startBar = playheadBar;
    state.playlist[trackIndex].push(newClip);
    renderPlaylist();
}

// --- ENVIRONMENT DETECTION ---
function checkEnvironment() {
    const isElectron = typeof process !== 'undefined' && process.versions && process.versions.electron;
    const titleBar = document.getElementById('title-bar');
    const banner = document.getElementById('standalone-banner');
    const audioPanel = document.getElementById('audioStatusPanel');

    if (isElectron) {
        console.log("Running in Standalone Mode");
        if(titleBar) titleBar.style.display = 'flex';
        if(banner) banner.style.display = 'none';
        if(audioPanel) audioPanel.style.display = 'none'; // Auto-start audio
        
        setTimeout(() => {
            if(Tone.context.state !== 'running') {
                Tone.start().then(() => { console.log("Audio Engine Auto-Started"); state.audioReady = true; });
            }
        }, 100);

        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            document.getElementById('btn-min')?.addEventListener('click', () => ipcRenderer.send('app/minimize'));
            document.getElementById('btn-max')?.addEventListener('click', () => ipcRenderer.send('app/maximize'));
            document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('app/close'));
        }
    } else {
        console.log("Running in Browser Mode");
        if(titleBar) titleBar.style.display = 'none';
        if(banner) banner.style.display = 'none'; 
    }
}

function init() {
    const vEl = document.getElementById('version-label');
    if (vEl) vEl.textContent = `${APP_STAGE} Version ${APP_VERSION}`;
    
    checkEnvironment();
    if(!loadProjectFromStorage()) {}
    generateRuler();
    renderResources();
    renderPlaylist();
    renderChannelRack();
    renderMixerUI(); 
    selectResource('pattern', 'pat1');
    Tone.Transport.bpm.value = state.bpm;
    setupAudioStatusPanel();
    setupPlayheadScrub();
    setupMainMenu();
    setVersionLabel();
}

function setupAudioStatusPanel(){
    const btn = document.getElementById('audioToggleBtn');
    const text = document.getElementById('audioStatusText');
    const updateUI = () => {
        const ready = (Tone.context && Tone.context.state === 'running');
        state.audioReady = ready;
        if(text) text.innerText = ready ? "Audio Ready" : "Audio Not Ready";
        if(btn) btn.innerText = ready ? "Stop" : "Start";
        if(ready) btn?.classList.add('active'); else btn?.classList.remove('active');
    };
    if(btn){
        btn.onclick = async () => {
            if(state.audioReady) {
                if(Tone.Transport.state === 'started') stopTransport();
                await Tone.context.suspend();
            } else { await Tone.start(); }
            updateUI();
        };
    }
    updateUI();
}

function setupPlayheadScrub(){
    const scroll = document.getElementById('playlist-scroll');
    if(!scroll) return;
    scroll.addEventListener('mousedown', (e)=>{
        if(state.mode !== 'SONG') return;
        if(e.target.classList.contains('clip') || e.target.closest('.clip')) return;
        const rect = scroll.getBoundingClientRect();
        const x = (e.clientX - rect.left) + scroll.scrollLeft;
        const step = Math.round((x - 120) / 3.75);
        state.playheadStep = Math.max(0, step);
        state.currentStep = state.playheadStep;
        const ph = document.getElementById('playhead');
        if(ph) ph.style.left = (120 + (state.playheadStep * 3.75)) + 'px';
    });
}

function setupMainMenu(){
    const overlay = document.getElementById('mainMenuOverlay');
    if(!overlay) return;
    const close = () => overlay.style.display = 'none';
    document.getElementById('menuNewProject')?.addEventListener('click', close);
    document.getElementById('menuOpenProject')?.addEventListener('click', close);
    document.getElementById('menuRecentProject')?.addEventListener('click', close);
}

function setVersionLabel(){
    const el = document.getElementById('version-label');
    if(el) el.innerText = `${APP_STAGE} v${APP_VERSION}`;
}

function openMixerWindow(){
    const ov = document.getElementById('mixerOverlay');
    if(ov) { ov.style.display = 'flex'; renderMixerUI(); }
}
function closeMixerWindow(){
    const ov = document.getElementById('mixerOverlay');
    if(ov) ov.style.display = 'none';
}

function renderMixerUI(){
    const body = document.getElementById('mixerBody');
    if(!body) return;
    body.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'mixer-grid';
    for(let i=0; i<8; i++){
        const strip = document.createElement('div');
        strip.className = 'mixer-strip';
        const title = document.createElement('div');
        title.className = 'strip-title';
        title.textContent = state.mixer.trackNames[i] || `Track ${i+1}`;
        strip.appendChild(title);
        const btns = document.createElement('div');
        btns.className = 'strip-btns';
        const mBtn = document.createElement('button');
        mBtn.className = 'strip-btn' + (state.mixer.mutes[i] ? ' active' : '');
        mBtn.textContent = 'M';
        mBtn.onclick = () => { state.mixer.mutes[i] = !state.mixer.mutes[i]; applyMixerToAudio(i); renderMixerUI(); };
        const sBtn = document.createElement('button');
        sBtn.className = 'strip-btn' + (state.mixer.solos[i] ? ' active' : '');
        sBtn.textContent = 'S';
        sBtn.onclick = () => { state.mixer.solos[i] = !state.mixer.solos[i]; applyMixerToAudio(i); renderMixerUI(); };
        btns.append(mBtn, sBtn);
        strip.appendChild(btns);
        const meter = document.createElement('div');
        meter.className = 'vert-meter';
        const fill = document.createElement('div');
        fill.className = 'meter-fill';
        fill.style.height = (state.mixer.volumes[i] * 100) + '%'; 
        meter.appendChild(fill);
        const vol = document.createElement('input');
        vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
        vol.value = state.mixer.volumes[i];
        vol.oninput = (e) => { state.mixer.volumes[i] = parseFloat(e.target.value); fill.style.height = (state.mixer.volumes[i]*100)+'%'; applyMixerToAudio(i); };
        meter.appendChild(vol);
        strip.appendChild(meter);
        grid.appendChild(strip);
    }
    body.appendChild(grid);
}

function ensureTrackAudio(trackIndex){
    state._audioTracks = state._audioTracks || Array(8).fill(null);
    if(state._audioTracks[trackIndex]) return state._audioTracks[trackIndex];
    const input = new Tone.Gain(1);
    const pan = new Tone.Panner(0);
    const vol = new Tone.Gain(1);
    input.connect(pan);
    pan.connect(vol);
    vol.toDestination();
    const track = { input, pan, vol };
    state._audioTracks[trackIndex] = track;
    applyMixerToAudio(trackIndex);
    return track;
}

function applyMixerToAudio(trackIndex){
    const t = state._audioTracks?.[trackIndex];
    if(!t) return;
    const m = state.mixer;
    t.vol.gain.value = m.mutes[trackIndex] ? 0 : m.volumes[trackIndex];
    t.pan.pan.value = m.pans[trackIndex];
}

async function togglePlay() {
    if(state.isPlaying) { stopTransport(); } else { await Tone.start(); Tone.Transport.start(); state.isPlaying = true; document.getElementById('play-btn')?.classList.add('active'); }
}
function stopTransport() {
    Tone.Transport.stop();
    activeSources.forEach(s => { try{s.stop()}catch(e){} });
    activeSources = [];
    state.isPlaying = false;
    document.getElementById('play-btn')?.classList.remove('active');
    document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
}

function saveProjectToStorage() {
    const data = { version: APP_VERSION, date: Date.now(), bpm: state.bpm, patterns: state.patterns, playlist: state.playlist, mixer: state.mixer };
    localStorage.setItem('canvas_project_autosave', JSON.stringify(data));
}
function loadProjectFromStorage() {
    const raw = localStorage.getItem('canvas_project_autosave');
    if(!raw) return false;
    try {
        const data = JSON.parse(raw);
        state.bpm = data.bpm || 128;
        state.patterns = data.patterns || state.patterns;
        state.playlist = data.playlist || state.playlist;
        if(data.mixer) state.mixer = data.mixer;
        return true;
    } catch(e) { return false; }
}
setInterval(saveProjectToStorage, 30000); 

function createEmptyGrid(beats) { return instruments.map(() => new Array(beats * 4).fill(false)); }
function createNewPattern() {
    const id = 'pat' + Date.now();
    state.patterns[id] = { id, name: `Pattern ${Object.keys(state.patterns).length + 1}`, grid: createEmptyGrid(4) };
    selectResource('pattern', id);
    renderResources();
}
function selectResource(type, id) {
    state.selectedResType = type;
    state.selectedResId = id;
    renderResources();
    if(type === 'pattern') {
        document.getElementById('rack-title').innerText = "SEQUENCER: " + state.patterns[id].name;
        renderChannelRack();
    }
}
function renderResources() {
    const pList = document.getElementById('pattern-list');
    if(pList) {
        pList.innerHTML = '';
        Object.values(state.patterns).forEach(p => {
            const d = document.createElement('div');
            d.className = `resource-item ${state.selectedResId === p.id ? 'selected' : ''}`;
            d.innerText = p.name;
            d.onclick = () => selectResource('pattern', p.id);
            pList.appendChild(d);
        });
    }
    const aList = document.getElementById('audio-list');
    if(aList) {
        aList.innerHTML = '';
        Object.values(state.audioClips).forEach(c => {
            const d = document.createElement('div');
            d.className = `resource-item audio-type ${state.selectedResId === c.id ? 'selected' : ''}`;
            d.innerHTML = `<i class="fas fa-wave-square"></i> ${c.name}`;
            d.onclick = () => selectResource('audio', c.id);
            aList.appendChild(d);
        });
    }
}
function generateRuler() {
    const r = document.getElementById('ruler');
    if(!r) return;
    r.innerHTML = '';
    for(let i=1; i<=50; i++){
        const d = document.createElement('div');
        d.className = 'ruler-segment'; d.innerText = i;
        r.appendChild(d);
    }
}

function renderPlaylist() {
    const c = document.getElementById('playlist-tracks');
    if(!c) return;
    c.innerHTML = '';
    state.playlist.forEach((clips, idx) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        const h = document.createElement('div');
        h.className = 'track-header';
        h.innerHTML = `<div class="track-buttons"><button class="track-btn" onclick="openFxWindow(${idx})">FX</button></div> Track ${idx+1}`; 
        row.appendChild(h);
        const l = document.createElement('div');
        l.className = 'track-lane';
        l.onclick = (e) => {
            if(e.target !== l) return;
            state.selectedClip = null;
            renderPlaylist();
            const bar = Math.floor(e.offsetX / 60);
            addClipToTrack(idx, bar);
        };
        clips.forEach((clip, clipIndex) => {
            const el = document.createElement('div');
            el.className = `clip ${clip.type === 'pattern' ? 'clip-pattern' : 'clip-audio'}`;
            if (state.selectedClip && state.selectedClip.trackIndex === idx && state.selectedClip.clipIndex === clipIndex) {
                el.classList.add('selected-clip');
            }
            if (clip.muted) el.classList.add('muted');
            el.style.left = (clip.startBar * 60) + 'px';
            el.style.width = (clip.lengthBars * 60) + 'px';
            el.innerText = clip.type === 'pattern' ? state.patterns[clip.id]?.name : state.audioClips[clip.id]?.name;
            
            el.onclick = (e) => {
                e.stopPropagation(); 
                state.selectedClip = { trackIndex: idx, clipIndex: clipIndex };
                renderPlaylist();
            };

            l.appendChild(el);
        });
        row.appendChild(l);
        c.appendChild(row);
    });
}

function addClipToTrack(trackIdx, startBar) {
    if(!state.selectedResId) return;
    state.playlist[trackIdx].push({
        type: state.selectedResType,
        id: state.selectedResId,
        startBar: startBar,
        lengthBars: state.selectedResType === 'pattern' ? 1 : 2
    });
    renderPlaylist();
}

function renderChannelRack() {
    const c = document.getElementById('rack-rows');
    if(!c) return;
    if(state.selectedResType !== 'pattern') { c.innerHTML = ''; return; }
    const grid = state.patterns[state.selectedResId].grid;
    c.innerHTML = '';
    grid.forEach((row, iIdx) => {
        const r = document.createElement('div');
        r.className = 'instrument-row';
        const name = document.createElement('div');
        name.className = 'inst-name';
        name.innerText = instruments[iIdx].name;
        r.appendChild(name);
        const seq = document.createElement('div');
        seq.className = 'step-sequencer';
        row.forEach((active, sIdx) => {
            const s = document.createElement('div');
            s.className = `step ${active ? 'active' : ''}`;
            if(sIdx % 4 === 0) s.style.borderLeft = "1px solid #666";
            s.onclick = () => { grid[iIdx][sIdx] = !grid[iIdx][sIdx]; renderChannelRack(); };
            seq.appendChild(s);
        });
        r.appendChild(seq);
        c.appendChild(r);
    });
}

Tone.Transport.scheduleRepeat((time) => {
    const step = state.currentStep;
    const patStep = step % 16;
    Tone.Draw.schedule(() => {
        document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
        document.querySelectorAll(`.step:nth-child(${patStep+1})`).forEach(s => s.classList.add('playing'));
        const ph = document.getElementById('playhead');
        if(ph) ph.style.left = (120 + (step * 3.75)) + 'px';
    }, time);
    if(state.mode === 'PATTERN') {
        const grid = state.patterns[state.selectedResId].grid;
        instruments.forEach((inst, idx) => { if(grid[idx][patStep]) playInst(idx, time); });
    } else if (state.mode === 'SONG') {
        const currentBar = Math.floor(step / 16);
        const stepInBar = step % 16;
        state.playlist.forEach((track, trackIndex) => {
            track.forEach(clip => {
                if (clip.muted) return; 
                if(currentBar >= clip.startBar && currentBar < clip.startBar + clip.lengthBars) {
                    if(clip.type === 'pattern' && state.patterns[clip.id]) {
                        const grid = state.patterns[clip.id].grid;
                        const pStep = stepInBar % grid[0].length;
                        playPatternStep(grid, pStep, time);
                    }
                    if(clip.type === 'audio' && currentBar === clip.startBar && stepInBar === 0) {
                        playAudioClip(clip.id, time, trackIndex, clip.offset || 0);
                    }
                }
            });
        });
    }
    state.currentStep++;
}, "16n");

function playPatternStep(grid, stepIdx, time) {
    if(grid[0][stepIdx]) safePlayDrum("Kick", time);
    if(grid[1][stepIdx]) safePlayDrum("Snare", time);
    if(grid[2][stepIdx]) hatSynth.triggerAttackRelease("32n", time);
    if(grid[3][stepIdx]) clapSynth.triggerAttackRelease("16n", time);
}

function playInst(idx, time) {
    if(idx===0) safePlayDrum("Kick", time);
    if(idx===1) safePlayDrum("Snare", time);
    if(idx===2) hatSynth.triggerAttackRelease("32n", time);
    if(idx===3) clapSynth.triggerAttackRelease("16n", time);
}

window.addEventListener('load', init);
async function handleAudioUpload(input) {
    const file = input.files[0];
    if(!file) return;
    const id = 'audio' + Date.now();
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);
        state.audioClips[id] = { id, name: file.name, buffer: audioBuffer, duration: audioBuffer.duration };
        renderResources();
        selectResource('audio', id);
    } catch (err) { alert("Error decoding audio file."); }
}

function openFxWindow(trackIndex){
    const overlay = document.getElementById('fxOverlay');
    const win = document.getElementById('fxWindow');
    if(!overlay || !win) return;
    
    // 1. Set Title
    const title = document.getElementById('fxWinTitle');
    if(title) title.innerText = `Effects (Track ${trackIndex + 1})`;

    // 2. Populate Plugin List
    const select = document.getElementById('fxPluginSelect');
    select.innerHTML = ''; 
    
    if(window.CA_PLUGINS) {
        Object.keys(window.CA_PLUGINS).forEach(key => {
            const plugin = window.CA_PLUGINS[key];
            const opt = document.createElement('option');
            opt.value = key;
            opt.innerText = plugin.name;
            select.appendChild(opt);
        });
    } else {
        const opt = document.createElement('option');
        opt.innerText = "No Plugins Found";
        select.appendChild(opt);
    }

    // 3. Wire up "Add" Button
    const addBtn = document.getElementById('fxAddPluginBtn');
    const newBtn = addBtn.cloneNode(true); // Clear old listeners
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    
    newBtn.onclick = () => {
        const pluginKey = select.value;
        if(pluginKey) addPluginToTrack(trackIndex, pluginKey);
    };

    // 4. Render Slots
    renderFxSlots(trackIndex);
    overlay.style.display = 'flex';
    document.getElementById('fxCloseBtn').onclick = () => overlay.style.display = 'none';
}

function renderFxSlots(trackIndex) {
    const body = document.getElementById('fxWinBody');
    body.innerHTML = '';
    
    if (!state.trackFxSlots[trackIndex]) {
        state.trackFxSlots[trackIndex] = Array(10).fill(null);
    }

    state.trackFxSlots[trackIndex].forEach((slot, slotIndex) => {
        const row = document.createElement('div');
        row.style.cssText = "padding: 8px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;";
        
        if (slot) {
            const left = document.createElement('div');
            const name = document.createElement('span');
            name.innerText = `${slotIndex + 1}. ${slot.name}`;
            name.style.color = "#ff9800";
            name.style.marginRight = "10px";

            // UI Button for Plugin (if it has custom UI)
            if(slot.node.mountUI) {
                const uiBtn = document.createElement('button');
                uiBtn.innerText = "⚙";
                uiBtn.style.cssText = "background:none; border:none; color:#bbb; cursor:pointer;";
                uiBtn.onclick = () => {
                    // Quick modal for plugin UI
                    const uiDiv = document.createElement('div');
                    uiDiv.style.cssText = "margin-top:5px; background:#222; padding:5px; border-radius:4px;";
                    slot.node.mountUI(uiDiv);
                    if(!row.querySelector('.plugin-ui-box')) {
                        uiDiv.className = 'plugin-ui-box';
                        row.appendChild(uiDiv);
                    } else {
                        row.querySelector('.plugin-ui-box').remove();
                    }
                };
                left.appendChild(uiBtn);
            }
            left.appendChild(name);

            const removeBtn = document.createElement('button');
            removeBtn.innerText = "X";
            removeBtn.style.cssText = "background: #d32f2f; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer;";
            removeBtn.onclick = () => removePluginFromTrack(trackIndex, slotIndex);
            
            row.appendChild(left);
            row.appendChild(removeBtn);
        } else {
            const name = document.createElement('span');
            name.innerText = `${slotIndex + 1}. (Empty)`;
            name.style.color = "#666";
            row.appendChild(name);
        }
        body.appendChild(row);
    });
}

function addPluginToTrack(trackIndex, pluginKey) {
    const registryItem = window.CA_PLUGINS[pluginKey];
    if(!registryItem) return;
    const slots = state.trackFxSlots[trackIndex];
    const emptyIndex = slots.findIndex(s => s === null);
    if (emptyIndex === -1) { alert("No empty slots!"); return; }

    const node = registryItem.create(Tone);
    slots[emptyIndex] = { name: registryItem.name, type: pluginKey, node: node };
    updateTrackAudioChain(trackIndex);
    renderFxSlots(trackIndex);
}

function removePluginFromTrack(trackIndex, slotIndex) {
    const slot = state.trackFxSlots[trackIndex][slotIndex];
    if (slot && slot.node) {
        if(slot.node.dispose) slot.node.dispose();
    }
    state.trackFxSlots[trackIndex][slotIndex] = null;
    updateTrackAudioChain(trackIndex);
    renderFxSlots(trackIndex);
}

function updateTrackAudioChain(trackIndex) {
    const track = ensureTrackAudio(trackIndex);
    const slots = state.trackFxSlots[trackIndex];
    track.input.disconnect();
    let currentNode = track.input;

    slots.forEach(slot => {
        if (slot && slot.node) {
            // Advanced Node (Separate Input/Output)
            if (slot.node.input && slot.node.output) {
                currentNode.connect(slot.node.input);
                currentNode = slot.node.output;
            } else {
                // Simple Node
                currentNode.connect(slot.node);
                currentNode = slot.node;
            }
        }
    });
    currentNode.connect(track.pan);
}
