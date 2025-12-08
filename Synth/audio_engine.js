/*
 * AUDIO ENGINE MODULE (v38 - Robust Offline Export)
 * Handles AudioContext, Scheduling, Synthesis, and Rendering.
 * Updated: Fixed Offline Export download trigger and deep state cloning.
 */

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.compressor = null;
        this.clockWorker = null;
        this.bassSynths = [];
        this.nextNoteTime = 0.0;
        this.lookahead = 0.1;
        this.scheduleAheadTime = 0.1;
        this.interval = 25.0; 
    }

    init() {
        if (this.ctx) return; 
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC({ latencyHint: 'interactive' });
            
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.6;

            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.value = -3;
            this.compressor.knee.value = 30;
            this.compressor.ratio.value = 12;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.25;

            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.ctx.destination);

            this.initSynths();
            this.initWorker();
            
            if(window.logToScreen) window.logToScreen("Audio Engine Initialized");
        } catch (e) {
            console.error("Audio Init Failed:", e);
            if(window.logToScreen) window.logToScreen("Audio Init Failed: " + e, 'error');
        }
    }

    initSynths() {
        if (this.bassSynths.length === 0) this.addBassSynth('bass-1');
        else this.bassSynths.forEach(s => s.init(this.ctx, this.masterGain));
        
        if (window.drumSynth) window.drumSynth.init(this.ctx, this.masterGain);
    }

    initWorker() {
        if (this.clockWorker) return;
        try {
            this.clockWorker = new Worker('Synth/clock_worker.js');
            this.clockWorker.onmessage = (e) => {
                if (e.data === "tick") this.scheduler();
            };
            this.clockWorker.postMessage({ interval: this.interval });
        } catch (e) {
            console.warn("Worker Init Failed:", e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    addBassSynth(id) {
        if (this.bassSynths.find(s => s.id === id)) return;
        const s = new window.BassSynth(id);
        if (this.ctx) s.init(this.ctx, this.masterGain);
        this.bassSynths.push(s);
        if (window.timeMatrix && window.timeMatrix.registerTrack) window.timeMatrix.registerTrack(id);
        return s;
    }

    removeSynth(id) {
        const idx = this.bassSynths.findIndex(s => s.id === id);
        if (idx > -1) {
            this.bassSynths.splice(idx, 1);
            if (window.timeMatrix) window.timeMatrix.removeTrack(id);
            return true;
        }
        return false;
    }

    getSynth(id) {
        return this.bassSynths.find(s => s.id === id);
    }

    syncWithMatrix(matrix) {
        if (!matrix) return;
        const activeIds = new Set();
        matrix.blocks.forEach(b => {
            if(b.tracks) Object.keys(b.tracks).forEach(id => activeIds.add(id));
        });

        for (let i = this.bassSynths.length - 1; i >= 0; i--) {
            const synth = this.bassSynths[i];
            if (!activeIds.has(synth.id)) this.bassSynths.splice(i, 1);
        }

        activeIds.forEach(id => {
            if (!this.getSynth(id)) this.addBassSynth(id);
        });
    }

    // --- TRANSPORT ---
    startPlayback() {
        this.resume();
        if (!this.ctx) this.init();
        window.AppState.isPlaying = true;
        window.AppState.currentPlayStep = 0;
        window.AppState.currentPlayBlock = window.AppState.editingBlock;
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        window.visualQueue = [];
        if (this.clockWorker) this.clockWorker.postMessage("start");
        if(window.logToScreen) window.logToScreen("PLAY");
    }

    stopPlayback() {
        window.AppState.isPlaying = false;
        if (this.clockWorker) this.clockWorker.postMessage("stop");
        if(window.logToScreen) window.logToScreen("STOP");
    }

    toggleTransport() {
        if (window.AppState.isPlaying) this.stopPlayback();
        else this.startPlayback();
        return window.AppState.isPlaying;
    }

    // --- SCHEDULER ---
    scheduler() {
        while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
            this.scheduleNote(window.AppState.currentPlayStep, window.AppState.currentPlayBlock, this.nextNoteTime);
            this.advanceNote();
        }
    }

    scheduleNote(step, block, time) {
        window.visualQueue.push({ step, block, time });
        const data = window.timeMatrix.getStepData(step, block);
        if (!data) return;

        // Play Drums
        if (data.drums && window.drumSynth) {
            data.drums.forEach(id => window.drumSynth.play(id, time));
        }

        // Play Bass
        if (data.tracks) {
            Object.keys(data.tracks).forEach(tid => {
                const noteInfo = data.tracks[tid][step];
                if (noteInfo) {
                    const synth = this.bassSynths.find(s => s.id === tid);
                    if (synth) synth.play(noteInfo.note, noteInfo.octave, time, 0.25, noteInfo.slide, noteInfo.accent);
                }
            });
        }
    }

    advanceNote() {
        const secPerBeat = 60.0 / window.AppState.bpm;
        const secPerStep = secPerBeat / 4; 
        this.nextNoteTime += secPerStep;
        window.AppState.currentPlayStep++;
        
        if (window.AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
            window.AppState.currentPlayStep = 0;
            window.AppState.currentPlayBlock++;
            if (window.AppState.currentPlayBlock >= window.timeMatrix.blocks.length) {
                window.AppState.currentPlayBlock = 0;
            }
        }
    }

    previewNote(synthId, note, octave) {
        this.resume();
        const s = this.getSynth(synthId);
        if (s) s.play(note, octave, this.ctx.currentTime);
    }

    previewDrum(drumId) {
        this.resume();
        if (window.drumSynth) window.drumSynth.play(drumId, this.ctx.currentTime);
    }

    // --- OFFLINE RENDER (UPDATED) ---
    async renderAudio() {
        if (window.AppState.isPlaying) this.stopPlayback();
        if(window.logToScreen) window.logToScreen("Initializing Offline Render...");
        
        try {
            const stepsPerBlock = window.timeMatrix.totalSteps;
            const totalBlocks = window.timeMatrix.blocks.length;
            const reps = window.AppState.exportReps;
            const bpm = window.AppState.bpm;
            
            const secPerStep = (60.0 / bpm) / 4;
            const totalSteps = stepsPerBlock * totalBlocks * reps;
            const duration = totalSteps * secPerStep + 2.0; // +2s tail

            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            // 2 channels, length in samples, sample rate
            const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
            
            // Master Compressor for Offline
            const offCompressor = offCtx.createDynamicsCompressor();
            offCompressor.threshold.value = -3;
            offCompressor.ratio.value = 12;
            
            const offMaster = offCtx.createGain();
            offMaster.gain.value = 0.6;
            
            offMaster.connect(offCompressor);
            offCompressor.connect(offCtx.destination);

            // 1. CLONE BASS SYNTHS
            const offBassSynths = [];
            this.bassSynths.forEach(liveSynth => {
                const s = new window.BassSynth(liveSynth.id);
                s.init(offCtx, offMaster); // Connect to offline master
                s.params = { ...liveSynth.params };
                
                // Ensure FX params are applied to the new offline nodes
                if(s.fxChain) {
                    s.setDistortion(s.params.distortion);
                    s.setDistTone(s.params.distTone);
                    s.setDistGain(s.params.distGain);
                }
                offBassSynths.push(s);
            });

            // 2. CLONE DRUM SYNTH
            // Must create a new instance attached to offCtx
            const offDrum = new window.DrumSynth();
            offDrum.init(offCtx, offMaster);
            
            if (window.drumSynth) {
                offDrum.setMasterVolume(window.drumSynth.masterVolume);
                
                // Deep copy channel states (Volume & Variant)
                window.drumSynth.channels.forEach(ch => {
                    offDrum.setChannelVolume(ch.id, ch.volume);
                    offDrum.setChannelVariant(ch.id, ch.variant);
                });
            }

            // 3. SCHEDULE EVENTS (Offline Timeline)
            if(window.logToScreen) window.logToScreen("Scheduling Events...");
            
            let t = 0.0;
            for (let r = 0; r < reps; r++) {
                for (let b = 0; b < totalBlocks; b++) {
                    const blk = window.timeMatrix.blocks[b];
                    for (let s = 0; s < stepsPerBlock; s++) {
                        // Drums
                        if (blk.drums[s]) {
                            // Note: blk.drums contains Channel IDs (indices)
                            blk.drums[s].forEach(id => offDrum.play(id, t));
                        }
                        // Bass
                        if (blk.tracks) {
                            Object.keys(blk.tracks).forEach(tid => {
                                const n = blk.tracks[tid][s];
                                if (n) {
                                    const syn = offBassSynths.find(k => k.id === tid);
                                    if (syn) syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                                }
                            });
                        }
                        t += secPerStep;
                    }
                }
            }

            // 4. RENDER
            if(window.logToScreen) window.logToScreen("Rendering Audio Buffer...");
            const renderedBuffer = await offCtx.startRendering();
            
            if(window.logToScreen) window.logToScreen("Encoding WAV...");
            const wavBlob = this.bufferToWave(renderedBuffer, renderedBuffer.length);
            
            // 5. TRIGGER DOWNLOAD (Robust Method)
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `ND23_Render_${Date.now()}.wav`;
            
            // Critical: Append to body for browser compatibility
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);
            
            if(window.logToScreen) window.logToScreen("Download Started [OK]");
            return true;

        } catch (e) {
            console.error(e);
            if(window.logToScreen) window.logToScreen("Render Error: " + e.message, 'error');
            return false;
        }
    }

    bufferToWave(abuffer, len) {
        let numOfChan = abuffer.numberOfChannels,
            length = len * numOfChan * 2 + 44,
            buffer = new ArrayBuffer(length),
            view = new DataView(buffer),
            channels = [], i, sample,
            offset = 0, pos = 0;

        // Header Helper
        function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
        function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

        // RIFF Chunk
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"

        // fmt Chunk
        setUint32(0x20746d66); // "fmt "
        setUint32(16); // length = 16
        setUint16(1); // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16); // 16-bit

        // data Chunk
        setUint32(0x61746164); // "data"
        setUint32(length - pos - 4); // chunk length

        // Interleave channels
        for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

        while(pos < length) {
            for(i = 0; i < numOfChan; i++) {
                // Clamp and convert float to 16-bit PCM
                sample = Math.max(-1, Math.min(1, channels[i][offset])); 
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
                view.setInt16(pos, sample, true); 
                pos += 2;
            }
            offset++;
        }
        return new Blob([buffer], {type: "audio/wav"});
    }
}

window.AudioEngine = AudioEngine;