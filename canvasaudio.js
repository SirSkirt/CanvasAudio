
// --- APP VERSION ---
const APP_STAGE = "Alpha";
const APP_VERSION = "0.3.1";
window.CA_VERSION = APP_VERSION;
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
    audioReady: false,
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

    // Per-track input selection (deviceId from enumerateDevices)
    trackInputDeviceIds: Array(8).fill(null),

    // Track FX slots (UI only for now)
    trackFxSlots: Array.from({length: 8}, () => Array(10).fill(null)),
    trackFxSlotEnabled: Array.from({length: 8}, () => Array(10).fill(true)),
    recordingStartPerf: 0,
    recordingTimer: null,
    
    patterns: { 'pat1': { id:'pat1', name: "Pattern 1", grid: createEmptyGrid(4) } },
    audioClips: {}, 
    
    selectedResType: 'pattern',
    selectedResId: 'pat1',
    
    playlist: [] 
    ,playheadStep: 0
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


// --- Mixer Window ---
function openMixerWindow(){
    const ov = document.getElementById('mixerOverlay');
    const body = document.getElementById('mixerBody');
    if(!ov || !body) return;
    ov.style.display = 'flex';
    renderMixerUI();
}
function closeMixerWindow(){
    const ov = document.getElementById('mixerOverlay');
    if(ov) ov.style.display = 'none';
}

function ensureMixerState(){
    state.mixer = state.mixer || {
        enabled:true,
        trackNames: Array.from({length:8}, (_,i)=>`Track ${i+1}`),
        volumes: Array(8).fill(1),
        pans: Array(8).fill(0),
        mutes: Array(8).fill(false),
        solos: Array(8).fill(false)
    };
}

function renderMixerUI(){
    ensureMixerState();
    const body = document.getElementById('mixerBody');
    if(!body) return;
    body.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'mixer-grid';
    for(let i=0;i<8;i++){
        const strip = document.createElement('div');
        strip.className = 'mixer-strip';
        const title = document.createElement('div');
        title.className = 'strip-title';
        title.textContent = state.mixer.trackNames[i] || `Track ${i+1}`;
        strip.appendChild(title);

        const btns = document.createElement('div');
        btns.className = 'strip-btns';
        const mBtn = document.createElement('button');
        mBtn.className = 'strip-btn'+(state.mixer.mutes[i]?' active':'');
        mBtn.textContent='M';
        mBtn.onclick=()=>{ state.mixer.mutes[i]=!state.mixer.mutes[i];
            applyMixerToAudio(i); renderMixerUI(); };
        const sBtn = document.createElement('button');
        sBtn.className = 'strip-btn'+(state.mixer.solos[i]?' active':'');
        sBtn.textContent='S';
        sBtn.onclick=()=>{ state.mixer.solos[i]=!state.mixer.solos[i];
            applyMixerToAudio(i); renderMixerUI(); };
        btns.appendChild(mBtn); btns.appendChild(sBtn);
        strip.appendChild(btns);

        const meter = document.createElement('div');
        meter.className = 'vert-meter';
        const fill = document.createElement('div');
        fill.className = 'meter-fill';
        fill.style.height = '0%';
        meter.appendChild(fill);
        const vol = document.createElement('input');
        vol.type='range';
        vol.min='0'; vol.max='1'; vol.step='0.01';
        vol.value=String(state.mixer.volumes[i] ?? 1);
        vol.oninput=(e)=>{ state.mixer.volumes[i]=parseFloat(e.target.value);
            applyMixerToAudio(i); };
        meter.appendChild(vol);
        strip.appendChild(meter);

        const panRow = document.createElement('div');
        panRow.className='pan-row';
        const panLab=document.createElement('div');
        panLab.className='pan-label';
        panLab.textContent='PAN';
        const pan=document.createElement('input');
        pan.type='range';
        pan.min='-1'; pan.max='1'; pan.step='0.01';
        pan.value=String(state.mixer.pans[i] ?? 0);
        pan.oninput=(e)=>{ state.mixer.pans[i]=parseFloat(e.target.value);
            applyMixerToAudio(i); };
        panRow.appendChild(panLab);
        panRow.appendChild(pan);
        strip.appendChild(panRow);

        grid.appendChild(strip);
    }
    body.appendChild(grid);
}

// --- Track Input Menu ---
async function openTrackInputMenu(trackIndex){
    const ov = document.getElementById('inputMenuOverlay');
    const body = document.getElementById('inputMenuBody');
    if(!ov || !body) return;
    ov.style.display='flex';
    body.innerHTML = '<div style="opacity:0.85; font-size:12px; margin-bottom:10px;">Select an input device for this track (WIP).</div>';

    let devices=[];
    try{
        const all = await navigator.mediaDevices.enumerateDevices();
        devices = all.filter(d=>d.kind==='audioinput');
    }catch(e){
        devices=[];
    }
    if(devices.length===0){
        const item=document.createElement('div');
        item.className='input-item';
        item.innerHTML='<div>No input devices found (or permission not granted yet).</div>';
        const btn=document.createElement('button');
        btn.textContent='Close';
        btn.onclick=closeTrackInputMenu;
        item.appendChild(btn);
        body.appendChild(item);
        return;
    }

    devices.forEach(d=>{
        const item=document.createElement('div');
        item.className='input-item';
        const left=document.createElement('div');
        left.textContent=d.label || 'Audio Input';
        const btn=document.createElement('button');
        const selected = state.trackInputDeviceId?.[trackIndex]===d.deviceId;
        btn.className = selected ? 'primary' : '';
        btn.textContent = selected ? 'Selected' : 'Select';
        btn.onclick=()=>{ state.trackInputDeviceId[trackIndex]=d.deviceId; closeTrackInputMenu(); renderPlaylistTracks(); };
        item.appendChild(left); item.appendChild(btn);
        body.appendChild(item);
    });
}
function closeTrackInputMenu(){
    const ov = document.getElementById('inputMenuOverlay');
    if(ov) ov.style.display='none';
}


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
    // Audio engine starts only after explicit user action via the Audio panel.
    setupAudioStatusPanel();
    setupPlayheadScrub();
    setupMainMenu();
    setVersionLabel();

}

function setupPlayheadScrub(){
    const scroll = document.getElementById('playlist-scroll');
    if(!scroll) return;

    // Click on empty area to move playhead.
    scroll.addEventListener('mousedown', (e)=>{
        // Only in SONG mode; also ignore when clicking on a clip (those handle their own drag).
        if(state.mode !== 'SONG') return;
        const target = e.target;
        if(target && (target.classList?.contains('clip') || target.closest?.('.clip'))) return;

        const rect = scroll.getBoundingClientRect();
        const x = (e.clientX - rect.left) + scroll.scrollLeft;
        const step = Math.round((x - 120) / 3.75);
        setPlayheadStep(step);
    });
}



// --- VERSION LABEL ---
function setVersionLabel(){
    const el = document.getElementById('versionLabel');
    if(el) el.innerText = "v" + APP_VERSION;
}

// --- MAIN MENU (WIP) ---
function setupMainMenu(){
    const overlay = document.getElementById('mainMenuOverlay');
    if(!overlay) return;

    const close = () => { overlay.style.display = 'none'; };

    const btnNew = document.getElementById('menuNewProject');
    const btnOpen = document.getElementById('menuOpenProject');
    const btnRecent = document.getElementById('menuRecentProject');

    if(btnNew) btnNew.onclick = close;
    if(btnOpen) btnOpen.onclick = close;
    if(btnRecent) btnRecent.onclick = close;
}

// --- AUDIO READY PANEL ---
function updateAudioStatusUI(){
    const text = document.getElementById('audioStatusText');
    const btn  = document.getElementById('audioToggleBtn');

    const ready = (Tone.context && Tone.context.state === 'running');
    state.audioReady = ready;

    if(text) text.innerText = ready ? "Audio Ready" : "Audio Not Ready";
    if(btn)  btn.innerText  = ready ? "Stop" : "Start";
}

async function startAudioEngine(){
    if(Tone.context && Tone.context.state !== 'running'){
        await Tone.start(); // resumes AudioContext after user gesture
    }
    updateAudioStatusUI();
}

async function stopAudioEngine(){
    try{
        if(Tone.Transport && Tone.Transport.state === 'started'){
            Tone.Transport.stop();
        }
        if(Tone.context && Tone.context.state === 'running'){
            await Tone.context.suspend();
        }
    }catch(e){}
    updateAudioStatusUI();
}

function setupAudioStatusPanel(){
    const btn = document.getElementById('audioToggleBtn');
    if(btn){
        btn.onclick = async () => {
            updateAudioStatusUI();
            if(state.audioReady) await stopAudioEngine();
            else await startAudioEngine();
        };
    }
    updateAudioStatusUI();
}

// Ensure audio is running for actions that need real-time playback/recording.
async function ensureAudioReady(){
    if(Tone.context && Tone.context.state === 'running'){
        state.audioReady = true;
        return true;
    }
    // Do not auto-start on load; but if the user presses play/record, start now (user gesture).
    await startAudioEngine();
    return (Tone.context && Tone.context.state === 'running');
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

// --- Track Arm/Input/FX UI ---

let _trackUiStyleInjected = false;
function ensureTrackUiStyles(){
    if(_trackUiStyleInjected) return;
    _trackUiStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        .track-buttons{ display:flex; gap:6px; align-items:center; margin-top:6px; }
        .track-btn{ width:26px; height:20px; border-radius:4px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.35); color:#ddd; display:flex; align-items:center; justify-content:center; cursor:pointer; }
        .track-btn:hover{ background:rgba(255,255,255,0.08); }
        .track-arm-ind{ width:12px; height:12px; border-radius:999px; border:2px solid rgba(255,70,70,0.9); background:rgba(0,0,0,0.1); }
        .track-arm-ind.armed{ background:rgba(255,70,70,0.95); box-shadow:0 0 8px rgba(255,70,70,0.6); }
        .track-mic{ font-size:13px; line-height:1; }
        .track-fx{ font-size:12px; font-weight:700; letter-spacing:0.4px; }
        /* FX window */
        #fxOverlay{ position:fixed; inset:0; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; z-index:9999; }
        #fxWindow{ width:min(560px, 92vw); max-height:min(80vh, 720px); overflow:auto; background:#1f1f1f; border:1px solid rgba(255,255,255,0.14); border-radius:10px; box-shadow:0 16px 50px rgba(0,0,0,0.6); }
        #fxHeader{ display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.10); font-weight:700; }
        #fxBody{ padding:12px 14px 16px; }
        .fxSlot{ display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.08); }
        .fxSlot:last-child{ border-bottom:none; }
        .fxSlotLabel{ width:64px; opacity:0.9; }
        .fxSlotSelect{ flex:1; }
        .fxSlotToggle{ width:22px; height:22px; border-radius:6px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.35); color:#ddd; cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .fxSlotToggle.off{ opacity:0.35; }
        .fxSmall{ font-size:12px; opacity:0.75; margin-top:10px; }

        /* FX window inner layout (0.3.0 placeholder DOM) */
        .fxwin-header{ display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.10); }
        .fxwin-titlebar{ font-weight:700; color:#e6e6e6; }
        .fxwin-body{ padding:12px 14px 16px; }
        #fxPluginSelect{ background:rgba(0,0,0,0.35); color:#ddd; border:1px solid rgba(255,255,255,0.18); border-radius:6px; height:26px; padding:0 8px; }
        #fxAddPluginBtn, #fxCloseBtn{ width:auto; height:26px; border-radius:6px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.35); color:#ddd; padding:0 10px; cursor:pointer; }
        #fxAddPluginBtn:hover, #fxCloseBtn:hover{ background:rgba(255,255,255,0.08); }
    `;
    document.head.appendChild(style);

    if(!document.getElementById('fxOverlay')){
        const overlay = document.createElement('div');
        overlay.id = 'fxOverlay';
        overlay.innerHTML = `
            <div id="fxWindow">
                <div id="fxHeader">
                    <div id="fxTitle">Track FX</div>
                    <button id="fxClose" class="track-btn" style="width:28px;height:24px;">✕</button>
                </div>
                <div id="fxBody"></div>
            </div>
        `;
        overlay.addEventListener('mousedown', (e)=>{ if(e.target === overlay) closeFxWindow(); });
        document.body.appendChild(overlay);
        document.getElementById('fxClose').onclick = closeFxWindow;
    }
}

function openInputPicker(trackIndex){
    // Mobile-friendly: simple prompt list.
    if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices){
        alert('Input selection not supported on this browser.');
        return;
    }
    navigator.mediaDevices.enumerateDevices().then(devices=>{
        const mics = devices.filter(d=>d.kind === 'audioinput');
        if(!mics.length){
            alert('No audio inputs found.');
            return;
        }
        const current = state.trackInputDeviceIds?.[trackIndex] || '';
        const lines = mics.map((d,i)=>`${i+1}) ${d.label || 'Microphone'}${d.deviceId===current?' (selected)':''}`);
        const choice = prompt(`Select input for Track ${trackIndex+1}:\n` + lines.join('\n') + `\n\nEnter number 1-${mics.length} (cancel to keep current).`);
        if(!choice) return;
        const idx = parseInt(choice,10);
        if(!Number.isFinite(idx) || idx < 1 || idx > mics.length) return;
        if(!state.trackInputDeviceIds) state.trackInputDeviceIds = Array(8).fill(null);
        state.trackInputDeviceIds[trackIndex] = mics[idx-1].deviceId;
        renderPlaylist(); // refresh small tooltip/icons if needed
    }).catch(()=>{
        alert('Unable to enumerate audio devices. (Permission may be required)');
    });
}

let _fxTrackIndex = null;
function openFxWindow(trackIndex){
    // Plugin registry comes from plugin.js (window.CA_PLUGINS)
    if(!window.CA_PLUGINS){ window.CA_PLUGINS = []; }

    const overlay = document.getElementById('fxOverlay');
    const win = document.getElementById('fxWindow');
    const title = document.getElementById('fxWinTitle');
    const body = document.getElementById('fxWinBody');

    if(!overlay || !win || !title || !body){
        console.warn('FX window elements missing in DOM');
        return;
    }

    overlay.style.display = 'flex';
    win.style.display = 'block';
    title.textContent = 'FX (Track ' + (trackIndex+1) + ')';

    state.trackPlugins = state.trackPlugins || Array(8).fill(0).map(()=>Array(10).fill(null));
    state.trackPluginStates = state.trackPluginStates || Array(8).fill(0).map(()=>Array(10).fill(null));
    const slots = state.trackPlugins[trackIndex];


    // Wire placeholder header controls (0.3.0 FX DOM)
    const pluginSelectTop = document.getElementById('fxPluginSelect');
    const addBtnTop = document.getElementById('fxAddPluginBtn');
    const closeBtnTop = document.getElementById('fxCloseBtn');


    if(pluginSelectTop){
        pluginSelectTop.onchange = ()=> {
            const editorSel = body.querySelector('select.fx-plugin-select');
            if(editorSel) editorSel.value = pluginSelectTop.value;
        };
    }
    if(closeBtnTop) closeBtnTop.onclick = ()=>closeFxWindow();
    // click outside to close
    overlay.onmousedown = (e)=>{ if(e.target === overlay) closeFxWindow(); };

    body.innerHTML = '';

    const header = document.createElement('div');
    header.style.display='flex';
    header.style.justifyContent='space-between';
    header.style.alignItems='center';
    header.style.marginBottom='8px';

    const left = document.createElement('div');
    left.style.color='#ccc';
    left.style.fontSize='12px';
    left.textContent='Slots (click to select)';
    header.appendChild(left);

    const closeBtn = document.createElement('button');
    closeBtn.textContent='Close';
    closeBtn.className='btn';
    closeBtn.onclick=()=>closeFxWindow();
    header.appendChild(closeBtn);

    body.appendChild(header);

    const slotList = document.createElement('div');
    slotList.className = 'fx-slot-list';
    body.appendChild(slotList);

    const editor = document.createElement('div');
    editor.style.marginTop='10px';
    editor.style.paddingTop='10px';
    editor.style.borderTop='1px solid rgba(255,255,255,0.08)';
    body.appendChild(editor);

    let selectedSlot = 0;


    const syncTopSelect = ()=>{
        if(!pluginSelectTop) return;
        pluginSelectTop.innerHTML = '';
        const emptyOpt=document.createElement('option');
        emptyOpt.value=''; emptyOpt.textContent='(empty)';
        pluginSelectTop.appendChild(emptyOpt);
        (window.CA_PLUGINS||[]).forEach(p=>{
            const o=document.createElement('option');
            o.value=p.id; o.textContent=p.name;
            pluginSelectTop.appendChild(o);
        });
        pluginSelectTop.value = slots[selectedSlot]?.id || '';
    };

    if(addBtnTop){
        addBtnTop.onclick = ()=>{
            const pid = pluginSelectTop ? pluginSelectTop.value : '';
            if(!pid){
                removePluginFromTrackSlot(trackIndex, selectedSlot);
                render();
                return;
            }
            setPluginToTrackSlot(trackIndex, selectedSlot, pid);
            render();
        };
    }
    const renderEditor = ()=>{
        editor.innerHTML='';
        const inst = slots[selectedSlot];

        const row = document.createElement('div');
        row.style.display='flex';
        row.style.alignItems='center';
        row.style.gap='8px';
        row.style.flexWrap='wrap';

        const sel = document.createElement('select');
        sel.className='fx-plugin-select';
        const emptyOpt=document.createElement('option');
        emptyOpt.value=''; emptyOpt.textContent='(empty)';
        sel.appendChild(emptyOpt);
        (window.CA_PLUGINS||[]).forEach(p=>{
            const o=document.createElement('option');
            o.value=p.id; o.textContent=p.name;
            sel.appendChild(o);
        });
        sel.value = inst?.id || '';
        sel.onchange = ()=>{ if(pluginSelectTop) pluginSelectTop.value = sel.value; };
        row.appendChild(sel);

        const setBtn=document.createElement('button');
        setBtn.className='btn';
        setBtn.textContent='Set';
        setBtn.onclick=()=>{
            const pid = sel.value;
            if(!pid){
                removePluginFromTrackSlot(trackIndex, selectedSlot);
                render();
                return;
            }
            setPluginToTrackSlot(trackIndex, selectedSlot, pid);
            render();
        };
        row.appendChild(setBtn);

        const editBtn=document.createElement('button');
        editBtn.className='btn';
        editBtn.textContent='Edit';
        editBtn.disabled = !inst;
        editBtn.onclick=()=>{ openPluginEditor(trackIndex, selectedSlot); };
        row.appendChild(editBtn);

        const clearBtn=document.createElement('button');
        clearBtn.className='btn';
        clearBtn.textContent='Clear';
        clearBtn.disabled = !inst;
        clearBtn.onclick=()=>{ removePluginFromTrackSlot(trackIndex, selectedSlot); render(); };
        row.appendChild(clearBtn);

        editor.appendChild(row);

        const help=document.createElement('div');
        help.style.color='#888'; help.style.fontSize='11px'; help.style.marginTop='6px';
        help.textContent='Set loads a plugin into the selected slot. Edit opens the plugin UI.';
        editor.appendChild(help);
    };

    const render = ()=>{
        slotList.innerHTML='';
        for(let i=0;i<10;i++){
            const slot = document.createElement('div');
            slot.className='fx-slot' + (i===selectedSlot?' selected':'');
            slot.onclick=()=>{ selectedSlot=i; render(); };

            const label = document.createElement('div');
            label.className='fx-slot-label';
            label.textContent = 'Slot ' + (i+1);
            slot.appendChild(label);

            const name = document.createElement('div');
            name.className='fx-slot-name';
            name.textContent = slots[i]?.name || '(empty)';
            slot.appendChild(name);

            slotList.appendChild(slot);
        }
        renderEditor();
        syncTopSelect();
    };

    render();
}


function closeFxWindow(){
    const overlay = document.getElementById('fxOverlay');
    if(overlay) overlay.style.display = 'none';
    _fxTrackIndex = null;
}

function ensureTrackAudio(trackIndex){
    state._audioTracks = state._audioTracks || Array(8).fill(null);
    if(state._audioTracks[trackIndex]) return state._audioTracks[trackIndex];

    const dest = Tone.getDestination ? Tone.getDestination() : Tone.Destination;

    const input = new Tone.Gain(1);
    const pan = new Tone.Panner(0);
    const vol = new Tone.Gain(1);

    input.connect(pan);
    pan.connect(vol);
    vol.connect(dest);

    const track = { input, pan, vol, plugins: Array(10).fill(null) };
    state._audioTracks[trackIndex] = track;

    applyMixerToAudio(trackIndex);
    rebuildTrackFxChain(trackIndex);

    return track;
}

function applyMixerToAudio(trackIndex){
    if(!state || !state.mixer) return;
    const t = (state._audioTracks && state._audioTracks[trackIndex]) ? state._audioTracks[trackIndex] : null;
    if(!t) return;

    const v = state.mixer.volumes?.[trackIndex];
    const p = state.mixer.pans?.[trackIndex];
    const m = state.mixer.mutes?.[trackIndex];

    try{ t.vol.gain.value = (m ? 0 : (typeof v==='number' ? v : 1)); }catch(e){}
    try{ t.pan.pan.value = (typeof p==='number' ? p : 0); }catch(e){}
}

function rebuildTrackFxChain(trackIndex){
    const t = ensureTrackAudio(trackIndex);

    // Clear any existing chain from track input
    try{ t.input.disconnect(); }catch(e){}
    let cursor = t.input;

    const slots = (state.trackPlugins && state.trackPlugins[trackIndex]) ? state.trackPlugins[trackIndex] : [];

    for(let i=0;i<10;i++){
        const inst = slots[i];
        if(!inst) continue;

        // Support plugins that expose a separate input/output (composite nodes)
        const inNode = inst.inputNode || (inst.node && inst.node.inputNode) || null;
        const outNode = inst.outputNode || (inst.node && inst.node.outputNode) || null;

        if(inNode && outNode){
            try{ cursor.connect(inNode); }catch(e){}
            cursor = outNode;
            continue;
        }

        if(inst.node){
            try{ cursor.connect(inst.node); }catch(e){}
            cursor = inst.node;
        }
    }

    try{ cursor.connect(t.pan); }catch(e){}
}

function setPluginToTrackSlot(trackIndex, slotIndex, pluginId){
    state.trackPlugins = state.trackPlugins || Array(8).fill(0).map(()=>Array(10).fill(null));
    state.trackPluginStates = state.trackPluginStates || Array(8).fill(0).map(()=>Array(10).fill(null));
    const def = (window.CA_PLUGINS||[]).find(p=>p.id===pluginId);
    if(!def) return null;

    removePluginFromTrackSlot(trackIndex, slotIndex);

    const inst = def.create({ trackIndex, slotIndex });
    state.trackPlugins[trackIndex][slotIndex] = inst;

    // Restore saved plugin state (if any)
    const saved = state.trackPluginStates?.[trackIndex]?.[slotIndex];
    if(saved && inst && typeof inst.setState === 'function'){
        try{ inst.setState(saved); }catch(e){}
    }

    rebuildTrackFxChain(trackIndex);
    return inst;
}

function removePluginFromTrackSlot(trackIndex, slotIndex){

    if(!state.trackPlugins || !state.trackPlugins[trackIndex]) return;
    const inst = state.trackPlugins[trackIndex][slotIndex];

    // Persist plugin state before removing (if supported)
    state.trackPluginStates = state.trackPluginStates || Array(8).fill(0).map(()=>Array(10).fill(null));
    if(inst && typeof inst.getState === 'function'){
        try{ state.trackPluginStates[trackIndex][slotIndex] = inst.getState(); }catch(e){}
    }
    if(inst){
        // Prefer instance-level dispose (lets plugins clear timers, etc.)
        try{ if(typeof inst.dispose === 'function') inst.dispose(); }catch(e){}
        // Fallback for legacy instances
        if(inst.node){
            try{ if(inst.node.dispose) inst.node.dispose(); }catch(e){}
        }
    }
    state.trackPlugins[trackIndex][slotIndex] = null;
    rebuildTrackFxChain(trackIndex);
}

function openPluginEditor(trackIndex, slotIndex){
    const inst = state.trackPlugins?.[trackIndex]?.[slotIndex];
    if(!inst) return;
    const def = (window.CA_PLUGINS||[]).find(p=>p.id===inst.id) || null;

    // Support both plugin.js style (instance.mountUI) and legacy style (def.createUI / def.mountUI)
    const mountFn =
        (inst && typeof inst.mountUI === 'function') ? ((mount)=>inst.mountUI(mount)) :
        (def && typeof def.mountUI === 'function') ? ((mount)=>def.mountUI(inst, mount)) :
        (def && typeof def.createUI === 'function') ? ((mount)=>def.createUI(inst, mount)) :
        null;

    if(!mountFn) return;

    const overlay = document.getElementById('fxOverlay');
    if(!overlay) return;

    const modal = document.createElement('div');
    modal.style.position='fixed';
    modal.style.left='50%';
    modal.style.top='50%';
    modal.style.transform='translate(-50%,-50%)';
    modal.style.width='520px';
    modal.style.maxWidth='92vw';
    modal.style.maxHeight='80vh';
    modal.style.overflow='auto';
    modal.style.background='#1a1a1a';
    modal.style.border='1px solid rgba(255,255,255,0.12)';
    modal.style.borderRadius='10px';
    modal.style.boxShadow='0 12px 40px rgba(0,0,0,0.6)';
    modal.style.padding='12px';
    modal.style.zIndex='100000';

    const head=document.createElement('div');
    head.style.display='flex';
    head.style.justifyContent='space-between';
    head.style.alignItems='center';
    head.style.marginBottom='10px';

    const h=document.createElement('div');
    h.textContent = (inst.name||'Plugin') + ' — Track ' + (trackIndex+1) + ' Slot ' + (slotIndex+1);
    h.style.color='#eee';
    h.style.fontSize='14px';
    head.appendChild(h);

    const x=document.createElement('button');
    x.textContent='✕';
    x.className='btn';
    x.onclick=()=>{ try{ state.trackPluginStates = state.trackPluginStates || Array(8).fill(0).map(()=>Array(10).fill(null)); if(inst && typeof inst.getState==='function'){ state.trackPluginStates[trackIndex][slotIndex] = inst.getState(); } }catch(e){} modal.remove(); };
    head.appendChild(x);

    modal.appendChild(head);

    const mount=document.createElement('div');
    modal.appendChild(mount);

    mountFn(mount);

    overlay.appendChild(modal);
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
    ensureTrackUiStyles();
    container.innerHTML = '';

    state.playlist.forEach((trackClips, trackIndex) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        
        const header = document.createElement('div');
        header.className = 'track-header';
        header.innerHTML = `
            <div class="track-buttons">
                <button class="arm-btn ${state.armedTrack === trackIndex ? 'active' : ''}" onclick="setArmedTrack(${trackIndex})" title="Arm Track">
                    <div class="track-arm-ind ${state.armedTrack === trackIndex ? 'armed' : ''}"></div>
                </button>
                <button class="track-btn input-btn" onclick="openInputPicker(${trackIndex})" title="Input">
                    <span class="track-mic">🎤</span>
                </button>
                <button class="track-btn fx-btn" onclick="openFxWindow(${trackIndex})" title="FX">
                    <span class="track-fx">FX</span>
                </button>
            </div>
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
updateBPM(state.bpm);
        // Start from the current playhead position (SONG mode) instead of forcing step 0.
        if(state.mode === 'SONG'){
            if(typeof state.playheadStep !== 'number') state.playheadStep = 0;
            state.currentStep = Math.max(0, state.playheadStep|0);
            // If starting mid-song, start any overlapping audio clips at the correct offset.
            try{ startOverlappingAudioAtPlayhead(Tone.now()); }catch(e){}
        }

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
    // Keep playhead where playback stopped.
    state.playheadStep = Math.max(0, state.currentStep|0);
    document.getElementById('play-btn').classList.remove('active');
    
    document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
    updatePlayheadUIFromStep(state.playheadStep);
}

// --- PLAYHEAD (SONG MODE) ---
function updatePlayheadUIFromStep(step){
    try{
        const px = 120 + (step * 3.75);
        const playhead = document.getElementById('playhead');
        if(playhead) playhead.style.left = px + 'px';
    }catch(e){}
}

function setPlayheadStep(step){
    step = Math.max(0, step|0);
    state.playheadStep = step;
    if(!state.isPlaying){
        state.currentStep = step;
        updatePlayheadUIFromStep(step);
    }
}

function startOverlappingAudioAtPlayhead(when){
    if(state.mode !== 'SONG') return;
    const step = Math.max(0, state.currentStep|0);
    const secondsPerBar = (60 / state.bpm) * state.timeSig;
    const secondsPerStep = secondsPerBar / 16;

    const curBar = Math.floor(step / 16);
    const stepInBar = step % 16;
    const curTimeSec = (curBar * secondsPerBar) + (stepInBar * secondsPerStep);

    state.playlist.forEach((track, trackIndex)=>{
        track.forEach(clip=>{
            if(clip.type !== 'audio') return;
            const clipData = state.audioClips?.[clip.id];
            if(!clipData || !clipData.buffer) return;
            const clipStartSec = (clip.startBar * secondsPerBar);
            const clipEndSec = clipStartSec + (clip.lengthBars * secondsPerBar);
            if(curTimeSec >= clipStartSec && curTimeSec < clipEndSec){
                const offset = Math.max(0, curTimeSec - clipStartSec);
                playAudioClip(clip.id, when, trackIndex, offset);
            }
        });
    });
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


function buildAudioConstraints(){
    // If a track has a selected input device, request that specific device.
    try{
        const t = state.armedTrack;
        const deviceId = (state.trackInputDeviceIds && t != null) ? state.trackInputDeviceIds[t] : null;
        if(deviceId){
            return { audio: { deviceId: { exact: deviceId } } };
        }
    }catch(e){}
    return { audio: true };
}

async function startRecording() {
    await ensureAudioReady();
    if(state.mode !== 'SONG') {
        alert('Recording is only available in SONG mode.');
        return;
    }
// Request mic
    try {
        state.mediaStream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints());
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

        state.playlist.forEach((track, trackIndex) => {
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
                        playAudioClip(clip.id, time, trackIndex);
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

function playAudioClip(id, time, trackIndex, offsetSeconds) {
            const clipData = state.audioClips[id];
            if (!clipData) return;

            // Accept either a raw AudioBuffer (clipData.buffer) or Tone.Buffer (clipData.toneBuffer)
            const rawBuffer = clipData.buffer && (clipData.buffer.getChannelData ? clipData.buffer : null);

            if (!rawBuffer) return;

            try {
                const ctx = Tone.context.rawContext;

                // Schedule in AudioContext time using Tone's scheduled time
                const when = (typeof time === "number") ? time : ctx.currentTime;

                const src = ctx.createBufferSource();
                src.buffer = rawBuffer;

                // Destination: connect directly to raw destination to avoid Tone wrapper issues in iframes/PWA
                const t = ensureTrackAudio((typeof trackIndex==='number' && trackIndex>=0) ? trackIndex : 0);
                const inNode = (t.input && t.input.input) ? t.input.input : t.input;
                // Always route through the track chain (FX -> Pan -> Vol -> Destination)
                src.connect(inNode);

                const off = (typeof offsetSeconds === 'number' && isFinite(offsetSeconds)) ? Math.max(0, offsetSeconds) : 0;
                try{ src.start(when, off); }catch(e){ src.start(when); }

                // Track active sources so Stop works
                activeSources.push(src);

                src.onended = () => {
                    const i = activeSources.indexOf(src);
                    if (i > -1) activeSources.splice(i, 1);
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
    // --- ELECTRON WINDOW CONTROLS ---
// Check if running in Electron before running this code
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');

    document.getElementById('btn-min').addEventListener('click', () => {
        ipcRenderer.send('app/minimize');
    });

    document.getElementById('btn-max').addEventListener('click', () => {
        ipcRenderer.send('app/maximize');
    });

    document.getElementById('btn-close').addEventListener('click', () => {
        ipcRenderer.send('app/close');
    });

    // TODO: Add click handlers for your .menu-item elements here
    // to open dropdowns or trigger save actions.
}
}

window.addEventListener('load', init);
