/*
 * DRUM SYNTH MODULE (v37 - Multi-Channel Matrix)
 * 9 Independent Channels with Volume Control and Sound Variants.
 * Pure Synthesis - No Samples.
 */

class DrumSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.noiseBuffer = null;

        // Configuration State
        this.masterVolume = 85;
        
        // 9 Fixed Slots with Defaults
        // Variants: 0=OFF, 1=Default, 2-8=Alt Sounds
        this.channels = [
            { id: 0, type: 'kick',  name: 'KICK',   variant: 1, volume: 90, gainNode: null },
            { id: 1, type: 'snare', name: 'SNARE',  variant: 1, volume: 85, gainNode: null },
            { id: 2, type: 'clap',  name: 'CLAP',   variant: 1, volume: 80, gainNode: null },
            { id: 3, type: 'chat',  name: 'CL.HAT', variant: 1, volume: 75, gainNode: null },
            { id: 4, type: 'ohat',  name: 'OP.HAT', variant: 1, volume: 75, gainNode: null },
            { id: 5, type: 'ltom',  name: 'LO TOM', variant: 1, volume: 80, gainNode: null },
            { id: 6, type: 'htom',  name: 'HI TOM', variant: 1, volume: 80, gainNode: null },
            { id: 7, type: 'crash', name: 'CRASH',  variant: 1, volume: 70, gainNode: null },
            { id: 8, type: 'perc',  name: 'PERC',   variant: 1, volume: 75, gainNode: null }
        ];

        // Default DnB Color Palette (can be overridden by UI)
        this.channelColors = [
            'hsl(0, 100%, 60%)',   // Red
            'hsl(40, 100%, 50%)',  // Orange
            'hsl(40, 100%, 60%)',  // Orange-Yellow (Clap)
            'hsl(180, 100%, 50%)', // Cyan
            'hsl(200, 100%, 50%)', // Blue
            'hsl(270, 100%, 60%)', // Purple
            'hsl(300, 100%, 60%)', // Magenta
            'hsl(50, 100%, 50%)',  // Yellow (Crash)
            'hsl(120, 100%, 50%)'  // Green (Perc)
        ];
    }

    init(audioContext, destination) {
        this.ctx = audioContext;
        
        // Master Bus
        this.masterGain = this.ctx.createGain();
        this.setMasterVolume(this.masterVolume);
        this.masterGain.connect(destination);

        // Initialize Channel Gains
        this.channels.forEach(ch => {
            ch.gainNode = this.ctx.createGain();
            this.setChannelVolume(ch.id, ch.volume);
            ch.gainNode.connect(this.masterGain);
        });

        this.createNoiseBuffer();
    }

    // --- VOLUME CONTROL ---

    setMasterVolume(val) {
        this.masterVolume = Math.max(0, Math.min(100, val));
        if(this.masterGain) {
            // Logarithmic fade for natural volume
            const gain = (this.masterVolume / 100) ** 1.5; 
            this.masterGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
        }
    }

    setChannelVolume(id, val) {
        const ch = this.channels[id];
        if(!ch) return;
        ch.volume = Math.max(0, Math.min(100, val));
        if(ch.gainNode) {
            const gain = (ch.volume / 100) ** 1.5;
            ch.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
        }
    }

    setChannelVariant(id, variant) {
        if(this.channels[id]) {
            this.channels[id].variant = parseInt(variant);
        }
    }

    // --- PLAYBACK ---

    play(channelId, time) {
        if (!this.ctx) return;
        const ch = this.channels[channelId];
        
        // 0 = Disabled
        if (!ch || ch.variant === 0) return;

        // Route based on type
        switch (ch.type) {
            case 'kick':  this.synthKick(time, ch); break;
            case 'snare': this.synthSnare(time, ch); break;
            case 'clap':  this.synthClap(time, ch); break;
            case 'chat':  this.synthHat(time, ch, false); break;
            case 'ohat':  this.synthHat(time, ch, true); break;
            case 'ltom':  this.synthTom(time, ch, 100); break;
            case 'htom':  this.synthTom(time, ch, 250); break;
            case 'crash': this.synthCrash(time, ch); break;
            case 'perc':  this.synthPerc(time, ch); break;
        }
    }

    // --- SYNTHESIS ALGORITHMS ---

    createNoiseBuffer() {
        const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
    }

    // 1. KICK (Punchy, Deep, Distorted)
    synthKick(time, ch) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        // Variant Logic
        let startFreq = 150, endFreq = 0.01, decay = 0.5;
        let type = 'sine';

        switch(ch.variant) {
            case 1: startFreq=180; decay=0.4; break; // Standard DnB
            case 2: startFreq=120; decay=0.8; break; // 808 Deep
            case 3: startFreq=220; decay=0.3; type='triangle'; break; // Hard
            case 4: startFreq=300; decay=0.15; break; // Clicky
            default: startFreq=150; 
        }

        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + decay);

        gain.gain.setValueAtTime(1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

        osc.connect(gain);
        gain.connect(ch.gainNode);

        osc.start(time);
        osc.stop(time + decay);
    }

    // 2. SNARE (Neuro, Tight, Trash)
    synthSnare(time, ch) {
        // A. Tone
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        let toneFreq = 200;
        
        // B. Noise
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        const noiseGain = this.ctx.createGain();

        // Variant Logic
        switch(ch.variant) {
            case 1: // Tight Neuro
                toneFreq = 250; 
                noiseFilter.type = 'highpass'; noiseFilter.frequency.value = 1500;
                break;
            case 2: // Low/Fat
                toneFreq = 160; 
                noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1000;
                break;
            case 3: // High/Piccolo
                toneFreq = 400; 
                noiseFilter.type = 'highpass'; noiseFilter.frequency.value = 3000;
                break;
            case 4: // Trashy (Triangle + Bandpass)
                osc.type = 'triangle';
                toneFreq = 220;
                noiseFilter.type = 'lowpass'; noiseFilter.frequency.value = 8000;
                break;
        }

        // Envelopes
        osc.frequency.setValueAtTime(toneFreq, time);
        osc.frequency.exponentialRampToValueAtTime(toneFreq/2, time + 0.1);
        oscGain.gain.setValueAtTime(0.5, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        noiseGain.gain.setValueAtTime(0.8, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.25);

        // Connections
        osc.connect(oscGain); oscGain.connect(ch.gainNode);
        noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(ch.gainNode);

        osc.start(time); osc.stop(time + 0.2);
        noise.start(time); noise.stop(time + 0.3);
    }

    // 3. CLAP (Layered Noise Pulse)
    synthClap(time, ch) {
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        filter.type = 'bandpass';
        // Variants: different filter centers
        filter.frequency.value = ch.variant === 1 ? 1200 : (ch.variant === 2 ? 800 : 2000);
        filter.Q.value = 1;

        // Clap Envelope (Multi-pulse simulation)
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.8, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.1, time + 0.02); // Slap 1
        gain.gain.setValueAtTime(0.6, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2); // Tail

        noise.connect(filter); filter.connect(gain); gain.connect(ch.gainNode);
        noise.start(time); noise.stop(time + 0.25);
    }

    // 4. HATS (FM Metallic + Filtered Noise)
    synthHat(time, ch, isOpen) {
        // Metallic FM base (6 Square oscillators at strange ratios)
        // For simplicity/CPU, we use filtered noise + high freq square
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        
        // Variant: Filter Freq
        const baseF = ch.variant === 1 ? 8000 : (ch.variant === 2 ? 5000 : 12000);
        filter.frequency.value = baseF;

        const gain = this.ctx.createGain();
        const decay = isOpen ? 0.4 : 0.05;
        const vol = isOpen ? 0.6 : 0.8;

        gain.gain.setValueAtTime(vol, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

        source.connect(filter); filter.connect(gain); gain.connect(ch.gainNode);
        source.start(time); source.stop(time + decay + 0.1);
    }

    // 5. TOMS (Pitch Sweep)
    synthTom(time, ch, basePitch) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Variants: Pitch Modifiers
        const p = ch.variant === 1 ? basePitch : (ch.variant === 2 ? basePitch * 0.7 : basePitch * 1.5);

        osc.frequency.setValueAtTime(p, time);
        osc.frequency.exponentialRampToValueAtTime(p * 0.2, time + 0.4);

        gain.gain.setValueAtTime(0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

        osc.connect(gain); gain.connect(ch.gainNode);
        osc.start(time); osc.stop(time + 0.5);
    }

    // 6. CRASH / RIDE
    synthCrash(time, ch) {
        // Multiple detuned squares + Noise
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; 
        hp.frequency.value = ch.variant === 1 ? 2000 : 5000; // 1=Crash, 2=Ride-ish

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 1.5); // Long decay

        noise.connect(hp); hp.connect(gain); gain.connect(ch.gainNode);
        noise.start(time); noise.stop(time + 2.0);
    }

    // 7. PERC / GLITCH (FM Synthesis)
    synthPerc(time, ch) {
        const osc = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const outGain = this.ctx.createGain();

        // FM Setup
        if (ch.variant === 1) { // Woodblock
            osc.frequency.value = 800;
            mod.frequency.value = 1200;
            modGain.gain.value = 500;
        } else if (ch.variant === 2) { // Bleep
            osc.type = 'square';
            osc.frequency.setValueAtTime(200, time);
            osc.frequency.linearRampToValueAtTime(800, time + 0.1);
            modGain.gain.value = 0;
        } else { // Metallic Glitch
            osc.frequency.value = 400;
            mod.type = 'sawtooth';
            mod.frequency.value = 60;
            modGain.gain.value = 1000;
        }

        // Envelope
        outGain.gain.setValueAtTime(0.7, time);
        outGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(outGain);
        outGain.connect(ch.gainNode);

        osc.start(time); mod.start(time);
        osc.stop(time + 0.2); mod.stop(time + 0.2);
    }
}

// Instance
window.drumSynth = new DrumSynth();