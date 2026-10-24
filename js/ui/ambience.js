// 環境音（WebAudio で合成）。画面に映っている範囲・時間帯・人の量に応じて控えめに鳴らす。
// - エレベーター: カゴの速さに合わせて音程が変わるモーター音、ドアが開くときのチャイム
// - オフィス: 勤務時間のタイピングと電話の呼び出し音
// - ファストフード・レストラン: 雑談のざわめきと調理のジュージュー音
// - ロビー: 人の量に応じたざわめき
// - 消防ヘリ: ローター音（sim.heli があるとき）
// - 工事中の施設: トンカチとドリル
// - ごみ・リサイクルセンター: 収集車のエンジン・バック警告音・積み込みの油圧音／駐車場: ドアの音・エンジン始動
import { TILE_W, FLOOR_H, SAVE_KEY } from '../sim/constants.js';
import { storage } from './save.js';

const AMB_KEY = SAVE_KEY + '.ambience';
const FOOD = new Set(['fastfood', 'restaurant']);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Ambience {
  constructor(sound) {
    this.s = sound;
    this.enabled = storage.get(AMB_KEY) !== '0';
    this.n = null;
    this.prevCar = new WeakMap();
    this.vmax = 0.5;
    this.lastChime = 0;
    this.lastT = 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    storage.set(AMB_KEY, on ? '1' : '0');
    if (!on) this.silence();
  }

  /** 常に鳴っている音の土台を作る（AudioContext が使えるようになってから） */
  ensure() {
    const s = this.s, c = s.ctx;
    if (this.n || !c || !s.noiseBuf || !s.master) return !!this.n;
    const noise = () => { const n = c.createBufferSource(); n.buffer = s.noiseBuf; n.loop = true; n.start(0, Math.random()); return n; };
    const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };
    const out = gain(1);
    out.connect(s.master);
    // ざわめき: 帯域を絞ったノイズを、ゆっくり揺らす
    const mBp = c.createBiquadFilter(); mBp.type = 'bandpass'; mBp.frequency.value = 520; mBp.Q.value = 0.8;
    const mAm = gain(0.7);
    const mLfo = c.createOscillator(); mLfo.frequency.value = 0.6; const mLfoG = gain(0.3); mLfo.connect(mLfoG); mLfoG.connect(mAm.gain); mLfo.start();
    const murmur = gain(0);
    noise().connect(mBp); mBp.connect(mAm); mAm.connect(murmur); murmur.connect(out);
    // 調理音: 高域のノイズ（ジュージュー）
    const zHp = c.createBiquadFilter(); zHp.type = 'highpass'; zHp.frequency.value = 3800;
    const zAm = gain(0.6);
    const zLfo = c.createOscillator(); zLfo.frequency.value = 7.3; const zLfoG = gain(0.25); zLfo.connect(zLfoG); zLfoG.connect(zAm.gain); zLfo.start();
    const sizzle = gain(0);
    noise().connect(zHp); zHp.connect(zAm); zAm.connect(sizzle); sizzle.connect(out);
    // エレベーターのモーター: のこぎり波＋サイン波をローパスに通す
    const motorOsc = c.createOscillator(); motorOsc.type = 'sawtooth'; motorOsc.frequency.value = 70;
    const motorOsc2 = c.createOscillator(); motorOsc2.type = 'sine'; motorOsc2.frequency.value = 140;
    const motorLp = c.createBiquadFilter(); motorLp.type = 'lowpass'; motorLp.frequency.value = 420; motorLp.Q.value = 2;
    const motor = gain(0);
    motorOsc.connect(motorLp); motorOsc2.connect(motorLp); motorLp.connect(motor); motor.connect(out);
    motorOsc.start(); motorOsc2.start();
    // ヘリのローター: 低域ノイズを 12Hz 前後で強く揺らす
    const rLp = c.createBiquadFilter(); rLp.type = 'lowpass'; rLp.frequency.value = 380;
    const rAm = gain(0.5);
    const rLfo = c.createOscillator(); rLfo.type = 'square'; rLfo.frequency.value = 12; const rLfoG = gain(0.5); rLfo.connect(rLfoG); rLfoG.connect(rAm.gain); rLfo.start();
    const rotor = gain(0);
    noise().connect(rLp); rLp.connect(rAm); rAm.connect(rotor); rotor.connect(out);
    // ごみ収集車のエンジン（低いうなり）
    const tOsc = c.createOscillator(); tOsc.type = 'sawtooth'; tOsc.frequency.value = 42;
    const tLp = c.createBiquadFilter(); tLp.type = 'lowpass'; tLp.frequency.value = 180; tLp.Q.value = 3;
    const tAm = gain(0.7);
    const tLfo = c.createOscillator(); tLfo.frequency.value = 9; const tLfoG = gain(0.25); tLfo.connect(tLfoG); tLfoG.connect(tAm.gain); tLfo.start();
    const truck = gain(0);
    tOsc.connect(tLp); tLp.connect(tAm); tAm.connect(truck); truck.connect(out); tOsc.start();
    this.n = { out, murmur, mBp, sizzle, motor, motorOsc, motorOsc2, motorLp, rotor, rLfo, truck, tOsc };
    return true;
  }

  set(param, v, tc = 0.25) {
    try { param.setTargetAtTime(v, this.s.ctx.currentTime, tc); } catch { /* */ }
  }

  silence() {
    const n = this.n;
    if (!n) return;
    for (const k of ['murmur', 'sizzle', 'motor', 'rotor', 'truck']) this.set(n[k].gain, 0, 0.15);
  }

  /** app から 8Hz ほどで呼ぶ */
  update(app) {
    const s = this.s;
    if (!s.ctx || s.ctx.state !== 'running' || s.muted) return;
    if (!this.ensure()) return;
    const sim = app.sim;
    const playing = this.enabled && app.started && !app.blocked() && app.effectiveSpeed() > 0 && !document.hidden;
    if (!playing || !sim) { this.silence(); return; }
    const now = performance.now();
    const dtReal = this.lastT ? Math.min(0.5, (now - this.lastT) / 1000) : 0.12;
    this.lastT = now;

    // 画面に映っている範囲（マスとフロア）
    const cam = app.cam;
    const x0 = cam.x / TILE_W, x1 = (cam.x + cam.vw / cam.zoom) / TILE_W;
    const fTop = -cam.y / FLOOR_H, fBot = -(cam.y + cam.vh / cam.zoom) / FLOOR_H;
    const vis = (o) => o.x + o.w > x0 && o.x < x1 && (o.f + (o.h || 1)) > fBot && o.f < fTop;
    // ズームアウトしすぎたら遠くの音として小さくする
    const near = clamp01((cam.zoom - 0.25) / 1.25) * 0.8 + 0.2;

    const h = sim.hour, wd = sim.weekday ?? sim.day % 7;
    const work = wd < 5 && h >= 8 && h < 18;
    let office = 0, food = 0, lobby = false, sumV = 0, maxRel = 0, works = 0, truck = null, cars = 0;
    for (const o of sim.objs.values()) {
      if (o.cars) {
        for (const car of o.cars) {
          const prev = this.prevCar.get(car);
          let v = typeof car.v === 'number' ? car.v : prev ? (car.pos - prev.pos) / Math.max(1e-3, dtReal) : 0;
          v = Math.abs(v);
          if (v > this.vmax) this.vmax = v;
          const onScreen = o.x + o.w > x0 && o.x < x1 && car.pos > fBot - 1 && car.pos < fTop + 1;
          if (onScreen) {
            sumV += v;
            maxRel = Math.max(maxRel, v / (this.vmax || 1));
            if (car.state === 'doors' && prev && prev.state !== 'doors' && now - this.lastChime > 350) {
              this.lastChime = now;
              this.chime(near);
            }
          }
          this.prevCar.set(car, { pos: car.pos, state: car.state });
        }
        if (Number.isFinite(o.constructUntil) && sim.time < o.constructUntil && o.x + o.w > x0 && o.x < x1) works++;
        continue;
      }
      if (o.destroyed || !vis(o)) continue;
      if (Number.isFinite(o.constructUntil) && sim.time < o.constructUntil) { works++; continue; }
      if (o.type === 'garbage' && o.truck && !truck) truck = o.truck;
      else if (o.type === 'parking') cars += o.used || 0;
      if (o.type === 'office' && work) office += o.inCount || (o.occupied ? 2 : 0);
      else if (FOOD.has(o.type) && (!sim.isOpen || sim.isOpen(o))) food += (o.inCount || 0) + 1;
      else if (o.type === 'lobby') lobby = true;
    }
    let crowd = 0;
    if (sim.active && lobby) {
      let seen = 0;
      for (const p of sim.active) { const f = p.f; if (f !== undefined && f < fTop && f > fBot) crowd++; if (crowd > 400 || ++seen > 3000) break; }
    }
    const n = this.n;
    // ざわめき（ロビー＋飲食店）
    const babble = crowd + food * 2;
    this.set(n.murmur.gain, Math.min(0.22, 0.018 * Math.sqrt(babble)) * near);
    this.set(n.mBp.frequency, 450 + Math.min(300, babble * 3));
    // 調理音
    this.set(n.sizzle.gain, food > 0 ? Math.min(0.05, 0.015 + food * 0.002) * near : 0);
    // モーター音: 速いほど高く・大きく
    const rel = clamp01(maxRel);
    this.set(n.motor.gain, sumV > 0.001 ? Math.min(0.1, 0.035 + 0.05 * Math.sqrt(sumV / (this.vmax || 1))) * near : 0, 0.15);
    this.set(n.motorOsc.frequency, 55 + 130 * rel, 0.12);
    this.set(n.motorOsc2.frequency, 110 + 260 * rel, 0.12);
    this.set(n.motorLp.frequency, 300 + 700 * rel, 0.12);
    // ヘリ
    const heli = sim.heli;
    if (heli && Number.isFinite(heli.x)) {
      const cx = cam.x + cam.vw / 2 / cam.zoom, cy = cam.y + cam.vh / 2 / cam.zoom;
      const dx = heli.x * TILE_W - cx, dy = -(heli.f ?? 0) * FLOOR_H - cy;
      const d = Math.hypot(dx, dy) * cam.zoom / Math.max(cam.vw, 1);
      this.set(n.rotor.gain, 0.22 * clamp01(1.4 - d), 0.2);
      this.set(n.rLfo.frequency, heli.phase === 'spray' ? 13 : 11.5, 0.3);
    } else this.set(n.rotor.gain, 0, 0.4);
    // 単発の音
    if (office > 0 && Math.random() < Math.min(0.85, office * 0.03)) this.typing(near, 1 + Math.floor(Math.random() * 3));
    if (office > 0 && Math.random() < Math.min(0.05, office * 0.0015)) this.phone(near);
    if (food > 0 && Math.random() < Math.min(0.5, food * 0.04)) this.voice(near);
    if (crowd > 0 && Math.random() < Math.min(0.4, crowd * 0.01)) this.voice(near * 0.8);
    // ごみ収集車: エンジン、バックの警告音（入ってくるとき）、積み込みの油圧音
    this.set(n.truck.gain, truck ? 0.09 * near : 0, 0.3);
    if (truck) {
      this.set(n.tOsc.frequency, truck.phase === 'load' ? 36 : 46, 0.4);
      if (truck.phase === 'in' && now - (this.lastBeep || 0) > 600) { this.lastBeep = now; this.tone(this.s.ctx.currentTime, 1040, 0.28, 0.03 * near, 'square'); }
      if (truck.phase === 'load' && Math.random() < 0.06) this.hydraulic(near);
      if (truck.phase === 'load' && Math.random() < 0.25) this.burst(this.s.ctx.currentTime + Math.random() * 0.1, 0.12, { type: 'lowpass', freq: 500, vol: 0.05 * near }); // 袋を放り込む音
    }
    // 駐車場: ときどきドアの閉まる音やエンジン始動
    if (cars > 0 && Math.random() < Math.min(0.08, cars * 0.004)) this.carSound(near);
    // 工事の音（トンカチ・ドリル）
    if (works > 0 && Math.random() < Math.min(0.7, 0.25 + works * 0.08)) this.hammer(near, 1 + Math.floor(Math.random() * 3));
    if (works > 0 && Math.random() < Math.min(0.12, 0.04 + works * 0.02)) this.drill(near);
  }

  // ---- 単発の合成音 ----
  burst(t, dur, o) {
    if (!this.s.canVoice()) return;
    const c = this.s.ctx;
    const src = c.createBufferSource();
    src.buffer = this.s.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.n.out);
    this.s.track(src, f, g);
    src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
  }

  tone(t, freq, dur, vol, type = 'sine') {
    if (!this.s.canVoice()) return;
    const c = this.s.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.n.out);
    this.s.track(o, g);
    o.start(t); o.stop(t + dur + 0.02);
  }

  typing(k, n) {
    const t0 = this.s.ctx.currentTime + Math.random() * 0.1;
    for (let i = 0; i < n; i++) this.burst(t0 + i * (0.06 + Math.random() * 0.07), 0.018, { type: 'highpass', freq: 2500 + Math.random() * 2500, vol: 0.035 * k });
  }

  phone(k) {
    const t0 = this.s.ctx.currentTime;
    for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) this.tone(t0 + r * 0.55 + i * 0.025, i % 2 ? 1320 : 1660, 0.03, 0.012 * k);
  }

  voice(k) {
    // 人の声っぽい短いフォルマント
    const t0 = this.s.ctx.currentTime + Math.random() * 0.1;
    const base = 300 + Math.random() * 700;
    this.burst(t0, 0.09 + Math.random() * 0.12, { freq: base, q: 6, vol: 0.05 * k, attack: 0.02 });
    if (Math.random() < 0.5) this.burst(t0 + 0.12, 0.08, { freq: base * 1.4, q: 6, vol: 0.035 * k, attack: 0.02 });
  }

  hammer(k, n) {
    const t0 = this.s.ctx.currentTime + Math.random() * 0.08;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.22 + Math.random() * 0.06);
      this.burst(t, 0.05, { type: 'lowpass', freq: 700, vol: 0.06 * k });
      this.burst(t, 0.03, { freq: 2600 + Math.random() * 800, q: 8, vol: 0.04 * k });
    }
  }

  drill(k) {
    if (!this.s.canVoice(2)) return;
    const c = this.s.ctx;
    const t = c.currentTime + Math.random() * 0.1;
    const dur = 0.5 + Math.random() * 0.5;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t); o.frequency.linearRampToValueAtTime(230, t + 0.12);
    const am = c.createOscillator(); am.frequency.value = 31; const amG = c.createGain(); amG.gain.value = 0.4; am.connect(amG);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * k, t + 0.05);
    g.gain.setValueAtTime(0.03 * k, t + dur - 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    amG.connect(g.gain);
    o.connect(f); f.connect(g); g.connect(this.n.out);
    this.s.track(o, f, g); this.s.track(am, amG);
    o.start(t); am.start(t); o.stop(t + dur + 0.02); am.stop(t + dur + 0.02);
  }

  hydraulic(k) {
    if (!this.s.canVoice()) return;
    const c = this.s.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.linearRampToValueAtTime(420, t + 0.9);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025 * k, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    o.connect(f); f.connect(g); g.connect(this.n.out);
    this.s.track(o, f, g);
    o.start(t); o.stop(t + 1.05);
  }

  carSound(k) {
    const t = this.s.ctx.currentTime + Math.random() * 0.2;
    if (Math.random() < 0.6) {
      this.burst(t, 0.08, { type: 'lowpass', freq: 350, vol: 0.06 * k }); // ドアの閉まる音
    } else {
      const c = this.s.ctx;
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(30, t); o.frequency.linearRampToValueAtTime(70, t + 0.4); o.frequency.linearRampToValueAtTime(55, t + 1.2);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04 * k, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      if (!this.s.canVoice()) return;
      o.connect(f); f.connect(g); g.connect(this.n.out); this.s.track(o, f, g); o.start(t); o.stop(t + 1.35);
    }
  }

  chime(k) {
    const t0 = this.s.ctx.currentTime;
    this.tone(t0, 1318.5, 0.5, 0.05 * k);
    this.tone(t0 + 0.16, 1046.5, 0.7, 0.045 * k);
  }
}
