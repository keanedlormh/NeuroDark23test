/*
 * FX SYNTH MODULE (ACID CORE v4)
 * Architecture: Asymmetric Tube Overdrive
 * Focus: Warm harmonics, tight low-end, and screaming resonance.
 */

// --- 1. FILTER ENGINE (Liquid 303 Style) ---
class BassFilter {
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // --- FRECUENCIA BASE (Logarítmica Musical) ---
        // Convertimos 0-100 a un rango de Hz útil (60Hz - 10000Hz)
        // La curva x^2 da más control en la zona grave del slider
        const t = params.cutoff / 100; 
        const baseFreq = 60 + (t * t * 9000); 

        // --- RESONANCIA (Q Adaptativa) ---
        // Reducimos la Q en frecuencias altas para evitar dolor de oídos
        // Aumentamos la Q en los acentos para el "chirrido" clásico
        let qVal = params.resonance; // 0-20 raw
        
        if (accent) {
            // Boost masivo de resonancia en acento (el secreto del Acid)
            qVal = Math.min(28, qVal * 1.5 + 5); 
        }
        
        // Compensación de agudos (si la freq es muy alta, baja la Q)
        if (baseFreq > 5000) qVal *= 0.6;
        
        filter.Q.value = Math.min(30, qVal);

        // --- ENVOLVENTE (Modulation) ---
        const envStrength = params.envMod / 100;
        // La envolvente abre el filtro hasta 4 octavas por encima
        const peakFreq = Math.min(22050, baseFreq + (envStrength * 8000));
        
        // --- TIEMPOS (Snappy vs Slide) ---
        const attackTime = slide ? 0.12 : 0.005; // Ataque inmediato
        
        // El decay es crucial. 
        // Slide = largo (no cierra). Acento = corto (percusivo).
        let decayTime = 0.1 + (params.decay / 100) * 0.8; // 0.1s - 0.9s
        if (accent) decayTime = 0.18; // El acento "muerde" rápido
        if (slide) decayTime = duration * 1.2; // Mantiene abierto

        // --- AUTOMATIZACIÓN ---
        filter.frequency.setValueAtTime(baseFreq, time);
        filter.frequency.linearRampToValueAtTime(peakFreq, time + attackTime);
        // Caída exponencial suave hacia la frecuencia base
        filter.frequency.setTargetAtTime(baseFreq, time + attackTime, decayTime / 3.5);

        return { node: filter, decayTime: decayTime };
    }
}

// --- 2. DISTORTION ENGINE (The "Dirty Box") ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        
        // TOPOLOGÍA: INPUT -> PRE-FILTRO -> DRIVE -> CLIPPER -> POST-FILTRO -> OUTPUT
        
        this.input = this.ctx.createGain();
        
        // 1. TIGHTENER (Pre-Distortion EQ)
        // Cortamos graves profundos (HighPass @ 200Hz) antes de la distorsión.
        // Esto hace que la distorsión sea "crujiente" y no "fangosa".
        this.preFilter = this.ctx.createBiquadFilter();
        this.preFilter.type = 'highpass';
        this.preFilter.frequency.value = 200; 
        this.preFilter.Q.value = 0.5;

        // 2. DRIVE STAGE
        this.driveGain = this.ctx.createGain();

        // 3. ASYMMETRIC CLIPPER
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // Obligatorio para evitar aliasing

        // 4. CABINET SIMULATOR (Post-Distortion EQ)
        // Simulamos un altavoz cortando los agudos "fizz" digitales.
        // LowPass @ 3500Hz (típico de altavoces de bajo/guitarra)
        this.postFilter = this.ctx.createBiquadFilter();
        this.postFilter.type = 'lowpass';
        this.postFilter.frequency.value = 3500; 
        this.postFilter.Q.value = 0.7; // Un poco de pico para presencia

        // 5. OUTPUT LEVEL
        this.output = this.ctx.createGain();

        // CONEXIONES
        this.input.connect(this.preFilter);
        this.preFilter.connect(this.driveGain);
        this.driveGain.connect(this.shaper);
        this.shaper.connect(this.postFilter);
        this.postFilter.connect(this.output);

        this.curveCache = new Map();
        this.currentAmt = -1;
    }

    connect(dest) {
        this.output.connect(dest);
    }

    setDistortion(amount) {
        // amount: 0 - 100
        if (this.currentAmt === amount) return;
        this.currentAmt = amount;

        if (amount <= 1) {
            // CLEAN MODE (Bypass Real)
            // Dejamos pasar todo el rango de frecuencias
            this.preFilter.frequency.value = 10;
            this.postFilter.frequency.value = 22000;
            this.shaper.curve = null;
            this.driveGain.gain.value = 1;
            this.output.gain.value = 1;
        } else {
            // DIRTY MODE
            
            // 1. Activar Filtros de Color
            this.preFilter.frequency.value = 180; // Tight bass
            // Cuanto más distorsión, más oscuro el filtro final para esconder ruido
            this.postFilter.frequency.value = 5000 - (amount * 35); 

            // 2. Curva
            if (!this.curveCache.has(amount)) {
                this.curveCache.set(amount, this._makeAsymmetricCurve(amount));
            }
            this.shaper.curve = this.curveCache.get(amount);

            // 3. Drive (Ganancia de entrada)
            // Empujamos agresivamente: 1x a 40x
            const drive = 1 + (amount / 2);
            this.driveGain.gain.value = drive;

            // 4. Level (Compensación de salida)
            // Fórmula empírica para mantener volumen constante
            this.output.gain.value = 1 / Math.pow(drive, 0.6);
        }
    }

    /**
     * Curva Asimétrica "Soft-Hard Hybrid"
     * Imita válvulas sobrecargadas: 
     * - Lado positivo: Clipping suave (compresión)
     * - Lado negativo: Clipping duro (agresividad)
     */
    _makeAsymmetricCurve(amount) {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const k = amount * 0.1; // Intensidad

        for (let i = 0; i < n_samples; i++) {
            // x va de -1 a 1
            const x = (i * 2) / n_samples - 1;
            
            if (x > 0) {
                // Positivo: Tanh suave (Compresión valvular)
                curve[i] = Math.tanh(x * (1 + k)); 
            } else {
                // Negativo: Clipping más duro y rápido (Fuzz/Distorsión)
                // Esto genera los armónicos pares deseados
                curve[i] = Math.max(-1, Math.tanh(x * (1 + k * 1.5))); 
            }
        }
        return curve;
    }
}

window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;