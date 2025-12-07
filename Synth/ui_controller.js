/*
 * UI CONTROLLER MODULE (v30.3 - Digital Cutoff Fix)
 * Handles DOM manipulation, Event Listeners, and Visual Feedback.
 * Decoupled from Audio logic.
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
        
        window.logToScreen("UI Controller Initialized");
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
        
        // EXPORT TRIGGERS
        this.safeClick('btn-open-export', () => { 
            this.toggleMenu(); // Close main menu
            this.toggleExportModal(); // Open export modal
        });
        this.safeClick('btn-close-export', () => this.toggleExportModal());
        
        // RENDER BUTTON WITH VISUAL FEEDBACK
        this.safeClick('btn-start-render', async () => { 
            if(window.audioEngine) {
                const btn = document.getElementById('btn-start-render');
                
                // Visual feedback start
                if(btn) {
                    btn.innerText = "WAIT...";
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    btn.disabled = true;
                }

                // Force a small UI tick before blocking
                await new Promise(r => setTimeout(r, 50));

                try {
                    await window.audioEngine.renderAudio();
                } catch (e) {
                    console.error("Render failed", e);
                } finally {
                    // Visual feedback end
                    if(btn) {
                        btn.innerText = "RENDER";
                        btn.classList.remove('opacity-50', 'cursor-not-allowed');
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
            if(window.timeMatrix.copyToClipboard(window.AppState.editingBlock)) window.logToScreen("PATTERN COPIED"); 
        });
        this.safeClick('btn-mem-paste', () => { 
            if(window.timeMatrix.pasteFromClipboard(window.AppState.editingBlock)) { 
                window.AppState.editingBlock++; 
                this.updateEditors(); 
                this.renderTrackBar(); 
                window.logToScreen("PATTERN PASTED"); 
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
        
        // Logs
        const logBtn = document.getElementById('btn-toggle-log-internal');
        const logPanel = document.getElementById('sys-log-panel');
        if(logBtn && logPanel) {
            logBtn.onclick = () => {
                logPanel.classList.toggle('-translate-y-full');
                logPanel.classList.toggle('translate-y-0');
                logBtn.innerText = logPanel.classList.contains('translate-y-0') ? "[HIDE]" : "[SHOW]";
            };
        }
        this.safeClick('btn-toggle-log-menu', () => { 
            if(logPanel.classList.contains('-translate-y-full')) logBtn.click();
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
                    window.logToScreen(`Added ${s.id}`);
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

        // --- DIGITAL REPEATERS (+/- Buttons) ---
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

        // Cutoff mapping normalization (Expects value in Hz for slider)
        if (param === 'cutoff') {
            const minHz = 100, maxHz = 5000;
            const clamped = Math.max(minHz, Math.min(maxHz, value));
            finalValue = ((clamped - minHz) / (maxHz - minHz)) * 100;
        }

        // Apply to Audio Engine
        if(param === 'volume') synth.setVolume(finalValue);
        else if(param === 'distortion') synth.setDistortion(finalValue);
        else if(param === 'cutoff') synth.setCutoff(finalValue);
        else if(param === 'resonance') synth.setResonance(finalValue);
        else if(param === 'envMod') synth.setEnvMod(finalValue);
        else if(param === 'decay') synth.setDecay(finalValue);
        else if(param === 'accentInt') synth.setAccentInt(finalValue);
        else if(param === 'distTone') synth.setDistTone(finalValue);
        else if(param === 'distGain') synth.setDistGain(finalValue);

        // Sync UI
        this.syncControls(window.AppState.activeView);
    }

    handleDigitalChange(param, value) {
        // Digital inputs for Resonance/Cutoff need special handling for visual scaling
        if (param === 'resonance') {
            this.handleParamChange('resonance', value / 5); // 0-100 -> 0-20
        } 
        else if (param === 'cutoff') {
            // FIX: Convert 0-100 range back to Hz (100-5000) 
            // so handleParamChange processes it correctly without resetting to 0.
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
        
        // Play Preview
        if(window.audioEngine) window.audioEngine.previewNote(sId, note, window.AppState.currentOctave);

        // Write to Matrix
        const block = window.timeMatrix.blocks[window.AppState.editingBlock];
        if(!block.tracks[sId]) window.timeMatrix.registerTrack(sId);
        
        // Preserve existing flags if overwriting
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
            btn.classList.add('border-green-500', 'text-green-500');
        } else {
            btn.innerHTML = "&#9658;"; // Play icon
            btn.classList.remove('border-green-500', 'text-green-500');
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
            m.classList.toggle('flex'); 
        }
    }

    toggleExportModal() {
        const m = document.getElementById('export-modal');
        if(m) { 
            m.classList.toggle('hidden'); 
            m.classList.toggle('flex'); 
        }
    }

    // --- 4. VISUAL RENDER LOOP ---

    renderLoop() {
        // Process queue from Audio Engine
        while(window.visualQueue && window.visualQueue.length > 0) {
            const now = window.audioEngine.ctx.currentTime;
            // Peek
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
        // Redraw TrackBar on Step 0 (sync visual)
        if(ev.step === 0) this.renderTrackBar();

        if(this.lastDrawnStep !== ev.step) {
            this.updatePlayClock(ev.step);
            
            // Follow Playback logic
            if(window.AppState.followPlayback && ev.block !== window.AppState.editingBlock) {
                window.AppState.editingBlock = ev.block;
                this.updateEditors();
                this.renderTrackBar();
            }

            // Highlight Matrix
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
        if(viewId === 'drum') return; // No params for drums in this UI
        
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
            if(p.waveform === 'square') wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">Π</span><span>SQR</span>';
            else wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">~</span><span>SAW</span>';
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

        // Update Modifiers Buttons State
        const slideBtn = document.getElementById('btn-toggle-slide');
        const accBtn = document.getElementById('btn-toggle-accent');
        if(slideBtn) slideBtn.classList.remove('text-green-400', 'border-green-600');
        if(accBtn) accBtn.classList.remove('text-green-400', 'border-green-600');

        if(window.AppState.activeView !== 'drum') {
            const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
            const noteData = blk.tracks[window.AppState.activeView] ? blk.tracks[window.AppState.activeView][window.AppState.selectedStep] : null;
            if(noteData) {
                if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600');
                if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600');
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
            
            el.className = `track-block ${isEditing ? 'track-block-editing' : ''} ${isPlaying ? 'track-block-playing' : ''}`;
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
        
        // Bass Tabs
        window.audioEngine.bassSynths.forEach(s => {
            const b = document.createElement('button');
            const active = window.AppState.activeView === s.id;
            b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${active ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
            b.innerText = s.id;
            b.onclick = () => this.setTab(s.id);
            c.appendChild(b);
        });

        // Drum Tab
        const d = document.createElement('button');
        const dActive = window.AppState.activeView === 'drum';
        d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${dActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
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
            b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
            b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
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
            r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs';
            r.innerHTML = `<span class="text-green-500">${s.id}</span><button class="text-red-500" onclick="window.removeBassSynth('${s.id}')">X</button>`;
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
        const p = document.getElementById('editor-panel');
        const btn = document.getElementById('btn-minimize-panel');
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
            if(active) {
                btn.classList.add('text-green-400', 'bg-green-900/20', 'border-green-500/50');
                btn.classList.remove('text-gray-600', 'bg-transparent', 'border-gray-800');
            } else {
                btn.classList.remove('text-green-400', 'bg-green-900/20', 'border-green-500/50');
                btn.classList.add('text-gray-600', 'bg-transparent', 'border-gray-800');
            }
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
            btn.classList.remove('border-gray-700', 'text-gray-400');
            btn.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20');
        } else {
            btn.innerText = "VISUALIZER: OFF";
            btn.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20');
            btn.classList.add('border-gray-700', 'text-gray-400');
        }
    }

    toggleUIMode() {
        window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
        const btn = document.getElementById('btn-toggle-ui-mode');
        const analogP = document.getElementById('fx-controls-analog');
        const digitalP = document.getElementById('fx-controls-digital');
        
        if(window.AppState.uiMode === 'digital') {
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
                // Get current value
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
                
                // Call handler to update Audio and UI
                if(target === 'resonance') this.handleDigitalChange('resonance', next);
                else if (target === 'cutoff') this.handleDigitalChange('cutoff', next); // Also use special handling for repeaters
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