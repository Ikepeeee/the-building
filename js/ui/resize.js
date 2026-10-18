// エレベーターの伸縮: 選択中のシャフトの上下に出すハンドル、または「調べる」でシャフトの端をドラッグ
// sim.check / sim.build('resizeElevator', {id, lo, hi})
import { TILE_W, FLOOR_H, MIN_F, MAX_F, screenToWorld, worldToCell } from '../sim/constants.js';

const EDGE = 4;

export class ElevatorResize {
  constructor(app) {
    this.app = app;
    this.active = null;
    this.handles = {};
    for (const end of ['top', 'bot']) {
      const b = document.createElement('button');
      b.className = `rs-handle rs-${end}`;
      b.textContent = end === 'top' ? '▲' : '▼';
      b.title = end === 'top' ? 'ドラッグして上に伸ばす・縮める' : 'ドラッグして下に伸ばす・縮める';
      b.setAttribute('aria-label', b.title);
      b.hidden = true;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        app.userGesture();
        const o = this.target();
        if (!o) return;
        try { b.setPointerCapture(e.pointerId); } catch { /* */ }
        this.start(o, end, e.clientX, e.clientY);
      });
      b.addEventListener('pointermove', (e) => { if (this.active) this.move(e.clientX, e.clientY); });
      b.addEventListener('pointerup', () => this.end());
      b.addEventListener('pointercancel', () => this.cancel());
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      document.getElementById('app').append(b);
      this.handles[end] = b;
    }
  }

  get supported() { return true; }

  /** ハンドルを出す対象: 調べるツールで選択中のエレベーター */
  target() {
    const app = this.app;
    if (!app.started || app.tool !== 'inspect' || app.selectedId == null || !app.sim) return null;
    const o = app.sim.objs.get(app.selectedId);
    return o && o.cars && o.lo != null ? o : null;
  }

  /** 調べるツールでシャフトの端（最上階・機械室／最下階・ピット）を掴んだか */
  hitEnd(cell) {
    const sim = this.app.sim;
    if (!sim || !cell) return null;
    let o = null;
    try { o = sim.transportAt ? sim.transportAt(cell.f, cell.x) : sim.objAt(cell.f, cell.x); } catch { o = null; }
    if (!o || !o.cars || o.lo == null) return null;
    if (cell.f >= o.hi) return { o, end: 'top' };
    if (cell.f <= o.lo) return { o, end: 'bot' };
    return null;
  }

  cellAtClient(cx, cy) {
    const app = this.app;
    const r = app.canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(app.cam, cx - r.left, cy - r.top);
    return worldToCell(wx, wy);
  }

  worldYAt(cy) {
    const app = this.app;
    const r = app.canvas.getBoundingClientRect();
    return (cy - r.top) / app.cam.zoom + app.cam.y;
  }

  start(o, end, cx, cy) {
    // 動かした量で伸縮する（つまみが画面の端に寄せて表示されていても、押した瞬間に範囲が飛ばない）
    this.active = { id: o.id, type: o.type, end, lo: o.lo, hi: o.hi, lo0: o.lo, hi0: o.hi, cx, cy, wy0: this.worldYAt(cy) };
    this.app.hoverGhost = null;
    this.update();
  }

  move(cx, cy) {
    const a = this.active;
    if (!a) return;
    a.cx = cx; a.cy = cy;
    const d = Math.round(-(this.worldYAt(cy) - a.wy0) / FLOOR_H);
    if (a.end === 'top') a.hi = Math.max(a.lo, Math.min(MAX_F, a.hi0 + d));
    else a.lo = Math.min(a.hi, Math.max(MIN_F, a.lo0 + d));
    this.preview();
  }

  preview() {
    const a = this.active;
    if (!a) return;
    if (a.lo === a.lo0 && a.hi === a.hi0) { this.app.dragGhost = null; return; }
    this.app.dragGhost = this.app.evalGhost('resizeElevator', { id: a.id, lo: a.lo, hi: a.hi }, a.type);
  }

  end() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.app.dragGhost = null;
    if (a.lo !== a.lo0 || a.hi !== a.hi0) this.app.doBuild('resizeElevator', { id: a.id, lo: a.lo, hi: a.hi });
  }

  cancel() {
    if (!this.active) return;
    this.active = null;
    this.app.dragGhost = null;
  }

  /** 毎フレーム: ハンドルの位置合わせと、端に近いときの自動スクロール */
  frame(dt) {
    const a = this.active;
    const cam = this.app.cam;
    if (a) {
      const r = this.app.canvas.getBoundingClientRect();
      const sy = a.cy - r.top;
      let vy = 0;
      // 指（カーソル）が HUD やツールバーの上まで来たら自動でスクロール
      if (sy < cam.insetTop + EDGE) vy = 1;
      else if (sy > cam.vh - cam.insetBottom - EDGE) vy = -1;
      if (vy) { cam.pan(0, vy * 300 * dt); this.move(a.cx, a.cy); }
    }
    this.update();
  }

  measure() {
    this.rects = { r: this.app.canvas.getBoundingClientRect(), root: this.app.root.getBoundingClientRect() };
  }

  update() {
    const o = this.target();
    const show = !!o && !this.app.blocked();
    if (!show && this.handles.top.hidden && this.handles.bot.hidden) return; // 何も出していなければ何もしない
    const cam = this.app.cam;
    if (!this.rects) this.measure();
    const { r, root } = this.rects;
    // つまみを置ける縦の範囲（HUD の下〜ツールバー・ボトムシートの上）
    const pEl = this.app.panel.el;
    let bottomLimit = r.top - root.top + r.height - cam.insetBottom - 20;
    if (show && !pEl.hidden && pEl.offsetWidth > r.width * 0.7) bottomLimit = Math.min(bottomLimit, pEl.offsetTop - 22);
    const topLimit = r.top - root.top + cam.insetTop + 22;
    for (const end of ['top', 'bot']) {
      const b = this.handles[end];
      if (!show) { if (!b.hidden) b.hidden = true; continue; }
      const lo = this.active && this.active.id === o.id ? this.active.lo : o.lo;
      const hi = this.active && this.active.id === o.id ? this.active.hi : o.hi;
      const wx = (o.x + o.w / 2) * TILE_W;
      // 上は機械室の上端、下はピットの下端の外側
      const wy = end === 'top' ? -(hi + 2) * FLOOR_H : -(lo - 1) * FLOOR_H;
      const sx = (wx - cam.x) * cam.zoom + r.left - root.left;
      let sy = (wy - cam.y) * cam.zoom + r.top - root.top + (end === 'top' ? -18 : 18);
      // 画面外なら端に寄せて表示する（矢印の向きで方向がわかる）
      const pinned = sy < topLimit || sy > bottomLimit;
      sy = Math.max(topLimit, Math.min(bottomLimit, sy));
      const visible = sx > 0 && sx < r.width + (r.left - root.left) && topLimit < bottomLimit;
      b.hidden = !visible && !(this.active && this.active.end === end);
      b.classList.toggle('is-pinned', pinned);
      b.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -50%)`;
      b.classList.toggle('is-active', !!(this.active && this.active.end === end));
    }
  }
}
