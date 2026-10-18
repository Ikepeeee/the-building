// 性能: 計測オーバーレイ（F3 / メニュー）と、重いときに描画解像度を下げる自動調整
import { SAVE_KEY } from '../sim/constants.js';
import { storage } from './save.js';

const KEY = SAVE_KEY + '.perf';
const ema = (a, v, k = 0.1) => (a == null ? v : a + (v - a) * k);

export class Perf {
  constructor(app) {
    this.app = app;
    this.frameMs = null; this.simMs = null; this.renderMs = null; this.uiMs = null;
    this.fps = 0; this.frames = 0; this.fpsT = 0;
    this.native = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    this.dpr = this.native;
    this.slowSince = 0; this.fastSince = 0;
    let st = {};
    try { st = JSON.parse(storage.get(KEY) || '{}') || {}; } catch { st = {}; }
    this.adaptive = st.adaptive !== false;
    const el = document.createElement('div');
    el.id = 'perf';
    el.hidden = !st.show;
    el.setAttribute('aria-hidden', 'true');
    document.getElementById('app').append(el);
    this.el = el;
    this.drawT = 0;
  }

  get visible() { return !this.el.hidden; }

  persist() { storage.set(KEY, JSON.stringify({ show: this.visible, adaptive: this.adaptive })); }

  toggle() {
    this.el.hidden = !this.el.hidden;
    this.persist();
    this.update(performance.now(), true);
  }

  setAdaptive(on) {
    this.adaptive = !!on;
    if (!on && this.dpr !== this.native) this.applyDpr(this.native);
    this.persist();
  }

  /** 1フレームの計測値を受け取る */
  record(now, dtMs, simMs, renderMs, uiMs) {
    if (dtMs > 0 && dtMs < 1000) this.frameMs = ema(this.frameMs, dtMs);
    this.simMs = ema(this.simMs, simMs);
    this.renderMs = ema(this.renderMs, renderMs);
    this.uiMs = ema(this.uiMs, uiMs);
    this.frames++;
    if (now - this.fpsT >= 1000) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsT)); this.frames = 0; this.fpsT = now; }
    this.adapt(now);
    if (this.visible && now - this.drawT > 250) this.update(now);
  }

  /** フレームが重い状態が続いたら DPR を 0.5 ずつ下げ、軽くなったら戻す */
  adapt(now) {
    if (!this.adaptive || !this.app.started || document.hidden) { this.slowSince = this.fastSince = 0; return; }
    const work = (this.simMs || 0) + (this.renderMs || 0) + (this.uiMs || 0);
    const slow = (this.frameMs || 0) > 20 && work > 12; // vsync 待ちだけで遅いときは下げない
    const fast = (this.frameMs || 0) < 14 && work < 7;
    if (slow) { this.fastSince = 0; this.slowSince ||= now; } else this.slowSince = 0;
    if (fast) { this.fastSince ||= now; } else this.fastSince = 0;
    if (this.slowSince && now - this.slowSince > 2000 && this.dpr > 1) {
      this.applyDpr(Math.max(1, this.dpr - 0.5));
      this.slowSince = now;
    } else if (this.fastSince && now - this.fastSince > 6000 && this.dpr < this.native) {
      this.applyDpr(Math.min(this.native, this.dpr + 0.5));
      this.fastSince = now;
    }
  }

  applyDpr(d) {
    this.dpr = d;
    this.app.layoutNow && this.app.layoutNow();
  }

  /** renderer.resize を、指定した DPR で呼ぶ（renderer が第3引数に対応していなくても効くように一時的に上書き） */
  resizeRenderer(renderer, w, h) {
    const d = this.dpr;
    if (d === this.native) { renderer.resize(w, h, d); return; }
    const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    let patched = false;
    try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => d }); patched = true; } catch { /* 上書きできない環境 */ }
    try { renderer.resize(w, h, d); } finally {
      if (patched) {
        try { if (own) Object.defineProperty(window, 'devicePixelRatio', own); else delete window.devicePixelRatio; } catch { /* */ }
      }
    }
  }

  update(now, force) {
    if (!this.visible) return;
    this.drawT = now;
    const s = this.app.sim;
    const f = (v) => (v == null ? '-' : v.toFixed(1));
    const people = s && s.active ? s.active.size : 0;
    const objs = s && s.objs ? s.objs.size : 0;
    const st = this.app.renderer && this.app.renderer.stats;
    this.el.textContent =
      `FPS ${this.fps}  frame ${f(this.frameMs)}ms\n` +
      `sim ${f(this.simMs)}  render ${f(this.renderMs)}  ui ${f(this.uiMs)} ms\n` +
      `人 ${people}  施設 ${objs}${st && st.objs != null ? `  描画 ${st.objs}/${st.people ?? '-'}` : ''}\n` +
      `解像度 ×${this.dpr}${this.dpr < this.native ? `（自動で下げ中 / 最大 ×${this.native}）` : ''}${this.adaptive ? '' : ' 自動調整オフ'}`;
    void force;
  }
}
