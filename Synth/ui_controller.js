/*
 * UI CONTROLLER MODULE (v38 - Swap Logic, Editable Inputs & Layout Fixes)
 * Handles DOM manipulation, Event Listeners, and Visual Feedback.
 * Implements Dynamic Drum Editor & Configuration Menu with Color Swap.
 */

class UIController {
    constructor() {
        this.drawFrameId = null;
        this.lastDrawnStep = -1;
        // Timer references for repeater buttons
        this.repeatTimer = null;
        this.repeatInterval = null;
        
        // Estado para intercambio de colores (Almacena el ID del canal de origen)
        this.colorSwapSource = null; 
        
        // Estado acordeón menú
        this.configMenuOpen = false;
    }

    init() {
        this.bindGlobalEvents();
        this.bindSynthControls();
        this.bindEditorControls();
        
        // Initial Renders
        this.renderInstrumentTabs();
        this.renderTrackBar();
        this.renderSubPanelStates(); // Fuerza el estado inicial Keys/FX
        this.updateEditors();
        this.initPlayClock();
        this.renderDrumConfigMenu();
        
        // Start Visual Loop
        this.renderLoop();
        
        if(window.logToScreen) window.logToScreen("UI Controller Initialized v38");
    }

    // --- 1. EVENTS ---
    bindGlobalEvents() {
        const unlock = () => {
            if (window.audioEngine) window.audioEngine.resume();
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);

        this.safeClick('btn-play', () => this.toggleTransport());
        this.safeClick('app-logo', () => this.toggleTransport());
        
        // Menu
        this.safeClick('btn-open-menu', () => { 
            this.colorSwapSource = null; // Resetear swap al abrir menú
            this.renderSynthMenu(); 
            this.renderDrumConfigMenu(); // Refrescar config al abrir
            this.toggleMenu(); 
        });
        this.safeClick('btn-close-menu', () => this.toggleMenu());
        this.safeClick('btn-toggle-ui-mode', () => this.toggleUIMode());
        this.safeClick('btn-toggle-visualizer', () => this.toggleVisualizerMode());
        
        // Modals
        this.safeClick('btn-open-export', () => { this.toggleMenu(); this.toggleExportModal(); });
        this.safeClick('btn-close-export', () => this.toggleExportModal());
        // Note: Memory modal is currently reused for CSV I/O in v37 logic, renaming IDs for clarity is recommended for future updates, but keeping original for compatibility.

        // CSV Actions
        this.safeClick('btn-gen-csv', () => {
            if(window.timeMatrix) {
                document.getElementById('csv-io-area').value = window.timeMatrix.exportToCSV();
                if(window.logToScreen) window.logToScreen("CSV Generated");
            }
        });

        this.safeClick('btn-load-csv', () => {
            const area = document.getElementById('csv-io-area');
            if(area && window.timeMatrix && window.timeMatrix.importFromCSV(area.value)) {
                if(window.audioEngine && typeof window.audioEngine.syncWithMatrix === 'function') {
                    window.audioEngine.syncWithMatrix(window.timeMatrix);
                }
                this.fullRefresh();
                if(window.logToScreen) window.logToScreen("CSV Loaded");
                // Note: No modal toggle here since the current logic keeps export modal open.
            } else {
                if(window.logToScreen) window.logToScreen("CSV Error", 'error');
            }
        });

        this.safeClick('btn-download-csv', () => {
            const content = document.getElementById('csv-io-area').value;
            if(!content) return;
            const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url; a.download = `ND23_Patch_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });

        const fInput = document.getElementById('file-upload-csv');
        if(fInput) {
            fInput.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = (ev) => {
                    document.getElementById('csv-io-area').value = ev.target.result;
                    document.getElementById('btn-load-csv').click();
                };
                r.readAsText(f);
                fInput.value = '';
            });
        }
        
        // Render Audio
        this.safeClick('btn-start-render', async () => { 
            if(window.audioEngine) {
                const btn = document.getElementById('btn-start-render');
                if(btn) { btn.innerText = "PROCESSING..."; btn.disabled = true; }
                await new Promise(r => setTimeout(r, 50));
                // Wait for the render to complete or fail
                const success = await window.audioEngine.renderAudio();
                
                if(btn) { 
                    btn.innerText = "RENDER WAV"; 
                    btn.disabled = false; 
                }
                if (!success) {
                    if(window.logToScreen) window.logToScreen("Render failed, check console for errors.", 'error');
                }
            } 
        });
        
        // Track Controls
        this.safeClick('btn-menu-panic', () => location.reload());
        this.safeClick('btn-menu-clear', () => { 
            // Use window.prompt replacement if real confirm is forbidden, but here, standard behavior:
            if(window.confirm("Clear Pattern?")) { window.timeMatrix.clearBlock(window.AppState.editingBlock); this.updateEditors(); this.toggleMenu(); }
        });
        this.safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); this.goToBlock(window.timeMatrix.blocks.length - 1); });
        this.safeClick('btn-del-block', () => { if(window.confirm("Delete Block?")) { window.timeMatrix.removeBlock(window.AppState.editingBlock); this.fullRefresh(); }});
        this.safeClick('btn-mem-copy', () => { 
            window.timeMatrix.copyToClipboard(window.AppState.editingBlock);
            if(window.logToScreen) window.logToScreen("Block copied.");
        });
        this.safeClick('btn-mem-paste', () => { 
            if(window.timeMatrix.pasteFromClipboard(window.AppState.editingBlock)) {
                this.fullRefresh();
                if(window.logToScreen) window.logToScreen("Block pasted.");
            }
        });
        this.safeClick('btn-move-left', () => { if(window.timeMatrix.moveBlock(window.AppState.editingBlock, -1)) this.goToBlock(window.AppState.editingBlock - 1); });
        this.safeClick('btn-move-right', () => { if(window.timeMatrix.moveBlock(window.AppState.editingBlock, 1)) this.goToBlock(window.AppState.editingBlock + 1); });

        const bpm = document.getElementById('bpm-input');
        if(bpm) bpm.onchange = (e) => window.AppState.bpm = parseInt(e.target.value) || 120; // Ensure it's a number
        if(bpm) bpm.oninput = (e) => { // Live clamp for better UX
            let v = parseInt(e.target.value);
            if(v < 60) e.target.value = 60;
            if(v > 300) e.target.value = 300;
        }

        // Export Reps
        document.querySelectorAll('.btn-option').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.btn-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.AppState.exportReps = parseInt(btn.dataset.rep);
            };
        });
        
        // Logs
        const logPanel = document.getElementById('sys-log-panel');
        this.safeClick('btn-toggle-log-internal', () => {
            if(logPanel) {
                logPanel.classList.toggle('visible');
                document.getElementById('btn-toggle-log-internal').innerText = logPanel.classList.contains('visible') ? "[ HIDE ]" : "[ SHOW ]";
            }
        });
        this.safeClick('btn-toggle-log-menu', () => { 
            if(!logPanel.classList.contains('visible')) document.getElementById('btn-toggle-log-internal').click();
            this.toggleMenu(); 
        });
        this.safeClick('btn-term-clear', () => {
            const logBody = document.getElementById('log-body');
            if(logBody) logBody.innerHTML = '';
        });
        
        // Add Synth
        this.safeClick('btn-add-synth', () => {
            if(window.audioEngine) {
                const s = window.audioEngine.addBassSynth(`bass-${window.audioEngine.bassSynths.length + 1}`);
                if(s) { this.renderSynthMenu(); this.renderInstrumentTabs(); this.setTab(s.id); }
            }
        });
    }

    bindSynthControls() {
        const bindSlider = (id, param) => {
            const el = document.getElementById(id);
            if(el) el.oninput = (e) => this.handleParamChange(param, parseInt(e.target.value));
        };
        ['vol','dist','cutoff','res','env','dec','acc','tone','dgain'].forEach(p => {
            bindSlider(`${p}-slider`, p === 'vol' ? 'volume' : p === 'dist' ? 'distortion' : p === 'res' ? 'resonance' : p === 'env' ? 'envMod' : p === 'dec' ? 'decay' : p === 'acc' ? 'accentInt' : p === 'tone' ? 'distTone' : p === 'dgain' ? 'distGain' : p);
        });

        this.setupDigitalRepeaters();
        this.safeClick('btn-waveform', () => this.toggleWaveform());
    }

    bindEditorControls() {
        this.safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); this.togglePanelState(); });
        this.safeClick('panel-header-trigger', () => this.togglePanelState());
        
        // Botones Keys/FX (ya agrupados en HTML v38)
        this.safeClick('btn-toggle-view-keys', (e) => { e.stopPropagation(); this.toggleSubPanel('keys'); });
        this.safeClick('btn-toggle-view-fx', (e) => { e.stopPropagation(); this.toggleSubPanel('fx'); });

        const octD = document.getElementById('oct-display');
        this.safeClick('oct-up', () => { if(window.AppState.currentOctave < 6) { window.AppState.currentOctave++; octD.innerText = window.AppState.currentOctave; }});
        this.safeClick('oct-down', () => { if(window.AppState.currentOctave > 1) { window.AppState.currentOctave--; octD.innerText = window.AppState.currentOctave; }});

        this.safeClick('btn-toggle-slide', () => this.toggleNoteMod('slide'));
        this.safeClick('btn-toggle-accent', () => this.toggleNoteMod('accent'));
        this.safeClick('btn-delete-note', () => {
            if(window.AppState.activeView !== 'drum') {
                const b = window.timeMatrix.blocks[window.AppState.editingBlock];
                b.tracks[window.AppState.activeView][window.AppState.selectedStep] = null;
                this.updateEditors();
            }
        });

        document.querySelectorAll('.key-w, .key-b').forEach(k => {
            k.onclick = () => this.placeNote(k.dataset.note);
        });

        window.addEventListener('stepSelect', (e) => { 
            window.AppState.selectedStep = e.detail.index; 
            this.updateEditors(); 
        });
    }

    // --- LOGIC ---
    
    setTab(v) {
        window.AppState.activeView = v;
        this.renderInstrumentTabs();
        this.updateEditors();
        this.syncControls(v);
    }

    handleParamChange(param, value) {
        if(!window.audioEngine) return;
        const synth = window.audioEngine.getSynth(window.AppState.activeView);
        if(!synth) return;

        let finalValue = value;
        // The cutoff slider range is 100 to 5000 Hz, but parameters are stored 0-100%
        if (param === 'cutoff') {
            // Converts Hz (100-5000) back to 0-100 range for consistency
            finalValue = Math.max(0, Math.min(100, (value - 100) / 49));
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

    placeNote(note) {
        if(window.AppState.activeView === 'drum') return;
        const sId = window.AppState.activeView;
        if(window.audioEngine) window.audioEngine.previewNote(sId, note, window.AppState.currentOctave);

        const block = window.timeMatrix.blocks[window.AppState.editingBlock];
        if(!block.tracks[sId]) window.timeMatrix.registerTrack(sId);
        
        const prev = block.tracks[sId][window.AppState.selectedStep];
        block.tracks[sId][window.AppState.selectedStep] = { 
            note: note, octave: window.AppState.currentOctave, 
            slide: prev ? prev.slide : false, accent: prev ? prev.accent : false 
        };
        this.updateEditors();
    }

    toggleNoteMod(prop) {
        if(window.AppState.activeView === 'drum') return;
        const note = window.timeMatrix.blocks[window.AppState.editingBlock].tracks[window.AppState.activeView][window.AppState.selectedStep];
        if(note) { note[prop] = !note[prop]; this.updateEditors(); }
    }

    toggleWaveform() {
        const s = window.audioEngine.getSynth(window.AppState.activeView);
        if(s) { s.setWaveform(s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth'); this.syncControls(s.id); }
    }

    toggleTransport() {
        const playing = window.audioEngine.toggleTransport();
        const btn = document.getElementById('btn-play');
        if(playing) { btn.innerHTML = "&#10074;&#10074;"; btn.classList.add('playing'); }
        else { btn.innerHTML = "&#9658;"; btn.classList.remove('playing'); window.timeMatrix.highlightPlayingStep(-1); this.renderTrackBar(); }
    }

    toggleMenu() { document.getElementById('main-menu').classList.toggle('hidden'); }
    toggleExportModal() { document.getElementById('export-modal').classList.toggle('hidden'); }
    // toggleMemoryModal() { document.getElementById('memory-modal').classList.toggle('hidden'); } // Not used anymore

    // --- RENDERERS ---
    renderLoop() {
        while(window.visualQueue && window.visualQueue.length > 0) {
            const now = window.audioEngine.ctx.currentTime;
            if(window.visualQueue[0].time <= now) {
                const ev = window.visualQueue.shift();
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
                    } else window.timeMatrix.highlightPlayingStep(-1);
                    this.lastDrawnStep = ev.step;
                }
            } else break;
        }
        requestAnimationFrame(() => this.renderLoop());
    }

    syncControls(viewId) {
        if(viewId === 'drum') return; 
        const s = window.audioEngine.getSynth(viewId);
        if(!s) return;
        const p = s.params;
        
        // Convert cutoff back to Hz for the slider display
        const cutoffHz = Math.round(((p.cutoff / 100) * 4900) + 100);

        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = Math.round(val); };
        
        // Analog Sliders
        setVal('vol-slider', p.volume); setVal('dist-slider', p.distortion);
        setVal('res-slider', p.resonance); setVal('env-slider', p.envMod);
        setVal('dec-slider', p.decay); setVal('acc-slider', p.accentInt);
        setVal('tone-slider', p.distTone); setVal('dgain-slider', p.distGain);
        setVal('cutoff-slider', cutoffHz);

        // Digital Displays
        document.getElementById('vol-digital').innerText = p.volume;
        document.getElementById('dist-digital').innerText = p.distortion;
        document.getElementById('cutoff-digital').innerText = cutoffHz; // Display Hz
        document.getElementById('res-digital').innerText = Math.round(p.resonance * 5); // Display 0-100 range
        document.getElementById('env-digital').innerText = p.envMod;
        document.getElementById('dec-digital').innerText = p.decay;
        document.getElementById('acc-digital').innerText = p.accentInt;
        document.getElementById('tone-digital').innerText = p.distTone;
        document.getElementById('dgain-digital').innerText = p.distGain;

        const wvBtn = document.getElementById('btn-waveform');
        if(wvBtn) wvBtn.innerHTML = p.waveform === 'square' ? '<span class="wave-symbol">Π</span> SQR' : '<span class="wave-symbol">~</span> SAW';
    }

    updateEditors() {
        const bEd = document.getElementById('editor-bass');
        const dEd = document.getElementById('editor-drum');
        document.getElementById('step-info-display').innerText = `STEP ${window.AppState.selectedStep+1} // ${window.AppState.activeView.toUpperCase()}`;
        
        const viewToggles = document.getElementById('view-toggles-container');

        if(window.AppState.activeView === 'drum') {
            bEd.classList.add('hidden'); 
            dEd.classList.remove('hidden');
            
            // Ocultar la base de bajos (teclas/fx)
            document.getElementById('subpanel-keys').classList.add('hidden');
            document.getElementById('subpanel-fx').classList.add('hidden');
            if(viewToggles) viewToggles.style.display = 'none'; // Ocultar botones toggle
            
            this.renderDrumRows();
        } else {
            bEd.classList.remove('hidden'); 
            dEd.classList.add('hidden');
            
            // Mostrar la base de bajos y restaurar estado de subpaneles
            if(viewToggles) viewToggles.style.display = 'flex';
            this.renderSubPanelStates(); 
        }

        // Estado de los botones Slide/Accent
        const slideBtn = document.getElementById('btn-toggle-slide');
        const accBtn = document.getElementById('btn-toggle-accent');
        if(slideBtn) slideBtn.classList.remove('active');
        if(accBtn) accBtn.classList.remove('active');

        if(window.AppState.activeView !== 'drum') {
            const block = window.timeMatrix.blocks[window.AppState.editingBlock];
            // Verificar si el track existe antes de acceder a la nota
            if(block.tracks[window.AppState.activeView]) {
                const note = block.tracks[window.AppState.activeView][window.AppState.selectedStep];
                if(note) {
                    if(note.slide && slideBtn) slideBtn.classList.add('active');
                    if(note.accent && accBtn) accBtn.classList.add('active');
                }
            }
        }
        window.timeMatrix.selectedStep = window.AppState.selectedStep;
        window.timeMatrix.render(window.AppState.activeView, window.AppState.editingBlock);
    }

    renderTrackBar() {
        const c = document.getElementById('track-bar');
        if(!c) return;
        c.innerHTML = '';
        document.getElementById('display-total-blocks').innerText = window.timeMatrix.blocks.length;
        document.getElementById('display-current-block').innerText = window.AppState.editingBlock + 1;

        window.timeMatrix.blocks.forEach((_, i) => {
            const el = document.createElement('div');
            let classes = 'chain-block';
            if(i === window.AppState.editingBlock) classes += ' editing';
            if(window.AppState.isPlaying && i === window.AppState.currentPlayBlock) classes += ' playing';
            el.className = classes;
            el.innerText = i + 1;
            el.onclick = () => this.goToBlock(i);
            c.appendChild(el);
        });
    }

    renderInstrumentTabs() {
        const c = document.getElementById('instrument-tabs-container');
        if(!c) return;
        c.innerHTML = '';
        window.audioEngine.bassSynths.forEach(s => {
            const b = document.createElement('button');
            b.className = `tab-pill ${window.AppState.activeView === s.id ? 'active' : ''}`;
            b.innerText = s.id.toUpperCase();
            b.onclick = () => this.setTab(s.id);
            c.appendChild(b);
        });
        const d = document.createElement('button');
        d.className = `tab-pill ${window.AppState.activeView === 'drum' ? 'active' : ''}`;
        d.innerText = "DRUMS";
        d.onclick = () => this.setTab('drum');
        c.appendChild(d);
    }

    renderSynthMenu() {
        const c = document.getElementById('synth-list-container');
        if(!c) return;
        c.innerHTML = '';
        window.audioEngine.bassSynths.forEach(s => {
            const r = document.createElement('div');
            r.className = 'menu-item-row';
            r.innerHTML = `<span class="text-green">${s.id.toUpperCase()}</span><button class="btn-icon-del" onclick="window.removeBassSynth('${s.id}')">X</button>`;
            c.appendChild(r);
        });
    }

    // --- DRUM EDITOR (2-COLUMN & INPUTS) ---

    renderDrumRows() {
        const c = document.getElementById('editor-drum');
        if(!c || !window.drumSynth) return;
        c.innerHTML = '';
        
        // 1. Master Volume (Span 2)
        const masterRow = document.createElement('div');
        masterRow.className = 'drum-master-panel';
        masterRow.innerHTML = `
            <span class="drum-master-label">MASTER VOL</span>
            <div class="drum-vol-ctrl">
                <button class="drum-vol-btn drum-rep-btn" data-target="master" data-dir="-1">-</button>
                <input type="number" class="drum-vol-input" id="drum-master-vol-in" value="${window.drumSynth.masterVolume}" min="0" max="100">
                <button class="drum-vol-btn drum-rep-btn" data-target="master" data-dir="1">+</button>
            </div>
        `;
        c.appendChild(masterRow);

        // Bind Master Input
        const mIn = masterRow.querySelector('#drum-master-vol-in');
        mIn.onchange = (e) => {
            const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
            window.drumSynth.setMasterVolume(v);
            mIn.value = v; 
        };
        mIn.onclick = (e) => e.stopPropagation();

        // 2. Channels (Grid Flow)
        const cur = window.timeMatrix.blocks[window.AppState.editingBlock].drums[window.AppState.selectedStep];
        
        window.drumSynth.channels.forEach(ch => {
            if(ch.variant === 0) return;

            const act = cur.includes(ch.id);
            // Si colorId no está definido, se usa el ID de canal por defecto para el color.
            const colIndex = (ch.colorId !== undefined) ? ch.colorId : ch.id;
            const color = window.drumSynth.channelColors[colIndex % window.drumSynth.channelColors.length];

            const row = document.createElement('div');
            row.className = `drum-row ${act ? 'active' : ''}`;
            
            // Info (Click to toggle step)
            const infoDiv = document.createElement('div');
            infoDiv.className = 'drum-info';
            infoDiv.innerHTML = `<div class="drum-color-tag" style="background:${color};box-shadow:0 0 5px ${color}"></div><span class="drum-label">${ch.name}</span>`;
            infoDiv.onclick = () => {
                if(window.audioEngine) window.audioEngine.resume();
                if(act) cur.splice(cur.indexOf(ch.id), 1);
                else { cur.push(ch.id); window.audioEngine.previewDrum(ch.id); }
                this.updateEditors();
            };

            // Volume (Input + Buttons)
            const volDiv = document.createElement('div');
            volDiv.className = 'drum-vol-ctrl';
            volDiv.innerHTML = `
                <button class="drum-vol-btn drum-rep-btn" data-target="${ch.id}" data-dir="-1">-</button>
                <input type="number" class="drum-vol-input" id="drum-vol-${ch.id}-in" value="${ch.volume}" min="0" max="100">
                <button class="drum-vol-btn drum-rep-btn" data-target="${ch.id}" data-dir="1">+</button>
            `;

            // Bind Channel Input
            const cIn = volDiv.querySelector('input');
            cIn.onclick = (e) => e.stopPropagation(); 
            cIn.onchange = (e) => {
                const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                window.drumSynth.setChannelVolume(ch.id, v);
                cIn.value = v;
            };

            row.appendChild(infoDiv);
            row.appendChild(volDiv);
            c.appendChild(row);
        });

        this.setupDrumRepeaters();
    }

    setupDrumRepeaters() {
        // Maneja botones de volumen en Drum Editor
        document.querySelectorAll('.drum-rep-btn').forEach(btn => {
            const target = btn.dataset.target; 
            const dir = parseInt(btn.dataset.dir);
            
            const change = () => {
                if(!window.drumSynth) return;
                
                if(target === 'master') {
                    const next = Math.max(0, Math.min(100, window.drumSynth.masterVolume + dir));
                    window.drumSynth.setMasterVolume(next);
                    const el = document.getElementById('drum-master-vol-in');
                    if(el) el.value = next;
                } else {
                    const id = parseInt(target);
                    const ch = window.drumSynth.channels[id];
                    if(ch) {
                        const next = Math.max(0, Math.min(100, ch.volume + dir));
                        window.drumSynth.setChannelVolume(id, next);
                        const el = document.getElementById(`drum-vol-${id}-in`); // Usar el ID de input
                        if(el) el.value = next;
                    }
                }
            };

            this.bindRepeater(btn, change);
        });
    }

    // --- DRUM CONFIG & COLOR SWAP ---

    renderDrumConfigMenu() {
        const c = document.getElementById('drum-config-container');
        if(!c || !window.drumSynth) return;
        
        // Renderiza el Accordion Wrapper
        c.innerHTML = `
            <div class="accordion-header" id="btn-toggle-drum-conf">
                <span class="section-label">DRUM MAPPING & COLOR (SWAP)</span>
                <span id="icon-drum-conf">${this.configMenuOpen ? '&#9660;' : '&#9658;'}</span>
            </div>
            <div class="accordion-content ${this.configMenuOpen ? '' : 'collapsed'}" id="drum-conf-body">
                <div class="drum-config-grid" id="drum-conf-list"></div>
            </div>
        `;

        // Bind Accordion Toggle
        const toggleBtn = c.querySelector('#btn-toggle-drum-conf');
        if(toggleBtn) {
            toggleBtn.onclick = () => {
                this.configMenuOpen = !this.configMenuOpen;
                this.renderDrumConfigMenu(); // Vuelve a renderizar para aplicar el colapsado
            };
        }

        const list = c.querySelector('#drum-conf-list');
        if (!list || !this.configMenuOpen) return; // Solo renderiza la lista si está abierto

        // Renderiza la lista de canales
        window.drumSynth.channels.forEach(ch => {
            const row = document.createElement('div');
            row.className = 'config-row';
            
            // Si colorId no está definido, se usa el ID de canal por defecto para el color.
            const colIndex = (ch.colorId !== undefined) ? ch.colorId : ch.id;
            const color = window.drumSynth.channelColors[colIndex % window.drumSynth.channelColors.length];
            
            // Verifica si este canal es el origen del swap
            const isSwapSource = (this.colorSwapSource === ch.id);

            row.innerHTML = `
                <div class="config-label text-dim">${ch.id + 1}</div>
                <div class="config-controls">
                    <select class="variant-select" id="conf-var-${ch.id}">
                        <option value="0" ${ch.variant===0?'selected':''}>OFF</option>
                        <option value="1" ${ch.variant===1?'selected':''}>${ch.name} 1</option>
                        <option value="2" ${ch.variant===2?'selected':''}>${ch.name} 2</option>
                        <option value="3" ${ch.variant===3?'selected':''}>${ch.name} 3</option>
                        <option value="4" ${ch.variant===4?'selected':''}>${ch.name} 4</option>
                    </select>
                    <div class="color-select ${isSwapSource ? 'swapping' : ''}" 
                         id="conf-col-${ch.id}" 
                         style="background:${color}"
                         title="Click to Swap Colors">
                    </div>
                </div>
            `;
            list.appendChild(row);

            // Bind Variant
            row.querySelector(`#conf-var-${ch.id}`).onchange = (e) => {
                window.drumSynth.setChannelVariant(ch.id, parseInt(e.target.value));
                if(window.AppState.activeView === 'drum') this.updateEditors();
            };

            // Bind Color Swap
            row.querySelector(`#conf-col-${ch.id}`).onclick = () => {
                this.handleColorSwap(ch.id);
            };
        });
    }

    handleColorSwap(clickedId) {
        // 1. No hay origen seleccionado: seleccionamos este como origen
        if (this.colorSwapSource === null) {
            this.colorSwapSource = clickedId;
            this.renderDrumConfigMenu(); 
            if(window.logToScreen) window.logToScreen(`Color Swap: Selected CH ${clickedId + 1}. Click target channel.`);
        } 
        // 2. Hay origen seleccionado: realizar el intercambio
        else {
            // Cancelar si se pulsa el mismo botón
            if (this.colorSwapSource === clickedId) {
                this.colorSwapSource = null;
                this.renderDrumConfigMenu();
                if(window.logToScreen) window.logToScreen("Color Swap: Canceled.");
                return;
            }

            // Conseguir los objetos de canal
            const srcCh = window.drumSynth.channels[this.colorSwapSource];
            const dstCh = window.drumSynth.channels[clickedId];

            // Realizar el intercambio de los colorId
            const tempColorId = dstCh.colorId;
            dstCh.colorId = srcCh.colorId;
            srcCh.colorId = tempColorId;

            // Resetear y actualizar
            this.colorSwapSource = null;
            this.renderDrumConfigMenu();
            if(window.AppState.activeView === 'drum') this.updateEditors(); 
            if(window.logToScreen) window.logToScreen(`Color Swap: Swapped colors between CH ${srcCh.id + 1} and CH ${dstCh.id + 1}.`);
        }
    }

    // --- Auxiliares ---
    setupDigitalRepeaters() {
        // Handles Bass Synth Digital Controls
        document.querySelectorAll('.dfx-btn').forEach(btn => {
            const changeVal = () => {
                const s = window.audioEngine.getSynth(window.AppState.activeView);
                if(!s) return;
                const p = btn.dataset.target, d = parseInt(btn.dataset.dir);
                let cur = 0;
                
                // Read value from digital display for precision (already scaled)
                const displayId = p.replace('volume', 'vol').replace('envMod', 'env').replace('decay', 'dec').replace('accentInt', 'acc').replace('distortion', 'dist').replace('distTone', 'tone').replace('distGain', 'dgain') + '-digital';
                const displayEl = document.getElementById(displayId);
                if (!displayEl) return;

                // For Cutoff and Resonance, the display holds the scaled value (Hz or 0-100), not the stored % param
                if (p === 'cutoff') {
                    cur = parseInt(displayEl.innerText); // Current Hz (100-5000)
                    let nextHz = Math.max(100, Math.min(5000, cur + d * 50)); // Step by 50Hz
                    this.handleParamChange(p, nextHz);
                } else if (p === 'resonance') {
                    cur = parseInt(displayEl.innerText); // Current 0-100 (Resonance * 5)
                    let nextScaled = Math.max(0, Math.min(100, cur + d));
                    this.handleParamChange(p, nextScaled / 5); // Scale back to 0-20
                } else {
                    cur = s.params[p]; // Stored 0-100 param
                    let next = Math.max(0, Math.min(100, cur + d));
                    this.handleParamChange(p, next);
                }
            };
            this.bindRepeater(btn, changeVal);
        });
    }

    bindRepeater(btn, action) {
        const stop = () => { clearTimeout(this.repeatTimer); clearInterval(this.repeatInterval); };
        const start = (e) => { 
            if(e) e.preventDefault();
            action(); 
            this.repeatTimer = setTimeout(() => this.repeatInterval = setInterval(action, 80), 400); 
        };
        btn.onmousedown = start;
        btn.onmouseup = stop;
        btn.onmouseleave = stop;
        btn.ontouchstart = (e) => { e.preventDefault(); start(e); };
        btn.ontouchend = stop;
    }

    goToBlock(i) { window.AppState.editingBlock = i; this.updateEditors(); this.renderTrackBar(); }
    fullRefresh() { window.AppState.editingBlock = 0; this.updateEditors(); this.renderTrackBar(); this.renderInstrumentTabs(); this.renderSynthMenu(); }
    
    togglePanelState() {
        window.AppState.panelCollapsed = !window.AppState.panelCollapsed;
        const p = document.getElementById('editor-panel');
        const b = document.getElementById('btn-minimize-panel');
        if(window.AppState.panelCollapsed) { p.classList.replace('expanded','collapsed'); b.innerHTML = "&#9650;"; }
        else { p.classList.replace('collapsed','expanded'); b.innerHTML = "&#9660;"; }
    }
    
    toggleSubPanel(p) {
        if(p==='keys') window.AppState.viewKeys = !window.AppState.viewKeys;
        if(p==='fx') window.AppState.viewFx = !window.AppState.viewFx;
        this.renderSubPanelStates();
    }
    
    renderSubPanelStates() {
        const pK = document.getElementById('subpanel-keys'), pF = document.getElementById('subpanel-fx');
        const bK = document.getElementById('btn-toggle-view-keys'), bF = document.getElementById('btn-toggle-view-fx');
        
        // Solo aplica si no estamos en vista 'drum'
        if(window.AppState.activeView !== 'drum') {
            if(window.AppState.viewKeys) { pK.classList.remove('hidden'); bK.classList.add('active'); } else { pK.classList.add('hidden'); bK.classList.remove('active'); }
            if(window.AppState.viewFx) { pF.classList.remove('hidden'); bF.classList.add('active'); } else { pF.classList.add('hidden'); bF.classList.remove('active'); }
        }
    }
    
    toggleVisualizerMode() { 
        window.AppState.followPlayback = !window.AppState.followPlayback; 
        document.getElementById('btn-toggle-visualizer').innerText = window.AppState.followPlayback ? "VISUALIZER: ON" : "VISUALIZER: OFF"; 
    }
    
    toggleUIMode() { 
        window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
        document.getElementById('btn-toggle-ui-mode').innerText = `UI MODE: ${window.AppState.uiMode.toUpperCase()}`;
        document.getElementById('fx-controls-analog').classList.toggle('hidden');
        document.getElementById('fx-controls-digital').classList.toggle('hidden');
        this.syncControls(window.AppState.activeView);
    }
    
    initPlayClock() { /* SVG Clock Init */ const s=document.getElementById('play-clock-svg'); if(!s)return; s.innerHTML=''; const t=16, r=45, c=50, ci=2*Math.PI*r, g=2, d=(ci/t)-g; for(let i=0;i<t;i++){const e=document.createElementNS("http://www.w3.org/2000/svg","circle");e.setAttribute("r",r);e.setAttribute("cx",c);e.setAttribute("cy",c);e.setAttribute("fill","transparent");e.setAttribute("stroke-width","4");e.setAttribute("stroke-dasharray",`${d} ${ci-d}`);e.setAttribute("transform",`rotate(${(360/t)*i},${c},${c})`);e.setAttribute("id",`clock-seg-${i}`);e.setAttribute("stroke","#333");s.appendChild(e);} }
    updatePlayClock(step) { for(let i=0;i<16;i++){ const s=document.getElementById(`clock-seg-${i}`); if(s){ if(i===step){s.setAttribute("stroke","#00ff41");s.setAttribute("opacity","1");} else if(i<step){s.setAttribute("stroke","#004411");s.setAttribute("opacity","0.5");} else {s.setAttribute("stroke","#222");s.setAttribute("opacity","0.3");} } } }
    blinkLed() { const l=document.getElementById('activity-led'); if(l){ l.style.backgroundColor='#fff'; l.style.boxShadow='0 0 8px #fff'; setTimeout(()=>{l.style.backgroundColor='';l.style.boxShadow='';},50); } }
    safeClick(id, fn) { const el = document.getElementById(id); if(el) el.onclick = fn; }
}
window.UIController = UIController;