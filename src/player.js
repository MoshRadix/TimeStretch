import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import soundTouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const state = { buffer: null, name: '', context: null, audioSetup: null, loading: false, loadId: 0, restoring: false, source: null, stretch: null, clarityNodes: null, clarity: false, playing: false, loop: false, offset: 0, startedAt: 0, speed: 1, pitch: 0, volume: 0.8, shortcuts: {} };
const waveform = $('#waveform');
const waveCtx = waveform.getContext('2d');
const waveformProgress = $('#waveform-progress');
const waveProgressCtx = waveformProgress.getContext('2d');
let scrubbing = false;
let scrubWasPlaying = false;
let recordingShortcut = null;
let progressFrame = 0;
let lastPositionSavedAt = 0;
const transcriptionText = $('#transcription-text');
const transcriptionFontSize = $('#transcription-font-size');
function loadTranscription() {
  transcriptionText.value = localStorage.getItem('mto-transcription') || '';
  const size = Number(localStorage.getItem('mto-transcription-font-size')) || 13;
  transcriptionFontSize.value = String(Math.max(8, Math.min(72, size)));
  transcriptionText.style.fontSize = `${transcriptionFontSize.value}px`;
}
function saveTranscription() {
  try { localStorage.setItem('mto-transcription', transcriptionText.value); $('#transcription-save-status').textContent = 'Saved on this device'; }
  catch { $('#transcription-save-status').textContent = 'Could not save on this device'; }
}

function toast(message) { window.dispatchEvent(new CustomEvent('mto:toast', { detail: message })); }
function formatTime(time) { if (!Number.isFinite(time)) return '00:00'; const s = Math.max(0, Math.floor(time)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function currentTime() { if (!state.buffer) return 0; return state.playing ? Math.min(state.buffer.duration, state.offset + (state.context.currentTime - state.startedAt) * state.speed) : state.offset; }
function savePlaybackPosition(force = false) {
  if (!state.buffer || !window.mto?.savePlaybackPosition) return;
  const now = performance.now();
  if (!force && now - lastPositionSavedAt < 1000) return;
  lastPositionSavedAt = now;
  try { window.mto.savePlaybackPosition(currentTime()); } catch {}
}

function drawWaveform() {
  drawWaveformOn(waveform, waveCtx, $('#wave-empty'), '#35434a');
  drawWaveformOn(waveformProgress, waveProgressCtx, $('#wave-empty'), '#80e2c3');
}
function drawWaveformOn(canvas, ctx, empty, barColor) {
  const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height; ctx.clearRect(0, 0, width, height);
  if (!state.buffer || !width || !height) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const data = state.buffer.getChannelData(0); const barCount = Math.max(1, Math.floor(width / 4)); const step = Math.max(1, Math.floor(data.length / barCount)); const mid = height / 2;
  for (let i = 0; i < barCount; i++) {
    let peak = 0; const start = i * step;
    for (let j = 0; j < step; j += 4) peak = Math.max(peak, Math.abs(data[start + j] || 0));
    const envelope = Math.max(0.1, Math.min(1, peak * 2.5)); const maxBarHeight = Math.max(1, height - 10); const barHeight = Math.min(maxBarHeight, 5 + envelope * (height * 0.72)); const x = (i / barCount) * width;
    ctx.fillStyle = barColor; ctx.globalAlpha = barColor === '#80e2c3' ? 0.96 : 0.84;
    ctx.beginPath(); ctx.roundRect(x, mid - barHeight / 2, 2, barHeight, Math.min(2, barHeight / 2)); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawProgress() {
  const time = currentTime(); const duration = state.buffer?.duration || 0; const ratio = duration ? time / duration : 0;
  $('#wave-playhead').style.left = `${ratio * 100}%`; $('#wave-progress').style.clipPath = `inset(0 ${100 - ratio * 100}% 0 0)`; $('#elapsed').textContent = formatTime(time);
  savePlaybackPosition();
  if (progressFrame) cancelAnimationFrame(progressFrame);
  progressFrame = state.playing ? requestAnimationFrame(() => { progressFrame = 0; drawProgress(); }) : 0;
}
function paintDials() {
  $('#speed-value').textContent = `${state.speed.toFixed(2)}×`; $('#pitch-value').textContent = `${state.pitch > 0 ? '+' : ''}${state.pitch} st`;
  window.dispatchEvent(new CustomEvent('mto:dials', { detail: { speed: state.speed, pitch: state.pitch } }));
  if (state.stretch) state.stretch.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.source) state.source.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.stretch) state.stretch.pitchSemitones.setTargetAtTime(state.pitch, state.context.currentTime, 0.04);
}
function setSpeed(value) {
  const nextSpeed = Math.round(Math.max(0.5, Math.min(2, value)) * 100) / 100;
  if (nextSpeed === state.speed) return;
  if (state.playing) {
    state.offset = currentTime();
    state.startedAt = state.context.currentTime;
  }
  state.speed = nextSpeed;
  paintDials();
}
function setPitch(value) { state.pitch = Math.max(-12, Math.min(12, Math.round(value))); paintDials(); }

function makeClarityChain() {
  const input = state.stretch || state.context.createGain();
  const highpass = state.context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = state.clarity ? 115 : 25;
  const presence = state.context.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.8; presence.gain.value = state.clarity ? 4.5 : 0;
  const compressor = state.context.createDynamicsCompressor(); compressor.threshold.value = -24; compressor.knee.value = 18; compressor.ratio.value = state.clarity ? 2.2 : 1; compressor.attack.value = 0.012; compressor.release.value = 0.22;
  const gain = state.context.createGain(); gain.gain.value = state.volume;
  state.clarityNodes = { highpass, presence, compressor, gain };
  input.connect(highpass); highpass.connect(presence); presence.connect(compressor); compressor.connect(gain); gain.connect(state.context.destination);
}
function updateClarity() {
  state.clarity = !state.clarity; const { highpass, presence, compressor } = state.clarityNodes || {};
  if (highpass) highpass.frequency.setTargetAtTime(state.clarity ? 115 : 25, state.context.currentTime, 0.08);
  if (presence) presence.gain.setTargetAtTime(state.clarity ? 4.5 : 0, state.context.currentTime, 0.08);
  if (compressor) compressor.ratio.setTargetAtTime(state.clarity ? 2.2 : 1, state.context.currentTime, 0.08);
  $('#clarity-toggle').classList.toggle('on', state.clarity); $('.muted-copy').textContent = state.clarity ? 'Enabled' : 'Disabled'; $('.clarity-card').classList.toggle('clarity-active', state.clarity); window.dispatchEvent(new CustomEvent('mto:clarity', { detail: state.clarity }));
}

async function ensureAudio(resumeContext = true) {
  if (state.context?.state === 'closed') { stopSource(); state.context = null; state.audioSetup = null; }
  if (!state.context) state.context = new AudioContext();
  if (!state.audioSetup) {
    const context = state.context;
    state.audioSetup = SoundTouchNode.register(context, soundTouchProcessorUrl).catch(async (error) => {
      try { await context.close(); } catch {}
      if (state.context === context) { state.context = null; state.audioSetup = null; }
      throw error;
    });
  }
  await state.audioSetup;
  if (resumeContext && state.context.state === 'suspended') await state.context.resume();
  if (resumeContext && state.context.state !== 'running') throw new Error(`Audio context is ${state.context.state}`);
}
function stopSource() {
  if (state.source) { try { state.source.onended = null; state.source.stop(); } catch {} try { state.source.disconnect(); } catch {} }
  if (state.stretch) { try { state.stretch.disconnect(); } catch {} }
  for (const node of Object.values(state.clarityNodes || {})) { try { node.disconnect(); } catch {} }
  state.source = null; state.stretch = null; state.clarityNodes = null;
}
function createPlaybackGraph() {
  stopSource();
  try {
    state.stretch = new SoundTouchNode({ context: state.context });
    const source = state.context.createBufferSource(); source.buffer = state.buffer; source.loop = state.loop; source.playbackRate.value = state.speed;
    state.source = source; source.connect(state.stretch); state.stretch.playbackRate.value = state.speed; state.stretch.pitchSemitones.value = state.pitch;
    makeClarityChain();
    source.onended = () => { if (state.playing && !state.loop) { state.playing = false; state.offset = 0; savePlaybackPosition(true); $('#play-symbol').textContent = '\u25B6'; $('#play-btn').classList.remove('is-playing'); $('#play-btn').title = 'Play'; $('#play-btn').setAttribute('aria-label', 'Play'); $('#track-state-label').textContent = 'TRACK ENDED'; $('#track-state-dot').classList.remove('playing'); drawProgress(); drawWaveform(); } };
  } catch (error) { stopSource(); throw error; }
}
async function play(allowDuringLoad = false) {
  if (state.loading && !allowDuringLoad) return;
  if (!state.buffer) { await openAudio(); return; }
  if (state.playing) return;
  await ensureAudio(); if (state.playing) return;
  if (state.offset >= state.buffer.duration) state.offset = 0;
  try { createPlaybackGraph(); state.startedAt = state.context.currentTime; state.source.start(0, state.offset); state.playing = true; }
  catch (error) { state.playing = false; stopSource(); throw error; }
  $('#play-symbol').textContent = '\u2016'; $('#play-btn').classList.add('is-playing'); $('#play-btn').title = 'Pause'; $('#play-btn').setAttribute('aria-label', 'Pause'); $('#track-state-label').textContent = 'NOW PLAYING'; $('#track-state-dot').classList.add('playing'); drawProgress();
}
function pause(savePosition = true) {
  if (!state.playing) return;
  state.offset = currentTime(); state.playing = false; stopSource(); if (savePosition) savePlaybackPosition(true); $('#play-symbol').textContent = '\u25B6'; $('#play-btn').classList.remove('is-playing'); $('#play-btn').title = 'Play'; $('#play-btn').setAttribute('aria-label', 'Play'); $('#track-state-label').textContent = 'PAUSED'; $('#track-state-dot').classList.remove('playing'); drawWaveform(); drawProgress();
}
async function togglePlay() { try { if (state.playing) pause(); else await play(); } catch (error) { console.error(error); toast('Playback could not start. Try reopening the audio file.'); } }
async function seekTo(value) {
  if (!state.buffer) return; state.offset = Math.max(0, Math.min(state.buffer.duration, value));
  const resume = state.playing; if (resume) { state.playing = false; stopSource(); }
  drawWaveform(); drawProgress(); savePlaybackPosition(true); if (resume) await togglePlay();
}
async function openAudio(restoredFile = null, restorePosition = 0) {
  const isRestore = Boolean(restoredFile);
  if (state.loading) {
    if (!isRestore && state.restoring) {
      state.loadId++;
      state.loading = false;
      state.restoring = false;
    } else return;
  }
  const loadId = ++state.loadId;
  state.loading = true;
  state.restoring = isRestore;
  try {
    const file = isRestore ? restoredFile : await window.mto.openAudio();
    if (!file || loadId !== state.loadId) return;
    await ensureAudio(false);
    if (loadId !== state.loadId) return;
    pause(false); const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes.data || file.bytes);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); const decoded = await state.context.decodeAudioData(copy);
    if (loadId !== state.loadId) return;
    state.buffer = decoded; state.name = file.name; state.offset = Math.max(0, Math.min(state.buffer.duration, Number(restorePosition) || 0));
    $('#track-title').textContent = file.name.replace(/\.(mp3|wav)$/i, ''); $('#track-meta').textContent = `${file.name.toLowerCase().endsWith('.wav') ? 'WAV' : 'MP3'} · ${formatTime(state.buffer.duration)} · ${Math.round(state.buffer.sampleRate / 1000)} kHz`;
    $('#duration').textContent = formatTime(state.buffer.duration); $('#end-time').textContent = formatTime(state.buffer.duration); $('#mid-time').textContent = formatTime(state.buffer.duration / 2);
    $('#track-state-label').textContent = restoredFile ? 'PAUSED' : 'TRACK LOADED'; $('#track-state-dot').classList.remove('playing');
    $('#recent-title').textContent = $('#track-title').textContent; $('#recent-subtitle').textContent = `${formatTime(state.buffer.duration)} · Just added`; $('.status-pill span').textContent = 'TRACK LOADED'; $('.status-pill i').classList.add('ready');
    drawWaveform(); drawProgress(); savePlaybackPosition(true);
    if (!isRestore) {
      try { await play(true); }
      catch (error) { console.error(error); toast('Audio loaded. Press Play to start playback.'); }
    }
  } catch (error) { if (loadId === state.loadId) { console.error(error); toast('Could not open or play this audio file.'); } }
  finally { if (loadId === state.loadId) { state.loading = false; state.restoring = false; } }
}
async function restoreLastAudio() {
  try {
    const file = await window.mto.restoreAudio();
    if (file) await openAudio(file, file.position);
  } catch (error) { console.error(error); toast('Could not restore the last audio file.'); }
}

function keyCombo(event) { const bits = []; if (event.ctrlKey) bits.push('Ctrl'); if (event.altKey) bits.push('Alt'); if (event.shiftKey) bits.push('Shift'); if (event.metaKey) bits.push('Super'); let key = event.key; if (key === ' ') key = 'Space'; else if (key === 'ArrowUp') key = 'Up'; else if (key === 'ArrowDown') key = 'Down'; else if (key === 'ArrowLeft') key = 'Left'; else if (key === 'ArrowRight') key = 'Right'; else if (key.length === 1) key = key.toUpperCase(); if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) bits.push(key); return bits.join('+'); }
function showSettings() { window.dispatchEvent(new Event('mto:settings-open')); }
function hideSettings() { window.dispatchEvent(new Event('mto:settings-close')); recordingShortcut = null; }
async function loadSettings() {
  state.shortcuts = await window.mto.getShortcuts();
  for (const input of document.querySelectorAll('[data-shortcut]')) input.value = state.shortcuts[input.dataset.shortcut] || '';
}
function doGlobalAction(action) { if (action === 'toggle-play') togglePlay(); else if (action === 'seek-backward') seekTo(currentTime() - 3); else if (action === 'seek-forward') seekTo(currentTime() + 3); else if (action === 'speed-down') setSpeed(state.speed - 0.05); else if (action === 'speed-up') setSpeed(state.speed + 0.05); else if (action === 'pitch-down') setPitch(state.pitch - 1); else if (action === 'pitch-up') setPitch(state.pitch + 1); }

paintDials(); drawWaveform(); loadSettings(); loadTranscription();
transcriptionText.addEventListener('input', saveTranscription);
transcriptionFontSize.addEventListener('input', () => { const size = Math.max(8, Math.min(72, Number(transcriptionFontSize.value) || 13)); transcriptionText.style.fontSize = `${size}px`; localStorage.setItem('mto-transcription-font-size', String(size)); });
$('#download-transcription').onclick = () => { const blob = new Blob([transcriptionText.value], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'transcription.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('#clear-transcription').onclick = () => { if (!transcriptionText.value || window.confirm('Clear the saved transcription?')) { transcriptionText.value = ''; saveTranscription(); transcriptionText.focus(); } };
$('#open-track').onclick = () => openAudio(); $('#play-btn').onclick = togglePlay;
$('#stop-btn').onclick = () => { pause(); state.offset = 0; savePlaybackPosition(true); drawWaveform(); drawProgress(); };
$('#jump-back').onclick = () => seekTo(currentTime() - 3); $('#jump-forward').onclick = () => seekTo(currentTime() + 3);
$('#loop-btn').onclick = () => { state.loop = !state.loop; $('#loop-btn').classList.toggle('selected', state.loop); if (state.source) state.source.loop = state.loop; };
window.addEventListener('mto:volume', (event) => { state.volume = Number(event.detail); $('#volume-value').textContent = `${Math.round(state.volume * 100)}%`; if (state.clarityNodes?.gain) state.clarityNodes.gain.gain.setTargetAtTime(state.volume, state.context.currentTime, 0.02); });
window.addEventListener('mto:clarity-input', updateClarity);
function wireWaveSeeking(hit, hover) {
  hit.addEventListener('pointerdown', (event) => { if (!state.buffer) return; scrubbing = true; scrubWasPlaying = state.playing; if (scrubWasPlaying) pause(); hit.setPointerCapture(event.pointerId); const rect = hit.getBoundingClientRect(); state.offset = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * state.buffer.duration; drawWaveform(); drawProgress(); });
  hit.addEventListener('pointermove', (event) => { const rect = hit.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); hover.style.left = `${ratio * 100}%`; if (scrubbing && state.buffer) { state.offset = ratio * state.buffer.duration; drawWaveform(); drawProgress(); } });
  hit.addEventListener('pointerup', async () => { if (!scrubbing) return; scrubbing = false; savePlaybackPosition(true); if (scrubWasPlaying) await togglePlay(); scrubWasPlaying = false; });
  hit.addEventListener('pointercancel', () => { scrubbing = false; savePlaybackPosition(true); scrubWasPlaying = false; });
}
wireWaveSeeking($('#wave-hit'), $('#wave-hover'));
window.addEventListener('resize', drawWaveform);
$('#open-settings').onclick = $('#top-settings').onclick = showSettings;
document.querySelectorAll('[data-shortcut]').forEach((input) => { input.onclick = () => { recordingShortcut = input; input.classList.add('recording'); input.value = 'Press shortcut…'; $('#shortcut-message').textContent = `Recording ${input.parentElement.firstChild.textContent.trim()}`; }; });
document.addEventListener('keydown', (event) => {
  if (recordingShortcut) { event.preventDefault(); const combo = keyCombo(event); if (!['Alt', 'Ctrl', 'Shift', 'Super'].includes(combo)) { recordingShortcut.value = combo; recordingShortcut.classList.remove('recording'); state.shortcuts[recordingShortcut.dataset.shortcut] = combo; recordingShortcut = null; $('#shortcut-message').textContent = 'Shortcut captured'; } return; }
  if (event.target.matches('input, textarea, [contenteditable="true"]')) { if (event.key === 'Escape') hideSettings(); return; }
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'ArrowLeft') seekTo(currentTime() - 3); else if (event.key === 'ArrowRight') seekTo(currentTime() + 3);
  else if (event.key === 'Escape') hideSettings();
});
$('#save-settings').onclick = async () => { try { state.shortcuts = await window.mto.saveShortcuts(state.shortcuts); $('#shortcut-message').textContent = 'Shortcuts saved'; toast('Global shortcuts saved'); } catch { toast('Could not save shortcuts'); } };
window.mto.onGlobalAction(doGlobalAction);
window.mtoPlayer = { setSpeed, setPitch };
window.addEventListener('beforeunload', () => savePlaybackPosition(true));
restoreLastAudio();
