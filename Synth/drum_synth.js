/* * DRUM SYNTH MODULE (Extended 7-Piece Kit)
 * Synthesizes analog-style percussion with advanced envelope shaping.
 */

class DrumSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        
        // Extended Kit Definition
        this.kits = [
            { id: 'kick', name: 'KICK', color: '#ff2222' },    // Red
            { id: 'snare', name: 'SNARE', color: '#ffdd00' },  // Yellow
            { id: 'clap', name: 'CLAP', color: '#ff8800' },    // Orange
            { id: 'hat', name: 'CL.HAT', color: '#00ccff' },   // Cyan (Closed)
            { id: 'ohat', name: 'OP.HAT', color: '#0088ff' },  // Blue (Open)
            { id: 'tom', name: 'LO TOM', color: '#bd00ff' },   // Purple
            { id: 'htom', name: 'HI TOM', color: '#ff00bd' }   // Pink
        ];
        
        // Cache noise buffer to save CPU
        this.noiseBuffer = null;
    }

    init(audioContext, outputNode) {
        this.ctx = audioContext;
        this.masterGain = outputNode;
        this.createNoiseBuffer();
    }

    // Pre-generate 1 second of white noise
    createNoiseBuffer() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate; 
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
    }

    play(type, time) {
        if (!this.ctx) return;

        switch (type) {
            case 'kick': this.playKick(time); break;
            case 'snare': this.playSnare(time); break;
            case 'clap': this.playClap(time); break;
            case 'hat': this.playHiHat(time, false); break; // Closed
            case 'ohat': this.playHiHat(time, true); break; // Open
            case 'tom': this.playTom(time, 150); break;     // Low Pitch
            case 'htom': this.playTom(time, 300); break;    // High Pitch
            
            // Legacy/Fallback mapping
            case 'perc': this.playTom(time, 300); break; 
            case 'chat': this.playHiHat(time, false); break;
            case 'ltom': this.playTom(time, 150); break;
        }
    }

    playKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Punchier Kick Envelope
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);

        gain.gain.setValueAtTime(1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.5);
    }

    playSnare(time) {
        // 1. Tone (Body)
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, time);
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.4, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(time);
        osc.stop(time + 0.2);

        // 2. Noise (Snares)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.setValueAtTime(2000, time);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.6, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.25);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        
        noise.start(time);
        noise.stop(time + 0.3);
    }

    playClap(time) {
        // Synthesized Hand Clap: Filtered noise with a "sawtooth" multi-pulse envelope
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200; // Clap "crack" frequency
        filter.Q.value = 1;

        const gain = this.ctx.createGain();
        
        // Multi-pulse envelope simulation (Reverb-like effect)
        // Pulse 1
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.1, time + 0.02);
        
        // Pulse 2
        gain.gain.setValueAtTime(0.5, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.1, time + 0.04);
        
        // Pulse 3 (Main Decay)
        gain.gain.setValueAtTime(0.8, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(time);
        noise.stop(time + 0.25);
    }

    playHiHat(time, isOpen) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;

        // Bandpass for metallic character
        const bandpass = this.ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        bandpass.Q.value = 1;

        // Highpass to clean up mud
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;

        const gain = this.ctx.createGain();
        
        // Envelope depends on Open/Closed state
        const decay = isOpen ? 0.4 : 0.06; // Open is longer
        const volume = isOpen ? 0.5 : 0.6; // Open is slightly quieter to mix better

        gain.gain.setValueAtTime(volume, time); 
        gain.gain.exponentialRampToValueAtTime(0.01, time + decay);

        source.connect(bandpass);
        bandpass.connect(highpass);
        highpass.connect(gain);
        gain.connect(this.masterGain);

        source.start(time);
        source.stop(time + decay + 0.1);
    }

    playTom(time, startFreq) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Pitch Sweep
        osc.frequency.setValueAtTime(startFreq, time); 
        osc.frequency.exponentialRampToValueAtTime(startFreq * 0.3, time + 0.4);

        // Amplitude Envelope
        gain.gain.setValueAtTime(0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.4);
    }
}

// Instance for live playback
window.drumSynth = new DrumSynth();

// Export class for offline rendering (CRITICAL FIX)
window.DrumSynth = DrumSynth;