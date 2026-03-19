// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Audio Module
// ═══════════════════════════════════════════════════════════════

class Audio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('nf_muted') === 'true';
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initialized = true;
    } catch (e) { /* no audio support */ }
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('nf_muted', this.muted);
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  tone(freq, type, dur, vol = 0.3, delay = 0) {
    if (this.muted || !this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.connect(g);
    g.connect(this.ctx.destination);
    o.type = type;
    o.frequency.value = freq;
    const t = this.ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, count = 1) {
    if (this.muted || !this.ctx) return;
    this.resume();

    switch (name) {
      case 'night':
        for (let i = 0; i < 3; i++) {
          this.tone(50 + i * 15, 'sine', 3 + i, 0.06, i * 0.6);
          this.tone(100 + i * 20, 'sawtooth', 2, 0.025, i * 0.8 + 0.2);
        }
        for (let i = 0; i < 6; i++) this.tone(3000 + Math.random() * 500, 'sine', 0.04, 0.015, i * 0.4);
        break;

      case 'kill':
        for (let k = 0; k < Math.min(count, 3); k++) {
          const d = k * 1.1;
          this.tone(70, 'sine', 0.18, 0.5, d);
          this.tone(35, 'sine', 0.35, 0.3, d + 0.05);
          this.tone(600 + Math.random() * 300, 'sawtooth', 0.09, 0.08, d + 0.1);
          // Swoosh
          const t2 = this.ctx.currentTime + d + 0.2;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.connect(g); g.connect(this.ctx.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(250, t2);
          o.frequency.exponentialRampToValueAtTime(600, t2 + 0.12);
          o.frequency.exponentialRampToValueAtTime(100, t2 + 0.45);
          g.gain.setValueAtTime(0, t2);
          g.gain.linearRampToValueAtTime(0.14, t2 + 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t2 + 0.55);
          o.start(t2); o.stop(t2 + 0.6);
        }
        break;

      case 'day':
        this.tone(523, 'triangle', 0.25, 0.15);
        this.tone(659, 'triangle', 0.25, 0.15, 0.28);
        this.tone(784, 'triangle', 0.45, 0.15, 0.55);
        break;

      case 'vote':
        this.tone(440, 'sine', 0.1, 0.08);
        break;

      case 'bad':
        this.tone(200, 'sawtooth', 0.3, 0.3);
        this.tone(150, 'sawtooth', 0.5, 0.2, 0.25);
        this.tone(90, 'sine', 1, 0.12, 0.45);
        break;

      case 'good':
        this.tone(523, 'sine', 0.2, 0.15);
        this.tone(659, 'sine', 0.2, 0.15, 0.2);
        this.tone(784, 'sine', 0.35, 0.15, 0.38);
        break;

      case 'chat':
        this.tone(800, 'sine', 0.06, 0.04);
        break;

      case 'save':
        this.tone(523, 'sine', 0.2, 0.12);
        this.tone(784, 'sine', 0.2, 0.12, 0.15);
        this.tone(1047, 'sine', 0.3, 0.12, 0.3);
        break;

      case 'jester':
        this.tone(392, 'square', 0.15, 0.08);
        this.tone(494, 'square', 0.15, 0.08, 0.15);
        this.tone(392, 'square', 0.15, 0.08, 0.3);
        this.tone(330, 'square', 0.3, 0.08, 0.45);
        break;

      case 'tick':
        this.tone(900, 'sine', 0.04, 0.12);
        this.tone(450, 'sine', 0.03, 0.06, 0.05);
        break;

      case 'ghost':
        this.tone(200, 'sine', 1.2, 0.06);
        this.tone(250, 'triangle', 0.8, 0.04, 0.3);
        this.tone(180, 'sine', 1, 0.03, 0.6);
        break;

      case 'death':
        this.tone(80, 'sine', 1.5, 0.2);
        this.tone(60, 'sine', 2, 0.15, 0.3);
        this.tone(200, 'sawtooth', 0.4, 0.1, 0.1);
        this.tone(40, 'sine', 2, 0.1, 0.8);
        break;

      case 'transition':
        this.tone(300, 'sine', 0.3, 0.08);
        this.tone(400, 'sine', 0.25, 0.06, 0.15);
        this.tone(500, 'sine', 0.2, 0.04, 0.3);
        break;
    }
  }

  // Dynamic phase ambience (oscillator drone)
  setAmbience(phase) {
    if (this.muted || !this.ctx) { this._stopAmbience(); return; }
    this._stopAmbience();
    if (!phase || phase === 'lobby' || phase === 'over') return;

    const configs = {
      night:       [{ freq: 55,  type: 'sine', vol: 0.03 }, { freq: 82,  type: 'triangle', vol: 0.015 }],
      investigate: [{ freq: 220, type: 'sine', vol: 0.02 }, { freq: 330, type: 'triangle', vol: 0.01 }],
      dinner:      [{ freq: 110, type: 'sine', vol: 0.025 }, { freq: 165, type: 'triangle', vol: 0.012 }],
      verdict:     [{ freq: 73,  type: 'sawtooth', vol: 0.02 }, { freq: 98,  type: 'sine', vol: 0.015 }],
    };
    const cfg = configs[phase];
    if (!cfg) return;

    this._ambienceNodes = [];
    cfg.forEach(c => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.ctx.destination);
      o.type = c.type; o.frequency.value = c.freq;
      g.gain.setValueAtTime(0, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(c.vol, this.ctx.currentTime + 1.5);
      o.start();
      this._ambienceNodes.push({ osc: o, gain: g });
    });
  }

  _stopAmbience() {
    if (!this._ambienceNodes) return;
    const t = this.ctx?.currentTime || 0;
    this._ambienceNodes.forEach(n => {
      try { n.gain.gain.linearRampToValueAtTime(0, t + 0.5); n.osc.stop(t + 0.6); } catch {}
    });
    this._ambienceNodes = null;
  }

  haptic(pattern = [50]) {
    if (this.muted) return;
    try { navigator.vibrate?.(pattern); } catch (e) { /* ignore */ }
  }
}

// Singleton
const audio = new Audio();
export default audio;
