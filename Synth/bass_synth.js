/*
 * BASS SYNTH MODULE (Voice Controller)
 * Orchestrates Oscillator, Filter (via FX), and VCA.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null; 
        this.fxChain = null; 
        this.lastFreq = 0;
        
        // Default Params (Expanded)
        this.params = {
            volume: 85,       // Main Output Volume
            distortion: 20,   // Drive amount
            distTone: 100,    // Distortion Tone (LPF)
            distGain: 60,     // Distortion Output Gain
            cutoff: 40, 
            resonance: 8, 
            envMod: 60,
            decay: 40,
            accentInt: 50,    // Accent Intensity (How much accent affects filter)
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        try {
            if (typeof window.BassDistortion !== 'undefined') {
                this.fxChain = new window.BassDistortion(this.ctx);
                
                // Initialize FX Params
                this.fxChain.setDistortion(this.params.distortion);
                this.fxChain.setTone(this.params.distTone);
                this.fxChain.setPostGain(this.params.distGain);
                
                this.fxChain.connect(destinationNode);
                this.output = this.fxChain.input; 
            } else {
                console.warn("BassDistortion class missing, running clean.");
                this.output = this.ctx.createGain();
                this.output.connect(destinationNode);
            }
        } catch (e) {
            console.error("Error initializing FX Chain:", e);
            this.output = this.ctx.createGain();
            this.output.connect(destinationNode);
        }
    }

    // --- Params Setters ---
    setVolume(val) { this.params.volume = val; }
    
    setDistortion(val) { 
        this.params.distortion = val; 
        if(this.fxChain) this.fxChain.setDistortion(val); 
    }
    
    setDistTone(val) {
        this.params.distTone = val;
        if(this.fxChain && this.fxChain.setTone) this.fxChain.setTone(val);
    }
    
    setDistGain(val) {
        this.params.distGain = val;
        if(this.fxChain && this.fxChain.setPostGain) this.fxChain.setPostGain(val);
    }

    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setAccentInt(val) { this.params.accentInt = val; }
    setWaveform(val) { this.params.waveform = val; }

    // --- Play Note ---
    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx || !this.output) return;

        // 1. Frecuencia MIDI
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // 2. Nodos
        const osc = this.ctx.createOscillator();
        const vca = this.ctx.createGain(); 
        
        // 3. Oscilador
        osc.type = this.params.waveform;
        osc.detune.value = (Math.random() * 4) - 2; 

        // 4. Portamento (Glide)
        if (!this.lastFreq) this.lastFreq = freq;
        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.08);
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // 5. Filtro
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            // Pasamos accentInt a la creación del filtro
            const fResult = window.BassFilter.create(
                this.ctx, 
                time, 
                this.params, 
                duration, 
                slide, 
                accent, 
                this.params.accentInt
            );
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            filterNode = this.ctx.createBiquadFilter();
            filterNode.frequency.value = 1000; 
        }

        // 6. Envolvente de Volumen (VCA)
        // Calculamos volumen base según el parámetro global
        const volFactor = this.params.volume / 100;
        
        // Si hay acento, damos un boost extra de volumen (clásico 303), 
        // pero respetando el techo del volumen global.
        let peakVol = 0.6 * volFactor; 
        if (accent) peakVol = 0.85 * volFactor; 
        
        vca.gain.setValueAtTime(0, time);
        
        if (slide) {
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.02);
            vca.gain.setValueAtTime(peakVol, time + duration); 
            vca.gain.linearRampToValueAtTime(0, time + duration + 0.05);
        } else {
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.005);
            const releaseTime = Math.max(0.18, filterDecay); 
            vca.gain.setTargetAtTime(0, time + 0.04, releaseTime / 4.5);
        }

        // 7. Ruta de Señal
        osc.connect(filterNode);
        filterNode.connect(vca);
        vca.connect(this.output); 

        // 8. Ciclo de Vida
        osc.start(time);
        osc.stop(time + duration + 1.5); 

        osc.onended = () => {
            try {
                osc.disconnect();
                vca.disconnect();
                filterNode.disconnect();
            } catch(e) {}
        };
    }
}

window.BassSynth = BassSynth;