// 入力（Pointer Events でマウス・タッチ・ペンをまとめて扱う＋キーボード）
import { screenToWorld, worldToCell, TYPES } from '../sim/constants.js';
import { SPEED_ONE, SPEED_RT } from './speeds.js';

const SLOP_MOUSE = 5;
const SLOP_TOUCH = 10;
const KEY_PAN_SPEED = 700; // CSS px / 秒
const EDGE = 40; // ドラッグ建設中の自動スクロール領域（px）

export const isDragTool = (tool) => tool === 'bulldoze' || !!(TYPES[tool] && TYPES[tool].drag);

const TOOL_KEYS = {
  KeyF: 'floor', KeyL: 'lobby', KeyT: 'stairs', KeyE: 'elevator', KeyX: 'express', KeyO: 'office',
  KeyC: 'condo', KeyH: 'hotelSingle', KeyR: 'restaurant', KeyB: 'bulldoze', KeyI: 'inspect',
};
const PAN_KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};

export class Input {
  constructor(app) {
    this.app = app;
    this.canvas = app.canvas;
    this.ptrs = new Map();
    this.mode = null; // 'tap' | 'pan' | 'drag' | 'pinch'
    this.drag = null;
    this.pinch = null;
    this.space = false;
    this.spaceUsed = false;
    this.keys = new Set();
    this.wheelSnapTimer = 0;
    this.lastWheelStep = 0;
    this.lastType = 'mouse';

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e, false));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.ptrs.size) app.hoverAt(null); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // iOS Safari のダブルタップ拡大・スクロールを防ぐ
    c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    c.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.space = false; this.updateCursor(); });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  cellAt(sx, sy) {
    const [wx, wy] = screenToWorld(this.app.cam, sx, sy);
    return worldToCell(wx, wy);
  }

  get busy() { return this.mode !== null; }

  updateCursor() {
    const c = this.canvas;
    const tool = this.app.tool;
    c.classList.toggle('c-panning', this.mode === 'pan');
    c.classList.toggle('c-pan', this.space && this.mode !== 'pan');
    const idle = !this.space && this.mode !== 'pan';
    c.classList.toggle('c-inspect', idle && tool === 'inspect');
    c.classList.toggle('c-bulldoze', idle && tool === 'bulldoze');
    c.classList.toggle('c-copy', idle && tool === 'copy');
    c.classList.toggle('c-build', idle && tool !== 'inspect' && tool !== 'bulldoze' && tool !== 'copy');
  }

  onDown(e) {
    this.app.userGesture();
    if (this.app.blocked()) return;
    const [sx, sy] = this.local(e);
    const touch = e.pointerType !== 'mouse';
    this.lastType = e.pointerType;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    this.ptrs.set(e.pointerId, { x: sx, y: sy, x0: sx, y0: sy, type: e.pointerType });
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();

    if (touch && this.ptrs.size === 2) { this.startPinch(); return; }
    if (this.ptrs.size > 1) return;

    if (!touch && (e.button === 1 || e.button === 2 || (e.button === 0 && this.space))) {
      e.preventDefault();
      if (this.space) this.spaceUsed = true;
      this.mode = 'pan';
      this.updateCursor();
      return;
    }
    if (!touch && e.button !== 0) return;

    const tool = this.app.tool;
    this.resizeCand = null;
    if (tool !== 'inspect' && this.app.toolIsDrag(tool)) {
      const cell = this.cellAt(sx, sy);
      this.mode = 'drag';
      this.drag = { tool, start: cell, cur: cell, touch, sx, sy };
      this.app.dragUpdate(this.drag);
      return;
    }
    // タッチの施設設置・コピー貼り付け: 指を滑らせて位置合わせ
    // （仮置きがあってそこから遠いところで始めたドラッグはスクロール、タップならそこへ置き直す）
    if (touch && this.app.placeTool() && !(this.app.pending && !this.app.pendingHit(sx, sy))) {
      this.mode = 'place';
      this.placePt = { x: sx, y: sy, x0: sx, y0: sy };
      this.app.placeStart(sx, sy);
      return;
    }
    this.mode = 'tap';
    // マウスの「調べる」でシャフトの端を掴んだら、動かしたときに伸縮を始める
    if (!touch && tool === 'inspect') this.resizeCand = this.app.resize.hitEnd(this.app.clampCell(this.cellAt(sx, sy)));
  }

  onMove(e) {
    const [sx, sy] = this.local(e);
    if (e.pointerType === 'mouse') this.app.noSnap = !!e.shiftKey;
    const pt = this.ptrs.get(e.pointerId);
    if (e.pointerType === 'mouse') this.app.hoverAt(this.mode === 'pan' ? null : this.cellAt(sx, sy), this.mode === 'drag');
    if (!pt) return;
    const dx = sx - pt.x, dy = sy - pt.y;
    pt.x = sx; pt.y = sy;
    switch (this.mode) {
      case 'pinch':
        this.updatePinch();
        break;
      case 'tap': {
        const slop = pt.type === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH;
        if (Math.hypot(sx - pt.x0, sy - pt.y0) > slop && this.resizeCand) {
          this.mode = 'resize';
          this.app.resize.start(this.resizeCand.o, this.resizeCand.end, e.clientX, e.clientY);
          this.app.resize.move(e.clientX, e.clientY);
          this.resizeCand = null;
        } else if (Math.hypot(sx - pt.x0, sy - pt.y0) > slop) {
          this.mode = 'pan';
          this.app.cam.pan(sx - pt.x0, sy - pt.y0);
          this.updateCursor();
        }
        break;
      }
      case 'pan':
        this.app.cam.pan(dx, dy);
        break;
      case 'resize':
        this.app.resize.move(e.clientX, e.clientY);
        break;
      case 'place': {
        const pp = this.placePt;
        pp.x = sx; pp.y = sy;
        this.app.placeMove(sx, sy, Math.hypot(sx - pp.x0, sy - pp.y0) > SLOP_TOUCH);
        break;
      }
      case 'drag':
        this.drag.sx = sx; this.drag.sy = sy; this.drag.moved = true;
        this.drag.cur = this.cellAt(sx, sy);
        this.app.dragUpdate(this.drag);
        break;
    }
  }

  /** 押している最中の操作をすべて取り消す（モーダルが開いたときなど） */
  cancelAll() {
    for (const id of this.ptrs.keys()) { try { this.canvas.releasePointerCapture(id); } catch { /* */ } }
    this.ptrs.clear();
    if (this.mode === 'drag') this.app.dragCancel();
    this.app.resize.cancel();
    this.app.placeCancel();
    this.resizeCand = null;
    this.mode = null;
    this.drag = null;
    this.pinch = null;
    this.space = false;
    this.keys.clear();
    this.updateCursor();
  }

  onUp(e, cancelled) {
    const pt = this.ptrs.get(e.pointerId);
    if (!pt) return;
    this.ptrs.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (this.app.blocked()) { this.cancelAll(); return; }
    if (this.mode === 'pinch') {
      if (this.ptrs.size < 2) {
        const p = this.pinch;
        this.app.cam.animateZoom(this.app.cam.nearestStep(), p.mx, p.my);
        this.pinch = null;
        if (this.ptrs.size === 1) {
          this.mode = 'pan';
        } else {
          this.mode = null;
        }
      }
      return;
    }
    if (this.ptrs.size > 0) return;
    const mode = this.mode;
    this.mode = null;
    this.updateCursor();
    if (cancelled) {
      if (mode === 'drag') this.app.dragCancel();
      if (mode === 'resize') this.app.resize.cancel();
      if (mode === 'place') this.app.placeCancel();
      this.drag = null;
      return;
    }
    if (mode === 'place') {
      this.app.placeEnd();
    } else if (mode === 'tap' && pt.type !== 'mouse' && this.app.placeTool()) {
      // 仮置きから離れた場所をタップ → そこ（指の少し上）へ置き直す
      this.app.placeStart(pt.x, pt.y, true);
      this.app.placeEnd();
    } else if (mode === 'tap') {
      this.app.tapAt(this.cellAt(pt.x, pt.y), pt.type !== 'mouse');
    } else if (mode === 'drag') {
      this.app.dragEnd(this.drag);
    } else if (mode === 'resize') {
      this.app.resize.end();
    }
    this.drag = null;
  }

  startPinch() {
    if (this.mode === 'drag') { this.app.dragCancel(); this.drag = null; }
    if (this.mode === 'place') this.app.placeCancel();
    const [a, b] = [...this.ptrs.values()];
    const cam = this.app.cam;
    cam.anim = null;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.pinch = {
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: cam.zoom,
      wx: mx / cam.zoom + cam.x, wy: my / cam.zoom + cam.y, mx, my,
    };
    this.mode = 'pinch';
  }

  updatePinch() {
    const pts = [...this.ptrs.values()];
    if (pts.length < 2 || !this.pinch) return;
    const [a, b] = pts;
    const p = this.pinch;
    const cam = this.app.cam;
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z = Math.min(4, Math.max(0.25, p.z0 * d / p.d0));
    cam.zoom = z;
    cam.x = p.wx - mx / z;
    cam.y = p.wy - my / z;
    cam.clamp();
    p.mx = mx; p.my = my;
  }

  onWheel(e) {
    e.preventDefault();
    if (this.app.blocked()) return;
    const [sx, sy] = this.local(e);
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.app.cam.vh : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    const cam = this.app.cam;
    if (e.ctrlKey || e.metaKey) {
      if (Math.abs(dy) >= 50) {
        // マウスホイールの1ノッチ → 1段階
        const now = performance.now();
        if (now - this.lastWheelStep > 90) { cam.stepZoom(dy < 0 ? 1 : -1, sx, sy); this.lastWheelStep = now; }
      } else {
        // トラックパッドのピンチ → 連続ズームして、止まったら近い段階に合わせる
        cam.anim = null;
        cam.zoomAt(cam.zoom * Math.exp(-dy * 0.012), sx, sy);
        clearTimeout(this.wheelSnapTimer);
        this.wheelSnapTimer = setTimeout(() => cam.animateZoom(cam.nearestStep(), sx, sy), 220);
      }
    } else {
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      cam.pan(-dx, -dy);
    }
    if (e.pointerType !== 'touch') this.app.hoverAt(this.cellAt(sx, sy), this.mode === 'drag');
  }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const app = this.app;
    if (down) app.userGesture();
    if (!down) {
      this.keys.delete(e.code);
      if (e.key === 'Shift') { app.noSnap = false; if (app.hover) app.hoverAt(app.hover); }
      if (e.code === 'Space') {
        this.space = false;
        if (!this.spaceUsed && !app.blocked()) app.togglePause();
        this.updateCursor();
      }
      return;
    }
    if (e.code === 'Escape') { app.escape(); e.preventDefault(); return; }
    if (e.code === 'F3') { e.preventDefault(); app.perf.toggle(); return; }
    if (e.key === 'Shift' && !e.repeat) { app.noSnap = true; if (app.hover) app.hoverAt(app.hover); }
    if (app.blocked()) return; // モーダル・タイトル中はゲーム操作をしない
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); app.manualSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && !String(window.getSelection?.() || '')) { e.preventDefault(); app.setTool('copy'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) { this.space = true; this.spaceUsed = false; this.updateCursor(); }
      return;
    }
    if (PAN_KEYS[e.code]) { this.keys.add(e.code); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'Digit0') { app.setSpeed(0); return; }
    if (/^Digit[1-4]$/.test(e.code)) { app.setSpeed(SPEED_ONE + (+e.code.slice(5)) - 1); return; }
    if (e.code === 'Digit5' || e.code === 'Backquote') { app.setSpeed(SPEED_RT); return; }
    if (e.code === 'KeyP') { app.togglePause(); return; }
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') { app.cam.stepZoom(1); return; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { app.cam.stepZoom(-1); return; }
    if (e.code === 'Home') { app.cam.home(app.buildingCenterX()); return; }
    if (e.code === 'KeyK') { app.setTool(app.tool === 'copy' ? 'inspect' : 'copy'); return; }
    if (e.code === 'KeyM') { app.toggleMute(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { app.setTool('bulldoze'); return; }
    if (TOOL_KEYS[e.code]) { app.setTool(TOOL_KEYS[e.code]); }
  }

  /** 毎フレーム: キーでのパンとドラッグ中の端スクロール */
  update(dt) {
    const cam = this.app.cam;
    if (this.keys.size) {
      let vx = 0, vy = 0;
      for (const k of this.keys) { const v = PAN_KEYS[k]; if (v) { vx += v[0]; vy += v[1]; } }
      if (vx || vy) cam.pan(-vx * KEY_PAN_SPEED * dt, -vy * KEY_PAN_SPEED * dt);
    }
    if (this.mode === 'place' && this.placePt && this.app.place && this.app.place.moved) {
      const p = this.placePt;
      let vx = 0, vy = 0;
      if (p.y < cam.insetTop + EDGE) vy = 1;
      else if (p.y > cam.vh - cam.insetBottom - EDGE) vy = -1;
      if (p.x < EDGE) vx = 1;
      else if (p.x > cam.vw - EDGE) vx = -1;
      if (vx || vy) { cam.pan(vx * 400 * dt, vy * 400 * dt); this.app.placeMove(p.x, p.y, true); }
    }
    if (this.mode === 'drag' && this.drag && this.drag.moved) {
      const d = this.drag;
      let vx = 0, vy = 0;
      if (d.sy < cam.insetTop + EDGE) vy = 1;
      else if (d.sy > cam.vh - cam.insetBottom - EDGE) vy = -1;
      if (d.sx < EDGE) vx = 1;
      else if (d.sx > cam.vw - EDGE) vx = -1;
      if (vx || vy) {
        cam.pan(vx * 500 * dt, vy * 500 * dt);
        d.cur = this.cellAt(d.sx, d.sy);
        this.app.dragUpdate(d);
      }
    }
  }
}
