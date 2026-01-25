// src/uiRenderer.js
import { state, instruments } from "./stateManager.js";
import { previewInstrument } from "./audioEngine.js";

export function generateRuler() {
  const ruler = document.getElementById('ruler');
  for(let i=1; i<=50; i++) {
    const div = document.createElement('div');
    div.className = 'ruler-segment';
    div.innerText = i;
    ruler.appendChild(div);
  }
}

export function renderResources(selectResource) {
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

export function drawWaveform(buffer, canvas) {
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

export function renderPlaylist(addClipToTrack) {
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
        renderPlaylist(addClipToTrack);
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

export function renderChannelRack() {
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
    label.onmousedown = () => { previewInstrument(idx); };
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

export function setRackTitle(text) {
  document.getElementById('rack-title').innerText = text;
}

export function setRackRowsHtml(html) {
  document.getElementById('rack-rows').innerHTML = html;
}
