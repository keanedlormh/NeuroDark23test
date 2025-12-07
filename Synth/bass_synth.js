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
        
        // Default Params
        this.params = {
            distortion: 20,
            cutoff: 40,   // 0-100
            resonance: 8, // 0-20
            envMod: 60,
            decay: 40,
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // 1. Setup Output & FX Chain
        // Usamos la nueva clase BassDistortion (basada en tu ejemplo BassFXChain)
        try {
            if (typeof window.BassDistortion !== 'undefined') {
                this.fxChain = new window.BassDistortion(this.ctx);
                this.fxChain.setDistortion(this.params.distortion);
                
                // Conectamos: FX -> Destino
                this.fxChain.connect(destinationNode);
                
                // Nuestra salida interna es la entrada del FX
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
    setDistortion(val) { 
        this.params.distortion = val; 
        if(this.fxChain) this.fxChain.setDistortion(val); 
    }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
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
        // Drift Analógico reducido para un sonido más estable con la nueva distorsión
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

        // 5. Filtro (Mantenemos BassFilter para el carácter Acid)
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            const fResult = window.BassFilter.create(this.ctx, time, this.params, duration, slide, accent);
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            // Fallback básico si falla el filtro externo
            filterNode = this.ctx.createBiquadFilter();
            filterNode.frequency.value = 1000; 
        }

        // 6. Envolvente de Volumen (VCA)
        const peakVol = accent ? 0.85 : 0.65; 
        
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

        // 7. Ruta de Señal: OSC -> FILTER -> VCA -> [DISTORTION INPUT]
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