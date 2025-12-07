/*
 * NEURODARK 23 - NATIVE CORE v29 (Pro Audio Update)
 */

const AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1',
    currentOctave: 3,
    uiMode: 'analog',
    exportReps: 1,
    // New UI States
    panelCollapsed: false,
    viewKeys: true,
    viewFx: true
};

let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];

let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- GLOBAL UTILS ---
window.toggleMenu = function() {
    const m = document.getElementById('main-menu');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
};

window.toggleExportModal = function() {
    const m = document.getElementById('export-modal');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
};

window.removeBassSynth = function(id) {
    if(bassSynths.length <= 1) {
        window.logToScreen("Cannot remove last synth", 'warn');
        return;
    }
    const idx = bassSynths.findIndex(s => s.id === id);
    if(idx > -1) {
        bassSynths.splice(idx, 1);
        if(window.timeMatrix) window.timeMatrix.removeTrack(id);
        renderSynthMenu();
        renderInstrumentTabs();
        if(AppState.activeView === id) setTab(bassSynths[0].id);
        window.logToScreen(`Removed ${id}`);
    }
};

function safeClick(id, fn) {
    const el = document.getElementById(id);
    if(el) el.onclick = fn;
}

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Boot Filters...");
    try {
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Missing";

        if(bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            bassSynths.push(def);
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        renderInstrumentTabs(); 
        renderTrackBar();
        updateEditors();
        initPlayClock();
        setupDigitalRepeaters();
        renderSubPanelStates(); // Initialize sub-panels
        
        // Initial Sync
        syncControlsFromSynth('bass-1');
        
        window.logToScreen("Engine Ready [OK]");
    } catch(e) {
        window.logToScreen("BOOT ERR: " + e, 'error');
        console.error(e);
    }
}

// --- ENGINE ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.6;
            
            // Master Compressor / Limiter
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -3;
            comp.knee.value = 30;
            comp.ratio.value = 12;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;
            
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            if(!clockWorker) {
                try {
                    clockWorker = new Worker('Synth/clock_worker.js');
                    clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
                    clockWorker.postMessage({interval: INTERVAL});
                } catch(e) { console.warn(e); }
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) { window.logToScreen("Audio Fail: "+e, 'error'); }
}

function globalUnlock() {
    initEngine();
    if(audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
    }
}

// --- CORE ---
function addBassSynth() {
    const id = `bass-${bassSynths.length + 1}`;
    if(bassSynths.find(s=>s.id===id)) return;
    const s = new window.BassSynth(id);
    if(audioCtx) s.init(audioCtx, masterGain);
    bassSynths.push(s);
    window.timeMatrix.registerTrack(id);
    renderSynthMenu(); renderInstrumentTabs(); setTab(id);
    window.logToScreen(`+Synth: ${id}`);
}

// --- CLOCK & SEQUENCER ---
function initPlayClock() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    const steps = window.timeMatrix.totalSteps || 16;
    const r=45, c=50, circ=2*Math.PI*r, gap=2, dash=(circ/steps)-gap;
    svg.innerHTML = ''; 
    for(let i=0; i<steps; i++) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("r", r); el.setAttribute("cx", c); el.setAttribute("cy", c);
        el.setAttribute("fill", "transparent"); el.setAttribute("stroke-width", "4");
        el.setAttribute("stroke-dasharray", `${dash} ${circ - dash}`);
        el.setAttribute("transform", `rotate(${(360/steps)*i}, ${c}, ${c})`);
        el.setAttribute("id", `clock-seg-${i}`);
        el.setAttribute("stroke", "#333"); 
        svg.appendChild(el);
    }
}

function updatePlayClock(step) {
    const total = window.timeMatrix.totalSteps;
    for(let i=0; i<total; i++) {
        const seg = document.getElementById(`clock-seg-${i}`);
        if(!seg) continue;
        if (i === step) { seg.setAttribute("stroke", "#00ff41"); seg.setAttribute("opacity", "1"); } 
        else if (i < step) { seg.setAttribute("stroke", "#004411"); seg.setAttribute("opacity", "0.5"); } 
        else { seg.setAttribute("stroke", "#222"); seg.setAttribute("opacity", "0.3"); }
    }
}

function nextNote() {
    const secPerBeat = 60.0 / AppState.bpm;
    const secPerStep = secPerBeat / 4;
    nextNoteTime += secPerStep;
    AppState.currentPlayStep++;
    if(AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock++;
        if(AppState.currentPlayBlock >= window.timeMatrix.blocks.length) AppState.currentPlayBlock = 0;
    }
}

function scheduleNote(step, block, time) {
    visualQueue.push({ step, block, time });
    const data = window.timeMatrix.getStepData(step, block);
    if(data.drums && window.drumSynth) data.drums.forEach(id => window.drumSynth.play(id, time));
    if(data.tracks) Object.keys(data.tracks).forEach(tid => {
        const n = data.tracks[tid][step];
        if(n) {
            const s = bassSynths.find(sy => sy.id === tid);
            if(s) s.play(n.note, n.octave, time, 0.25, n.slide, n.accent);
        }
    });
}

function scheduler() {
    while(nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(AppState.currentPlayStep, AppState.currentPlayBlock, nextNoteTime);
        nextNote();
    }
}

function drawLoop() {
    const t = audioCtx.currentTime;
    while(visualQueue.length && visualQueue[0].time <= t) {
        const ev = visualQueue.shift();
        if(ev.step === 0) renderTrackBar();
        if(lastDrawnStep !== ev.step) {
            updatePlayClock(ev.step);
            if(AppState.followPlayback && ev.block !== AppState.editingBlock) {
                AppState.editingBlock = ev.block;
                updateEditors();
                renderTrackBar();
            }
            if(ev.block === AppState.editingBlock) {
                window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) blinkLed();
            } else {
                window.timeMatrix.highlightPlayingStep(-1);
            }
            lastDrawnStep = ev.step;
        }
    }
    if(AppState.isPlaying) requestAnimationFrame(drawLoop);
}

function blinkLed() {
    const led = document.getElementById('activity-led');
    if(led) {
        led.style.backgroundColor = '#fff';
        led.style.boxShadow = '0 0 8px #fff';
        setTimeout(() => { led.style.backgroundColor = ''; led.style.boxShadow = ''; }, 50);
    }
}

function toggleTransport() { 
    initEngine(); 
    AppState.isPlaying = !AppState.isPlaying; 
    const btn = document.getElementById('btn-play'); 
    if(AppState.isPlaying) { 
        btn.innerHTML = "&#10074;&#10074;"; 
        btn.classList.add('border-green-500', 'text-green-500'); 
        AppState.currentPlayStep = 0; 
        AppState.currentPlayBlock = AppState.editingBlock; 
        nextNoteTime = audioCtx.currentTime + 0.1; 
        visualQueue = []; 
        if(clockWorker) clockWorker.postMessage("start"); 
        drawLoop(); 
        window.logToScreen("PLAY"); 
    } else { 
        btn.innerHTML = "&#9658;"; 
        btn.classList.remove('border-green-500', 'text-green-500'); 
        if(clockWorker) clockWorker.postMessage("stop"); 
        cancelAnimationFrame(drawFrameId); 
        window.timeMatrix.highlightPlayingStep(-1); 
        updatePlayClock(-1); 
        renderTrackBar(); 
        window.logToScreen("STOP"); 
    } 
}

// --- SYNC & CONTROL MAPPING ---

function updateSynthParam(param, value) {
    const s = bassSynths.find(sy => sy.id === AppState.activeView);
    if(!s) return;

    let finalValue = value;

    if (param === 'cutoff') {
        const minHz = 100;
        const maxHz = 5000;
        const clamped = Math.max(minHz, Math.min(maxHz, value));
        finalValue = ((clamped - minHz) / (maxHz - minHz)) * 100;
    }
    
    // Mapeo extendido para los nuevos parámetros
    if(param === 'volume') s.setVolume(finalValue);
    if(param === 'distortion') s.setDistortion(finalValue);
    if(param === 'cutoff') s.setCutoff(finalValue);
    if(param === 'resonance') s.setResonance(finalValue);
    if(param === 'envMod') s.setEnvMod(finalValue);
    if(param === 'decay') s.setDecay(finalValue);
    if(param === 'accentInt') s.setAccentInt(finalValue);
    if(param === 'distTone') s.setDistTone(finalValue);
    if(param === 'distGain') s.setDistGain(finalValue);

    syncControlsFromSynth(AppState.activeView);
}

function syncControlsFromSynth(viewId) {
    const s = bassSynths.find(sy => sy.id === viewId);
    if(!s) return;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.value = Math.round(val);
    };

    const p = s.params;

    // --- Analog Mode ---
    setVal('vol-slider', p.volume);
    setVal('dist-slider', p.distortion);
    setVal('res-slider', p.resonance);
    setVal('env-slider', p.envMod);
    setVal('dec-slider', p.decay);
    setVal('acc-slider', p.accentInt);
    setVal('tone-slider', p.distTone);
    setVal('dgain-slider', p.distGain);
    
    // Conversión de Cutoff para display Hz vs %
    const cutoffHz = ((p.cutoff / 100) * 4900) + 100;
    setVal('cutoff-slider', cutoffHz);

    // --- Digital Mode ---
    setVal('vol-digital', p.volume);
    setVal('dist-digital', p.distortion);
    setVal('cutoff-digital', p.cutoff);
    setVal('res-digital', p.resonance * 5); // Visual 0-100%
    setVal('env-digital', p.envMod);
    setVal('dec-digital', p.decay);
    setVal('acc-digital', p.accentInt);
    setVal('tone-digital', p.distTone);
    setVal('dgain-digital', p.distGain);


    const wvBtn = document.getElementById('btn-waveform');
    if(wvBtn) {
        if(p.waveform === 'square') wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">Π</span><span>SQR</span>';
        else wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">~</span><span>SAW</span>';
    }
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    safeClick('btn-play', toggleTransport);
    safeClick('app-logo', toggleTransport); 
    safeClick('btn-open-menu', () => { renderSynthMenu(); window.toggleMenu(); });
    safeClick('btn-menu-close', window.toggleMenu);
    
    safeClick('btn-toggle-ui-mode', toggleUIMode);
    safeClick('btn-toggle-visualizer', toggleVisualizerMode);
    
    // Panel & View Toggles
    safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); togglePanelState(); });
    safeClick('panel-header-trigger', togglePanelState);
    safeClick('btn-toggle-view-keys', (e) => { e.stopPropagation(); toggleSubPanel('keys'); });
    safeClick('btn-toggle-view-fx', (e) => { e.stopPropagation(); toggleSubPanel('fx'); });

    const logPanel = document.getElementById('sys-log-panel');
    const logBtn = document.getElementById('btn-toggle-log-internal');
    if(logBtn) logBtn.onclick = () => {
        logPanel.classList.toggle('-translate-y-full');
        logPanel.classList.toggle('translate-y-0');
        logBtn.innerText = logPanel.classList.contains('translate-y-0') ? "[HIDE]" : "[SHOW]";
    };
    safeClick('btn-toggle-log-menu', () => { 
        if(logPanel.classList.contains('-translate-y-full')) logBtn.click();
        window.toggleMenu(); 
    });

    safeClick('btn-waveform', toggleWaveform);

    // --- BIND ANALOG SLIDERS ---
    const bindSlider = (id, param) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => updateSynthParam(param, parseInt(e.target.value));
    };
    bindSlider('vol-slider', 'volume');
    bindSlider('dist-slider', 'distortion');
    bindSlider('cutoff-slider', 'cutoff'); 
    bindSlider('res-slider', 'resonance');
    bindSlider('env-slider', 'envMod');
    bindSlider('dec-slider', 'decay');
    bindSlider('acc-slider', 'accentInt');
    bindSlider('tone-slider', 'distTone');
    bindSlider('dgain-slider', 'distGain');

    // --- BIND DIGITAL INPUTS ---
    const bindDigitalInput = (id, param) => {
        const el = document.getElementById(id);
        if(el) {
            el.onchange = (e) => {
                let val = parseInt(e.target.value);
                if(isNaN(val)) val = 0;
                val = Math.max(0, Math.min(100, val)); 
                
                if (param === 'resonance') {
                    const s = bassSynths.find(sy => sy.id === AppState.activeView);
                    if(s) s.setResonance(val / 5);
                    syncControlsFromSynth(AppState.activeView);
                }
                else if (param === 'cutoff') {
                    const s = bassSynths.find(sy => sy.id === AppState.activeView);
                    if(s) s.setCutoff(val);
                    syncControlsFromSynth(AppState.activeView);
                } 
                else {
                    // Mapeo directo para el resto
                    updateSynthParam(param, val);
                }
            };
        }
    };
    bindDigitalInput('vol-digital', 'volume');
    bindDigitalInput('dist-digital', 'distortion');
    bindDigitalInput('cutoff-digital', 'cutoff');
    bindDigitalInput('res-digital', 'resonance');
    bindDigitalInput('env-digital', 'envMod');
    bindDigitalInput('dec-digital', 'decay');
    bindDigitalInput('acc-digital', 'accentInt');
    bindDigitalInput('tone-digital', 'distTone');
    bindDigitalInput('dgain-digital', 'distGain');

    window.addEventListener('stepSelect', (e) => { AppState.selectedStep = e.detail.index; updateEditors(); });
    
    document.querySelectorAll('.piano-key').forEach(k => {
        k.onclick = () => {
            initEngine();
            const note = k.dataset.note;
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            const b = window.timeMatrix.blocks[AppState.editingBlock];
            if(!b.tracks[s.id]) window.timeMatrix.registerTrack(s.id);
            const prev = b.tracks[s.id][AppState.selectedStep];
            b.tracks[s.id][AppState.selectedStep] = { 
                note, octave: AppState.currentOctave, 
                slide: prev ? prev.slide : false, 
                accent: prev ? prev.accent : false 
            };
            s.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
        };
    });

    safeClick('btn-delete-note', () => { 
        const s = bassSynths.find(sy => sy.id === AppState.activeView); 
        if(s) { window.timeMatrix.blocks[AppState.editingBlock].tracks[s.id][AppState.selectedStep] = null; updateEditors(); }
    });

    const toggleNoteMod = (prop) => {
        if(AppState.activeView === 'drum') return;
        const b = window.timeMatrix.blocks[AppState.editingBlock];
        const track = b.tracks[AppState.activeView];
        if(!track) return;
        const note = track[AppState.selectedStep];
        if(note) { note[prop] = !note[prop]; updateEditors(); }
    };
    safeClick('btn-toggle-slide', () => toggleNoteMod('slide'));
    safeClick('btn-toggle-accent', () => toggleNoteMod('accent'));

    const bpm = document.getElementById('bpm-input'); if(bpm) bpm.onchange = (e) => AppState.bpm = e.target.value;
    const octD = document.getElementById('oct-display');
    safeClick('oct-up', () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; });
    safeClick('oct-down', () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; });

    safeClick('btn-add-synth', addBassSynth);
    safeClick('btn-menu-panic', () => location.reload());
    safeClick('btn-menu-clear', () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); window.toggleMenu(); }});
    safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); });
    safeClick('btn-del-block', () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }});
    safeClick('btn-mem-copy', () => { if(window.timeMatrix.copyToClipboard(AppState.editingBlock)) window.logToScreen("PATTERN COPIED"); });
    safeClick('btn-mem-paste', () => { if(window.timeMatrix.pasteFromClipboard(AppState.editingBlock)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); window.logToScreen("PATTERN PASTED"); }});
    safeClick('btn-move-left', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); }});
    safeClick('btn-move-right', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); }});
    
    safeClick('btn-open-export', () => { window.toggleMenu(); window.toggleExportModal(); });
    safeClick('btn-close-export', window.toggleExportModal);
    safeClick('btn-start-render', renderAudio);
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });

    bootstrap();
});

// --- RENDERERS ---
function renderInstrumentTabs() {
    const c = document.getElementById('instrument-tabs-container');
    if(!c) return;
    c.innerHTML = '';
    bassSynths.forEach(s => {
        const b = document.createElement('button');
        const active = AppState.activeView === s.id;
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${active ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
        b.innerText = s.id;
        b.onclick = () => setTab(s.id);
        c.appendChild(b);
    });
    const d = document.createElement('button');
    const dActive = AppState.activeView === 'drum';
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${dActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
    d.innerText = "DRUMS";
    d.onclick = () => setTab('drum');
    c.appendChild(d);
}

function setTab(v) {
    AppState.activeView = v;
    renderInstrumentTabs();
    updateEditors();
    syncControlsFromSynth(v);
}

function toggleSubPanel(panel) {
    if(panel === 'keys') AppState.viewKeys = !AppState.viewKeys;
    if(panel === 'fx') AppState.viewFx = !AppState.viewFx;
    renderSubPanelStates();
}

function renderSubPanelStates() {
    const pKeys = document.getElementById('subpanel-keys');
    const pFx = document.getElementById('subpanel-fx');
    const btnKeys = document.getElementById('btn-toggle-view-keys');
    const btnFx = document.getElementById('btn-toggle-view-fx');

    const setBtnState = (btn, active) => {
        if(!btn) return;
        if(active) {
            btn.classList.add('text-green-400', 'bg-green-900/20', 'border-green-500/50');
            btn.classList.remove('text-gray-600', 'bg-transparent', 'border-gray-800');
        } else {
            btn.classList.remove('text-green-400', 'bg-green-900/20', 'border-green-500/50');
            btn.classList.add('text-gray-600', 'bg-transparent', 'border-gray-800');
        }
    };

    if(pKeys) {
        if(AppState.viewKeys) pKeys.classList.remove('hidden');
        else pKeys.classList.add('hidden');
        setBtnState(btnKeys, AppState.viewKeys);
    }

    if(pFx) {
        if(AppState.viewFx) pFx.classList.remove('hidden');
        else pFx.classList.add('hidden');
        setBtnState(btnFx, AppState.viewFx);
    }
}

function setupDigitalRepeaters() {
    const buttons = document.querySelectorAll('.dfx-btn');
    if(!buttons.length) return;
    buttons.forEach(btn => {
        let intervalId = null;
        let timeoutId = null;
        const target = btn.dataset.target; 
        const dir = parseInt(btn.dataset.dir); 

        const changeVal = () => {
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            
            let current = 0;
            // Get current value based on target
            if(target === 'volume') current = s.params.volume;
            else if(target === 'distortion') current = s.params.distortion;
            else if(target === 'envMod') current = s.params.envMod;
            else if(target === 'decay') current = s.params.decay;
            else if(target === 'accentInt') current = s.params.accentInt;
            else if(target === 'distTone') current = s.params.distTone;
            else if(target === 'distGain') current = s.params.distGain;
            else if(target === 'resonance') current = s.params.resonance * 5; 
            else if(target === 'cutoff') current = s.params.cutoff; 

            let next = Math.max(0, Math.min(100, current + dir));
            
            // Set new value
            if (target === 'resonance') s.setResonance(next / 5);
            else if (target === 'cutoff') s.setCutoff(next);
            else if(target === 'volume') s.setVolume(next);
            else if(target === 'distortion') s.setDistortion(next);
            else if(target === 'envMod') s.setEnvMod(next);
            else if(target === 'decay') s.setDecay(next);
            else if(target === 'accentInt') s.setAccentInt(next);
            else if(target === 'distTone') s.setDistTone(next);
            else if(target === 'distGain') s.setDistGain(next);
            
            syncControlsFromSynth(AppState.activeView);
        };

        const startRepeat = () => {
            changeVal(); 
            timeoutId = setTimeout(() => {
                intervalId = setInterval(changeVal, 100); 
            }, 400); 
        };

        const stopRepeat = () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };

        btn.addEventListener('mousedown', startRepeat);
        btn.addEventListener('mouseup', stopRepeat);
        btn.addEventListener('mouseleave', stopRepeat);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startRepeat(); });
        btn.addEventListener('touchend', stopRepeat);
    });
}

function toggleWaveform() {
    const s = bassSynths.find(sy => sy.id === AppState.activeView);
    if(s) {
        const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
        s.setWaveform(next);
        syncControlsFromSynth(AppState.activeView);
    }
}

function renderTrackBar() { const c = document.getElementById('track-bar'); if(!c) return; c.innerHTML = ''; const blocks = window.timeMatrix.blocks; document.getElementById('display-total-blocks').innerText = blocks.length; document.getElementById('display-current-block').innerText = AppState.editingBlock + 1; blocks.forEach((_, i) => { const el = document.createElement('div'); el.className = `track-block ${i===AppState.editingBlock ? 'track-block-editing' : ''} ${AppState.isPlaying && i===AppState.currentPlayBlock ? 'track-block-playing' : ''}`; el.innerText = i + 1; el.onclick = () => { AppState.editingBlock = i; updateEditors(); renderTrackBar(); }; c.appendChild(el); }); }

function updateEditors() { 
    const bEd = document.getElementById('editor-bass'); 
    const dEd = document.getElementById('editor-drum'); 
    const info = document.getElementById('step-info-display'); 
    const keysBtn = document.getElementById('btn-toggle-view-keys');
    const fxBtn = document.getElementById('btn-toggle-view-fx');

    if(info) info.innerText = `STEP ${AppState.selectedStep+1} // ${AppState.activeView.toUpperCase()}`; 
    
    // Toggle Visibility of Views
    if(AppState.activeView === 'drum') { 
        bEd.classList.add('hidden'); 
        dEd.classList.remove('hidden'); 
        // Hide bass-specific controls in drum mode
        if(keysBtn) keysBtn.style.display = 'none';
        if(fxBtn) fxBtn.style.display = 'none';
        renderDrumRows(); 
    } else { 
        bEd.classList.remove('hidden'); 
        dEd.classList.add('hidden'); 
        // Show bass-specific controls
        if(keysBtn) keysBtn.style.display = 'block';
        if(fxBtn) fxBtn.style.display = 'block';
    } 

    const slideBtn = document.getElementById('btn-toggle-slide'); 
    const accBtn = document.getElementById('btn-toggle-accent'); 
    if(slideBtn) slideBtn.classList.remove('text-green-400', 'border-green-600'); 
    if(accBtn) accBtn.classList.remove('text-green-400', 'border-green-600'); 
    
    if(AppState.activeView !== 'drum') { 
        const blk = window.timeMatrix.blocks[AppState.editingBlock]; 
        const noteData = blk.tracks[AppState.activeView] ? blk.tracks[AppState.activeView][AppState.selectedStep] : null; 
        if(noteData) { 
            if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600'); 
            if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600'); 
        } 
    } 
    window.timeMatrix.selectedStep = AppState.selectedStep; 
    window.timeMatrix.render(AppState.activeView, AppState.editingBlock); 
}

function renderDrumRows() { const c = document.getElementById('editor-drum'); if(!c) return; c.innerHTML = ''; const blk = window.timeMatrix.blocks[AppState.editingBlock]; const cur = blk.drums[AppState.selectedStep]; const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : []; kits.forEach(k => { const act = cur.includes(k.id); const b = document.createElement('button'); b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`; b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`; b.onclick = () => { initEngine(); if(act) cur.splice(cur.indexOf(k.id), 1); else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); } updateEditors(); }; c.appendChild(b); }); }
function renderSynthMenu() { const c = document.getElementById('synth-list-container'); if(!c) return; c.innerHTML = ''; bassSynths.forEach(s => { const r = document.createElement('div'); r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs'; r.innerHTML = `<span class="text-green-500">${s.id}</span><button class="text-red-500" onclick="removeBassSynth('${s.id}')">X</button>`; c.appendChild(r); }); }
function togglePanelState() { AppState.panelCollapsed = !AppState.panelCollapsed; const p = document.getElementById('editor-panel'); const btn = document.getElementById('btn-minimize-panel'); if(AppState.panelCollapsed) { p.classList.remove('panel-expanded'); p.classList.add('panel-collapsed'); btn.innerHTML = "&#9650;"; } else { p.classList.remove('panel-collapsed'); p.classList.add('panel-expanded'); btn.innerHTML = "&#9660;"; } }
function toggleVisualizerMode() { AppState.followPlayback = !AppState.followPlayback; const btn = document.getElementById('btn-toggle-visualizer'); if(AppState.followPlayback) { btn.innerText = "VISUALIZER: ON"; btn.classList.remove('border-gray-700', 'text-gray-400'); btn.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20'); } else { btn.innerText = "VISUALIZER: OFF"; btn.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20'); btn.classList.add('border-gray-700', 'text-gray-400'); } }

function toggleUIMode() { 
    AppState.uiMode = AppState.uiMode === 'analog' ? 'digital' : 'analog'; 
    const btn = document.getElementById('btn-toggle-ui-mode'); 
    const analogP = document.getElementById('fx-controls-analog'); 
    const digitalP = document.getElementById('fx-controls-digital'); 
    
    if(AppState.uiMode === 'digital') { 
        btn.innerText = "UI MODE: DIGITAL"; 
        btn.classList.add('border-green-500', 'text-green-300'); 
        analogP.classList.add('hidden'); 
        digitalP.classList.remove('hidden'); 
    } else { 
        btn.innerText = "UI MODE: ANALOG"; 
        btn.classList.remove('border-green-500', 'text-green-300'); 
        analogP.classList.remove('hidden'); 
        digitalP.classList.add('hidden'); 
    } 
    syncControlsFromSynth(AppState.activeView); 
}

// --- EXPORT RENDER LOGIC ---
async function renderAudio() {
    if(AppState.isPlaying) toggleTransport();
    window.logToScreen("Rendering WAV...");
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "WAIT..."; btn.disabled = true; }

    try {
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secPerStep = (60.0 / AppState.bpm) / 4;
        const totalSteps = stepsPerBlock * totalBlocks * AppState.exportReps;
        const duration = totalSteps * secPerStep + 2.0;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const offMaster = offCtx.createGain();
        offMaster.gain.value = 0.6;
        offMaster.connect(offCtx.destination);

        const offBass = [];
        bassSynths.forEach(ls => {
            const s = new window.BassSynth(ls.id);
            s.init(offCtx, offMaster);
            // Copiar todos los parámetros al contexto offline
            s.setVolume(ls.params.volume);
            s.setDistortion(ls.params.distortion);
            s.setDistTone(ls.params.distTone);
            s.setDistGain(ls.params.distGain);
            s.setCutoff(ls.params.cutoff);
            s.setResonance(ls.params.resonance);
            s.setEnvMod(ls.params.envMod);
            s.setDecay(ls.params.decay);
            s.setAccentInt(ls.params.accentInt);
            s.setWaveform(ls.params.waveform);
            offBass.push(s);
        });
        const offDrum = new DrumSynth();
        offDrum.init(offCtx, offMaster);

        let t = 0.0;
        for(let r=0; r<AppState.exportReps; r++) {
            for(let b=0; b<totalBlocks; b++) {
                const blk = window.timeMatrix.blocks[b];
                for(let s=0; s<stepsPerBlock; s++) {
                    if(blk.drums[s]) blk.drums[s].forEach(id=>offDrum.play(id, t));
                    if(blk.tracks) Object.keys(blk.tracks).forEach(tid => {
                        const n = blk.tracks[tid][s];
                        if(n) {
                            const syn = offBass.find(k=>k.id===tid);
                            if(syn) syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                        }
                    });
                    t += secPerStep;
                }
            }
        }

        const buf = await offCtx.startRendering();
        const wav = bufferToWave(buf, buf.length);
        const url = URL.createObjectURL(wav);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ND23_Render_${Date.now()}.wav`;
        a.click();
        window.logToScreen("Download Ready!");
        window.toggleExportModal();

    } catch(e) { window.logToScreen("Render Err: "+e, 'error'); }
    finally { if(btn) { btn.innerText = "RENDER"; btn.disabled = false; } }
}

function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
    setUint32(length - pos - 4);

    for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); 
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
            view.setInt16(pos, sample, true); pos += 2;
        }
        offset++;
    }
    return new Blob([buffer], {type: "audio/wav"});
}