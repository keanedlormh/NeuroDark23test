/*
 * FX SYNTH MODULE (ACID CORE v4)
 * Focus: Warm harmonics, tight low-end, and screaming resonance.
 */

// --- 1. FILTER ENGINE (Liquid 303 Style) ---
// (Mantenemos este módulo ya que define el carácter del filtro Acid)
class BassFilter {
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // --- FRECUENCIA BASE (Logarítmica Musical) ---
        // Convertimos 0-100 a un rango de Hz útil (60Hz - 10000Hz)
        const t = params.cutoff / 100; 
        const baseFreq = 60 + (t * t * 9000); 

        // --- RESONANCIA (Q Adaptativa) ---
        let qVal = params.resonance; // 0-20 raw
        
        if (accent) {
            // Boost masivo de resonancia en acento
            qVal = Math.min(28, qVal * 1.5 + 5); 
        }
        
        // Compensación de agudos
        if (baseFreq > 5000) qVal *= 0.6;
        
        filter.Q.value = Math.min(30, qVal);

        // --- ENVOLVENTE (Modulation) ---
        const envStrength = params.envMod / 100;
        const peakFreq = Math.min(22050, baseFreq + (envStrength * 8000));
        
        // --- TIEMPOS ---
        const attackTime = slide ? 0.12 : 0.005;
        
        let decayTime = 0.1 + (params.decay / 100) * 0.8; 
        if (accent) decayTime = 0.18; 
        if (slide) decayTime = duration * 1.2;

        // --- AUTOMATIZACIÓN ---
        filter.frequency.setValueAtTime(baseFreq, time);
        filter.frequency.linearRampToValueAtTime(peakFreq, time + attackTime);
        filter.frequency.setTargetAtTime(baseFreq, time + attackTime, decayTime / 3.5);

        return { node: filter, decayTime: decayTime };
    }
}

// --- 2. DISTORTION ENGINE (Updated to Classic Soft-Clip) ---
// Reemplazado con la lógica de BassFXChain proporcionada por el usuario
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.input = this.ctx.createGain();
        this.output = this.ctx.createGain();

        // 1. Distortion Node
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // Mantenemos 4x para calidad extra, aunque el ejemplo usaba 2x

        // Routing: Input -> Shaper -> Output
        // Eliminada la complejidad anterior (Pre/Post filtros) que ensuciaba el sonido
        this.input.connect(this.shaper);
        this.shaper.connect(this.output);

        // Init Cache
        this.amount = 0;
        this.cachedCurve = null;
    }

    connect(destination) {
        this.output.connect(destination);
    }

    setDistortion(amount) {
        // Evitar regenerar la curva si no ha cambiado
        if (amount === this.amount && this.cachedCurve) return;
        this.amount = amount;

        if (amount <= 0) {
            this.shaper.curve = null;
        } else {
            // Lazy generate curve
            this.shaper.curve = this._makeDistortionCurve(amount);
        }
    }

    // Algoritmo clásico de distorsión sigmoide
    _makeDistortionCurve(amount) {
        const k = amount; // Usamos el valor directo (0-100 funciona bien con esta fórmula)
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;

        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            // Fórmula clásica: (3 + k) * x * 20 * deg / (PI + k * abs(x))
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

// Export global para compatibilidad
window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;