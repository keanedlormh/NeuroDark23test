/*
 * AUDIO ENGINE MODULE (v30)
 * Handles AudioContext, Scheduling, Synthesis, and Rendering.
 * Decoupled from UI logic.
 */

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.compressor = null;
        this.clockWorker = null;
        this.bassSynths = [];
        
        // Scheduler State
        this.nextNoteTime = 0.0;
        this.lookahead = 0.1; // seconds
        this.scheduleAheadTime = 0.1; // seconds
        this.interval = 25.0; // ms (Worker tick)
    }

    // --- INITIALIZATION ---
    init() {
        if (this.ctx) return; // Already initialized

        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC({ latencyHint: 'interactive' });
            
            // Master Chain: MasterGain -> Compressor -> Destination
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.6; // Headroom

            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.value = -3;
            this.compressor.knee.value = 30;
            this.compressor.ratio.value = 12;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.25;

            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.ctx.destination);

            // Initialize Synths
            this.initSynths();

            // Initialize Clock Worker
            this.initWorker();
            
            window.logToScreen("Audio Engine Initialized");
        } catch (e) {
            console.error("Audio Init Failed:", e);
            window.logToScreen("Audio Init Failed: " + e, 'error');
        }
    }

    initSynths() {
        // Bass Synths
        // Ensure at least one synth exists
        if (this.bassSynths.length === 0) {
            this.addBassSynth('bass-1');
        } else {
            // Re-init existing if needed
            this.bassSynths.forEach(s => s.init(this.ctx, this.masterGain));
        }

        // Drum Synth
        if (window.drumSynth) {
            window.drumSynth.init(this.ctx, this.masterGain);
        }
    }

    initWorker() {
        if (this.clockWorker) return;
        try {
            // Adjust path if necessary based on your folder structure
            this.clockWorker = new Worker('Synth/clock_worker.js');
            this.clockWorker.onmessage = (e) => {
                if (e.data === "tick") {
                    this.scheduler();
                }
            };
            this.clockWorker.postMessage({ interval: this.interval });
        } catch (e) {
            console.warn("Worker Init Failed:", e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // --- SYNTH MANAGEMENT ---
    addBassSynth(id) {
        if (this.bassSynths.find(s => s.id === id)) return;
        
        const s = new window.BassSynth(id);
        if (this.ctx) s.init(this.ctx, this.masterGain);
        this.bassSynths.push(s);
        
        // Register in Matrix if not present
        if (window.timeMatrix && window.timeMatrix.registerTrack) {
            window.timeMatrix.registerTrack(id);
        }
        
        return s;
    }

    removeSynth(id) {
        if (this.bassSynths.length <= 1) {
            window.logToScreen("Cannot remove last synth", 'warn');
            return false;
        }
        const idx = this.bassSynths.findIndex(s => s.id === id);
        if (idx > -1) {
            this.bassSynths.splice(idx, 1);
            if (window.timeMatrix) window.timeMatrix.removeTrack(id);
            window.logToScreen(`Removed Synth: ${id}`);
            return true;
        }
        return false;
    }

    getSynth(id) {
        return this.bassSynths.find(s => s.id === id);
    }

    // --- TRANSPORT CONTROLS ---
    startPlayback() {
        this.resume();
        if (!this.ctx) this.init();

        window.AppState.isPlaying = true;
        window.AppState.currentPlayStep = 0;
        
        // Start from the currently edited block? Or always 0? 
        // Logic: Start from edited block to loop it, or sequence blocks logic.
        // For now, let's start at the beginning of the current block for immediacy.
        window.AppState.currentPlayBlock = window.AppState.editingBlock;

        this.nextNoteTime = this.ctx.currentTime + 0.1;
        window.visualQueue = []; // Clear queue

        if (this.clockWorker) this.clockWorker.postMessage("start");
        window.logToScreen("PLAY");
    }

    stopPlayback() {
        window.AppState.isPlaying = false;
        if (this.clockWorker) this.clockWorker.postMessage("stop");
        
        // Reset Visuals immediately via UI Controller (handled in UI loop)
        // But we can push a "stop" event or handle it in UIController directly.
        
        window.logToScreen("STOP");
    }

    toggleTransport() {
        if (window.AppState.isPlaying) {
            this.stopPlayback();
        } else {
            this.startPlayback();
        }
        return window.AppState.isPlaying;
    }

    // --- SCHEDULER (Core Logic) ---
    scheduler() {
        // While there are notes that will play within the lookahead window...
        while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
            this.scheduleNote(
                window.AppState.currentPlayStep, 
                window.AppState.currentPlayBlock, 
                this.nextNoteTime
            );
            this.advanceNote();
        }
    }

    scheduleNote(step, block, time) {
        // 1. Push to Visual Queue for the UI to render
        window.visualQueue.push({ step, block, time });

        // 2. Get Data
        const data = window.timeMatrix.getStepData(step, block);
        if (!data) return;

        // 3. Play Drums
        if (data.drums && window.drumSynth) {
            data.drums.forEach(id => window.drumSynth.play(id, time));
        }

        // 4. Play Bass Tracks
        if (data.tracks) {
            Object.keys(data.tracks).forEach(tid => {
                const noteInfo = data.tracks[tid][step];
                if (noteInfo) {
                    const synth = this.bassSynths.find(s => s.id === tid);
                    if (synth) {
                        synth.play(
                            noteInfo.note, 
                            noteInfo.octave, 
                            time, 
                            0.25, // default duration
                            noteInfo.slide, 
                            noteInfo.accent
                        );
                    }
                }
            });
        }
    }

    advanceNote() {
        const secPerBeat = 60.0 / window.AppState.bpm;
        const secPerStep = secPerBeat / 4; // 16th notes
        
        this.nextNoteTime += secPerStep;
        
        // Advance Step
        window.AppState.currentPlayStep++;
        
        // Loop Block / Song
        if (window.AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
            window.AppState.currentPlayStep = 0;
            window.AppState.currentPlayBlock++;
            
            // Loop blocks
            if (window.AppState.currentPlayBlock >= window.timeMatrix.blocks.length) {
                window.AppState.currentPlayBlock = 0;
            }
        }
    }

    // --- DIRECT PLAY (Preview) ---
    previewNote(synthId, note, octave) {
        this.resume();
        const s = this.getSynth(synthId);
        if (s) {
            s.play(note, octave, this.ctx.currentTime);
        }
    }

    previewDrum(drumId) {
        this.resume();
        if (window.drumSynth) {
            window.drumSynth.play(drumId, this.ctx.currentTime);
        }
    }

    // --- EXPORT RENDER ---
    async renderAudio() {
        if (window.AppState.isPlaying) this.stopPlayback();
        
        window.logToScreen("Starting Offline Render...");
        
        try {
            const stepsPerBlock = window.timeMatrix.totalSteps;
            const totalBlocks = window.timeMatrix.blocks.length;
            const reps = window.AppState.exportReps;
            const bpm = window.AppState.bpm;
            
            const secPerStep = (60.0 / bpm) / 4;
            const totalSteps = stepsPerBlock * totalBlocks * reps;
            const duration = totalSteps * secPerStep + 2.0; // +2s tail

            // Offline Context
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
            
            const offMaster = offCtx.createGain();
            offMaster.gain.value = 0.6;
            offMaster.connect(offCtx.destination);

            // Clone Synths for Offline
            const offBassSynths = [];
            this.bassSynths.forEach(liveSynth => {
                const s = new window.BassSynth(liveSynth.id);
                s.init(offCtx, offMaster);
                // Copy Params
                s.params = { ...liveSynth.params };
                // Also update the internal FX chain of the offline synth
                if(s.fxChain) {
                    s.setDistortion(s.params.distortion);
                    s.setDistTone(s.params.distTone);
                    s.setDistGain(s.params.distGain);
                }
                offBassSynths.push(s);
            });

            const offDrum = new window.DrumSynth();
            offDrum.init(offCtx, offMaster);

            // Render Loop
            let t = 0.0;
            for (let r = 0; r < reps; r++) {
                for (let b = 0; b < totalBlocks; b++) {
                    const blk = window.timeMatrix.blocks[b];
                    for (let s = 0; s < stepsPerBlock; s++) {
                        // Drums
                        if (blk.drums[s]) {
                            blk.drums[s].forEach(id => offDrum.play(id, t));
                        }
                        // Bass
                        if (blk.tracks) {
                            Object.keys(blk.tracks).forEach(tid => {
                                const n = blk.tracks[tid][s];
                                if (n) {
                                    const syn = offBassSynths.find(k => k.id === tid);
                                    if (syn) {
                                        syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                                    }
                                }
                            });
                        }
                        t += secPerStep;
                    }
                }
            }

            // Process
            const renderedBuffer = await offCtx.startRendering();
            const wavBlob = this.bufferToWave(renderedBuffer, renderedBuffer.length);
            
            // Download
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ND23_Render_${Date.now()}.wav`;
            a.click();
            
            window.logToScreen("Render Complete. Downloading...");
            return true;

        } catch (e) {
            window.logToScreen("Render Failed: " + e, 'error');
            console.error(e);
            return false;
        }
    }

    // Helper: WAV Encoder
    bufferToWave(abuffer, len) {
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
                // PCM 16bit conversion
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
                view.setInt16(pos, sample, true); pos += 2;
            }
            offset++;
        }
        return new Blob([buffer], {type: "audio/wav"});
    }
}

window.AudioEngine = AudioEngine;