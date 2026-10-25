// 全体図（ミニマップ）: 横に広い（W マス）建物全体と今見ている範囲を表示。タップ／ドラッグでその場所へ移動。
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F } from '../sim/constants.js';

export class Minimap {
  constructor(app) {
    this.app = app;
    const wrap = document.createElement('div');
    wrap.id = 'minimap';
    wrap.className = 'frame';
    wrap.title = '全体図（タップでその場所へ移動）';
    const c = document.createElement('canvas');
    wrap.append(c);
    document.getElementById('app').append(wrap);
    this.wrap = wrap;
    this.c = c;
    this.base = document.createElement('canvas');
    this.baseT = 0;
    this.dragging = false;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.userGesture();
      this.dragging = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* */ }
      this.jump(e);
    });
    c.addEventListener('pointermove', (e) => { if (this.dragging) this.jump(e); });
    c.addEventListener('pointerup', () => { this.dragging = false; });
    c.addEventListener('pointercancel', () => { this.dragging = false; });
    c.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  /** 大きさは画面サイズが変わったときだけ測る（毎フレーム getBoundingClientRect しない） */
  measure() {
    const r = this.c.getBoundingClientRect();
    this.sz = [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))];
    this.baseT = 0;
  }

  size() {
    if (!this.sz || this.sz[0] <= 1) this.measure();
    return this.sz;
  }

  /** 表示するフロアの範囲（建物の高さに合わせて縦を詰める） */
  range() {
    const top = Math.max(15, Math.min(MAX_F, (this.maxF ?? 0) + 6));
    const floorMin = this.app.sim && Number.isFinite(this.app.sim.minFloor) ? Math.max(MIN_F, this.app.sim.minFloor) : MIN_F;
    const bot = Math.min(-1, Math.max(floorMin - 1, (this.minF ?? 0) - 2));
    return [bot, top];
  }

  rebuild() {
    const sim = this.app.sim;
    if (!sim || !sim.grid) return;
    const [cw, ch] = this.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const b = this.base;
    // 大きさが変わったときだけ確保し直す（毎回 width を代入するとメモリを取り直してしまう）
    if (b.width !== cw * dpr || b.height !== ch * dpr) { b.width = cw * dpr; b.height = ch * dpr; }
    const g = b.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, b.width, b.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 各列の最上階・最下階
    const tops = new Int16Array(W).fill(-999), bots = new Int16Array(W).fill(999);
    let maxF = 0, minF = 0;
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = sim.grid[f];
      if (!row) continue;
      for (let x = 0; x < W; x++) if (row[x] !== 0) { if (f > tops[x]) tops[x] = f; if (f < bots[x]) bots[x] = f; if (f > maxF) maxF = f; if (f < minF) minF = f; }
    }
    this.maxF = maxF; this.minF = minF;
    const [fb, ft] = this.range();
    const fy = (f) => ((ft + 1 - f) / (ft + 1 - fb)) * ch;
    const sky = g.createLinearGradient(0, 0, 0, fy(0));
    sky.addColorStop(0, '#2a3f8f'); sky.addColorStop(1, '#7fb3e6');
    g.fillStyle = sky; g.fillRect(0, 0, cw, fy(0));
    g.fillStyle = '#6b4a2b'; g.fillRect(0, fy(0), cw, ch - fy(0));
    g.fillStyle = '#4c8f3a'; g.fillRect(0, fy(0), cw, 1);
    const colW = cw / W;
    g.fillStyle = '#d8d2c2';
    for (let x = 0; x < W; x++) {
      if (tops[x] >= 0) g.fillRect(x * colW, fy(tops[x] + 1), Math.max(1, colW), fy(0) - fy(tops[x] + 1));
      if (bots[x] < 0) g.fillRect(x * colW, fy(0), Math.max(1, colW), fy(bots[x]) - fy(0));
    }
    // 移動手段（エレベーター）を細い線で
    g.fillStyle = '#333';
    for (const o of sim.objs.values()) if (o.cars) g.fillRect((o.x + o.w / 2) * colW - 0.5, fy(o.hi + 1), 1, fy(o.lo) - fy(o.hi + 1));
  }

  draw(now) {
    if (this.wrap.hidden || this.wrap.offsetParent === null) return;
    const [cw, ch] = this.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.c.width !== cw * dpr || this.c.height !== ch * dpr) { this.c.width = cw * dpr; this.c.height = ch * dpr; this.baseT = 0; }
    // 下絵は建物が変わったとき（sim.revision）だけ作り直す。revision が無い sim では 3 秒ごと
    const sim = this.app.sim;
    const rev = sim && typeof sim.revision === 'number' ? sim.revision : null;
    if (!this.baseT || (rev !== null ? rev !== this.rev && now - this.baseT > 500 : now - this.baseT > 3000) || sim !== this.lastSim) {
      this.baseT = now; this.rev = rev; this.lastSim = sim; this.rebuild();
    }
    if (now - (this.drawT || 0) < 100) return; // 枠の描き直しは 10fps で十分
    this.drawT = now;
    const g = this.c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.c.width, this.c.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = this.app.cam;
    const [fb, ft] = this.range();
    const sx = (wx) => (wx / (W * TILE_W)) * cw;
    const sy = (wy) => ((ft + 1 + wy / FLOOR_H) / (ft + 1 - fb)) * ch;
    const x0 = sx(cam.x), x1 = sx(cam.x + cam.vw / cam.zoom);
    const y0 = sy(cam.y + cam.insetTop / cam.zoom), y1 = sy(cam.y + (cam.vh - cam.insetBottom) / cam.zoom);
    g.strokeStyle = '#ffd34d'; g.lineWidth = 1.5;
    g.strokeRect(Math.round(x0) + 0.5, Math.max(0.5, Math.round(y0) + 0.5), Math.max(3, x1 - x0), Math.max(3, Math.min(ch - 1, y1) - Math.max(0, y0)));
  }

  jump(e) {
    const r = this.c.getBoundingClientRect();
    this.measure();
    const [cw, ch] = this.size();
    const [fb, ft] = this.range();
    const px = (e.clientX - r.left) / cw, py = (e.clientY - r.top) / ch;
    const wx = px * W * TILE_W;
    const f = ft + 1 - py * (ft + 1 - fb);
    const cam = this.app.cam;
    cam.anim = null;
    cam.x = wx - cam.vw / 2 / cam.zoom;
    const usable = cam.vh - cam.insetTop - cam.insetBottom;
    cam.y = -f * FLOOR_H - (cam.insetTop + usable / 2) / cam.zoom;
    cam.clamp();
  }
}
