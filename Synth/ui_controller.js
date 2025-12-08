/*
 * UI CONTROLLER MODULE (v33 - Semantic UI Refactor)
 * Handles DOM manipulation, Event Listeners, and Visual Feedback.
 * Cleaned of Tailwind dependencies. Uses native semantic classes.
 */

class UIController {
    constructor() {
        this.drawFrameId = null;
        this.lastDrawnStep = -1;
    }

    init() {
        this.bindGlobalEvents();
        this.bindSynthControls();
        this.bindEditorControls();
        
        // Initial Renders
        this.renderInstrumentTabs();
        this.renderTrackBar();
        this.updateEditors();
        this.initPlayClock();
        
        // Start Visual Loop
        this.renderLoop();
        
        if(window.logToScreen) window.logToScreen("UI Controller Initialized");
    }

    // --- 1. EVENT BINDING ---

    bindGlobalEvents() {
        // Unlock Audio Context on first interaction
        const unlock = () => {
            if (window.audioEngine) window.audioEngine.resume();
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);

        // Header & Menu
        this.safeClick('btn-play', () => this.toggleTransport());
        this.safeClick('app-logo', () => this.toggleTransport());
        
        // MENU TRIGGERS
        this.safeClick('btn-open-menu', () => { 
            this.renderSynthMenu(); 
            this.toggleMenu(); 
        });
        this.safeClick('btn-menu-close', () => this.toggleMenu());
        
        // Menu Options
        this.safeClick('btn-toggle-ui-mode', () => this.toggleUIMode());
        this.safeClick('btn-toggle-visualizer', () => this.toggleVisualizerMode());
        
        // EXPORT TRIGGERS (AUDIO)
        this.safeClick('btn-open-export', () => { 
            this.toggleMenu(); 
            this.toggleExportModal(); 
        });
        this.safeClick('btn-close-export', () => this.toggleExportModal());

        // MEMORY TRIGGERS (CSV)
        this.safeClick('btn-open-memory', () => {
            this.toggleMenu();
            this.toggleMemoryModal();
        });
        this.safeClick('btn-close-memory', () => this.toggleMemoryModal());

        // --- CSV ACTIONS ---
        this.safeClick('btn-gen-csv', () => {
            if(window.timeMatrix) {
                const csvData = window.timeMatrix.exportToCSV();
                const area = document.getElementById('csv-io-area');
                if(area) area.value = csvData;
                if(window.logToScreen) window.logToScreen("CSV Generated in Buffer");
            }
        });

        this.safeClick('btn-load-csv', () => {
            const area = document.getElementById('csv-io-area');
            if(area && window.timeMatrix) {
                const success = window.timeMatrix.importFromCSV(area.value);
                
                if(success) {
                    // Sync Audio Engine
                    if(window.audioEngine && typeof window.audioEngine.syncWithMatrix === 'function') {
                        window.audioEngine.syncWithMatrix(window.timeMatrix);
                    }

                    // Reset UI State
                    window.AppState.editingBlock = 0;
                    window.AppState.selectedStep = 0;
                    
                    // Render Everything
                    this.renderInstrumentTabs();
                    this.renderTrackBar();
                    this.updateEditors();
                    this.renderSynthMenu();
                    
                    // Set active view
                    if(window.audioEngine && window.audioEngine.bassSynths.length > 0) {
                        this.setTab(window.audioEngine.bassSynths[0].id);
                    } else {
                        this.setTab('drum');
                    }

                    if(window.logToScreen) window.logToScreen("CSV Loaded Successfully");
                    this.toggleMemoryModal(); 
                } else {
                    if(window.logToScreen) window.logToScreen("CSV Import Failed: Invalid Format", 'error');
                }
            }
        });

        this.safeClick('btn-download-csv', () => {
            const content = document.getElementById('csv-io-area').value;
            if(!content) { 
                if(window.logToScreen) window.logToScreen("Buffer Empty", 'warn'); 
                return; 
            }
            
            const blob = new Blob([content], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ND23_Patch_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });

        const fileInput = document.getElementById('file-upload-csv');
        if(fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (e) => {
                    const contents = e.target.result;
                    const area = document.getElementById('csv-io-area');
                    if(area) area.value = contents;
                    document.getElementById('btn-load-csv').click();
                };
                reader.readAsText(file);
                fileInput.value = '';
            });
        }
        
        // RENDER BUTTON
        this.safeClick('btn-start-render', async () => { 
            if(window.audioEngine) {
                const btn = document.getElementById('btn-start-render');
                if(btn) {
                    btn.innerText = "WAIT...";
                    btn.classList.add('btn-disabled');
                    btn.disabled = true;
                }
                await new Promise(r => setTimeout(r, 50));
                try {
                    await window.audioEngine.renderAudio();
                } catch (e) {
                    console.error("Render failed", e);
                } finally {
                    if(btn) {
                        btn.innerText = "RENDER";
                        btn.classList.remove('btn-disabled');
                        btn.disabled = false;
                    }
                }
            } 
        });
        
        // Global Panic/Clear
        this.safeClick('btn-menu-panic', () => location.reload());
        this.safeClick('btn-menu-clear', () => { 
            if(confirm("Clear Pattern?")) { 
                window.timeMatrix.clearBlock(window.AppState.editingBlock); 
                this.updateEditors(); 
                this.toggleMenu(); 
            }
        });

        // Track Bar Controls
        this.safeClick('btn-add-block', () => { 
            window.timeMatrix.addBlock(); 
            window.AppState.editingBlock = window.timeMatrix.blocks.length - 1; 
            this.updateEditors(); 
            this.renderTrackBar(); 
        });
        this.safeClick('btn-del-block', () => { 
            if(confirm("Delete Block?")) { 
                window.timeMatrix.removeBlock(window.AppState.editingBlock); 
                window.AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length - 1); 
                this.updateEditors(); 
                this.renderTrackBar(); 
            }
        });
        this.safeClick('btn-mem-copy', () => { 
            if(window.timeMatrix.copyToClipboard(window.AppState.editingBlock)) {
                if(window.logToScreen) window.logToScreen("PATTERN COPIED"); 
            }
        });
        this.safeClick('btn-mem-paste', () => { 
            if(window.timeMatrix.pasteFromClipboard(window.AppState.editingBlock)) { 
                window.AppState.editingBlock++; 
                this.updateEditors(); 
                this.renderTrackBar(); 
                if(window.logToScreen) window.logToScreen("PATTERN PASTED"); 
            }
        });
        this.safeClick('btn-move-left', () => { 
            if(window.timeMatrix.moveBlock(window.AppState.editingBlock, -1)) { 
                window.AppState.editingBlock--; 
                this.updateEditors(); 
                this.renderTrackBar(); 
            }
        });
        this.safeClick('btn-move-right', () => { 
            if(window.timeMatrix.moveBlock(window.AppState.editingBlock, 1)) { 
                window.AppState.editingBlock++; 
                this.updateEditors(); 
                this.renderTrackBar(); 
            }
        });

        // BPM Input
        const bpm = document.getElementById('bpm-input');
        if(bpm) bpm.onchange = (e) => window.AppState.bpm = e.target.value;

        // Export Reps
        document.querySelectorAll('.export-rep-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.AppState.exportReps = parseInt(btn.dataset.rep);
            };
        });
        
        // Logs Toggle
        const logBtn = document.getElementById('btn-toggle-log-internal');
        const logPanel = document.getElementById('sys-log-panel');
        if(logBtn && logPanel) {
            logBtn.onclick = () => {
                const isHidden = logPanel.classList.contains('log-hidden');
                if(isHidden) {
                    logPanel.classList.remove('log-hidden');
                    logPanel.classList.add('log-visible');
                    logBtn.innerText = "[HIDE]";
                } else {
                    logPanel.classList.remove('log-visible');
                    logPanel.classList.add('log-hidden');
                    logBtn.innerText = "[SHOW]";
                }
            };
        }
        this.safeClick('btn-toggle-log-menu', () => { 
            if(logPanel.classList.contains('log-hidden')) logBtn.click();
            this.toggleMenu(); 
        });
        
        // Add Synth
        this.safeClick('btn-add-synth', () => {
            if(window.audioEngine) {
                const s = window.audioEngine.addBassSynth(`bass-${window.audioEngine.bassSynths.length + 1}`);
                if(s) {
                    this.renderSynthMenu();
                    this.renderInstrumentTabs();
                    this.setTab(s.id);
                    if(window.logToScreen) window.logToScreen(`Added ${s.id}`);
                }
            }
        });
    }

    bindSynthControls() {
        // --- ANALOG SLIDERS ---
        const bindSlider = (id, param) => {
            const el = document.getElementById(id);
            if(el) el.oninput = (e) => this.handleParamChange(param, parseInt(e.target.value));
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

        // --- DIGITAL INPUTS ---
        const bindDigital = (id, param) => {
            const el = document.getElementById(id);
            if(el) {
                el.onchange = (e) => {
                    let val = parseInt(e.target.value);
                    if(isNaN(val)) val = 0;
                    val = Math.max(0, Math.min(100, val));
                    this.handleDigitalChange(param, val);
                };
            }
        };

        bindDigital('vol-digital', 'volume');
        bindDigital('dist-digital', 'distortion');
        bindDigital('cutoff-digital', 'cutoff');
        bindDigital('res-digital', 'resonance');
        bindDigital('env-digital', 'envMod');
        bindDigital('dec-digital', 'decay');
        bindDigital('acc-digital', 'accentInt');
        bindDigital('tone-digital', 'distTone');
        bindDigital('dgain-digital', 'distGain');

        // --- DIGITAL REPEATERS ---
        this.setupDigitalRepeaters();

        // Waveform Toggle
        this.safeClick('btn-waveform', () => this.toggleWaveform());
    }

    bindEditorControls() {
        // Panel Toggles
        this.safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); this.togglePanelState(); });
        this.safeClick('panel-header-trigger', () => this.togglePanelState());
        
        this.safeClick('btn-toggle-view-keys', (e) => { e.stopPropagation(); this.toggleSubPanel('keys'); });
        this.safeClick('btn-toggle-view-fx', (e) => { e.stopPropagation(); this.toggleSubPanel('fx'); });

        // Octave Control
        const octD = document.getElementById('oct-display');
        this.safeClick('oct-up', () => { 
            if(window.AppState.currentOctave < 6) {
                window.AppState.currentOctave++; 
                if(octD) octD.innerText = window.AppState.currentOctave; 
            }
        });
        this.safeClick('oct-down', () => { 
            if(window.AppState.currentOctave > 1) {
                window.AppState.currentOctave--; 
                if(octD) octD.innerText = window.AppState.currentOctave; 
            }
        });

        // Note Modifiers
        this.safeClick('btn-toggle-slide', () => this.toggleNoteMod('slide'));
        this.safeClick('btn-toggle-accent', () => this.toggleNoteMod('accent'));
        
        // Piano Keys
        document.querySelectorAll('.piano-key').forEach(k => {
            k.onclick = () => {
                if(window.audioEngine) window.audioEngine.resume();
                const note = k.dataset.note;
                this.placeNote(note);
            };
        });

        // Delete Note
        this.safeClick('btn-delete-note', () => {
            if(window.AppState.activeView === 'drum') return;
            const b = window.timeMatrix.blocks[window.AppState.editingBlock];
            if(b && b.tracks[window.AppState.activeView]) {
                b.tracks[window.AppState.activeView][window.AppState.selectedStep] = null;
                this.updateEditors();
            }
        });

        // Matrix Step Selection
        window.addEventListener('stepSelect', (e) => { 
            window.AppState.selectedStep = e.detail.index; 
            this.updateEditors(); 
        });
    }

    // --- 2. LOGIC HANDLERS ---

    handleParamChange(param, value) {
        if(!window.audioEngine) return;
        const synth = window.audioEngine.getSynth(window.AppState.activeView);
        if(!synth) return;

        let finalValue = value;

        if (param === 'cutoff') {
            const minHz = 100, maxHz = 5000;
            const clamped = Math.max(minHz, Math.min(maxHz, value));
            finalValue = ((clamped - minHz) / (maxHz - minHz)) * 100;
        }

        if(param === 'volume') synth.setVolume(finalValue);
        else if(param === 'distortion') synth.setDistortion(finalValue);
        else if(param === 'cutoff') synth.setCutoff(finalValue);
        else if(param === 'resonance') synth.setResonance(finalValue);
        else if(param === 'envMod') synth.setEnvMod(finalValue);
        else if(param === 'decay') synth.setDecay(finalValue);
        else if(param === 'accentInt') synth.setAccentInt(finalValue);
        else if(param === 'distTone') synth.setDistTone(finalValue);
        else if(param === 'distGain') synth.setDistGain(finalValue);

        this.syncControls(window.AppState.activeView);
    }

    handleDigitalChange(param, value) {
        if (param === 'resonance') {
            this.handleParamChange('resonance', value / 5); 
        } 
        else if (param === 'cutoff') {
            const hz = ((value / 100) * 4900) + 100;
            this.handleParamChange('cutoff', hz);
        }
        else {
            this.handleParamChange(param, value);
        }
    }

    placeNote(note) {
        if(window.AppState.activeView === 'drum') return;
        const sId = window.AppState.activeView;
        
        if(window.audioEngine) window.audioEngine.previewNote(sId, note, window.AppState.currentOctave);

        const block = window.timeMatrix.blocks[window.AppState.editingBlock];
        if(!block.tracks[sId]) window.timeMatrix.registerTrack(sId);
        
        const prev = block.tracks[sId][window.AppState.selectedStep];
        
        block.tracks[sId][window.AppState.selectedStep] = { 
            note: note, 
            octave: window.AppState.currentOctave, 
            slide: prev ? prev.slide : false, 
            accent: prev ? prev.accent : false 
        };
        
        this.updateEditors();
    }

    toggleNoteMod(prop) {
        if(window.AppState.activeView === 'drum') return;
        const block = window.timeMatrix.blocks[window.AppState.editingBlock];
        const track = block.tracks[window.AppState.activeView];
        if(!track) return;
        
        const note = track[window.AppState.selectedStep];
        if(note) { 
            note[prop] = !note[prop]; 
            this.updateEditors(); 
        }
    }

    toggleWaveform() {
        if(!window.audioEngine) return;
        const s = window.audioEngine.getSynth(window.AppState.activeView);
        if(s) {
            const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
            s.setWaveform(next);
            this.syncControls(s.id);
        }
    }

    toggleTransport() {
        if(!window.audioEngine) return;
        const isPlaying = window.audioEngine.toggleTransport();
        const btn = document.getElementById('btn-play');
        
        if(isPlaying) {
            btn.innerHTML = "&#10074;&#10074;"; // Pause icon
            btn.classList.add('playing');
        } else {
            btn.innerHTML = "&#9658;"; // Play icon
            btn.classList.remove('playing');
            window.timeMatrix.highlightPlayingStep(-1);
            this.updatePlayClock(-1);
            this.renderTrackBar();
        }
    }
    
    // --- 3. MENU & MODAL HANDLERS ---

    toggleMenu() {
        const m = document.getElementById('main-menu');
        if(m) { 
            m.classList.toggle('hidden'); 
            m.classList.toggle('flex-center'); // Requires .flex-center { display: flex; align-items:center; justify-content:center; } in CSS
        }
    }

    toggleExportModal() {
        const m = document.getElementById('export-modal');
        if(m) { 
            m.classList.toggle('hidden'); 
            m.classList.toggle('flex-center');
        }
    }

    toggleMemoryModal() {
        const m = document.getElementById('memory-modal');
        if(m) {
            m.classList.toggle('hidden');
            m.classList.toggle('flex-center');
        }
    }

    // --- 4. VISUAL RENDER LOOP ---

    renderLoop() {
        while(window.visualQueue && window.visualQueue.length > 0) {
            const now = window.audioEngine.ctx.currentTime;
            if(window.visualQueue[0].time <= now) {
                const ev = window.visualQueue.shift();
                this.processVisualEvent(ev);
            } else {
                break; 
            }
        }
        requestAnimationFrame(() => this.renderLoop());
    }

    processVisualEvent(ev) {
        if(ev.step === 0) this.renderTrackBar();

        if(this.lastDrawnStep !== ev.step) {
            this.updatePlayClock(ev.step);
            
            if(window.AppState.followPlayback && ev.block !== window.AppState.editingBlock) {
                window.AppState.editingBlock = ev.block;
                this.updateEditors();
                this.renderTrackBar();
            }

            if(ev.block === window.AppState.editingBlock) {
                window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) this.blinkLed();
            } else {
                window.timeMatrix.highlightPlayingStep(-1);
            }
            
            this.lastDrawnStep = ev.step;
        }
    }

    // --- 5. UI UPDATES & SYNC ---

    syncControls(viewId) {
        if(viewId === 'drum') return; 
        
        const synth = window.audioEngine.getSynth(viewId);
        if(!synth) return;
        const p = synth.params;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.value = Math.round(val);
        };

        // Analog
        setVal('vol-slider', p.volume);
        setVal('dist-slider', p.distortion);
        setVal('res-slider', p.resonance);
        setVal('env-slider', p.envMod);
        setVal('dec-slider', p.decay);
        setVal('acc-slider', p.accentInt);
        setVal('tone-slider', p.distTone);
        setVal('dgain-slider', p.distGain);
        
        const cutoffHz = ((p.cutoff / 100) * 4900) + 100;
        setVal('cutoff-slider', cutoffHz);

        // Digital
        setVal('vol-digital', p.volume);
        setVal('dist-digital', p.distortion);
        setVal('cutoff-digital', p.cutoff);
        setVal('res-digital', p.resonance * 5);
        setVal('env-digital', p.envMod);
        setVal('dec-digital', p.decay);
        setVal('acc-digital', p.accentInt);
        setVal('tone-digital', p.distTone);
        setVal('dgain-digital', p.distGain);

        // Waveform Button
        const wvBtn = document.getElementById('btn-waveform');
        if(wvBtn) {
            if(p.waveform === 'square') wvBtn.innerHTML = '<span class="wave-icon">Π</span><span>SQR</span>';
            else wvBtn.innerHTML = '<span class="wave-icon">~</span><span>SAW</span>';
        }
    }

    updateEditors() {
        const bEd = document.getElementById('editor-bass');
        const dEd = document.getElementById('editor-drum');
        const info = document.getElementById('step-info-display');
        const keysBtn = document.getElementById('btn-toggle-view-keys');
        const fxBtn = document.getElementById('btn-toggle-view-fx');

        if(info) info.innerText = `STEP ${window.AppState.selectedStep+1} // ${window.AppState.activeView.toUpperCase()}`;

        if(window.AppState.activeView === 'drum') {
            bEd.classList.add('hidden');
            dEd.classList.remove('hidden');
            if(keysBtn) keysBtn.style.display = 'none';
            if(fxBtn) fxBtn.style.display = 'none';
            this.renderDrumRows();
        } else {
            bEd.classList.remove('hidden');
            dEd.classList.add('hidden');
            if(keysBtn) keysBtn.style.display = 'block';
            if(fxBtn) fxBtn.style.display = 'block';
        }

        const slideBtn = document.getElementById('btn-toggle-slide');
        const accBtn = document.getElementById('btn-toggle-accent');
        
        if(slideBtn) slideBtn.classList.remove('active');
        if(accBtn) accBtn.classList.remove('active');

        if(window.AppState.activeView !== 'drum') {
            const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
            const noteData = blk.tracks[window.AppState.activeView] ? blk.tracks[window.AppState.activeView][window.AppState.selectedStep] : null;
            if(noteData) {
                if(noteData.slide && slideBtn) slideBtn.classList.add('active');
                if(noteData.accent && accBtn) accBtn.classList.add('active');
            }
        }

        // Render Matrix
        window.timeMatrix.selectedStep = window.AppState.selectedStep;
        window.timeMatrix.render(window.AppState.activeView, window.AppState.editingBlock);
    }

    // --- 6. RENDER HELPERS ---

    renderTrackBar() {
        const c = document.getElementById('track-bar');
        if(!c) return;
        c.innerHTML = '';
        
        const blocks = window.timeMatrix.blocks;
        document.getElementById('display-total-blocks').innerText = blocks.length;
        document.getElementById('display-current-block').innerText = window.AppState.editingBlock + 1;

        blocks.forEach((_, i) => {
            const el = document.createElement('div');
            const isEditing = i === window.AppState.editingBlock;
            const isPlaying = window.AppState.isPlaying && i === window.AppState.currentPlayBlock;
            
            // Usamos clases semánticas
            let classes = 'track-block';
            if(isEditing) classes += ' editing';
            if(isPlaying) classes += ' playing';
            
            el.className = classes;
            el.innerText = i + 1;
            el.onclick = () => { 
                window.AppState.editingBlock = i; 
                this.updateEditors(); 
                this.renderTrackBar(); 
            };
            c.appendChild(el);
        });
    }

    renderInstrumentTabs() {
        const c = document.getElementById('instrument-tabs-container');
        if(!c || !window.audioEngine) return;
        c.innerHTML = '';
        
        window.audioEngine.bassSynths.forEach(s => {
            const b = document.createElement('button');
            const active = window.AppState.activeView === s.id;
            b.className = active ? 'tab-btn active' : 'tab-btn';
            b.innerText = s.id;
            b.onclick = () => this.setTab(s.id);
            c.appendChild(b);
        });

        const d = document.createElement('button');
        const dActive = window.AppState.activeView === 'drum';
        d.className = dActive ? 'tab-btn active' : 'tab-btn';
        d.innerText = "DRUMS";
        d.onclick = () => this.setTab('drum');
        c.appendChild(d);
    }

    renderDrumRows() {
        const c = document.getElementById('editor-drum');
        if(!c) return;
        c.innerHTML = '';
        
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const cur = blk.drums[window.AppState.selectedStep];
        
        const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : [];
        
        kits.forEach(k => {
            const act = cur.includes(k.id);
            const b = document.createElement('button');
            b.className = act ? 'drum-row active' : 'drum-row';
            
            // Visualización del círculo de color
            const colorDot = `<div class="drum-indicator" style="background-color: ${k.color}; box-shadow: 0 0 5px ${k.color};"></div>`;
            b.innerHTML = `<span>${k.name}</span>${colorDot}`;
            
            b.onclick = () => {
                if(window.audioEngine) window.audioEngine.resume();
                
                if(act) {
                    cur.splice(cur.indexOf(k.id), 1);
                } else {
                    cur.push(k.id);
                    if(window.audioEngine) window.audioEngine.previewDrum(k.id);
                }
                this.updateEditors();
            };
            c.appendChild(b);
        });
    }

    renderSynthMenu() {
        const c = document.getElementById('synth-list-container');
        if(!c || !window.audioEngine) return;
        c.innerHTML = '';
        
        window.audioEngine.bassSynths.forEach(s => {
            const r = document.createElement('div');
            r.className = 'menu-list-item';
            r.innerHTML = `<span class="text-green">${s.id}</span><button class="btn-remove-synth" onclick="window.removeBassSynth('${s.id}')">X</button>`;
            c.appendChild(r);
        });
    }

    // --- 7. STATE TOGGLES ---

    setTab(v) {
        window.AppState.activeView = v;
        this.renderInstrumentTabs();
        this.updateEditors();
        this.syncControls(v);
    }

    togglePanelState() {
        window.AppState.panelCollapsed = !window.AppState.panelCollapsed;
        const btn = document.getElementById('btn-minimize-panel');
        const p = document.getElementById('editor-panel');
        
        if(window.AppState.panelCollapsed) {
            p.classList.remove('panel-expanded');
            p.classList.add('panel-collapsed');
            btn.innerHTML = "&#9650;";
        } else {
            p.classList.remove('panel-collapsed');
            p.classList.add('panel-expanded');
            btn.innerHTML = "&#9660;";
        }
    }

    toggleSubPanel(panel) {
        if(panel === 'keys') window.AppState.viewKeys = !window.AppState.viewKeys;
        if(panel === 'fx') window.AppState.viewFx = !window.AppState.viewFx;
        this.renderSubPanelStates();
    }

    renderSubPanelStates() {
        const pKeys = document.getElementById('subpanel-keys');
        const pFx = document.getElementById('subpanel-fx');
        const btnKeys = document.getElementById('btn-toggle-view-keys');
        const btnFx = document.getElementById('btn-toggle-view-fx');

        const setBtn = (btn, active) => {
            if(!btn) return;
            if(active) btn.classList.add('active');
            else btn.classList.remove('active');
        };

        if(pKeys) {
            if(window.AppState.viewKeys) pKeys.classList.remove('hidden');
            else pKeys.classList.add('hidden');
            setBtn(btnKeys, window.AppState.viewKeys);
        }

        if(pFx) {
            if(window.AppState.viewFx) pFx.classList.remove('hidden');
            else pFx.classList.add('hidden');
            setBtn(btnFx, window.AppState.viewFx);
        }
    }

    toggleVisualizerMode() {
        window.AppState.followPlayback = !window.AppState.followPlayback;
        const btn = document.getElementById('btn-toggle-visualizer');
        if(window.AppState.followPlayback) {
            btn.innerText = "VISUALIZER: ON";
            btn.classList.add('active');
        } else {
            btn.innerText = "VISUALIZER: OFF";
            btn.classList.remove('active');
        }
    }

    toggleUIMode() {
        window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
        const btn = document.getElementById('btn-toggle-ui-mode');
        const analogP = document.getElementById('fx-controls-analog');
        const digitalP = document.getElementById('fx-controls-digital');
        
        if(window.AppState.uiMode === 'digital') {
            btn.innerText = "UI MODE: DIGITAL";
            btn.classList.add('active');
            analogP.classList.add('hidden');
            digitalP.classList.remove('hidden');
        } else {
            btn.innerText = "UI MODE: ANALOG";
            btn.classList.remove('active');
            analogP.classList.remove('hidden');
            digitalP.classList.add('hidden');
        }
        this.syncControls(window.AppState.activeView);
    }

    // --- 8. UTILS ---

    setupDigitalRepeaters() {
        const buttons = document.querySelectorAll('.dfx-btn');
        buttons.forEach(btn => {
            let intervalId = null;
            let timeoutId = null;
            const target = btn.dataset.target; 
            const dir = parseInt(btn.dataset.dir); 

            const changeVal = () => {
                if(!window.audioEngine) return;
                const s = window.audioEngine.getSynth(window.AppState.activeView);
                if(!s) return;
                
                let current = 0;
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
                
                if(target === 'resonance') this.handleDigitalChange('resonance', next);
                else if (target === 'cutoff') this.handleDigitalChange('cutoff', next); 
                else this.handleParamChange(target, next);
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

    initPlayClock() {
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

    updatePlayClock(step) {
        const total = window.timeMatrix.totalSteps;
        for(let i=0; i<total; i++) {
            const seg = document.getElementById(`clock-seg-${i}`);
            if(!seg) continue;
            if (i === step) { seg.setAttribute("stroke", "#00ff41"); seg.setAttribute("opacity", "1"); } 
            else if (i < step) { seg.setAttribute("stroke", "#004411"); seg.setAttribute("opacity", "0.5"); } 
            else { seg.setAttribute("stroke", "#222"); seg.setAttribute("opacity", "0.3"); }
        }
    }

    blinkLed() {
        const led = document.getElementById('activity-led');
        if(led) {
            led.style.backgroundColor = '#fff';
            led.style.boxShadow = '0 0 8px #fff';
            setTimeout(() => { led.style.backgroundColor = ''; led.style.boxShadow = ''; }, 50);
        }
    }

    safeClick(id, fn) {
        const el = document.getElementById(id);
        if(el) el.onclick = fn;
    }
}

window.UIController = UIController;