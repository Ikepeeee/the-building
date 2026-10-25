// 効果音（WebAudio で合成。音声ファイルは使わない）
import { storage } from './save.js';
import { SAVE_KEY } from '../sim/constants.js';

const MUTE_KEY = SAVE_KEY + '.mute';
const SFX_KEY = SAVE_KEY + '.sfx';
const N = (s) => 440 * Math.pow(2, (s - 69) / 12); // MIDI ノート番号 → Hz

// 同時に鳴らす単発音の上限（iOS の Safari は AudioNode を作りすぎるとタブが落ちることがある）
export const MAX_VOICES = 16;
const PRIORITY = new Set(['alarm', 'boom', 'fanfare', 'bells', 'built', 'error']);

const THROTTLE = { built: 250, cash: 140, ding: 120, build: 60, complaint: 400, roach: 300, fire: 600, alarm: 1500, boom: 300, bells: 1500, fanfare: 1500 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = storage.get(MUTE_KEY) === '1';
    this.sfxOn = storage.get(SFX_KEY) !== '0'; // 効果音（環境音は ambience.js 側で別に切り替え）
    this.last = {};
    this.voices = 0; // 鳴っている単発音（ソースノード）の数
    this.idleSince = 0;
  }

  /** あと n 個鳴らせるか（優先度の高い音は少しだけ枠を超えてよい） */
  canVoice(n = 1, priority = false) {
    return this.voices + n <= MAX_VOICES + (priority ? 8 : 0);
  }

  /** 鳴り終わったら止めて、つないだノードも全部外す（ノードを溜めない） */
  track(src, ...extra) {
    this.voices++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      this.voices = Math.max(0, this.voices - 1);
      try { src.disconnect(); } catch { /* */ }
      for (const n of extra) { try { n.disconnect(); } catch { /* */ } }
    };
    src.onended = end;
    return src;
  }

  /** 遊んでいない（一時停止・タイトル）状態が続いたら AudioContext を止めて電池と負荷を減らす */
  idle(isIdle) {
    if (!this.ctx) return;
    const now = performance.now();
    if (isIdle) {
      if (!this.idleSince) this.idleSince = now;
      if (now - this.idleSince > 3000 && this.ctx.state === 'running' && this.voices === 0) this.suspend();
    } else {
      this.idleSince = 0;
      if (this.ctx.state === 'suspended' && !document.hidden) this.resume();
    }
  }

  /** 初回のユーザー操作で呼ぶ（自動再生制限の解除） */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.32;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* 音が出ないだけ */ }
  }

  suspend() { try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch { /* */ } }
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch { /* */ } }

  setMuted(m) {
    this.muted = !!m;
    storage.set(MUTE_KEY, m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  tone(freq, t, dur, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const v = o.vol ?? 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    this.track(osc, g);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  noise(t, dur, o = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    const v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    this.track(src, f, g);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  setSfx(on) {
    this.sfxOn = !!on;
    storage.set(SFX_KEY, on ? '1' : '0');
  }

  play(name) {
    if (this.muted || !this.sfxOn || !this.ctx) return;
    if (this.ctx.state === 'suspended' && !document.hidden) { this.resume(); this.idleSince = 0; }
    if (this.ctx.state !== 'running') return;
    if (!this.canVoice(2, PRIORITY.has(name))) return; // 鳴りすぎのときは落とす
    const now = performance.now();
    if (now - (this.last[name] || 0) < (THROTTLE[name] ?? 80)) return;
    this.last[name] = now;
    const t = this.ctx.currentTime + 0.01;
    try {
      switch (name) {
        case 'cash':
          this.tone(N(88), t, 0.07, { vol: 0.15 });
          this.tone(N(93), t + 0.07, 0.22, { vol: 0.15 });
          break;
        case 'ding':
          this.tone(N(84), t, 0.7, { type: 'sine', vol: 0.3 });
          this.tone(N(96), t, 0.4, { type: 'sine', vol: 0.08 });
          break;
        case 'build':
          this.noise(t, 0.06, { freq: 1800, vol: 0.35 });
          this.tone(180, t, 0.07, { vol: 0.15, to: 90 });
          this.noise(t + 0.11, 0.06, { freq: 1500, vol: 0.3 });
          this.tone(160, t + 0.11, 0.07, { vol: 0.12, to: 80 });
          break;
        case 'bulldoze':
          this.noise(t, 0.5, { freq: 1500, to: 150, vol: 0.4 });
          this.tone(70, t, 0.45, { type: 'sawtooth', vol: 0.12, to: 40 });
          break;
        case 'error':
          this.tone(160, t, 0.1, { vol: 0.14 });
          this.tone(110, t + 0.11, 0.18, { vol: 0.14 });
          break;
        case 'boom':
          this.noise(t, 1.6, { freq: 900, to: 50, vol: 0.9, attack: 0.002 });
          this.tone(90, t, 1.2, { type: 'sine', vol: 0.5, to: 28 });
          break;
        case 'fire':
          for (let i = 0; i < 9; i++) this.noise(t + i * 0.06 + Math.random() * 0.04, 0.05, { filter: 'bandpass', freq: 1500 + Math.random() * 2500, q: 3, vol: 0.3 });
          this.noise(t, 0.6, { freq: 400, vol: 0.12, attack: 0.1 });
          break;
        case 'alarm':
          for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, t + i * 0.18, 0.17, { vol: 0.12, attack: 0.01 });
          break;
        case 'bells':
          [N(79), N(76), N(72), N(79)].forEach((f, i) => {
            const s = t + i * 0.42;
            this.tone(f, s, 1.6, { type: 'sine', vol: 0.25, attack: 0.003 });
            this.tone(f * 2.76, s, 0.6, { type: 'sine', vol: 0.05, attack: 0.003 });
            this.tone(f * 5.4, s, 0.25, { type: 'sine', vol: 0.03, attack: 0.003 });
          });
          break;
        case 'fanfare': {
          const seq = [[72, 0, 0.12], [76, 0.12, 0.12], [79, 0.24, 0.12], [84, 0.36, 0.5], [79, 0.86, 0.12], [84, 0.98, 0.7]];
          for (const [n, d, l] of seq) {
            this.tone(N(n), t + d, l, { vol: 0.13 });
            this.tone(N(n - 12), t + d, l, { type: 'triangle', vol: 0.15 });
          }
          break;
        }
        case 'roach':
          for (let i = 0; i < 5; i++) this.noise(t + i * 0.045, 0.03, { filter: 'highpass', freq: 5000, vol: 0.2 });
          break;
        case 'complaint':
          this.tone(N(64), t, 0.16, { type: 'triangle', vol: 0.22, to: N(60) });
          this.tone(N(59), t + 0.18, 0.28, { type: 'triangle', vol: 0.22, to: N(55) });
          break;
        case 'built':
          // 完成: 明るい2音＋きらり
          this.tone(N(79), t, 0.12, { type: 'triangle', vol: 0.18 });
          this.tone(N(84), t + 0.1, 0.35, { type: 'triangle', vol: 0.18 });
          this.tone(N(96), t + 0.18, 0.25, { type: 'sine', vol: 0.06 });
          break;
        case 'click':
          this.tone(1200, t, 0.03, { vol: 0.05 });
          break;
        default:
          this.tone(N(76), t, 0.1, { vol: 0.1 });
      }
    } catch { /* ignore */ }
  }
}
