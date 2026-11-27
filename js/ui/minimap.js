// 全体図（ミニマップ）: 横に広い（W マス）建物全体と今見ている範囲を表示。タップ／ドラッグでその場所へ移動。
// 縦の表示範囲は「建物」と「いま映っている範囲」の両方を含めるので、見ている枠が途中で切れない。
// 右上の ▾ で小さな 🗺 ボタンにたためる（設定は保存）。
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F, SAVE_KEY } from '../sim/constants.js';
import { storage } from './save.js';

const PREF = SAVE_KEY + '.minimap';
const STEP = 5; // 縦の範囲は 5 フロア単位で切り替える（描き直しを減らす）

export class Minimap {
  constructor(app) {
    this.app = app;
    const wrap = document.createElement('div');
    wrap.id = 'minimap';
    wrap.className = 'frame';
    wrap.title = '全体図（タップでその場所へ移動）';
    const c = document.createElement('canvas');
    const hide = document.createElement('button');
    hide.className = 'mm-hide';
    hide.type = 'button';
    hide.title = '全体図をしまう';
    hide.textContent = '▾';
    wrap.append(c, hide);
    const show = document.createElement('button');
    show.id = 'minimap-show';
    show.type = 'button';
    show.className = 'btn';
    show.title = '全体図を出す';
    show.textContent = '🗺';
    const root = document.getElementById('app');
    root.append(wrap, show);
    this.wrap = wrap;
    this.c = c;
    this.showBtn = show;
    this.base = document.createElement('canvas');
    this.baseT = 0;
    this.dragging = false;
    this.rangeUsed = null;

    let collapsed = false;
    try { collapsed = storage.get(PREF) === 'hidden'; } catch { collapsed = false; }
    this.setCollapsed(collapsed);
    hide.addEventListener('click', (e) => { e.stopPropagation(); app.userGesture && app.userGesture(); this.setCollapsed(true); });
    show.addEventListener('click', (e) => { e.stopPropagation(); app.userGesture && app.userGesture(); this.setCollapsed(false); });

    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.userGesture && app.userGesture();
      this.dragging = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* */ }
      this.jump(e);
    });
    c.addEventListener('pointermove', (e) => { if (this.dragging) this.jump(e); });
    c.addEventListener('pointerup', () => { this.dragging = false; });
    c.addEventListener('pointercancel', () => { this.dragging = false; });
    c.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

    // 大きさは要素の大きさが変わったときに測る（全画面切り替え・回転・レイアウト変更に追従）
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(c);
    }
  }

  setCollapsed(v) {
    this.collapsed = !!v;
    this.wrap.classList.toggle('mm-collapsed', this.collapsed);
    document.getElementById('app').classList.toggle('mm-off', this.collapsed);
    try { storage.set(PREF, this.collapsed ? 'hidden' : 'shown'); } catch { /* */ }
    if (!this.collapsed) { this.measure(); this.baseT = 0; }
  }

  toggle() { this.setCollapsed(!this.collapsed); }

  measure() {
    const r = this.c.getBoundingClientRect();
    this.sz = [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))];
    this.baseT = 0;
  }

  size() {
    if (!this.sz || this.sz[0] <= 1) this.measure();
    return this.sz;
  }

  /** いまカメラに映っているフロアの範囲 [下, 上] */
  viewFloors() {
    const cam = this.app.cam;
    if (!cam || !cam.zoom) return null;
    const top = -(cam.y + cam.insetTop / cam.zoom) / FLOOR_H;               // 画面上端のフロア位置
    const bot = -(cam.y + (cam.vh - cam.insetBottom) / cam.zoom) / FLOOR_H; // 画面下端
    return [bot, top];
  }

  /** 表示するフロアの範囲。建物と、いま見ている範囲の両方を含める（5 フロア単位） */
  wantedRange() {
    const sim = this.app.sim;
    const floorMin = sim && Number.isFinite(sim.minFloor) ? Math.max(MIN_F, sim.minFloor) : MIN_F;
    let top = Math.max(15, (this.maxF ?? 0) + 6);
    let bot = Math.min(-1, (this.minF ?? 0) - 2);
    const v = this.viewFloors();
    if (v) { top = Math.max(top, Math.ceil(v[1])); bot = Math.min(bot, Math.floor(v[0])); }
    top = Math.min(MAX_F + 4, Math.ceil(top / STEP) * STEP);
    bot = Math.max(floorMin - 2, Math.floor(bot / STEP) * STEP);
    return [bot, top];
  }

  range() { return this.rangeUsed || this.wantedRange(); }

  scanBuilding() {
    const sim = this.app.sim;
    const tops = new Int16Array(W).fill(-999), bots = new Int16Array(W).fill(999);
    let maxF = 0, minF = 0;
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = sim.grid[f];
      if (!row) continue;
      for (let x = 0; x < W; x++) if (row[x] !== 0) { if (f > tops[x]) tops[x] = f; if (f < bots[x]) bots[x] = f; if (f > maxF) maxF = f; if (f < minF) minF = f; }
    }
    this.maxF = maxF; this.minF = minF;
    this.cols = { tops, bots };
  }

  rebuild(range) {
    const sim = this.app.sim;
    if (!sim || !sim.grid || !this.cols) return;
    const [cw, ch] = this.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const b = this.base;
    if (b.width !== cw * dpr || b.height !== ch * dpr) { b.width = cw * dpr; b.height = ch * dpr; }
    const g = b.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, b.width, b.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rangeUsed = range;
    const [fb, ft] = range;
    const fy = (f) => ((ft + 1 - f) / (ft + 1 - fb)) * ch;
    const g0 = Math.max(0, Math.min(ch, fy(0)));
    const sky = g.createLinearGradient(0, 0, 0, Math.max(1, g0));
    sky.addColorStop(0, '#2a3f8f'); sky.addColorStop(1, '#7fb3e6');
    g.fillStyle = sky; g.fillRect(0, 0, cw, g0);
    g.fillStyle = sim.theme === 'seaside' ? '#c9a66b' : '#6b4a2b'; g.fillRect(0, g0, cw, ch - g0);
    g.fillStyle = '#4c8f3a'; g.fillRect(0, g0, cw, 1);
    const { tops, bots } = this.cols;
    const colW = cw / W;
    g.fillStyle = '#d8d2c2';
    for (let x = 0; x < W; x++) {
      if (tops[x] >= 0) g.fillRect(x * colW, fy(tops[x] + 1), Math.max(1, colW), fy(0) - fy(tops[x] + 1));
      if (bots[x] < 0) g.fillRect(x * colW, fy(0), Math.max(1, colW), fy(bots[x]) - fy(0));
    }
    g.fillStyle = '#333';
    for (const o of sim.objs.values()) if (o.cars) g.fillRect((o.x + o.w / 2) * colW - 0.5, fy(o.hi + 1), 1, fy(o.lo) - fy(o.hi + 1));
  }

  draw(now) {
    if (this.collapsed || this.wrap.hidden || this.wrap.offsetParent === null) return;
    const [cw, ch] = this.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.c.width !== cw * dpr || this.c.height !== ch * dpr) { this.c.width = cw * dpr; this.c.height = ch * dpr; this.baseT = 0; }
    const sim = this.app.sim;
    const rev = sim && typeof sim.revision === 'number' ? sim.revision : null;
    // 建物の形は sim.revision が変わったときだけ数え直す（revision が無い sim では 3 秒ごと）
    const structChanged = !this.baseT || sim !== this.lastSim || (rev !== null ? rev !== this.rev && now - this.baseT > 500 : now - this.baseT > 3000);
    if (structChanged && sim && sim.grid) { this.rev = rev; this.lastSim = sim; this.scanBuilding(); }
    const want = this.wantedRange();
    const used = this.rangeUsed;
    // ドラッグ中は縦の範囲を固定する（範囲が変わると指の位置と移動先がずれるため）
    const rangeChanged = !used || (!this.dragging && (used[0] !== want[0] || used[1] !== want[1]));
    if (structChanged || rangeChanged || this.baseSz !== cw + 'x' + ch) {
      this.baseT = now; this.baseSz = cw + 'x' + ch;
      this.rebuild(this.dragging && used ? used : want);
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
    // いま見ている範囲（上下のバー・ツールバーに隠れている分を除く）
    const x0 = sx(cam.x), x1 = sx(cam.x + cam.vw / cam.zoom);
    const y0 = sy(cam.y + cam.insetTop / cam.zoom), y1 = sy(cam.y + (cam.vh - cam.insetBottom) / cam.zoom);
    const L = Math.max(0, x0), R = Math.min(cw, x1), T = Math.max(0, y0), B = Math.min(ch, y1);
    if (R - L < 1 || B - T < 1) return;
    g.fillStyle = 'rgba(255, 211, 77, 0.14)';
    g.fillRect(L, T, R - L, B - T);
    g.strokeStyle = '#ffd34d'; g.lineWidth = 1.5;
    g.strokeRect(L + 0.75, T + 0.75, Math.max(2, R - L - 1.5), Math.max(2, B - T - 1.5));
  }

  jump(e) {
    const r = this.c.getBoundingClientRect();
    const cw = Math.max(1, r.width), ch = Math.max(1, r.height);
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
