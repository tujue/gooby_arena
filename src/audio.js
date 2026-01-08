export class SoundManager {
    constructor() {
        if (SoundManager.instance) return SoundManager.instance;
        SoundManager.instance = this;
        this.musicEnabled = true;
        this.soundEnabled = true;
        this.masterVolume = 0.3;

        // Initialize AudioContext Lazily to prevent warnings
        this.ctx = null;
        this.AudioContextClass = window.AudioContext || window.webkitAudioContext;

        this.currentMusicType = null;
        this.musicInterval = null;
        this.pendingMusic = null;

        // Auto-resume on user interaction
        const initAudio = () => {
            if (!this.ctx) {
                this.ctx = new this.AudioContextClass();
            }

            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().then(() => {
                    if (this.pendingMusic && this.musicEnabled) {
                        this.playMusic(this.pendingMusic);
                        this.pendingMusic = null;
                    }
                }).catch(err => {
                });
            } else if (this.pendingMusic && this.musicEnabled) {
                this.playMusic(this.pendingMusic);
                this.pendingMusic = null;
            }
        };

        // Listen for ANY user interaction
        ['click', 'keydown', 'touchstart'].forEach(event => {
            window.addEventListener(event, initAudio, { once: true });
        });
    }

    // Resume audio context (for browser autoplay policies)
    resumeAudio() {
        if (!this.ctx && this.AudioContextClass) {
            this.ctx = new this.AudioContextClass();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            return this.ctx.resume().then(() => {
            }).catch(err => {
            });
        }
        return Promise.resolve();
    }

    toggleMute() {
        this.musicEnabled = !this.musicEnabled;
        if (!this.musicEnabled) this.stopMusic();
        else if (this.currentMusicType) this.playMusic(this.currentMusicType);
        return this.musicEnabled;
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        return this.soundEnabled;
    }

    playTone(freq, type, duration, vol = 1.0) {
        if (!this.soundEnabled || !this.ctx || this.ctx.state !== 'running') return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol * this.masterVolume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) { }
    }

    playNoise(duration, vol = 1.0) {
        if (!this.soundEnabled || !this.ctx || this.ctx.state !== 'running') return;
        try {
            const bufferSize = this.ctx.sampleRate * duration;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(vol * this.masterVolume * 0.5, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            noise.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start();
        } catch (e) { }
    }

    /* ---- MISSING FUNCTIONS ADDED HERE ---- */
    playStart() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(300, 'sine', 0.3);
        setTimeout(() => this.playTone(600, 'sine', 0.5), 200);
    }

    playWin() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(400, 'sine', 0.1);
        setTimeout(() => this.playTone(600, 'sine', 0.1), 100);
        setTimeout(() => this.playTone(1000, 'sine', 0.4), 200);
    }

    playDash() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playNoise(0.2, 0.8);
        this.playTone(400, 'triangle', 0.1, 0.2);
    }

    playHit(force = 1.0) {
        if (!this.soundEnabled || !this.ctx) return;
        const v = Math.min(1.0, force * 0.5);
        this.playTone(150, 'square', 0.1, v);
        this.playTone(60, 'sawtooth', 0.15, v);
    }

    playKill() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(800, 'sine', 0.1);
        setTimeout(() => this.playTone(100, 'square', 0.3), 100);
    }

    playUIHover() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(800, 'sine', 0.05, 0.05);
    }

    playUIClick() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(100, 'triangle', 0.1, 0.5);
    }

    playGoobyHit() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(300, 'sine', 0.2, 0.2);
    }

    playCollect() {
        if (!this.soundEnabled || !this.ctx) return;
        this.playTone(1000, 'sine', 0.08, 0.15);
    }

    playAnnouncer() { } // Dummy

    stopMusic() {
        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }
        this.currentMusicType = null;
    }

    playMusic(type) {
        if (!this.musicEnabled) return;
        if (!this.ctx) {
            this.pendingMusic = type;
            return;
        }
        if (this.currentMusicType === type) return;
        this.stopMusic();
        this.currentMusicType = type;

        // Simple music implementation to prevent errors
        this.musicInterval = setInterval(() => {
            // Music loop logic...
        }, 500);
    }
}
