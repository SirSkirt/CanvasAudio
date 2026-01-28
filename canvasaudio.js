// canvasaudio.js - Main Application Logic (v0.4.1)

// --- APP VERSION ---
const APP_STAGE = "Alpha";
const APP_VERSION = "0.4.1";
window.CA_VERSION = APP_VERSION;

// --- CONSTANTS ---
const instruments = [
    { name: "Kick", note: "C1" }, 
    { name: "Snare", note: "D1" }, 
    { name: "HiHat", note: "E1" },
    { name: "Clap", note: "F1" }
];

// --- STATE ---
let state = {
    audioReady: false,
    isPlaying: false,
    mode: 'PATTERN', // 'PATTERN' | 'SONG'
    bpm: 128,
    currentStep: 0,
    timeSig: 4, 

    // Recording
    armedTrack: 0,
    isRecording: false,
    mediaStream: null,
    mediaRecorder: null,
    recordingClipId: null,

    // Inputs & FX
    trackInputDeviceIds: Array(8).fill(null),
    trackFxSlots: Array.from({length: 8}, () => Array(10).fill(null)),
    trackFxSlotEnabled: Array.from({length: 8}, () => Array(10).fill(true)),
    recordingStartPerf: 0,
    recordingTimer: null,
    
    // Data
    patterns: { 'pat1': { id:'pat1', name: "Pattern 1", grid: createEmptyGrid(4) } },
    audioClips: {}, 
    playlist: [],
    
    // Selection
    selectedResType: 'pattern',
    selectedResId: 'pat1',
    playheadStep: 0,
    
    // Mixer Defaults
    mixer: {
        trackNames: Array.from({length:8}, (_,i)=>`Track ${i+1}`),
        volumes: Array(8).fill(1),
        pans: Array(8).fill(0),
        mutes: Array(8).fill(false),
        solos: Array(8).fill(false)
    }
};

// Initialize Playlist Tracks
if(state.playlist.length === 0) {
    for(let i=0; i<8; i++) state.playlist.push([]);
}

// --- AUDIO ENGINE ---
const drumSamples = new Tone.Players({
    "Kick": "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
    "Snare": "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
}).toDestination();

const hatSynth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
}).toDestination();
hatSynth.volume.value = -15;

const clapSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
}).toDestination();
clapSynth.volume.value = -10;

let activeSources = [];

// --- ENVIRONMENT CHECK (NEW) ---
function checkEnvironment() {
    // Check for Electron
    const isElectron = typeof process !== 'undefined' && process.versions && process.versions.electron;
    
    const titleBar = document.getElementById('title-bar');
    const banner = document.getElementById('standalone-banner');

    if (isElectron) {
        console.log("Running in Standalone Mode");
        // Show custom title bar
        if(titleBar) titleBar.style.display = 'flex';
        // Hide web banner
        if(banner) banner.style.display = 'none';

        // Initialize Electron Window Controls
        setupElectronControls();
    } else {
        console.log("Running in Browser Mode");
        // Hide custom title bar (let browser handle it)
        if(titleBar) titleBar.style.display = 'none';
        
        // Show "Download Standalone" Banner
        if(banner) banner.style.display = 'flex';
    }
}

function setupElectronControls() {
    // We check for 'require' to avoid errors in browser
    if (typeof require !== 'undefined') {
        const { ipcRenderer } = require('electron');
        document.getElementById('btn-min')?.addEventListener('click', () => ipcRenderer.send('app/minimize'));
        document.getElementById('btn-max')?.addEventListener('click', () => ipcRenderer.send('app/maximize'));
        document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('app/close'));
    }
}

// --- INIT ---
function init() {
    const vEl = document.getElementById('version-label');
    if (vEl) vEl.textContent = `${APP_STAGE} Version ${APP_VERSION}`;

    // Environment Check
    checkEnvironment();
    
    // Autosave Load
    if(!loadProjectFromStorage()) {
        // Defaults if new
    }

    generateRuler();
    renderResources();
    renderPlaylist();
    renderChannelRack();
    renderMixerUI(); // Ensure mixer state exists
    
    selectResource('pattern', 'pat1');
    Tone.Transport.bpm.value = 128;
    
    setupAudioStatusPanel();
    setupPlayheadScrub();
    setupMainMenu();
    setVersionLabel();
}

// --- MIXER UI ---
function openMixerWindow(){
    const ov = document.getElementById('mixerOverlay');
    if(ov) {
        ov.style.display = 'flex';
        renderMixerUI();
    }
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
        
        // Title
        const title = document.createElement('div');
        title.className = 'strip-title';
        title.textContent = state.mixer.trackNames[i] || `Track ${i+1}`;
        strip.appendChild(title);

        // Mute/Solo
        const btns = document.createElement('div');
        btns.className = 'strip-btns';
        
        const mBtn = document.createElement('button');
        mBtn.className = 'strip-btn' + (state.mixer.mutes[i] ? ' active' : '');
        mBtn.textContent = 'M';
        mBtn.onclick = () => { 
            state.mixer.mutes[i] = !state.mixer.mutes[i]; 
            applyMixerToAudio(i); 
            renderMixerUI(); 
        };
        
        const sBtn = document.createElement('button');
        sBtn.className = 'strip-btn' + (state.mixer.solos[i] ? ' active' : '');
        sBtn.textContent = 'S';
        sBtn.onclick = () => { 
            state.mixer.solos[i] = !state.mixer.solos[i]; 
            applyMixerToAudio(i); 
            renderMixerUI(); 
        };
        
        btns.append(mBtn, sBtn);
        strip.appendChild(btns);

        // Fader
        const meter = document.createElement('div');
        meter.className = 'vert-meter';
        const fill = document.createElement('div');
        fill.className = 'meter-fill';
        fill.style.height = (state.mixer.volumes[i] * 100) + '%'; // Visual approx
        meter.appendChild(fill);
        
        const vol = document.createElement('input');
        vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
        vol.value = state.mixer.volumes[i];
        vol.oninput = (e) => { 
            state.mixer.volumes[i] = parseFloat(e.target.value); 
            fill.style.height = (state.mixer.volumes[i]*100)+'%';
            applyMixerToAudio(i); 
        };
        meter.appendChild(vol);
        strip.appendChild(meter);

        grid.appendChild(strip);
    }
    body.appendChild(grid);
}

// --- TRACK AUDIO & FX ---
function ensureTrackAudio(trackIndex){
    state._audioTracks = state._audioTracks || Array(8).fill(null);
    if(state._audioTracks[trackIndex]) return state._audioTracks[trackIndex];

    // Create Nodes
    const input = new Tone.Gain(1);
    const pan = new Tone.Panner(0);
    const vol = new Tone.Gain(1);
    
    // Chain: Input -> [Plugins] -> Pan -> Vol -> Destination
    input.connect(pan);
    pan.connect(vol);
    vol.toDestination();

    const track = { input, pan, vol };
    state._audioTracks[trackIndex] = track;
    
    // Initialize mixer state
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

// --- TRANSPORT & PLAYBACK ---
async function togglePlay() {
    if(state.isPlaying) {
        stopTransport();
    } else {
        await Tone.start();
        Tone.Transport.start();
        state.isPlaying = true;
        document.getElementById('play-btn').classList.add('active');
    }
}

function stopTransport() {
    Tone.Transport.stop();
    activeSources.forEach(s => { try{s.stop()}catch(e){} });
    activeSources = [];
    state.isPlaying = false;
    document.getElementById('play-btn').classList.remove('active');
    
    // Visual reset
    document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
}

// --- AUTOSAVE ---
function saveProjectToStorage() {
    const data = {
        version: APP_VERSION,
        date: Date.now(),
        bpm: state.bpm,
        patterns: state.patterns,
        playlist: state.playlist,
        mixer: state.mixer
    };
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
setInterval(saveProjectToStorage, 30000); // 30s autosave

// --- HELPER FUNCTIONS ---
function createEmptyGrid(beats) {
    return instruments.map(() => new Array(beats * 4).fill(false));
}

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
    pList.innerHTML = '';
    Object.values(state.patterns).forEach(p => {
        const d = document.createElement('div');
        d.className = `resource-item ${state.selectedResId === p.id ? 'selected' : ''}`;
        d.innerText = p.name;
        d.onclick = () => selectResource('pattern', p.id);
        pList.appendChild(d);
    });

    const aList = document.getElementById('audio-list');
    aList.innerHTML = '';
    Object.values(state.audioClips).forEach(c => {
        const d = document.createElement('div');
        d.className = `resource-item audio-type ${state.selectedResId === c.id ? 'selected' : ''}`;
        d.innerHTML = `<i class="fas fa-wave-square"></i> ${c.name}`;
        d.onclick = () => selectResource('audio', c.id);
        aList.appendChild(d);
    });
}

function generateRuler() {
    const r = document.getElementById('ruler');
    r.innerHTML = '';
    for(let i=1; i<=50; i++){
        const d = document.createElement('div');
        d.className = 'ruler-segment'; d.innerText = i;
        r.appendChild(d);
    }
}

function renderPlaylist() {
    const c = document.getElementById('playlist-tracks');
    c.innerHTML = '';
    state.playlist.forEach((clips, idx) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        
        // Header
        const h = document.createElement('div');
        h.className = 'track-header';
        h.innerHTML = `<div>Track ${idx+1}</div>`; // Simplified for brevity
        row.appendChild(h);
        
        // Lane
        const l = document.createElement('div');
        l.className = 'track-lane';
        l.onclick = (e) => {
            if(e.target !== l) return;
            const bar = Math.floor(e.offsetX / 60);
            addClipToTrack(idx, bar);
        };

        // Clips
        clips.forEach(clip => {
            const el = document.createElement('div');
            el.className = `clip ${clip.type === 'pattern' ? 'clip-pattern' : 'clip-audio'}`;
            el.style.left = (clip.startBar * 60) + 'px';
            el.style.width = (clip.lengthBars * 60) + 'px';
            el.innerText = clip.type === 'pattern' ? state.patterns[clip.id]?.name : state.audioClips[clip.id]?.name;
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
        lengthBars: state.selectedResType === 'pattern' ? 1 : 2 // simplified
    });
    renderPlaylist();
}

function renderChannelRack() {
    const c = document.getElementById('rack-rows');
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

// Clock Loop
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
        instruments.forEach((inst, idx) => {
            if(grid[idx][patStep]) playInst(idx, time);
        });
    }
    
    state.currentStep++;
}, "16n");

function playInst(idx, time) {
    if(idx===0) drumSamples.player("Kick").start(time);
    if(idx===1) drumSamples.player("Snare").start(time);
    if(idx===2) hatSynth.triggerAttackRelease("32n", time);
    if(idx===3) clapSynth.triggerAttackRelease("16n", time);
}

// Load
window.addEventListener('load', init);
