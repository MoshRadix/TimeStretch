import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import soundTouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';
import waveformProcessorUrl from './waveform-processor.js?url&no-inline';
import { loadWaveformCache, saveWaveformCache } from './waveform-cache.js';
import './style.css';
import './polish.css';

const $ = (selector) => document.querySelector(selector);
const effectsStorageKey = 'mto-audio-settings:';
let legacyEffects = {};
try { legacyEffects = JSON.parse(localStorage.getItem('mto-audio-effects') || '{}') || {}; } catch {}
const state = { buffer: null, waveformPeaks: null, waveformAnalysis: null, waveformCacheWrite: Promise.resolve(), bookmarks: [], audioPath: '', name: '', context: null, audioSetup: null, loading: false, loadId: 0, restoring: false, source: null, media: $('#audio-stream'), mediaSource: null, streaming: false, stretch: null, clarityNodes: null, clarity: false, noiseReduction: false, equalizer: false, eqValues: { low: 0, mid: 0, high: 0 }, noiseGateFrame: 0, noiseGateSamples: null, meterFrame: 0, meterSamples: null, playing: false, loop: false, offset: 0, startedAt: 0, speed: 1, pitch: 0, volume: 0.8, shortcuts: {} };
const waveform = $('#waveform');
const waveCtx = waveform.getContext('2d');
const waveformProgress = $('#waveform-progress');
const waveProgressCtx = waveformProgress.getContext('2d');
let scrubbing = false;
let scrubWasPlaying = false;
let recordingShortcut = null;
let progressFrame = 0;
let lastPositionSavedAt = 0;
const waveformPeakCount = 512;
const transcriptionText = $('#transcription-text');
const transcriptionFontSize = $('#transcription-font-size');
let transcriptionLanguage = 'dv';
const phoneticThaana = {
  q: 'ް', w: 'އ', e: 'ެ', r: 'ރ', t: 'ތ', y: 'ޔ', u: 'ު', i: 'ި', o: 'ޮ', p: 'ޕ',
  a: 'ަ', s: 'ސ', d: 'ދ', f: 'ފ', g: 'ގ', h: 'ހ', j: 'ޖ', k: 'ކ', l: 'ލ',
  z: 'ޒ', x: '×', c: 'ޗ', v: 'ވ', b: 'ބ', n: 'ނ', m: 'މ',
  Q: 'ޤ', W: 'ޢ', E: 'ޭ', R: 'ޜ', T: 'ޓ', Y: 'ޠ', U: 'ޫ', I: 'ީ', O: 'ޯ', P: '÷',
  A: 'ާ', S: 'ށ', D: 'ޑ', F: 'ﷲ', G: 'ޣ', H: 'ޙ', J: 'ޛ', K: 'ޚ', L: 'ޅ',
  Z: 'ޡ', X: 'ޘ', C: 'ޝ', V: 'ޥ', B: 'ޞ', N: 'ޏ', M: '>',
};
function setTranscriptionLanguage(language, save = true) {
  transcriptionLanguage = language === 'en' ? 'en' : 'dv';
  const isDhivehi = transcriptionLanguage === 'dv';
  transcriptionText.dataset.language = transcriptionLanguage;
  transcriptionText.dir = isDhivehi ? 'rtl' : 'ltr';
  transcriptionText.lang = isDhivehi ? 'dv' : 'en';
  transcriptionText.placeholder = isDhivehi ? 'ލިޔުން ފަށާ...' : 'Start typing your transcription…';
  $('#transcription-font-name').textContent = isDhivehi ? 'FARUMA FONT' : 'ARIAL FONT';
  $('#language-dv').classList.toggle('active', isDhivehi);
  $('#language-en').classList.toggle('active', !isDhivehi);
  $('#language-dv').setAttribute('aria-pressed', String(isDhivehi));
  $('#language-en').setAttribute('aria-pressed', String(!isDhivehi));
  if (save) localStorage.setItem('mto-transcription-language', transcriptionLanguage);
}
function transcriptionStorageKey(filePath) { return `mto-transcription:${filePath}`; }
function loadTranscription(filePath = state.audioPath) {
  const savedText = filePath
    ? localStorage.getItem(transcriptionStorageKey(filePath))
    : localStorage.getItem('mto-transcription');
  transcriptionText.value = savedText || '';
  const size = Number(localStorage.getItem('mto-transcription-font-size')) || 13;
  transcriptionFontSize.value = String(Math.max(8, Math.min(72, size)));
  transcriptionText.style.fontSize = `${transcriptionFontSize.value}px`;
  setTranscriptionLanguage(localStorage.getItem('mto-transcription-language') || 'dv', false);
}
function saveTranscription() {
  try {
    const key = state.audioPath ? transcriptionStorageKey(state.audioPath) : 'mto-transcription';
    localStorage.setItem(key, transcriptionText.value);
    $('#transcription-save-status').textContent = 'Saved on this device';
  }
  catch { $('#transcription-save-status').textContent = 'Could not save on this device'; }
}

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2400); }
function updateLoadProgress(label, percent = null) {
  const panel = $('#load-progress'); const value = $('#load-progress-value'); const bar = $('#load-progress-bar');
  panel.hidden = false; $('#load-progress-label').textContent = label;
  if (percent === null) { value.textContent = '…'; bar.classList.add('indeterminate'); bar.style.width = ''; }
  else { const safePercent = Math.max(0, Math.min(100, percent)); value.textContent = `${Math.round(safePercent)}%`; bar.classList.remove('indeterminate'); bar.style.width = `${safePercent}%`; }
}
function finishLoadProgress() { $('#load-progress').hidden = true; $('#load-progress-bar').classList.remove('indeterminate'); }
function formatTime(time) { if (!Number.isFinite(time)) return '00:00'; const s = Math.max(0, Math.floor(time)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function audioDuration() { return state.buffer?.duration || state.media?.duration || 0; }
function hasAudio() { return Boolean(state.buffer || (state.streaming && state.media?.src)); }
function waveformCacheIdentity(file) { return JSON.stringify([file.path, file.size, Number(file.mtimeMs) || 0]); }
async function readWaveformCache(file) {
  try { return await loadWaveformCache(waveformCacheIdentity(file)); }
  catch (error) { console.error('Could not load the saved waveform:', error); return null; }
}
function persistWaveform(key, peaks, progress, complete = false) {
  if (!key || !peaks) return;
  const snapshot = peaks.slice();
  state.waveformCacheWrite = state.waveformCacheWrite
    .catch((error) => console.error('Could not save the waveform:', error))
    .then(() => saveWaveformCache(key, snapshot, progress, complete))
    .catch((error) => console.error('Could not save the waveform:', error));
  return state.waveformCacheWrite;
}
function currentTime() { if (!hasAudio()) return 0; return state.streaming ? (state.media?.currentTime || 0) : (state.playing ? Math.min(state.buffer.duration, state.offset + (state.context.currentTime - state.startedAt) * state.speed) : state.offset); }
function savePlaybackPosition(force = false) {
  if (!hasAudio() || !window.mto?.savePlaybackPosition) return;
  const now = performance.now();
  if (!force && now - lastPositionSavedAt < 1000) return;
  lastPositionSavedAt = now;
  try { window.mto.savePlaybackPosition(currentTime()); } catch {}
}

function bookmarksStorageKey(filePath) { return `mto-bookmarks:${filePath}`; }
function loadBookmarks(filePath, duration) {
  try {
    const saved = JSON.parse(localStorage.getItem(bookmarksStorageKey(filePath)) || '[]');
    if (!Array.isArray(saved)) throw new Error('Saved bookmarks are not a list');
    return [...new Set(saved.filter((position) => Number.isFinite(position) && position >= 0 && position <= duration))].sort((a, b) => a - b);
  } catch (error) {
    console.error('Could not load audio bookmarks:', error);
    toast('Could not load bookmarks for this audio.');
    return [];
  }
}
function saveBookmarks() {
  if (!state.audioPath) return;
  try {
    localStorage.setItem(bookmarksStorageKey(state.audioPath), JSON.stringify(state.bookmarks));
  } catch (error) {
    console.error('Could not save audio bookmarks:', error);
    toast('Could not save bookmarks on this device.');
  }
}
function renderBookmarks() {
  const list = $('#wave-bookmarks');
  const addButton = $('#bookmark-add');
  if (!list || !addButton) return;
  addButton.disabled = !state.audioPath;
  list.replaceChildren();
  for (const [index, position] of state.bookmarks.entries()) {
    const item = document.createElement('div');
    item.className = 'wave-bookmark-item';
    const jump = document.createElement('button');
    jump.className = 'wave-bookmark-jump';
    jump.type = 'button';
    jump.textContent = formatTime(position);
    jump.title = `Jump to ${formatTime(position)}`;
    jump.addEventListener('click', () => seekTo(position));
    const remove = document.createElement('button');
    remove.className = 'wave-bookmark-delete';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Delete bookmark at ${formatTime(position)}`;
    remove.setAttribute('aria-label', `Delete bookmark at ${formatTime(position)}`);
    remove.addEventListener('click', () => {
      state.bookmarks.splice(index, 1);
      saveBookmarks();
      renderBookmarks();
    });
    item.append(jump, remove);
    list.append(item);
  }
  document.querySelectorAll('.wave-bookmark-marker').forEach((marker) => marker.remove());
  const duration = audioDuration();
  if (!duration) return;
  const waveformWrap = $('#wave-hit');
  for (const position of state.bookmarks) {
    const marker = document.createElement('span');
    marker.className = 'wave-bookmark-marker';
    marker.style.left = `${Math.min(100, position / duration * 100)}%`;
    marker.title = `Bookmark at ${formatTime(position)}`;
    marker.setAttribute('aria-hidden', 'true');
    waveformWrap.append(marker);
  }
}
function addBookmark() {
  if (!state.audioPath) return;
  const position = Math.max(0, Math.min(audioDuration(), currentTime()));
  if (state.bookmarks.some((bookmark) => Math.abs(bookmark - position) < 0.1)) {
    toast('A bookmark already exists at this position.');
    return;
  }
  state.bookmarks.push(position);
  state.bookmarks.sort((a, b) => a - b);
  saveBookmarks();
  renderBookmarks();
}

function drawWaveform() {
  drawWaveformOn(waveform, waveCtx, $('#wave-empty'), '#75578f');
  drawWaveformOn(waveformProgress, waveProgressCtx, $('#wave-empty'), '#d19aff');
}
function drawWaveformOn(canvas, ctx, empty, barColor) {
  const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height; ctx.clearRect(0, 0, width, height);
  if (!width || !height) { empty.classList.remove('hidden'); return; }
  if (!state.buffer && !state.streaming) { empty.classList.remove('hidden'); return; }
  const peaks = state.waveformPeaks;
  const hasSamples = Boolean(peaks?.some((peak) => peak > 0.0001));
  if (!state.buffer && !hasSamples) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  const barCount = Math.max(1, Math.min(peaks?.length || 1, Math.floor(width / 3.5)));
  const mid = Math.floor(height / 2);
  ctx.fillStyle = 'rgba(190, 160, 216, 0.12)';
  ctx.fillRect(0, mid, width, 1);
  if (!peaks) return;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  if (barColor === '#d19aff') {
    gradient.addColorStop(0, '#bd82e8');
    gradient.addColorStop(0.5, '#e1b8ff');
    gradient.addColorStop(1, '#a969d1');
  } else {
    gradient.addColorStop(0, '#684d80');
    gradient.addColorStop(0.5, '#9776ad');
    gradient.addColorStop(1, '#574168');
  }
  ctx.fillStyle = gradient;
  ctx.globalAlpha = barColor === '#d19aff' ? 0.98 : 0.9;
  const barWidth = Math.min(2.5, width / barCount * 0.66);
  for (let i = 0; i < barCount; i++) {
    const peak = peaks[Math.min(peaks.length - 1, Math.floor(i * peaks.length / barCount))];
    if (peak <= 0.0001) continue;
    const barHeight = Math.max(2, Math.min(height - 12, Math.sqrt(Math.min(1, peak)) * (height - 12)));
    const x = (i / barCount) * width + (width / barCount - barWidth) / 2;
    ctx.beginPath();
    ctx.roundRect(x, mid - barHeight / 2, barWidth, barHeight, barWidth / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

async function getBufferWaveformPeaks(buffer, file, cached, loadId) {
  if (cached?.complete) return cached.peaks;
  const peaks = cached?.peaks || new Float32Array(waveformPeakCount);
  const cacheKey = waveformCacheIdentity(file);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const firstBin = cached ? Math.min(peaks.length, Math.floor(cached.progress * peaks.length)) : 0;
  let lastSavedAt = performance.now();
  let lastSavedProgress = firstBin / peaks.length;
  for (let chunkStart = firstBin; chunkStart < peaks.length; chunkStart += 8) {
    if (state.loadId !== loadId) return null;
    const chunkEnd = Math.min(peaks.length, chunkStart + 8);
    for (let i = chunkStart; i < chunkEnd; i++) {
      const start = Math.floor(i * buffer.length / peaks.length);
      const end = Math.floor((i + 1) * buffer.length / peaks.length);
      let peak = 0;
      for (const channel of channels) {
        for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
      }
      peaks[i] = peak;
    }
    const progress = chunkEnd / peaks.length;
    const now = performance.now();
    updateLoadProgress('Building waveform…', 65 + progress * 35);
    if (progress - lastSavedProgress >= 0.05 || now - lastSavedAt >= 2000) {
      persistWaveform(cacheKey, peaks, progress);
      lastSavedProgress = progress;
      lastSavedAt = now;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (state.loadId !== loadId) return null;
  await persistWaveform(cacheKey, peaks, 1, true);
  return peaks;
}

function stopWaveformAnalysis() {
  const analysis = state.waveformAnalysis;
  if (!analysis) return;
  const progress = analysis.progress || 0;
  if (!analysis.completed) persistWaveform(analysis.cacheKey, analysis.peaks, progress);
  state.waveformAnalysis = null;
  $('#wave-hit').classList.remove('wave-analyzing');
  analysis.audio.pause();
  analysis.audio.removeAttribute('src');
  analysis.audio.load();
  analysis.audio.removeEventListener('ended', analysis.onEnded);
  analysis.audio.removeEventListener('error', analysis.onError);
  if (analysis.processor) {
    analysis.processor.port.onmessage = null;
    analysis.processor.port.close();
    analysis.processor.disconnect();
  }
  analysis.source.disconnect();
  analysis.context.close().catch((error) => console.error('Could not close waveform analyzer:', error));
}

async function analyzeStreamingWaveform(url, duration, loadId, file, cached) {
  stopWaveformAnalysis();
  const audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  const context = new AudioContext();
  const source = context.createMediaElementSource(audio);
  const peaks = cached?.peaks || new Float32Array(waveformPeakCount);
  const startProgress = cached?.progress || 0;
  let previousTime = startProgress * duration;
  let lastDraw = 0;
  const analysis = { audio, context, source, processor: null, onEnded: null, onError: null, duration, progress: startProgress, peaks, cacheKey: waveformCacheIdentity(file), lastCacheAt: performance.now(), lastCacheProgress: startProgress };
  state.waveformPeaks = peaks;
  state.waveformAnalysis = analysis;
  $('#wave-hit').classList.add('wave-analyzing');
  $('#wave-empty').querySelector('b').textContent = 'Building your waveform';
  $('#wave-empty').querySelector('small').textContent = 'Scanning the audio progressively';
  drawWaveform();
  try {
    await context.audioWorklet.addModule(waveformProcessorUrl);
    if (state.waveformAnalysis !== analysis || state.loadId !== loadId) {
      return;
    }
    const processor = new AudioWorkletNode(context, 'mto-waveform', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'max',
    });
    analysis.processor = processor;
    source.connect(processor);
    processor.connect(context.destination);
    processor.port.onmessage = (event) => {
      if (state.waveformAnalysis !== analysis || state.loadId !== loadId) return;
      const currentTime = Math.min(duration, audio.currentTime);
      if (!Number.isFinite(currentTime)) return;
      const peak = Number(event.data);
      if (Number.isFinite(peak) && peak > 0) {
        const firstBin = Math.min(peaks.length - 1, Math.floor(previousTime / duration * peaks.length));
        const lastBin = Math.min(peaks.length - 1, Math.floor(currentTime / duration * peaks.length));
        for (let bin = firstBin; bin <= lastBin; bin++) peaks[bin] = Math.max(peaks[bin], peak);
      }
      previousTime = currentTime;
      analysis.progress = Math.max(analysis.progress, currentTime / duration);
      if (analysis.progress - analysis.lastCacheProgress >= 0.02 || performance.now() - analysis.lastCacheAt >= 2000) {
        persistWaveform(analysis.cacheKey, peaks, analysis.progress);
        analysis.lastCacheProgress = analysis.progress;
        analysis.lastCacheAt = performance.now();
      }
      if (performance.now() - lastDraw >= 100) {
        lastDraw = performance.now();
        drawWaveform();
        $('#track-meta').textContent = `${$('#track-meta').textContent.replace(/ · waveform \d+%$/, '')} · waveform ${Math.floor(currentTime / duration * 100)}%`;
      }
    };
    analysis.onEnded = async () => {
      if (state.waveformAnalysis !== analysis) return;
      analysis.progress = 1;
      analysis.completed = true;
      const saved = persistWaveform(analysis.cacheKey, peaks, 1, true);
      stopWaveformAnalysis();
      await saved;
      if (state.loadId !== loadId) return;
      if (!peaks.some((peak) => peak > 0.0001)) {
        $('#wave-empty').querySelector('b').textContent = 'Waveform unavailable';
        $('#wave-empty').querySelector('small').textContent = 'The audio is ready to play';
      }
      drawWaveform();
      $('#track-meta').textContent = $('#track-meta').textContent.replace(/ · waveform \d+%$/, '');
    };
    analysis.onError = () => {
      console.error('Could not analyze the streamed audio waveform:', audio.error);
      if (state.waveformAnalysis === analysis) stopWaveformAnalysis();
      $('#wave-empty').querySelector('b').textContent = 'Waveform unavailable';
      $('#wave-empty').querySelector('small').textContent = 'The audio is ready to play';
      drawWaveform();
      $('#track-meta').textContent = $('#track-meta').textContent.replace(/ · waveform \d+%$/, '');
    };
    audio.addEventListener('ended', analysis.onEnded, { once: true });
    audio.addEventListener('error', analysis.onError, { once: true });
    audio.playbackRate = 16;
    audio.preservesPitch = false;
    audio.src = url;
    audio.load();
    await context.resume();
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve, reject) => {
        audio.addEventListener('loadedmetadata', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('Audio metadata could not be loaded')), { once: true });
      });
    }
    if (startProgress > 0) {
      audio.currentTime = Math.min(duration, startProgress * duration);
      previousTime = audio.currentTime;
    }
    await audio.play();
  } catch (error) {
    if (state.waveformAnalysis === analysis) stopWaveformAnalysis();
    console.error('Could not start waveform analysis:', error);
    if (state.loadId === loadId) {
      $('#wave-empty').querySelector('b').textContent = 'Waveform unavailable';
      $('#wave-empty').querySelector('small').textContent = 'The audio is ready to play';
      drawWaveform();
      $('#track-meta').textContent = $('#track-meta').textContent.replace(/ · waveform \d+%$/, '');
    }
  }
}

function drawProgress() {
  const time = currentTime(); const duration = audioDuration(); const ratio = duration ? time / duration : 0;
  $('#wave-playhead').style.left = `${ratio * 100}%`; $('#wave-progress').style.clipPath = `inset(0 ${100 - ratio * 100}% 0 0)`; $('#elapsed').textContent = formatTime(time);
  savePlaybackPosition();
  if (progressFrame) cancelAnimationFrame(progressFrame);
  progressFrame = state.playing ? requestAnimationFrame(() => { progressFrame = 0; drawProgress(); }) : 0;
}
function paintRange(input, centered = false) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Math.max(min, Math.min(max, Number(input.value) || 0));
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = ratio * 100;
  const center = (min + max) / 2;
  const centerPercent = 50;
  input.style.setProperty('--range-fill-start', `${centered && value < center ? percent : centered ? centerPercent : 0}%`);
  input.style.setProperty('--range-fill-end', `${centered && value < center ? centerPercent : percent}%`);
  const valueText = input.id === 'speed-slider' ? `${value.toFixed(2)} times` : input.id === 'pitch-slider' ? `${value > 0 ? '+' : ''}${value} semitones` : input.dataset.unit === 'dB' ? `${value > 0 ? '+' : ''}${value} decibels` : `${Math.round(value * 100)} percent`;
  input.setAttribute('aria-valuetext', valueText);
}
function paintDials() {
  $('#speed-value').textContent = `${state.speed.toFixed(2)}×`; $('#pitch-value').textContent = `${state.pitch > 0 ? '+' : ''}${state.pitch} st`;
  $('#speed-slider').value = String(state.speed); $('#pitch-slider').value = String(state.pitch);
  paintRange($('#speed-slider')); paintRange($('#pitch-slider'), true);
  if (state.stretch) state.stretch.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.source) state.source.playbackRate.setTargetAtTime(state.speed, state.context.currentTime, 0.02);
  if (state.streaming && state.media) state.media.playbackRate = state.speed;
  if (state.stretch) state.stretch.pitchSemitones.setTargetAtTime(state.pitch, state.context.currentTime, 0.04);
}
function saveAudioSettings(filePath = state.audioPath) {
  if (!filePath) return;
  const snapshot = { speed: state.speed, pitch: state.pitch, volume: state.volume, clarity: state.clarity, noiseReduction: state.noiseReduction, equalizer: state.equalizer, eqValues: state.eqValues };
  try { localStorage.setItem(`${effectsStorageKey}${filePath}`, JSON.stringify(snapshot)); }
  catch (error) { console.error('Could not save audio settings:', error); }
}
function loadAudioSettings(filePath) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`${effectsStorageKey}${filePath}`) || 'null'); } catch {}
  const source = saved && typeof saved === 'object' ? saved : {
    noiseReduction: legacyEffects.noiseReduction,
    equalizer: legacyEffects.equalizer,
    eqValues: legacyEffects.eqValues
  };
  const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  state.speed = Math.round(Math.max(0.5, Math.min(2, numeric(source.speed, 1))) * 100) / 100;
  state.pitch = Math.max(-12, Math.min(12, Math.round(numeric(source.pitch, 0))));
  state.volume = Math.max(0, Math.min(1, numeric(source.volume, 0.8)));
  state.clarity = source.clarity === true;
  state.noiseReduction = source.noiseReduction === true;
  state.equalizer = source.equalizer === true;
  for (const band of ['low', 'mid', 'high']) state.eqValues[band] = Math.max(-12, Math.min(12, Math.round(numeric(source.eqValues?.[band], 0))));
  $('#volume').value = String(state.volume);
  $('#volume-value').textContent = `${Math.round(state.volume * 100)}%`;
  $('#audio-stream').volume = state.volume;
  paintRange($('#volume'));
  paintDials();
  syncEffectControls();
  saveAudioSettings(filePath);
}
function setSpeed(value) { state.speed = Math.round(Math.max(0.5, Math.min(2, value)) * 100) / 100; paintDials(); saveAudioSettings(); }
function setPitch(value) { state.pitch = Math.max(-12, Math.min(12, Math.round(value))); paintDials(); saveAudioSettings(); }

function syncEffectControls() {
  const noiseToggle = $('#noise-reduction-toggle');
  const eqToggle = $('#equalizer-toggle');
  const clarityToggle = $('#clarity-toggle');
  clarityToggle.classList.toggle('on', state.clarity);
  clarityToggle.setAttribute('aria-pressed', String(state.clarity));
  $('.clarity-card').classList.toggle('clarity-active', state.clarity);
  noiseToggle.classList.toggle('on', state.noiseReduction);
  noiseToggle.setAttribute('aria-pressed', String(state.noiseReduction));
  $('.noise-reduction-card').classList.toggle('effect-active', state.noiseReduction);
  eqToggle.classList.toggle('on', state.equalizer);
  eqToggle.setAttribute('aria-pressed', String(state.equalizer));
  $('.equalizer-card').classList.toggle('effect-active', state.equalizer);
  for (const band of ['low', 'mid', 'high']) {
    const slider = $(`#eq-${band}`);
    slider.value = String(state.eqValues[band]);
    slider.disabled = !state.equalizer;
    $(`#eq-${band}-value`).textContent = `${state.eqValues[band] > 0 ? '+' : ''}${state.eqValues[band]} dB`;
    paintRange(slider, true);
  }
}
function setNoiseReduction(enabled) {
  state.noiseReduction = enabled;
  const nodes = state.clarityNodes;
  if (nodes && state.context) {
    const now = state.context.currentTime;
    nodes.noiseHighpass.frequency.setTargetAtTime(enabled ? 90 : 20, now, 0.08);
    nodes.noiseLowpass.frequency.setTargetAtTime(enabled ? 10000 : 20000, now, 0.08);
    if (!enabled) {
      if (state.noiseGateFrame) cancelAnimationFrame(state.noiseGateFrame);
      state.noiseGateFrame = 0;
      nodes.noiseGate.gain.setTargetAtTime(1, now, 0.03);
    } else if (state.playing) monitorNoiseGate();
  }
  saveAudioSettings();
  syncEffectControls();
}
function monitorNoiseGate() {
  const nodes = state.clarityNodes;
  if (!state.noiseReduction || !state.playing || !nodes || !state.noiseGateSamples) { state.noiseGateFrame = 0; return; }
  nodes.noiseAnalyser.getFloatTimeDomainData(state.noiseGateSamples);
  let energy = 0;
  for (const sample of state.noiseGateSamples) energy += sample * sample;
  const rms = Math.sqrt(energy / state.noiseGateSamples.length);
  const attenuation = Math.max(0.25, Math.min(1, (rms - 0.002) / 0.012));
  nodes.noiseGate.gain.setTargetAtTime(attenuation, state.context.currentTime, 0.035);
  state.noiseGateFrame = requestAnimationFrame(monitorNoiseGate);
}
function monitorAudioLevel() {
  const analyser = state.clarityNodes?.meterAnalyser;
  const meter = $('#live-audio-meter');
  if (!state.playing || !analyser || !state.meterSamples || !meter) { state.meterFrame = 0; return; }
  analyser.getFloatTimeDomainData(state.meterSamples);
  let energy = 0;
  let peak = 0;
  for (const sample of state.meterSamples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(energy / state.meterSamples.length);
  const toDbfs = (amplitude) => amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
  const rmsDb = toDbfs(rms);
  const peakDb = toDbfs(peak);
  // The bar is calibrated to a 60 dB display range: silence/very quiet at 0%,
  // digital full scale at 100%. Keep the underlying meter value in dBFS.
  const displayedDb = Math.max(-60, Math.min(0, rmsDb));
  const level = ((displayedDb + 60) / 60) * 100;
  meter.style.setProperty('--meter-level', `${level}%`);
  meter.setAttribute('aria-valuenow', String(Number.isFinite(displayedDb) ? Math.round(displayedDb * 10) / 10 : -60));
  meter.setAttribute('aria-valuetext', `RMS ${Number.isFinite(rmsDb) ? rmsDb.toFixed(1) : '−∞'} dBFS, peak ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : '−∞'} dBFS`);
  meter.title = meter.getAttribute('aria-valuetext');
  state.meterFrame = requestAnimationFrame(monitorAudioLevel);
}
function setEqValue(band, value) {
  const next = Math.max(-12, Math.min(12, Math.round(Number(value))));
  state.eqValues[band] = next;
  const filter = state.clarityNodes?.[`eq${band[0].toUpperCase()}${band.slice(1)}`];
  if (filter && state.context) filter.gain.setTargetAtTime(state.equalizer ? next : 0, state.context.currentTime, 0.04);
  $(`#eq-${band}-value`).textContent = `${next > 0 ? '+' : ''}${next} dB`;
  paintRange($(`#eq-${band}`), true);
  saveAudioSettings();
}
function setEqualizer(enabled) {
  state.equalizer = enabled;
  if (state.context && state.clarityNodes) for (const band of ['low', 'mid', 'high']) {
    const filter = state.clarityNodes[`eq${band[0].toUpperCase()}${band.slice(1)}`];
    filter.gain.setTargetAtTime(enabled ? state.eqValues[band] : 0, state.context.currentTime, 0.04);
  }
  saveAudioSettings();
  syncEffectControls();
}

function makeClarityChain(input = state.stretch || state.context.createGain()) {
  const highpass = state.context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = state.clarity ? 115 : 25;
  const presence = state.context.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.8; presence.gain.value = state.clarity ? 4.5 : 0;
  const compressor = state.context.createDynamicsCompressor(); compressor.threshold.value = -24; compressor.knee.value = 18; compressor.ratio.value = state.clarity ? 2.2 : 1; compressor.attack.value = 0.012; compressor.release.value = 0.22;
  const gain = state.context.createGain(); gain.gain.value = state.volume;
  const meterAnalyser = state.context.createAnalyser(); meterAnalyser.fftSize = 256; meterAnalyser.smoothingTimeConstant = 0.72;
  const noiseHighpass = state.context.createBiquadFilter(); noiseHighpass.type = 'highpass'; noiseHighpass.frequency.value = state.noiseReduction ? 90 : 20;
  const noiseLowpass = state.context.createBiquadFilter(); noiseLowpass.type = 'lowpass'; noiseLowpass.frequency.value = state.noiseReduction ? 10000 : 20000;
  const noiseAnalyser = state.context.createAnalyser(); noiseAnalyser.fftSize = 512; noiseAnalyser.smoothingTimeConstant = 0.82;
  const noiseGate = state.context.createGain(); noiseGate.gain.value = 1;
  const eqLow = state.context.createBiquadFilter(); eqLow.type = 'lowshelf'; eqLow.frequency.value = 180; eqLow.gain.value = state.equalizer ? state.eqValues.low : 0;
  const eqMid = state.context.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 1100; eqMid.Q.value = 0.85; eqMid.gain.value = state.equalizer ? state.eqValues.mid : 0;
  const eqHigh = state.context.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4200; eqHigh.gain.value = state.equalizer ? state.eqValues.high : 0;
  state.noiseGateSamples = new Float32Array(noiseAnalyser.fftSize);
  state.meterSamples = new Float32Array(meterAnalyser.fftSize);
  state.clarityNodes = { noiseHighpass, noiseLowpass, noiseAnalyser, noiseGate, eqLow, eqMid, eqHigh, highpass, presence, compressor, gain, meterAnalyser };
  input.connect(noiseHighpass); noiseHighpass.connect(noiseLowpass); noiseLowpass.connect(noiseAnalyser); noiseAnalyser.connect(noiseGate);
  noiseGate.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(highpass); highpass.connect(presence); presence.connect(compressor); compressor.connect(gain); gain.connect(meterAnalyser); meterAnalyser.connect(state.context.destination);
}
function updateClarity() {
  state.clarity = !state.clarity; const { highpass, presence, compressor } = state.clarityNodes || {};
  if (highpass) highpass.frequency.setTargetAtTime(state.clarity ? 115 : 25, state.context.currentTime, 0.08);
  if (presence) presence.gain.setTargetAtTime(state.clarity ? 4.5 : 0, state.context.currentTime, 0.08);
  if (compressor) compressor.ratio.setTargetAtTime(state.clarity ? 2.2 : 1, state.context.currentTime, 0.08);
  $('#clarity-toggle').classList.toggle('on', state.clarity); $('#clarity-toggle').setAttribute('aria-pressed', String(state.clarity)); $('.clarity-card').classList.toggle('clarity-active', state.clarity); saveAudioSettings();
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
  if (state.audioSetup) await state.audioSetup;
  if (resumeContext && state.context.state === 'suspended') await state.context.resume();
  if (resumeContext && state.context.state !== 'running') throw new Error(`Audio context is ${state.context.state}`);
}
function stopSource() {
  if (state.noiseGateFrame) cancelAnimationFrame(state.noiseGateFrame);
  if (state.meterFrame) cancelAnimationFrame(state.meterFrame);
  state.noiseGateFrame = 0;
  state.meterFrame = 0;
  state.meterSamples = null;
  const meter = $('#live-audio-meter');
  if (meter) { meter.style.setProperty('--meter-level', '0%'); meter.setAttribute('aria-valuenow', '-60'); meter.setAttribute('aria-valuetext', 'No active audio'); meter.title = 'No active audio'; }
  if (state.source) { try { state.source.onended = null; state.source.stop(); } catch {} try { state.source.disconnect(); } catch {} }
  if (state.mediaSource) { try { state.mediaSource.disconnect(); } catch {} }
  if (state.stretch) { try { state.stretch.disconnect(); } catch {} }
  for (const node of Object.values(state.clarityNodes || {})) { try { node.disconnect(); } catch {} }
  state.source = null; state.stretch = null; state.clarityNodes = null; state.noiseGateSamples = null;
}
function createPlaybackGraph() {
  stopSource();
  try {
    if (state.streaming) {
      state.media.loop = state.loop; state.media.playbackRate = state.speed; state.media.preservesPitch = false;
      if (!state.mediaSource) state.mediaSource = state.context.createMediaElementSource(state.media);
      state.media.volume = 1;
      state.stretch = new SoundTouchNode({ context: state.context }); state.mediaSource.connect(state.stretch); makeClarityChain();
    } else {
      state.stretch = new SoundTouchNode({ context: state.context });
      const source = state.context.createBufferSource(); source.buffer = state.buffer; source.loop = state.loop; source.playbackRate.value = state.speed;
      state.source = source; source.connect(state.stretch);
      makeClarityChain();
      source.onended = () => handleEnded();
    }
    if (state.stretch) { state.stretch.playbackRate.value = state.speed; state.stretch.pitchSemitones.value = state.pitch; }
  } catch (error) { stopSource(); throw error; }
}
function handleEnded() { if (state.playing && !state.loop) { state.playing = false; state.offset = 0; savePlaybackPosition(true); window.mto.setPlaybackActive(false); $('#play-symbol').textContent = '\u25B6'; $('#play-btn').classList.remove('is-playing'); $('#play-btn').title = 'Play'; $('#play-btn').setAttribute('aria-label', 'Play'); $('#track-state-label').textContent = 'TRACK ENDED'; $('#track-state-dot').classList.remove('playing'); drawProgress(); drawWaveform(); } }
async function play(allowDuringLoad = false) {
  if (state.loading && !allowDuringLoad) return;
  if (!hasAudio()) { await openAudio(); return; }
  if (state.playing) return;
  await ensureAudio(); if (state.playing) return;
  if (state.offset >= audioDuration()) state.offset = 0;
  try { createPlaybackGraph(); state.startedAt = state.context?.currentTime || 0; if (state.streaming) { state.media.currentTime = state.offset; state.media.onended = handleEnded; await state.media.play(); } else state.source.start(0, state.offset); state.playing = true; monitorAudioLevel(); if (state.noiseReduction) monitorNoiseGate(); window.mto.setPlaybackActive(true); }
  catch (error) { state.playing = false; stopSource(); throw error; }
  $('#play-symbol').textContent = '\u2016'; $('#play-btn').classList.add('is-playing'); $('#play-btn').title = 'Pause'; $('#play-btn').setAttribute('aria-label', 'Pause'); $('#track-state-label').textContent = 'NOW PLAYING'; $('#track-state-dot').classList.add('playing'); drawProgress();
}
function pause(savePosition = true) {
  if (!state.playing) return;
  state.offset = currentTime(); state.playing = false; if (state.streaming) state.media.pause(); stopSource(); if (savePosition) savePlaybackPosition(true); window.mto.setPlaybackActive(false); $('#play-symbol').textContent = '\u25B6'; $('#play-btn').classList.remove('is-playing'); $('#play-btn').title = 'Play'; $('#play-btn').setAttribute('aria-label', 'Play'); $('#track-state-label').textContent = 'PAUSED'; $('#track-state-dot').classList.remove('playing'); drawWaveform(); drawProgress();
}
async function togglePlay() { try { if (state.playing) pause(); else await play(); } catch (error) { console.error(error); toast('Playback could not start. Try reopening the audio file.'); } }
async function seekTo(value) {
  if (!hasAudio()) return; state.offset = Math.max(0, Math.min(audioDuration(), value));
  if (state.streaming) state.media.currentTime = state.offset;
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
    saveAudioSettings();
    const totalBytes = Number(file.size);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new Error('Audio file has no readable data');
    const isLargeFile = totalBytes >= 64 * 1024 * 1024;
    const cachedWaveform = await readWaveformCache(file);
    if (loadId !== state.loadId) return;
    stopWaveformAnalysis();
    state.waveformPeaks = cachedWaveform?.peaks || null;
    $('#wave-hit').classList.remove('wave-analyzing');
    $('#wave-empty').querySelector('b').textContent = 'Your waveform will appear here';
    $('#wave-empty').querySelector('small').textContent = 'Open an MP3 or WAV to get started';
    state.audioPath = '';
    state.bookmarks = [];
    renderBookmarks();
    updateLoadProgress('Preparing audio…', 0);
    pause(false); state.audioPath = file.path; loadAudioSettings(file.path); state.buffer = null; state.streaming = false; state.media.pause(); state.media.removeAttribute('src'); state.media.load();
    let waveformReady = Boolean(cachedWaveform?.complete);
    if (isLargeFile) {
      updateLoadProgress('Opening large audio stream…', null);
      await new Promise((resolve, reject) => { const onReady = () => { cleanup(); resolve(); }; const onError = () => { cleanup(); reject(new Error('Audio stream could not be opened')); }; const cleanup = () => { state.media.removeEventListener('loadedmetadata', onReady); state.media.removeEventListener('error', onError); }; state.media.addEventListener('loadedmetadata', onReady, { once: true }); state.media.addEventListener('error', onError, { once: true }); state.media.crossOrigin = 'anonymous'; state.media.src = file.url; state.media.load(); });
      if (loadId !== state.loadId) return;
      state.streaming = true; state.media.volume = state.volume; state.media.muted = false; state.name = file.name; state.offset = Math.max(0, Math.min(audioDuration(), Number(restorePosition) || 0));
      updateLoadProgress('Large audio ready', 70);
    } else {
      await ensureAudio(false);
      if (loadId !== state.loadId) return;
      const bytes = new Uint8Array(totalBytes); const chunkSize = 4 * 1024 * 1024;
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        if (loadId !== state.loadId) return;
        const chunk = await window.mto.readAudioChunk(file.path, offset, Math.min(chunkSize, totalBytes - offset));
        const partSource = chunk instanceof Uint8Array ? chunk : (chunk?.data || chunk);
        const part = partSource instanceof Uint8Array ? partSource : new Uint8Array(partSource);
        if (!part.byteLength) throw new Error('Audio file could not be read');
        bytes.set(part, offset); updateLoadProgress('Reading audio…', ((offset + part.byteLength) / totalBytes) * 65);
      }
      if (loadId !== state.loadId) return;
      updateLoadProgress('Decoding audio…', null);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const copy = bytes.buffer; const decoded = await state.context.decodeAudioData(copy);
      if (loadId !== state.loadId) return;
      updateLoadProgress('Finalizing audio…', 65);
      state.buffer = decoded; state.name = file.name; state.offset = Math.max(0, Math.min(state.buffer.duration, Number(restorePosition) || 0));
      state.waveformPeaks = await getBufferWaveformPeaks(decoded, file, cachedWaveform, loadId);
      if (loadId !== state.loadId) return;
      updateLoadProgress('Waveform ready', 100);
    }
    const duration = audioDuration();
    if (isLargeFile && !waveformReady) {
      updateLoadProgress('Generating waveform…', 82);
      try {
        const generated = await window.mto.generateWaveform(file.path, duration);
        if (loadId !== state.loadId) return;
        if (generated?.length === waveformPeakCount) {
          state.waveformPeaks = Float32Array.from(generated);
          await persistWaveform(waveformCacheIdentity(file), state.waveformPeaks, 1, true);
          waveformReady = true;
          drawWaveform();
        }
      } catch (error) {
        console.warn('The fast waveform generator was unavailable; using the built-in analyzer.', error);
      }
    }
    if (isLargeFile) updateLoadProgress('Audio ready', 100);
    state.audioPath = file.path;
    state.bookmarks = loadBookmarks(file.path, duration);
    loadTranscription(file.path);
    $('#track-title').textContent = file.name.replace(/\.(mp3|wav)$/i, ''); $('#track-meta').textContent = `${file.name.toLowerCase().endsWith('.wav') ? 'WAV' : 'MP3'} · ${formatTime(duration)}${state.buffer ? ` · ${Math.round(state.buffer.sampleRate / 1000)} kHz` : ' · streaming'}`;
    $('#duration').textContent = formatTime(duration); $('#end-time').textContent = formatTime(duration); $('#mid-time').textContent = formatTime(duration / 2);
    $('#track-state-label').textContent = restoredFile ? 'PAUSED' : 'TRACK LOADED'; $('#track-state-dot').classList.remove('playing');
    $('#recent-title').textContent = $('#track-title').textContent; $('#recent-subtitle').textContent = `${formatTime(duration)} · Just added`; $('.status-pill span').textContent = 'TRACK LOADED'; $('.status-pill i').classList.add('ready');
    renderBookmarks(); drawWaveform(); drawProgress(); savePlaybackPosition(true);
    if (isLargeFile && !waveformReady) analyzeStreamingWaveform(file.url, duration, loadId, file, cachedWaveform);
    if (!isRestore) {
      try { await play(true); }
      catch (error) { console.error(error); toast('Audio loaded. Press Play to start playback.'); }
    }
  } catch (error) { if (loadId === state.loadId) { console.error(error); toast('Could not open or play this audio file.'); } }
  finally { if (loadId === state.loadId) { state.loading = false; state.restoring = false; finishLoadProgress(); } }
}
async function restoreLastAudio() {
  try {
    const file = await window.mto.restoreAudio();
    if (file) await openAudio(file, file.position);
  } catch (error) { console.error(error); toast('Could not restore the last audio file.'); }
}

function keyCombo(event) { const bits = []; if (event.ctrlKey) bits.push('Ctrl'); if (event.altKey) bits.push('Alt'); if (event.shiftKey) bits.push('Shift'); if (event.metaKey) bits.push('Super'); let key = event.key; if (key === ' ') key = 'Space'; else if (key === 'ArrowUp') key = 'Up'; else if (key === 'ArrowDown') key = 'Down'; else if (key === 'ArrowLeft') key = 'Left'; else if (key === 'ArrowRight') key = 'Right'; else if (key.length === 1) key = key.toUpperCase(); if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) bits.push(key); return bits.join('+'); }
function showSettings() { $('#settings-overlay').classList.add('visible'); }
function hideSettings() { $('#settings-overlay').classList.remove('visible'); recordingShortcut = null; }
function showAbout() { $('#about-overlay').classList.add('visible'); $('#close-about').focus(); }
function hideAbout() { $('#about-overlay').classList.remove('visible'); $('#open-about').focus(); }
async function loadSettings() {
  state.shortcuts = await window.mto.getShortcuts();
  for (const input of document.querySelectorAll('[data-shortcut]')) input.value = state.shortcuts[input.dataset.shortcut] || '';
}
function doGlobalAction(action) { if (action === 'toggle-play') togglePlay(); else if (action === 'seek-backward') seekTo(currentTime() - 3); else if (action === 'seek-forward') seekTo(currentTime() + 3); else if (action === 'speed-down') setSpeed(state.speed - 0.05); else if (action === 'speed-up') setSpeed(state.speed + 0.05); else if (action === 'pitch-down') setPitch(state.pitch - 1); else if (action === 'pitch-up') setPitch(state.pitch + 1); }

const taskbar = $('#player-taskbar');
const playerCard = $('.player-card');
const trackHeader = playerCard.querySelector('.track-header');
const playerControlPanel = document.createElement('section');
playerControlPanel.className = 'player-control-panel';
playerControlPanel.setAttribute('aria-label', 'Playback controls');
trackHeader.append($('#open-track'));
playerControlPanel.append(playerCard.querySelector('.wave-wrap'), playerCard.querySelector('.transport'));
taskbar.append(trackHeader, playerControlPanel);
$('#side-player-controls').append($('.controls-row'));
const bookmarkRow = document.createElement('div');
bookmarkRow.className = 'wave-bookmark-row';
bookmarkRow.innerHTML = '<button class="bookmark-add" id="bookmark-add" type="button" disabled>+ Bookmark</button><div class="wave-bookmarks" id="wave-bookmarks" aria-label="Audio bookmarks"></div>';
playerControlPanel.querySelector('.wave-wrap').append(bookmarkRow);
$('#bookmark-add').addEventListener('click', addBookmark);
syncEffectControls(); paintDials(); drawWaveform(); loadSettings(); loadTranscription();
transcriptionText.addEventListener('input', saveTranscription);
transcriptionText.addEventListener('keydown', (event) => {
  if (transcriptionLanguage !== 'dv' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key.length !== 1) return;
  const thaana = phoneticThaana[event.key];
  if (!thaana) return;
  event.preventDefault();
  transcriptionText.setRangeText(thaana, transcriptionText.selectionStart, transcriptionText.selectionEnd, 'end');
  transcriptionText.dispatchEvent(new Event('input', { bubbles: true }));
});
$('#language-dv').addEventListener('click', () => setTranscriptionLanguage('dv'));
$('#language-en').addEventListener('click', () => setTranscriptionLanguage('en'));
transcriptionFontSize.addEventListener('input', () => { const size = Math.max(8, Math.min(72, Number(transcriptionFontSize.value) || 13)); transcriptionText.style.fontSize = `${size}px`; localStorage.setItem('mto-transcription-font-size', String(size)); });
$('#speed-slider').addEventListener('input', (event) => setSpeed(Number(event.target.value)));
$('#pitch-slider').addEventListener('input', (event) => setPitch(Number(event.target.value)));
$('#download-transcription').onclick = () => { const blob = new Blob([transcriptionText.value], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'transcription.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('#clear-transcription').onclick = () => { if (!transcriptionText.value || window.confirm('Clear the saved transcription?')) { transcriptionText.value = ''; saveTranscription(); transcriptionText.focus(); } };
$('#open-track').onclick = () => openAudio(); $('#play-btn').onclick = togglePlay;
$('#stop-btn').onclick = () => { pause(); state.offset = 0; savePlaybackPosition(true); drawWaveform(); drawProgress(); };
$('#jump-back').onclick = () => seekTo(currentTime() - 3); $('#jump-forward').onclick = () => seekTo(currentTime() + 3);
$('#loop-btn').onclick = () => { state.loop = !state.loop; $('#loop-btn').classList.toggle('selected', state.loop); if (state.source) state.source.loop = state.loop; if (state.media) state.media.loop = state.loop; };
$('#volume').oninput = (event) => { state.volume = Number(event.target.value); $('#volume-value').textContent = `${Math.round(state.volume * 100)}%`; paintRange(event.target); saveAudioSettings(); if (state.media) state.media.volume = state.streaming && state.mediaSource ? 1 : state.volume; if (state.clarityNodes?.gain) state.clarityNodes.gain.gain.setTargetAtTime(state.volume, state.context.currentTime, 0.02); };
paintRange($('#volume'));
$('#clarity-toggle').onclick = () => updateClarity();
$('#noise-reduction-toggle').onclick = () => setNoiseReduction(!state.noiseReduction);
$('#equalizer-toggle').onclick = () => setEqualizer(!state.equalizer);
for (const band of ['low', 'mid', 'high']) $(`#eq-${band}`).addEventListener('input', (event) => setEqValue(band, event.target.value));
document.querySelectorAll('[data-reset]').forEach((button) => button.onclick = () => button.dataset.reset === 'speed' ? setSpeed(1) : setPitch(0));
function wireWaveSeeking(hit, hover) {
  const timeHint = document.createElement('div');
  timeHint.className = 'wave-time-hint';
  timeHint.setAttribute('aria-hidden', 'true');
  hit.append(timeHint);
  const updatePointerHint = (event, rect = hit.getBoundingClientRect()) => {
    if (!hasAudio() || rect.width <= 0) { timeHint.classList.remove('visible'); return; }
    const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const ratio = localX / rect.width;
    timeHint.style.left = `${Math.max(30, Math.min(rect.width - 30, localX))}px`;
    timeHint.textContent = formatTime(ratio * audioDuration());
    timeHint.classList.add('visible');
  };
  hit.addEventListener('pointerdown', (event) => { if (!hasAudio()) return; scrubbing = true; scrubWasPlaying = state.playing; if (scrubWasPlaying) pause(); hit.setPointerCapture(event.pointerId); const rect = hit.getBoundingClientRect(); state.offset = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * audioDuration(); if (state.streaming) state.media.currentTime = state.offset; drawWaveform(); drawProgress(); });
  hit.addEventListener('pointermove', (event) => { const rect = hit.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); hover.style.left = `${ratio * 100}%`; updatePointerHint(event, rect); if (scrubbing && hasAudio()) { state.offset = ratio * audioDuration(); if (state.streaming) state.media.currentTime = state.offset; drawWaveform(); drawProgress(); } });
  hit.addEventListener('pointerleave', () => { if (!scrubbing) timeHint.classList.remove('visible'); });
  hit.addEventListener('pointerup', async () => { if (!scrubbing) return; scrubbing = false; savePlaybackPosition(true); if (scrubWasPlaying) await togglePlay(); scrubWasPlaying = false; });
  hit.addEventListener('pointercancel', () => { scrubbing = false; savePlaybackPosition(true); scrubWasPlaying = false; });
}
wireWaveSeeking($('#wave-hit'), $('#wave-hover'));
window.addEventListener('resize', drawWaveform);
$('#open-settings').onclick = $('#top-settings').onclick = showSettings; $('#close-settings').onclick = hideSettings;
$('#settings-overlay').addEventListener('click', (event) => { if (event.target === $('#settings-overlay')) hideSettings(); });
$('#open-about').onclick = showAbout; $('#close-about').onclick = hideAbout;
$('#about-overlay').addEventListener('click', (event) => { if (event.target === $('#about-overlay')) hideAbout(); });
$('#open-developer-profile').onclick = async () => { try { await window.mto.openDeveloperProfile(); } catch (error) { console.error('Could not open developer profile:', error); toast('Could not open the developer profile.'); } };
document.querySelectorAll('[data-shortcut]').forEach((input) => { input.onclick = () => { recordingShortcut = input; input.classList.add('recording'); input.value = 'Press shortcut…'; $('#shortcut-message').textContent = `Recording ${input.parentElement.firstChild.textContent.trim()}`; }; });
document.addEventListener('keydown', (event) => {
  if (recordingShortcut) { event.preventDefault(); const combo = keyCombo(event); if (!['Alt', 'Ctrl', 'Shift', 'Super'].includes(combo)) { recordingShortcut.value = combo; recordingShortcut.classList.remove('recording'); state.shortcuts[recordingShortcut.dataset.shortcut] = combo; recordingShortcut = null; $('#shortcut-message').textContent = 'Shortcut captured'; } return; }
  if (event.key === 'Escape') { hideSettings(); hideAbout(); return; }
  if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'ArrowLeft') seekTo(currentTime() - 3); else if (event.key === 'ArrowRight') seekTo(currentTime() + 3);
});
$('#save-settings').onclick = async () => { try { state.shortcuts = await window.mto.saveShortcuts(state.shortcuts); $('#shortcut-message').textContent = 'Shortcuts saved'; toast('Global shortcuts saved'); } catch { toast('Could not save shortcuts'); } };
function showUpdateStatus(update, notify = false) {
  const label = $('.status-pill span');
  const aboutStatus = $('#about-update-status');
  const checkButton = $('#check-for-updates');
  const isBusy = ['checking', 'downloading', 'downloaded', 'installing'].includes(update.status);
  checkButton.disabled = isBusy || update.status === 'unavailable';
  if (update.status === 'checking') aboutStatus.textContent = 'Checking for updates…';
  else if (update.status === 'downloading') aboutStatus.textContent = `Downloading version ${update.version || 'update'} · ${update.percent ?? 0}%`;
  else if (update.status === 'downloaded') aboutStatus.textContent = `Version ${update.version} is ready to install when playback stops.`;
  else if (update.status === 'installing') aboutStatus.textContent = 'Installing update…';
  else if (update.status === 'up-to-date') aboutStatus.textContent = 'You’re up to date.';
  else if (update.status === 'unavailable') aboutStatus.textContent = 'Updates are available in the installed app.';
  else if (update.status === 'error') aboutStatus.textContent = 'Could not check for updates. Try again later.';
  else aboutStatus.textContent = 'Updates are checked automatically.';
  if (update.status === 'checking') label.textContent = 'CHECKING FOR UPDATES';
  else if (update.status === 'downloading') label.textContent = `DOWNLOADING UPDATE ${update.percent ?? 0}%`;
  else if (update.status === 'downloaded') {
    label.textContent = 'UPDATE READY · INSTALLS WHEN PAUSED';
    if (notify) toast(`Update ${update.version} downloaded. It will install when playback stops.`);
  } else if (update.status === 'installing') label.textContent = 'INSTALLING UPDATE';
  else if (update.status === 'unavailable') label.textContent = 'UPDATES REQUIRE INSTALLED APP';
  else if (update.status === 'error') label.textContent = 'UPDATE CHECK FAILED';
  else label.textContent = state.playing ? 'NOW PLAYING' : hasAudio() ? 'TRACK LOADED' : 'READY TO LISTEN';
}
$('#check-for-updates').onclick = async () => {
  $('#about-update-status').textContent = 'Checking for updates…';
  $('#check-for-updates').disabled = true;
  try { showUpdateStatus(await window.mto.checkForUpdates()); }
  catch (error) { console.error('Could not check for updates:', error); showUpdateStatus({ status: 'error' }); }
};
window.mto.onUpdateStatus((update) => showUpdateStatus(update, true));
window.mto.getUpdateState().then((update) => showUpdateStatus(update)).catch((error) => console.error('Could not load update status:', error));
window.mto.getVersion().then((version) => { $('#about-version').textContent = version; }).catch((error) => console.error('Could not read application version:', error));
window.mto.onGlobalAction(doGlobalAction);
window.addEventListener('beforeunload', () => { saveAudioSettings(); savePlaybackPosition(true); });
restoreLastAudio();
