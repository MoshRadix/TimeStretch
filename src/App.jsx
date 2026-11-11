import React, { useEffect, useState } from 'react';
import { AudioLines, CircleHelp, Download, FileAudio2, Gauge, Headphones, Keyboard, Music2, Pause, Play, Plus, RotateCcw, Settings2, SkipBack, SkipForward, Square, Trash2, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Separator } from './components/ui/separator';
import { Slider } from './components/ui/slider';
import { Switch, SwitchThumb } from './components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Textarea } from './components/ui/textarea';
import { Toaster } from './components/ui/sonner';
import { toast as sonnerToast } from 'sonner';

function ControlCard({ id, type, title, value, min, max, step, labels, onReset }) {
  return <Card className="control-card"><CardHeader className="control-header"><div className="control-kicker"><span className={`control-indicator ${type}`} />{type === 'speed' ? 'TEMPO' : 'TONE'}</div><Button variant="ghost" size="sm" className="reset-control" onClick={onReset}><RotateCcw /> Reset</Button></CardHeader><CardContent className="control-content"><div className="control-title-row"><CardTitle>{title}</CardTitle><output id={`${type}-value`}>{value}</output></div><Slider id={id} min={min} max={max} step={step} value={[parseFloat(value)]} onValueChange={(v) => window.mtoPlayer?.[type === 'speed' ? 'setSpeed' : 'setPitch'](v[0])} aria-label={title} className={`control-slider ${type}`} /><div className="slider-labels"><span>{labels[0]}</span><span>{labels[1]}</span></div></CardContent></Card>;
}

function App() {
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(.8);
  const [clarity, setClarity] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const dials = (e) => { setSpeed(e.detail.speed); setPitch(e.detail.pitch); };
    const vol = (e) => setVolume(e.detail);
    const cl = (e) => setClarity(e.detail);
    const prefs = () => setSettingsOpen(true);
    const close = () => setSettingsOpen(false);
    const notify = (e) => sonnerToast(e.detail);
    window.addEventListener('mto:dials', dials); window.addEventListener('mto:volume', vol); window.addEventListener('mto:clarity', cl);
    window.addEventListener('mto:settings-open', prefs); window.addEventListener('mto:settings-close', close);
    window.addEventListener('mto:toast', notify);
    return () => { window.removeEventListener('mto:dials', dials); window.removeEventListener('mto:volume', vol); window.removeEventListener('mto:clarity', cl); window.removeEventListener('mto:settings-open', prefs); window.removeEventListener('mto:settings-close', close); window.removeEventListener('mto:toast', notify); };
  }, []);
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines /></div><div><b>M<span className="brand-zero">0</span>SH</b><small>TIME STRETCH</small></div></div>
      <div className="section-label">YOUR STUDIO</div>
      <div className="control-stack"><div className="section-label">PLAYER CONTROLS</div>
        <ControlCard id="speed-slider" type="speed" title="Playback speed" value={`${speed.toFixed(2)}×`} min={.5} max={2} step={.01} labels={['0.5×', '2×']} onReset={() => window.mtoPlayer?.setSpeed(1)} />
        <ControlCard id="pitch-slider" type="pitch" title="Pitch shift" value={`${pitch > 0 ? '+' : ''}${pitch} st`} min={-12} max={12} step={1} labels={['−12 st', '+12 st']} onReset={() => window.mtoPlayer?.setPitch(0)} />
        <Card className="clarity-card"><CardHeader className="clarity-heading"><WandSparkles /><div><CardTitle>Voice clarity</CardTitle><CardDescription>Enhance presence and intelligibility</CardDescription></div></CardHeader><CardContent className="clarity-content"><span className="muted-copy">{clarity ? 'Enabled' : 'Disabled'}</span><Switch id="clarity-toggle" checked={clarity} onCheckedChange={(v) => window.dispatchEvent(new CustomEvent('mto:clarity-input', { detail: v }))}><SwitchThumb /></Switch></CardContent></Card>
      </div>
      <Separator className="sidebar-separator" />
      <div className="section-label">RECENT SESSION</div>
      <div className="recent-track" id="recent-track"><span className="recent-icon"><Music2 /></span><div className="recent-meta"><b id="recent-title">Nothing playing</b><small id="recent-subtitle">Open a track to begin</small></div><span className="playing-bars"><i /><i /><i /></span></div>
      <div className="sidebar-bottom"><Button id="open-settings" variant="ghost" className="settings-link"><Settings2 /> Settings <kbd>Alt + ,</kbd></Button><div className="version">M<span className="brand-zero">0</span>SH PLAYER <span>·</span> 1.0.0 <span>·</span> Developed by <b>M<span className="brand-zero">0</span>SH</b></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Studio <span>/</span> <strong>Transcription</strong></div><div className="top-actions"><Badge id="app-status" variant="outline" className="status-pill"><i /> <span>Ready to listen</span></Badge><Button id="top-settings" variant="ghost" size="icon" aria-label="Settings"><Settings2 /></Button><div className="avatar">M</div></div></header>
      <section className="player-taskbar" id="player-taskbar" aria-label="Audio player">
        <div className="track-header"><div className="track-icon"><FileAudio2 /></div><div className="track-info"><div className="now-playing-label"><span className="track-state-dot" id="track-state-dot" /><span id="track-state-label">Ready for audio</span></div><h2 id="track-title">No audio loaded</h2><p id="track-meta">MP3 or WAV audio</p></div><Button id="open-track" className="open-track-btn"><Plus /><span>Open audio</span></Button></div>
        <Card className="player-control-panel"><CardContent className="wave-wrap"><div className="wave-time"><span id="elapsed" className="wave-current-time">00:00</span><span className="wave-label">WAVEFORM</span><span id="duration">00:00</span></div><div className="wave-canvas-wrap" id="wave-hit"><canvas id="waveform" aria-label="Track waveform. Click or drag to seek" /><div className="wave-progress" id="wave-progress"><canvas id="waveform-progress" /></div><div className="wave-hover" id="wave-hover" /><div className="wave-playhead" id="wave-playhead"><span /></div><div className="wave-empty" id="wave-empty"><FileAudio2 /><b>Your waveform will appear here</b><small>Open an MP3 or WAV to get started</small></div></div><div className="wave-ticks"><span>00:00</span><span id="mid-time">00:00</span><span id="end-time">00:00</span></div></CardContent>
          <div className="transport"><div className="transport-side seek-side"><Button id="jump-back" variant="outline" size="sm" aria-label="Back 3 seconds"><SkipBack /><span>3s</span></Button><Button id="jump-forward" variant="outline" size="sm" aria-label="Forward 3 seconds"><SkipForward /><span>3s</span></Button></div><div className="transport-main"><Button id="stop-btn" variant="outline" size="icon" aria-label="Stop"><Square /></Button><Button id="play-btn" className="play-btn" size="icon" aria-label="Play"><span id="play-symbol"><Play /></span></Button><Button id="loop-btn" variant="outline" size="icon" aria-label="Loop track"><RotateCcw /></Button></div><div className="transport-side right-side"><Volume2 /><Slider id="volume" min={0} max={1} step={.01} value={[volume]} onValueChange={(v) => window.dispatchEvent(new CustomEvent('mto:volume', { detail: v[0] }))} aria-label="Volume" /><span id="volume-value">{Math.round(volume * 100)}%</span></div></div>
        </Card>
      </section>
      <section className="transcription-page" id="transcription-page"><div className="page-heading"><div><div className="eyebrow">TRANSCRIPTION WORKSPACE</div><h1>Audio transcription</h1><p>Write and edit your transcription. Changes save automatically on this device.</p></div><Badge variant="secondary"><span className="saved-dot" /> Local autosave</Badge></div>
        <Card className="transcription-card"><div className="transcription-toolbar"><div className="transcription-font-label"><Headphones /> Faruma font</div><Separator orientation="vertical" className="toolbar-separator" /><label className="font-size-control" htmlFor="transcription-font-size">Font size<Input id="transcription-font-size" type="number" min="8" max="72" defaultValue="13" aria-label="Transcription font size" /><span>px</span></label><div className="transcription-actions"><Button id="download-transcription" variant="outline"><Download /> Download .txt</Button><Button id="clear-transcription" variant="outline"><Trash2 /> Clear text</Button></div></div>
          <Textarea id="transcription-text" className="transcription-text" spellCheck="false" placeholder="Start typing your transcription…" aria-label="Audio transcription" /><div className="transcription-footer"><span><span className="saved-dot" /> <span id="transcription-save-status">Saved on this device</span></span><span>UTF-8 text</span></div>
        </Card>
        <div className="keyboard-hint"><Keyboard /> <span>Space play / pause</span><kbd>←</kbd><kbd>→</kbd><span>seek</span><Button id="keyboard-help" variant="link" size="sm" onClick={() => window.dispatchEvent(new Event('mto:settings-open'))}><CircleHelp /> Keyboard shortcuts</Button></div>
      </section>
    </main>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="settings-modal"><DialogHeader><DialogTitle>Your shortcuts</DialogTitle><DialogDescription>Set global keys that work even when M0SH is in the background. Click any shortcut to change it.</DialogDescription></DialogHeader><div className="shortcut-list"><label>Play / pause <Input data-shortcut="playPause" defaultValue="Ctrl+Space" readOnly /></label><label>Seek backward <Input data-shortcut="seekBackward" defaultValue="Alt+Left" readOnly /></label><label>Seek forward <Input data-shortcut="seekForward" defaultValue="Alt+Right" readOnly /></label><label>Speed down <Input data-shortcut="speedDown" defaultValue="Alt+Down" readOnly /></label><label>Speed up <Input data-shortcut="speedUp" defaultValue="Alt+Up" readOnly /></label><label>Pitch down <Input data-shortcut="pitchDown" defaultValue="Ctrl+Alt+Left" readOnly /></label><label>Pitch up <Input data-shortcut="pitchUp" defaultValue="Ctrl+Alt+Right" readOnly /></label></div><div className="modal-footer"><span id="shortcut-message">Click a shortcut, then press your keys</span><Button id="save-settings">Save shortcuts</Button></div></DialogContent></Dialog>
    <Toaster position="bottom-center" />
  </div>;
}
export default App;
