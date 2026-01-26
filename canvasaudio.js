<!— canvasaudio.js (fixed) —>
/* NOTE: This file is provided exactly as a drop-in replacement.
   Only the audio-clip playback function was changed to use native
   AudioBufferSourceNode for compatibility with raw AudioBuffer. */

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
            
            patterns: { 'pat1': { id:'pat1', name: "Pattern 1", grid: createEmptyGrid() } },
            audioClips: {}, 
            
            selectedResType: 'pattern',
            selectedResId: 'pat1',
            
            playlist: [] 
        };

        for(let i=0; i<8; i++) state.playlist.push([]);

        // --- AUDIO ENGINE (HYBRID) ---
        
        // 1. SAMPLES
        const drumSamples = new Tone.Players({
            "Kick": "https://tonejs.github.io/audio/drum-samples/Techno/kick.mp3",
            "Snare": "https://tonejs.github.io/audio/drum-samples/Techno/snare.mp3"
        }).toDestination();

        // 2. SYNTHS
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

        // --- INITIALIZATION ---
        function init() {
            generateRuler();
            renderResources();
            renderPlaylist();
            renderChannelRack();
            selectResource('pattern', 'pat1');
            Tone.Transport.bpm.value = 128;
        }

        // --- DATA HELPERS ---
        function createEmptyGrid() {
            return instruments.map(() => new Array(16).fill(false));
        }

        function createNewPattern() {
            const id = 'pat' + Date.now();
            state.patterns[id] = { id, name: `Pattern ${Object.keys(state.patterns).length + 1}`, grid: createEmptyGrid() };
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

            // 1. Wake up Audio Context
            if (Tone.context.state !== 'running') {
                await Tone.start();
            }

            const id = 'audio' + Date.now();
            
            // 2. Read file as ArrayBuffer
            const reader = new FileReader();
            reader.onload = async (e) => {
                const arrayBuffer = e.target.result;
                
                try {
                    // 3. Native Decode (Bypasses Tone's URL loader)
                    const audioBuffer = await Tone.context.rawContext.decodeAudioData(arrayBuffer);
                    
                    state.audioClips[id] = {
                        id,
                        name: file.name,
                        buffer: audioBuffer, // Storing raw AudioBuffer
                        duration: audioBuffer.duration
                    };
                    
                    renderResources();
                    selectResource('audio', id);
                    console.log("Audio decoded successfully!");
                } catch (err) {
                    console.error("Decoding error:", err);
                    alert("Error decoding audio file. Try a standard MP3 or WAV.");
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
                document.getElementById('rack-title').innerText = "AUDIO CLIP SELECTED (Not editable in sequencer)";
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
                if(clip.buffer) div.classList.add('loaded'); // Visual indicator
                div.id = `res-${clip.id}`;
                div.title = clip.name;
                div.innerHTML = `<i class="fas fa-wave-square"></i> ${clip.name}`;
                div.onclick = () => selectResource('audio', clip.id);
                audioList.appendChild(div);
            });
        }

        // --- PLAYLIST RENDER ---
        function generateRuler() {
            const ruler = document.getElementById('ruler');
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
                header.innerText = `Track ${trackIndex + 1}`;
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
                    const resName = clip.type === 'pattern' ? state.patterns[clip.id].name : state.audioClips[clip.id].name;
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
                        drawWaveform(state.audioClips[clip.id].buffer, canvas);
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

        function addClipToTrack(trackIndex, startBar) {
            if(!state.selectedResId) return;
            
            let length = 1;
            
            if(state.selectedResType === 'audio') {
                const clip = state.audioClips[state.selectedResId];
                if(!clip) return;
                const secondsPerBar = (60 / state.bpm) * 4;
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

        // --- SEQUENCER RENDER ---
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
                label.onmousedown = () => {
                   previewInstrument(idx);
                };
                controls.appendChild(label);
                row.appendChild(controls);

                const seq = document.createElement('div');
                seq.className = 'step-sequencer';
                
                grid[idx].forEach((active, stepIdx) => {
                    const step = document.createElement('div');
                    step.className = `step ${active ? 'active' : ''}`;
                    step.dataset.step = stepIdx;
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

        // --- TRANSPORT ---
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

        // --- CLOCK ---
        Tone.Transport.scheduleRepeat((time) => {
            const step = state.currentStep;
            
            // Visuals
            Tone.Draw.schedule(() => {
                document.querySelectorAll('.step.playing').forEach(s => s.classList.remove('playing'));
                document.querySelectorAll(`.step[data-step="${step%16}"]`).forEach(s => s.classList.add('playing'));

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
                    playPatternStep(state.patterns[state.selectedResId].grid, step % 16, time);
                }
            } 
            else if (state.mode === 'SONG') {
                const currentBar = Math.floor(step / 16);
                const stepInBar = step % 16;

                state.playlist.forEach(track => {
                    track.forEach(clip => {
                        if(currentBar >= clip.startBar && currentBar < clip.startBar + clip.lengthBars) {
                            if(clip.type === 'pattern') {
                                playPatternStep(state.patterns[clip.id].grid, stepInBar, time);
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
            if(grid[0][stepIdx]) {
                if(drumSamples.player("Kick").loaded) drumSamples.player("Kick").start(time, 0, "16n");
            }
            if(grid[1][stepIdx]) {
                if(drumSamples.player("Snare").loaded) drumSamples.player("Snare").start(time, 0, "16n");
            }
            if(grid[2][stepIdx]) {
                hatSynth.triggerAttackRelease("32n", time);
            }
            if(grid[3][stepIdx]) {
                clapSynth.triggerAttackRelease("16n", time);
            }
        }

        // FIXED: Use native AudioBufferSourceNode to play raw AudioBuffer
        function playAudioClip(id, time) {
            const clipData = state.audioClips[id];

            if(!clipData || !clipData.buffer) return;

            try {
                const src = Tone.context.rawContext.createBufferSource();
                src.buffer = clipData.buffer;

                src.connect(Tone.context.rawContext.destination);

                src.start(time);
                activeSources.push(src);

                src.onended = () => {
                    const index = activeSources.indexOf(src);
                    if (index > -1) activeSources.splice(index, 1);
                };
            } catch (e) {
                console.error("Audio playback error:", e);
            }
        }

        function clearCurrentPattern() {
            if(state.selectedResType === 'pattern') {
                state.patterns[state.selectedResId].grid = createEmptyGrid();
                renderChannelRack();
            }
        }

        // --- GLOBAL EXPORTS (for inline HTML handlers) ---
        try {
          window.setMode = setMode;
          window.togglePlay = togglePlay;
          window.stopTransport = stopTransport;
          window.updateBPM = updateBPM;
          window.toggleFullscreen = toggleFullscreen;
          window.createNewPattern = createNewPattern;
          window.clearCurrentPattern = clearCurrentPattern;
          window.handleAudioUpload = handleAudioUpload;
          window.selectResource = selectResource;
        } catch (e) {}

        window.addEventListener('load', init);
