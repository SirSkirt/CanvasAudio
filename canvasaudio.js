/**
 * CanvasAudio Main Logic
 * v0.6.0 - Synthesized Drums (Crash Proof)
 */

const APP_STAGE = "Alpha";
const APP_VERSION = "0.6.0";
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

// --- NEW SYNTH AUDIO ENGINE (NO SAMPLES = NO CRASHES) ---
const kickSynth = new Tone.MembraneSynth().toDestination();
kickSynth.volume.value = -5;

const snareSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
}).toDestination();
snareSynth.volume.value = -10;

const hatSynth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
}).toDestination();
hatSynth.volume.value = -15;

const clapSynth = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
}).toDestination();
clapSynth.volume.value = -10;

let activeSources = [];


// --- ROBUST AUDIO PLAYER ---
function playAudioClip(id, time, trackIndex, rawOffset) {
    const clipData = state.audioClips[id];
    if(!clipData || !clipData.buffer) return;

    // Validate Offset to prevent "Start time error"
    let offset = rawOffset || 0;
    if (offset < 0) offset = 0;
    if (offset >= clipData.buffer.duration) return; 

    const ctx = Tone.context.rawContext;
    const src = ctx.createBufferSource();
    src.buffer = clipData.buffer;
    
    const t = ensureTrackAudio(trackIndex);
    src.connect(t.input);

    try { 
        const duration = clipData.buffer.duration - offset;
        src.start(time, offset, duration); 
    } catch(e) { 
        console.error("Audio Clip Error:", e);
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


// --- RECORDING (MIC -> AUDIO CLIP) ---
function setRecordButtonUI(){
    const btn = document.getElementById('record-btn');
    if(!btn) return;
    if(state.isRecording){
        btn.classList.add('active-record');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        btn.title = 'Stop Recording';
    } else {
        btn.classList.remove('active-record');
        btn.innerHTML = '<i class="fas fa-circle"></i>';
        btn.title = 'Record';
    }
}

async function toggleRecord(){
    // Only allow recording when audio is started
    if(!state.audioReady){
        showToast && showToast('Start Audio first');
        return;
    }
    if(state.isRecording){
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording(){
    try {
        if(state.mediaRecorder && state.mediaRecorder.state !== 'inactive'){
            return;
        }
        // Request mic
        const constraints = { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.mediaStream = stream;

        const chunks = [];
        const mr = new MediaRecorder(stream);
        state.mediaRecorder = mr;
        state.isRecording = true;
        setRecordButtonUI();

        mr.ondataavailable = (e)=>{ if(e.data && e.data.size>0) chunks.push(e.data); };
        mr.onerror = ()=>{ /* rely on overlay */ };
        mr.onstop = async ()=>{
            try{
                const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);

                const id = 'rec_' + Date.now();
                const name = 'Recording ' + new Date().toLocaleTimeString();
                state.audioClips[id] = { id, name, buffer: audioBuffer, duration: audioBuffer.duration, peaks: computeWaveformPeaks(audioBuffer) };

                // Place on track 1 at current playhead (SONG) or at bar 0 (PATTERN)
                const trackIdx = 0;
                const startBar = (state.mode === 'SONG') ? (Math.max(0, (state.currentStep||0)) / 16) : 0;
                state.selectedResType = 'audio';
                state.selectedResId = id;
                addClipToTrack(trackIdx, startBar);
                renderResourceLists();
            } finally {
                // cleanup stream
                if(state.mediaStream){
                    state.mediaStream.getTracks().forEach(t=>t.stop());
                    state.mediaStream = null;
                }
                state.mediaRecorder = null;
                state.isRecording = false;
                setRecordButtonUI();
            }
        };

        mr.start();
    } catch(err){
        state.isRecording = false;
        setRecordButtonUI();
        console.error(err);
    }
}

function stopRecording(){
    try{
        if(state.mediaRecorder && state.mediaRecorder.state !== 'inactive'){
            state.mediaRecorder.stop();
        } else {
            // ensure cleanup
            if(state.mediaStream){
                state.mediaStream.getTracks().forEach(t=>t.stop());
                state.mediaStream = null;
            }
            state.mediaRecorder = null;
            state.isRecording = false;
            setRecordButtonUI();
        }
    } catch(err){
        console.error(err);
    }
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


function secondsPerBar() {
    // Assumes quarter-note beat and timeSig beats per bar (e.g., 4/4 => 4 beats)
    return (60 / (state.bpm || 120)) * (state.timeSig || 4);
}

function calcAudioLengthBars(audioClipId) {
    const cd = state.audioClips ? state.audioClips[audioClipId] : null;
    if(!cd || !cd.duration || !isFinite(cd.duration)) return 2;
    const spb = secondsPerBar();
    if(!spb || !isFinite(spb) || spb <= 0) return 2;
    return Math.max(1, Math.ceil(cd.duration / spb));
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
            if (clip.type === 'audio') {
                const cd = state.audioClips[clip.id];
                if (cd && cd.peaks) attachClipWaveform(el, cd);
            }
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
        lengthBars: state.selectedResType === 'pattern' ? 1 : ((state.selectedResType === 'audio') ? calcAudioLengthBars(state.selectedResId) : 2),
        autoLength: (state.selectedResType === 'audio')
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

// --- UPDATED PLAY FUNCTIONS (USE SYNTHS) ---
function playPatternStep(grid, stepIdx, time) {
    if(grid[0][stepIdx]) kickSynth.triggerAttackRelease("C1", "8n", time);
    if(grid[1][stepIdx]) snareSynth.triggerAttackRelease("8n", time);
    if(grid[2][stepIdx]) hatSynth.triggerAttackRelease("32n", time);
    if(grid[3][stepIdx]) clapSynth.triggerAttackRelease("16n", time);
}

function playInst(idx, time) {
    if(idx===0) kickSynth.triggerAttackRelease("C1", "8n", time);
    if(idx===1) snareSynth.triggerAttackRelease("8n", time);
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
        state.audioClips[id] = { id, name: file.name, buffer: audioBuffer, duration: audioBuffer.duration, peaks: computeWaveformPeaks(audioBuffer) };
        renderResources();
        selectResource('audio', id);
    } catch (err) { alert("Error decoding audio file."); }
}

// --- WAVEFORM PEAKS (for playlist clip rendering) ---
function computeWaveformPeaks(audioBuffer, points = 800) {
    try {
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
        const len = ch0.length;
        if(len === 0) return [];
        const blockSize = Math.max(1, Math.floor(len / points));
        const peaks = new Array(points);
        for (let i = 0; i < points; i++) {
            const start = i * blockSize;
            const end = Math.min(len, start + blockSize);
            let min = 1.0, max = -1.0;
            for (let j = start; j < end; j++) {
                const v0 = ch0[j];
                const v = ch1 ? (v0 + ch1[j]) * 0.5 : v0;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            peaks[i] = [min, max];
        }
        return peaks;
    } catch (e) {
        console.warn('Waveform peak calc failed', e);
        return [];
    }
}

function drawWaveformToCanvas(peaks, canvas) {
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if(!peaks || peaks.length === 0) return;
    // subtle waveform (no hard-coded theme changes)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    const mid = Math.floor(h / 2);
    const step = w / peaks.length;
    ctx.beginPath();
    for(let i=0; i<peaks.length; i++){
        const x = Math.floor(i * step);
        const p = peaks[i];
        const y1 = mid + Math.floor(p[0] * mid);
        const y2 = mid + Math.floor(p[1] * mid);
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
    }
    ctx.stroke();
}

function attachClipWaveform(clipEl, clipData) {
    if(!clipEl || !clipData || !clipData.peaks || clipData.peaks.length === 0) return;
    // Ensure relative positioning so the canvas can overlay
    if(getComputedStyle(clipEl).position === 'static') {
        clipEl.style.position = 'relative';
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'clip-waveform';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    clipEl.appendChild(canvas);

    requestAnimationFrame(() => {
        const rect = clipEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cw = Math.max(1, Math.floor(rect.width * dpr));
        const ch = Math.max(1, Math.floor(rect.height * dpr));
        canvas.width = cw;
        canvas.height = ch;
        drawWaveformToCanvas(clipData.peaks, canvas);
    });
}


function openFxWindow(trackIndex){
    const overlay = document.getElementById('fxOverlay');
    const win = document.getElementById('fxWindow');
    if(!overlay || !win) return;
    const title = document.getElementById('fxWinTitle');
    if(title) title.innerText = `Effects (Track ${trackIndex + 1})`;

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

    const addBtn = document.getElementById('fxAddPluginBtn');
    const newBtn = addBtn.cloneNode(true); 
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    
    newBtn.onclick = () => {
        const pluginKey = select.value;
        if(pluginKey) addPluginToTrack(trackIndex, pluginKey);
    };

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

            if(slot.node.mountUI) {
                const uiBtn = document.createElement('button');
                uiBtn.innerText = "⚙";
                uiBtn.style.cssText = "background:none; border:none; color:#bbb; cursor:pointer;";
                uiBtn.onclick = () => {
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
            if (slot.node.input && slot.node.output) {
                currentNode.connect(slot.node.input);
                currentNode = slot.node.output;
            } else {
                currentNode.connect(slot.node);
                currentNode = slot.node;
            }
        }
    });
    currentNode.connect(track.pan);
}