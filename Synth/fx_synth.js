/*
 * FX SYNTH MODULE (ACID CORE v4.5 - PRO AUDIO)
 * Focus: Warm harmonics, dynamic accent control, and tone shaping.
 */

// --- 1. FILTER ENGINE (Liquid 303 Style) ---
class BassFilter {
    /**
     * @param {AudioContext} ctx 
     * @param {number} time - Current time
     * @param {object} params - Synth parameters
     * @param {number} duration - Note duration
     * @param {boolean} slide - Is slide active?
     * @param {boolean} accent - Is accent active?
     * @param {number} accentInt - Accent Intensity (0-100)
     */
    static create(ctx, time, params, duration, slide, accent, accentInt = 50) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // Mapeo de intensidad de acento (0 a 1.0)
        const accFactor = accentInt / 100;

        // --- FRECUENCIA BASE (Logarítmica Musical) ---
        const t = params.cutoff / 100; 
        const baseFreq = 60 + (t * t * 9000); 

        // --- RESONANCIA (Q Adaptativa) ---
        let qVal = params.resonance; // 0-20 raw
        
        if (accent) {
            // La resonancia ahora responde a la intensidad del acento
            // Si accentInt es bajo, el boost es sutil. Si es alto, "grita".
            const boost = 5 + (qVal * 1.5 * accFactor);
            qVal = Math.min(28, qVal + boost); 
        }
        
        // Compensación de agudos
        if (baseFreq > 5000) qVal *= 0.6;
        
        filter.Q.value = Math.min(30, qVal);

        // --- ENVOLVENTE (Modulation) ---
        // El acento también afecta cuánto se abre el filtro extra
        let envStrength = params.envMod / 100;
        if (accent) envStrength += (0.3 * accFactor); // Extra 'wow' on accent

        const peakFreq = Math.min(22050, baseFreq + (envStrength * 8000));
        
        // --- TIEMPOS ---
        const attackTime = slide ? 0.12 : 0.005;
        
        let decayTime = 0.1 + (params.decay / 100) * 0.8; 
        
        if (accent) {
            // En acento, el decay es más percusivo (más corto cuanto más acento)
            // Esto emula el comportamiento de descarga de condensador del 303
            decayTime = 0.2 - (0.1 * accFactor);
        }
        
        if (slide) decayTime = duration * 1.2;

        // --- AUTOMATIZACIÓN ---
        filter.frequency.setValueAtTime(baseFreq, time);
        filter.frequency.linearRampToValueAtTime(peakFreq, time + attackTime);
        filter.frequency.setTargetAtTime(baseFreq, time + attackTime, decayTime / 3.5);

        return { node: filter, decayTime: decayTime };
    }
}

// --- 2. DISTORTION ENGINE (Classic + Tone Control) ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.input = this.ctx.createGain();
        this.output = this.ctx.createGain();

        // 1. Shaper (The Grit)
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x';

        // 2. Tone Control (Post-Distortion EQ)
        // Elimina el "fizz" agudo molesto de la distorsión digital
        this.toneFilter = this.ctx.createBiquadFilter();
        this.toneFilter.type = 'lowpass';
        this.toneFilter.Q.value = 0.7; // Un poco de color en el corte

        // 3. Post Gain (Makeup / Output Trim)
        this.postGain = this.ctx.createGain();

        // Routing: Input -> Shaper -> Tone -> PostGain -> Output
        this.input.connect(this.shaper);
        this.shaper.connect(this.toneFilter);
        this.toneFilter.connect(this.postGain);
        this.postGain.connect(this.output);

        // Init Params
        this.amount = 0;
        this.cachedCurve = null;
        
        // Defaults
        this.setTone(100); // Open
        this.setPostGain(100); // Unity approx
    }

    connect(destination) {
        this.output.connect(destination);
    }

    setDistortion(amount) {
        if (amount === this.amount && this.cachedCurve) return;
        this.amount = amount;

        if (amount <= 0) {
            this.shaper.curve = null;
        } else {
            this.shaper.curve = this._makeDistortionCurve(amount);
        }
    }

    setTone(val) {
        // Val 0-100
        // 0 = Dark (500Hz), 100 = Open (20kHz)
        // Mapping logarítmico para que se sienta natural
        const hz = 500 + (Math.pow(val / 100, 2) * 19500);
        this.toneFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.05);
    }

    setPostGain(val) {
        // Val 0-100
        // Compensamos el volumen. Aprox 0.5x a 2.0x
        const gain = val / 50; 
        this.postGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
    }

    _makeDistortionCurve(amount) {
        const k = amount;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;

        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;