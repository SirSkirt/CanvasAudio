
// --- APP VERSION ---
const APP_STAGE = "Alpha";
const APP_VERSION = "0.2.4";

const APP_BUILD = "1";
// --- CONSTANTS ---
const instruments = [
    { name: "Kick", note: "C1" }, 
    { name: "Snare", note: "D1" }, 
    { name: "HiHat", note: "E1" }, // Synthesized
    { name: "Clap", note: "F1" }   // Synthesized
];

// --- STATE ---
let state = {
    isPlaying: false,
    mode: 'PATTERN', // 'PATTERN' | 'SONG'
    bpm: 128,
    currentStep: 0,
    timeSig: 4, // 4 beats per bar

    // Recording
    armedTrack: 0,
    isRecording: false,
    mediaStream: null,
    mediaRecorder: null,
    recordingClipId: null,
    recordingStartPerf: 0,
    recordingTimer: null,
    
    patterns: { 'pat1': { id:'pat1', name: "Pattern 1", grid: createEmptyGrid(4) } },
    audioClips: {}, 
    
    selectedResType: 'pattern',
    selectedResId: 'pat1',
    
    playlist: [] 
};

// Initialize 8 Tracks
for(let i=0; i<8; i++) state.playlist.push([]);

// --- AUDIO ENGINE (HYBRID) ---

// 1. SAMPLES (Kick & Snare)
const drumSamples = new Tone.Players({
    "Kick": "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
    "Snare": "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
}).toDestination();

// 2. SYNTHS (HiHat & Clap)
const hatSynth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5
}).toDestination();
hatSynth.volume.value = -15;

const clapSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
}).toDestination();
clapSynth.volume.value = -10;

let activeSources = [];


// --- UPDATE CHECKER ---
function setupUpdateChecker() {
    const banner = document.getElementById('update-banner');
    const textEl = document.getElementById('update-text');
    const btn = document.getElementById('update-reload');
    if (!banner || !textEl || !btn) return;

    const check = async () => {
        try {
            const res = await fetch(`version.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.version) return;

            if (data.version !== APP_VERSION) {
                textEl.textContent = `Update available (${data.version}).`;
                banner.classList.remove('hidden');
                btn.onclick = () => forceUpdateReload(data);
            }
        } catch (e) {}
    };

    check();
    setInterval(check, 60000);
}

async function forceUpdateReload(remote) {
    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
        }
        if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
    } catch (e) {}

    const v = remote && (remote.build || remote.version) ? (remote.build || remote.version) : String(Date.now());
    const url = new URL(window.location.href);
    url.searchParams.set('v', v);
    url.searchParams.set('t', String(Date.now()));
    window.location.replace(url.toString());
}

// --- INITIALIZATION ---
function init() {
            // Version label (UI)
            const vEl = document.getElementById('version-label');
            if (vEl) vEl.textContent = `${APP_STAGE} Version ${APP_VERSION}`;

    setupUpdateChecker();

    generateRuler();
    renderResources();
    renderPlaylist();
    renderChannelRack();
    selectResource('pattern', 'pat1');
    Tone.Transport.bpm.value = 128;
}

// --- DATA HELPERS ---
function createEmptyGrid(beats) {
    const steps = beats * 4; // 16ths
    return instruments.map(() => new Array(steps).fill(false));
}

function createNewPattern() {
    const id = 'pat' + Date.now();
    state.patterns[id] = { 
        id, 
        name: `Pattern ${Object.keys(state.patterns).length + 1}`, 
        grid: createEmptyGrid(state.timeSig) 
    };
    selectResource('pattern', id);
    renderResources();
}

// --- FULLSCREEN FUNCTION ---
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error enabling full-screen: ${err.message}`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// --- AUDIO IMPORT (NATIVE DECODER FIX) ---
async function handleAudioUpload(input) {
    const file = input.files[0];
    if(!file) return;

    if (Tone.context.state !== 'running') {
        await Tone.start();
    }

    const id = 'audio' + Date.now();
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        try {
            const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);
            state.audioClips[id] = {
                id,
                name: file.name,
                buffer: audioBuffer,
                duration: audioBuffer.duration
            };
            renderResources();
            selectResource('audio', id);
            console.log("Audio decoded successfully!");
        } catch (err) {
            console.error("Decoding error:", err);
            alert("Error decoding audio file.");
        }
    };
    reader.readAsArrayBuffer(file);
}

function selectResource(type, id) {
    state.selectedResType = type;
    state.selectedResId = id;
    
    document.querySelectorAll('.resource-item').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById(`res-${id}`);
    if(el) el.classList.add('selected');

    if(type === 'pattern') {
        renderChannelRack();
        document.getElementById('rack-title').innerText = "SEQUENCER: " + state.patterns[id].name;
    } else {
        document.getElementById('rack-title').innerText = "AUDIO CLIP SELECTED (Not editable)";
        document.getElementById('rack-rows').innerHTML = `<div style="padding:20px; color:#666; text-align:center;">Drag this clip or click in the Playlist to add it.</div>`;
    }
}

function renderResources() {
    const patList = document.getElementById('pattern-list');
    patList.innerHTML = '';
    Object.values(state.patterns).forEach(pat => {
        const div = document.createElement('div');
        div.className = `resource-item ${state.selectedResId === pat.id ? 'selected' : ''}`;
        div.id = `res-${pat.id}`;
        div.innerText = pat.name;
        div.onclick = () => selectResource('pattern', pat.id);
        patList.appendChild(div);
    });

    const audioList = document.getElementById('audio-list');
    audioList.innerHTML = '';
    Object.values(state.audioClips).forEach(clip => {
        const div = document.createElement('div');
        div.className = `resource-item audio-type ${state.selectedResId === clip.id ? 'selected' : ''}`;
        if(clip.buffer) div.classList.add('loaded');
        div.id = `res-${clip.id}`;
        div.title = clip.name;
        div.innerHTML = `<i class="fas fa-wave-square"></i> ${clip.name}`;
        div.onclick = () => selectResource('audio', clip.id);
        audioList.appendChild(div);
    });
}

// --- UI & RENDERERS ---
function generateRuler() {
    const ruler = document.getElementById('ruler');
    ruler.innerHTML = ''; // Clear prev
    for(let i=1; i<=50; i++) {
        const div = document.createElement('div');
        div.className = 'ruler-segment';
        div.innerText = i;
        ruler.appendChild(div);
    }
}

function renderPlaylist() {
    const container = document.getElementById('playlist-tracks');
    container.innerHTML = '';

    state.playlist.forEach((trackClips, trackIndex) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        
        const header = document.createElement('div');
        header.className = 'track-header';
        header.innerHTML = `
            <button class="arm-btn ${state.armedTrack === trackIndex ? 'active' : ''}" onclick="setArmedTrack(${trackIndex})" title="Arm Track">
                <i class="fas fa-circle"></i>
            </button>
            Track ${trackIndex + 1}
        `;
        row.appendChild(header);

        const lane = document.createElement('div');
        lane.className = 'track-lane';
        lane.style.width = (50 * 60) + 'px'; 

        lane.onclick = (e) => {
            if(e.target !== lane) return;
            const rect = lane.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const barIndex = Math.floor(clickX / 60);
            addClipToTrack(trackIndex, barIndex);
        };

        trackClips.forEach((clip, clipIndex) => {
            const width = clip.lengthBars * 60;
            const el = document.createElement('div');
            el.className = `clip ${clip.type === 'pattern' ? 'clip-pattern' : 'clip-audio'}`;
            el.style.left = (clip.startBar * 60) + 'px';
            el.style.width = width + 'px';
            
            const nameTag = document.createElement('div');
            nameTag.className = 'clip-name';
            
            let resName = "Unknown";
            if(clip.type === 'pattern' && state.patterns[clip.id]) resName = state.patterns[clip.id].name;
            if(clip.type === 'audio' && state.audioClips[clip.id]) resName = state.audioClips[clip.id].name;
            
            nameTag.innerText = resName;
            el.appendChild(nameTag);

            el.oncontextmenu = (e) => {
                e.preventDefault();
                state.playlist[trackIndex].splice(clipIndex, 1);
                renderPlaylist();
            };

            if(clip.type === 'audio' && state.audioClips[clip.id]) {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = 56;
                el.appendChild(canvas);
                const clipData = state.audioClips[clip.id];
                if (clipData.buffer) {
                    drawWaveform(clipData.buffer, canvas);
                } else if (clipData.isRecording) {
                    el.classList.add('clip-recording');
                    drawRecordingPlaceholder(canvas);
                }
            } else if (clip.type === 'pattern') {
                 const gridDiv = document.createElement('div');
                 gridDiv.style.width = '100%';
                 gridDiv.style.height = '100%';
                 gridDiv.style.opacity = '0.3';
                 gridDiv.style.backgroundImage = 'linear-gradient(90deg, transparent 50%, #fff 50%)';
                 gridDiv.style.backgroundSize = '4px 100%';
                 el.appendChild(gridDiv);
            }

            lane.appendChild(el);
        });

        row.appendChild(lane);
        container.appendChild(row);
    });
}

function drawRecordingPlaceholder(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(229,57,53,0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(229,57,53,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, canvas.height/2);
    ctx.lineTo(canvas.width-2, canvas.height/2);
    ctx.stroke();
}

function addClipToTrack(trackIndex, startBar) {
    if(!state.selectedResId) return;
    
    let length = 1;
    
    if(state.selectedResType === 'audio') {
        const clip = state.audioClips[state.selectedResId];
        if(!clip) return;
        const secondsPerBar = (60 / state.bpm) * state.timeSig; 
        length = Math.ceil(clip.duration / secondsPerBar);
        if(length < 1) length = 1;
    }

    state.playlist[trackIndex].push({
        type: state.selectedResType,
        id: state.selectedResId,
        startBar: startBar,
        lengthBars: length
    });
    renderPlaylist();
}

function drawWaveform(buffer, canvas) {
    if(!buffer) return;
    const ctx = canvas.getContext('2d');
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;
    
    ctx.fillStyle = "#03a9f4";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    for(let i=0; i < canvas.width; i++){
        let min = 1.0;
        let max = -1.0;
        for (let j=0; j<step; j++) {
            const datum = data[(i*step)+j]; 
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        ctx.fillRect(i, (1+min)*amp, 1, Math.max(1,(max-min)*amp));
    }
}

function renderChannelRack() {
    const container = document.getElementById('rack-rows');
    if(state.selectedResType !== 'pattern') return;

    container.innerHTML = '';
    const grid = state.patterns[state.selectedResId].grid;

    instruments.forEach((inst, idx) => {
        const row = document.createElement('div');
        row.className = 'instrument-row';

        const controls = document.createElement('div');
        controls.className = 'inst-controls';
        const label = document.createElement('div');
        label.className = 'inst-name';
        label.innerText = inst.name;
        label.onmousedown = () => previewInstrument(idx);
        controls.appendChild(label);
        row.appendChild(controls);

        const seq = document.createElement('div');
        seq.className = 'step-sequencer';
        
        // Ensure grid row exists (for safety if instrument count changed)
        if(!grid[idx]) grid[idx] = new Array(state.timeSig * 4).fill(false);

        grid[idx].forEach((active, stepIdx) => {
            const step = document.createElement('div');
            step.className = `step ${active ? 'active' : ''}`;
            step.dataset.step = stepIdx;
            
            // Visual Beat Markers (every 4 steps)
            if(stepIdx % 4 === 0) step.style.borderLeft = "1px solid #777";

            step.onmousedown = () => {
                grid[idx][stepIdx] = !grid[idx][stepIdx];
                renderChannelRack();
            };
            seq.appendChild(step);
        });

        row.appendChild(seq);
        container.appendChild(row);
    });
}

function previewInstrument(idx) {
    if(idx === 0) { if(drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(); }
    else if(idx === 1) { if(drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(); }
    else if(idx === 2) { hatSynth.triggerAttackRelease("32n"); }
    else if(idx === 3) { clapSynth.triggerAttackRelease("16n"); }
}

// --- CONTROLS ---
function setMode(mode) {
    state.mode = mode;
    document.getElementById('mode-pat').classList.toggle('active', mode === 'PATTERN');
    document.getElementById('mode-song').classList.toggle('active', mode === 'SONG');
    stopTransport();
}

function updateBPM(val) {
    state.bpm = parseInt(val);
    Tone.Transport.bpm.value = state.bpm;
}

function updateTimeSig(val) {
    state.timeSig = parseInt(val);
    // Note: Changing time sig mainly affects NEW patterns in this simple version
    // Existing patterns keep their length to avoid data loss/corruption
    alert("Time Signature updated! New patterns will be created in " + val + "/4.");
}

async function togglePlay() {
    if(state.isPlaying) {
        stopTransport();
    } else {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        updateBPM(state.bpm);
        Tone.Transport.start();
        state.isPlaying = true;
        document.getElementById('play-btn').classList.add('active');
    }
}

function stopTransport() {
    Tone.Transport.stop();
    activeSources.forEach(source => {
        try { source.stop(); } catch(e){}
    });
    activeSources = [];

    state.isPlaying = false;
    state.currentStep = 0;
    document.getElementById('play-btn').classList.remove('active');
    
    document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
    document.getElementById('playhead').style.left = '120px';
}

function setArmedTrack(trackIndex) {
    state.armedTrack = Math.max(0, Math.min(state.playlist.length - 1, trackIndex));
    renderPlaylist();
}

async function toggleRecord() {
    if(state.isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if(state.mode !== 'SONG') {
        alert('Recording is only available in SONG mode.');
        return;
    }

    if (Tone.context.state !== 'running') {
        await Tone.start();
    }

    // Request mic
    try {
        state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        alert('Microphone permission denied.');
        return;
    }

    const clipId = 'rec_' + Date.now();
    state.recordingClipId = clipId;
    state.recordingStartPerf = performance.now();

    // Create placeholder clip data
    state.audioClips[clipId] = {
        name: 'Recording...',
        buffer: null,
        url: null,
        isRecording: true
    };

    // Place clip at current playhead position
    const startBar = Math.floor(state.currentStep / 16);
    const track = state.playlist[state.armedTrack] || state.playlist[0];
    if(!state.playlist[state.armedTrack]) state.playlist[state.armedTrack] = track;

    track.push({ type: 'audio', id: clipId, startBar, lengthBars: 1 });
    renderPlaylist();

    // Start recorder
    const chunks = [];
    state.mediaRecorder = new MediaRecorder(state.mediaStream);
    state.mediaRecorder.ondataavailable = (ev) => { if(ev.data && ev.data.size) chunks.push(ev.data); };
    state.mediaRecorder.onstop = async () => {
        try {
            const blob = new Blob(chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const decoded = await Tone.context.rawContext.decodeAudioData(arrayBuffer);
            state.audioClips[clipId].buffer = decoded;
            state.audioClips[clipId].name = 'Recorded Audio';
            state.audioClips[clipId].isRecording = false;

            // Finalize length
            const secondsPerBar = (60 / state.bpm) * state.timeSig;
            const finalBars = Math.max(1, Math.ceil(decoded.duration / secondsPerBar));
            const t = state.playlist[state.armedTrack] || [];
            const item = t.find(c => c.id === clipId);
            if(item) item.lengthBars = finalBars;
        } catch (e) {
            console.error('Recording decode failed:', e);
            alert('Recording failed to decode.');
            delete state.audioClips[clipId];
        }

        renderPlaylist();
        cleanupRecordingStream();
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    document.getElementById('record-btn')?.classList.add('recording');

    // Grow the clip in real-time (FL-style)
    state.recordingTimer = setInterval(() => {
        const elapsed = (performance.now() - state.recordingStartPerf) / 1000;
        const secondsPerBar = (60 / state.bpm) * state.timeSig;
        const bars = Math.max(1, Math.ceil(elapsed / secondsPerBar));
        const t = state.playlist[state.armedTrack] || [];
        const item = t.find(c => c.id === clipId);
        if(item) {
            item.lengthBars = bars;
            renderPlaylist();
        }
    }, 200);
}

function stopRecording() {
    if(!state.isRecording) return;

    state.isRecording = false;
    document.getElementById('record-btn')?.classList.remove('recording');

    if(state.recordingTimer) {
        clearInterval(state.recordingTimer);
        state.recordingTimer = null;
    }

    try {
        state.mediaRecorder?.stop();
    } catch(e) {
        cleanupRecordingStream();
    }
}

function cleanupRecordingStream() {
    try {
        state.mediaStream?.getTracks()?.forEach(t => t.stop());
    } catch(e) {}
    state.mediaStream = null;
    state.mediaRecorder = null;
    state.recordingClipId = null;
}

// --- CLOCK ---
Tone.Transport.scheduleRepeat((time) => {
    const step = state.currentStep;
    const totalSteps = state.timeSig * 4; // 16 for 4/4, 12 for 3/4
    
    // Visuals
    Tone.Draw.schedule(() => {
        document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
        document.querySelectorAll(`.step[data-step="${step % totalSteps}"]`).forEach(s => s.classList.add('playing'));

        if(state.mode === 'SONG') {
            const px = 120 + (step * 3.75);
            const playhead = document.getElementById('playhead');
            playhead.style.left = px + 'px';
            
            const scrollBox = document.getElementById('playlist-scroll');
            if(px > scrollBox.scrollLeft + scrollBox.clientWidth) {
                scrollBox.scrollLeft = px - 150;
            }
        }
    }, time);

    // Audio Logic
    if(state.mode === 'PATTERN') {
        if(state.selectedResType === 'pattern') {
            const grid = state.patterns[state.selectedResId].grid;
            // Wrap step around current pattern length
            const localStep = step % grid[0].length; 
            playPatternStep(grid, localStep, time);
        }
    } 
    else if (state.mode === 'SONG') {
        // Calculate Bar and Step
        const currentBar = Math.floor(step / 16); // Assuming standard 4/4 grid logic for arrangement for now
        const stepInBar = step % 16;

        state.playlist.forEach(track => {
            track.forEach(clip => {
                if(currentBar >= clip.startBar && currentBar < clip.startBar + clip.lengthBars) {
                    if(clip.type === 'pattern') {
                        // Check if pattern has data at this step
                        if(state.patterns[clip.id]) {
                            const grid = state.patterns[clip.id].grid;
                            const patStep = stepInBar % grid[0].length; // Handle different time sigs gracefully
                            playPatternStep(grid, patStep, time);
                        }
                    } 
                    if(clip.type === 'audio' && currentBar === clip.startBar && stepInBar === 0) {
                        playAudioClip(clip.id, time);
                    }
                }
            });
        });
    }

    state.currentStep++;

}, "16n");

function playPatternStep(grid, stepIdx, time) {
    // 0: Kick
    if(grid[0] && grid[0][stepIdx]) {
        if(drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(time, 0, "16n");
    }
    // 1: Snare
    if(grid[1] && grid[1][stepIdx]) {
        if(drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(time, 0, "16n");
    }
    // 2: HiHat
    if(grid[2] && grid[2][stepIdx]) {
        hatSynth.triggerAttackRelease("32n", time);
    }
    // 3: Clap
    if(grid[3] && grid[3][stepIdx]) {
        clapSynth.triggerAttackRelease("16n", time);
    }
}

function playAudioClip(id, time) {
    const clipData = state.audioClips[id];
    if(!clipData || !clipData.buffer) return;

    try {
        const source = new Tone.BufferSource({
            buffer: clipData.buffer
        }).toDestination();
        
        source.start(time);
        activeSources.push(source);
        
        source.onended = () => {
            const index = activeSources.indexOf(source);
            if (index > -1) activeSources.splice(index, 1);
        };
    } catch (e) {
        console.error("Audio playback error:", e);
    }
}

function clearCurrentPattern() {
    if(state.selectedResType === 'pattern') {
        state.patterns[state.selectedResId].grid = createEmptyGrid(state.timeSig);
        renderChannelRack();
    }
}

window.addEventListener('load', init);
