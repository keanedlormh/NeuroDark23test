/**
 * TIME MATRIX MODULE (v35 - Visual Fixes)
 * Handles Grid Data and Rendering.
 * Fixed: Drum dots visibility and Tailwind removal.
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4;
        this.blocks = [];
        this.containerId = 'matrix-container';
        this.selectedStep = 0;
        this.clipboard = null;
        
        // Note Mapping
        this.noteMapRev = ['-', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        this.noteMap = {
            'C':1, 'C#':2, 'D':3, 'D#':4, 'E':5, 'F':6, 
            'F#':7, 'G':8, 'G#':9, 'A':10, 'A#':11, 'B':12
        };

        this.addBlock();
    }

    init() { 
        this.container = document.getElementById(this.containerId); 
        return !!this.container; 
    }
    
    registerTrack(id) { 
        this.blocks.forEach(b=>{ if(!b.tracks[id]) b.tracks[id] = new Array(this.totalSteps).fill(null); }); 
    }
    
    removeTrack(id) { 
        this.blocks.forEach(b=>delete b.tracks[id]); 
    }
    
    addBlock() {
        const newTracks = {};
        if (this.blocks.length > 0) Object.keys(this.blocks[0].tracks).forEach(k => newTracks[k] = new Array(this.totalSteps).fill(null));
        else newTracks['bass-1'] = new Array(this.totalSteps).fill(null);
        this.blocks.push({ tracks: newTracks, drums: new Array(this.totalSteps).fill().map(()=>[]) });
    }
    
    duplicateBlock(idx) {
        if(!this.blocks[idx]) return;
        const org = this.blocks[idx];
        const newTracks = {};
        Object.keys(org.tracks).forEach(k => {
            newTracks[k] = org.tracks[k].map(n => n ? {...n} : null);
        });
        this.blocks.splice(idx+1, 0, { tracks: newTracks, drums: org.drums.map(d=>[...d]) });
    }

    copyToClipboard(idx) {
        if (!this.blocks[idx]) return false;
        const org = this.blocks[idx];
        const newTracks = {};
        Object.keys(org.tracks).forEach(k => {
            newTracks[k] = org.tracks[k].map(n => n ? {...n} : null);
        });
        const newDrums = org.drums.map(d => [...d]);
        this.clipboard = { tracks: newTracks, drums: newDrums };
        return true;
    }

    pasteFromClipboard(idx) {
        if (!this.clipboard) return false;
        const source = this.clipboard;
        const newTracks = {};
        Object.keys(source.tracks).forEach(k => {
            newTracks[k] = source.tracks[k].map(n => n ? {...n} : null);
        });
        const newDrums = source.drums.map(d => [...d]);
        this.blocks.splice(idx + 1, 0, { tracks: newTracks, drums: newDrums });
        return true;
    }
    
    removeBlock(idx) { if(this.blocks.length<=1) this.clearBlock(0); else this.blocks.splice(idx,1); }
    
    moveBlock(idx, dir) {
        const t = idx + dir;
        if(t<0 || t>=this.blocks.length) return false;
        const tmp = this.blocks[t]; this.blocks[t] = this.blocks[idx]; this.blocks[idx] = tmp;
        return true;
    }
    
    clearBlock(idx) {
        const b = this.blocks[idx];
        if(!b) return;
        Object.keys(b.tracks).forEach(k=>b.tracks[k].fill(null));
        b.drums.forEach(d=>d.length=0);
    }
    
    getStepData(step, block) {
        const b = this.blocks[block];
        if(!b) return {};
        return { tracks: b.tracks, drums: b.drums[step]||[] };
    }

    // --- CSV EXPORT ---
    exportToCSV() {
        if(!window.audioEngine) return "";
        const bpm = window.AppState.bpm;
        const totalStepsGlobal = this.blocks.length * this.totalSteps;
        const synths = window.audioEngine.bassSynths;
        
        let csv = `${bpm}-${totalStepsGlobal}-${synths.length}`;
        for(let i=1; i<=totalStepsGlobal; i++) csv += `,${i}`;
        csv += "\n";

        synths.forEach(synth => {
            const p = synth.params;
            const waveInt = p.waveform === 'square' ? 1 : 0;
            const configStr = `${synth.id}:${p.volume}-${p.distortion}-${p.distTone}-${p.distGain}-${p.cutoff}-${p.resonance}-${p.envMod}-${p.decay}-${p.accentInt}-${waveInt}`;
            let row = configStr;

            this.blocks.forEach(block => {
                const track = block.tracks[synth.id];
                for(let s=0; s<this.totalSteps; s++) {
                    const n = track ? track[s] : null;
                    if(n) {
                        const nInt = this.noteMap[n.note] || 0;
                        const sld = n.slide ? 1 : 0;
                        const acc = n.accent ? 1 : 0;
                        row += `,${nInt}-${n.octave}-${sld}-${acc}`;
                    } else {
                        row += `,0`;
                    }
                }
            });
            csv += row + "\n";
        });

        let drumRow = `drums:7`;
        const drumOrder = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'htom'];
        
        this.blocks.forEach(block => {
            for(let s=0; s<this.totalSteps; s++) {
                const dStep = block.drums[s] || [];
                let binary = "";
                drumOrder.forEach(dId => {
                    binary += dStep.includes(dId) ? "1" : "0";
                });
                drumRow += `,${binary}`;
            }
        });
        csv += drumRow;
        return csv;
    }

    // --- CSV IMPORT ---
    importFromCSV(csvData) {
        if(!csvData || !window.audioEngine) return false;

        try {
            const lines = csvData.trim().split('\n');
            if(lines.length < 2) throw "Invalid Data";

            const headerCells = lines[0].split(',');
            const meta = headerCells[0].split('-'); 
            const bpm = parseInt(meta[0]);
            const totalStepsGlobal = parseInt(meta[1]);
            
            if(isNaN(bpm) || isNaN(totalStepsGlobal)) throw "Invalid Metadata";

            window.AppState.bpm = bpm;
            const bpmInput = document.getElementById('bpm-input');
            if(bpmInput) bpmInput.value = bpm;

            this.blocks = [];
            const blocksNeeded = Math.ceil(totalStepsGlobal / this.totalSteps);
            for(let i=0; i<blocksNeeded; i++) this.addBlock();

            for(let i=1; i<lines.length; i++) {
                const cells = lines[i].split(',');
                const configCell = cells[0]; 
                
                if(configCell.startsWith('drums')) {
                    const drumOrder = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'htom'];
                    for(let stepGlobal=0; stepGlobal < totalStepsGlobal; stepGlobal++) {
                        const binary = cells[stepGlobal + 1];
                        if(!binary) continue;
                        const blockIdx = Math.floor(stepGlobal / this.totalSteps);
                        const stepIdx = stepGlobal % this.totalSteps;
                        if(this.blocks[blockIdx]) {
                            const activeDrums = [];
                            for(let bit=0; bit<binary.length; bit++) {
                                if(binary[bit] === '1' && drumOrder[bit]) activeDrums.push(drumOrder[bit]);
                            }
                            this.blocks[blockIdx].drums[stepIdx] = activeDrums;
                        }
                    }
                } else if(configCell.includes(':')) {
                    const parts = configCell.split(':');
                    const id = parts[0];
                    const paramsStr = parts[1];
                    const pVals = paramsStr.split('-').map(Number);

                    let synth = window.audioEngine.getSynth(id);
                    if(!synth) synth = window.audioEngine.addBassSynth(id);

                    if(synth && pVals.length >= 10) {
                        synth.setVolume(pVals[0]); synth.setDistortion(pVals[1]);
                        synth.setDistTone(pVals[2]); synth.setDistGain(pVals[3]);
                        synth.setCutoff(pVals[4]); synth.setResonance(pVals[5]);
                        synth.setEnvMod(pVals[6]); synth.setDecay(pVals[7]);
                        synth.setAccentInt(pVals[8]);
                        synth.setWaveform(pVals[9] === 1 ? 'square' : 'sawtooth');
                    }
                    this.registerTrack(id);

                    for(let stepGlobal=0; stepGlobal < totalStepsGlobal; stepGlobal++) {
                        const noteData = cells[stepGlobal + 1];
                        if(!noteData || noteData === '0') continue;
                        const blockIdx = Math.floor(stepGlobal / this.totalSteps);
                        const stepIdx = stepGlobal % this.totalSteps;
                        const nParts = noteData.split('-');
                        if(nParts.length === 4) {
                            const noteInt = parseInt(nParts[0]);
                            const noteChar = this.noteMapRev[noteInt];
                            if(this.blocks[blockIdx] && noteChar) {
                                this.blocks[blockIdx].tracks[id][stepIdx] = {
                                    note: noteChar, octave: parseInt(nParts[1]),
                                    slide: nParts[2] === '1', accent: nParts[3] === '1'
                                };
                            }
                        }
                    }
                }
            }
            return true;
        } catch(e) {
            console.error("CSV Import Error:", e);
            return false;
        }
    }

    // --- RENDER ---
    render(activeView, blockIndex) {
        if (!this.init()) return;
        this.container.innerHTML = '';
        this.container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;
        
        const block = this.blocks[blockIndex];
        if (!block) return;

        for (let i = 0; i < this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            if (i === this.selectedStep) el.classList.add('step-selected');
            
            if (activeView === 'drum') this.drawDrums(el, block.drums[i], i);
            else {
                if(!block.tracks[activeView]) this.registerTrack(activeView);
                this.drawNote(el, block.tracks[activeView][i], i);
            }

            el.onclick = () => {
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };
            this.container.appendChild(el);
        }
    }

    drawNote(el, data, i) {
        if(data) {
            el.classList.add('has-bass');
            const noteStr = `${data.accent ? '^' : ''}${data.note}${data.slide ? '~' : ''}`;
            el.innerHTML = `<div class="matrix-cell-content"><span class="matrix-note-text">${noteStr}</span><span class="matrix-oct-text">${data.octave}</span></div>`;
        } else {
            el.classList.remove('has-bass');
            el.innerHTML = `<span class="matrix-step-num">${i+1}</span>`;
        }
    }

    // --- FIX: VISUALIZACIÓN DRUMS ---
    drawDrums(el, drums, i) {
        el.classList.remove('has-bass');
        if(drums && drums.length) {
            let html = '<div class="matrix-drum-container">';
            const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : [];
            drums.forEach(id => {
                const k = kits.find(x=>x.id===id);
                const c = k ? k.color : '#fff';
                // Genera DIVs con clase matrix-drum-dot
                html += `<div class="matrix-drum-dot" style="background-color:${c}; box-shadow: 0 0 4px ${c};"></div>`;
            });
            el.innerHTML = html + '</div>';
        } else {
            el.innerHTML = `<span class="matrix-step-num">${i+1}</span>`;
        }
    }

    highlightPlayingStep(index) {
        if (!this.init()) return;
        const old = this.container.querySelector('.step-playing');
        if (old) old.classList.remove('step-playing');
        if (index >= 0 && this.container.children[index]) {
            this.container.children[index].classList.add('step-playing');
        }
    }
}

window.timeMatrix = new TimeMatrix();