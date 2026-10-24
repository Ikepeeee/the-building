// カメラ（UI が持ち主）。範囲制限とズーム段階を管理する。
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F } from '../sim/constants.js';

// ピクセルアートが綺麗に見える段階（1/4 刻みまたは整数倍）
export const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4];
const ZMIN = ZOOMS[0], ZMAX = ZOOMS[ZOOMS.length - 1];

const WORLD_L = -6 * TILE_W;
const WORLD_R = W * TILE_W + 6 * TILE_W;
const WORLD_T = -(MAX_F + 1) * FLOOR_H - 4 * FLOOR_H; // 屋上の上に少し空
const WORLD_B = -MIN_F * FLOOR_H + FLOOR_H; // 最下層の下に少し地面
const LABEL_PX = 48; // フロア番号ラベルの幅（CSS px）

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 2;
    this.vw = 1; this.vh = 1;
    this.insetTop = 0; this.insetBottom = 0;
    this.anim = null;
  }

  get view() { return { x: this.x, y: this.y, zoom: this.zoom }; }

  setViewport(w, h, insetTop, insetBottom) {
    this.vw = w; this.vh = h; this.insetTop = insetTop; this.insetBottom = insetBottom;
    this.clamp();
  }

  /** 1F 付近を画面の下寄りに、建物の中央を映す */
  home(centerX) {
    this.anim = null;
    this.zoom = this.vw > 1800 && this.vh > 1000 ? 3 : 2;
    const usable = this.vh - this.insetTop - this.insetBottom;
    this.y = -(this.insetTop + usable * 0.72) / this.zoom;
    const cx = Number.isFinite(centerX) ? centerX : W / 2; // マス単位
    this.x = cx * TILE_W - this.vw / 2 / this.zoom;
    this.clamp();
  }

  clamp() {
    const z = this.zoom;
    // 横: 左端のフロア番号ラベル（約 44px）に x=0 の施設が隠れないよう、画面上で最低 LABEL_PX の余白を許す
    const minX = Math.min(WORLD_L, -LABEL_PX / z);
    const maxX = WORLD_R - this.vw / z;
    this.x = minX > maxX ? (minX + WORLD_R) / 2 - this.vw / 2 / z : Math.min(maxX, Math.max(minX, this.x));
    // 縦: HUD・ツールバーの下も見えるように。100F が画面の中央まで下ろせるよう空を広めに許す
    const usable = Math.max(1, this.vh - this.insetTop - this.insetBottom);
    const minY = Math.min(WORLD_T - this.insetTop / z, -(MAX_F + 0.5) * FLOOR_H - (this.insetTop + usable * 0.5) / z);
    const maxY = WORLD_B - (this.vh - this.insetBottom) / z;
    this.y = minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, this.y));
  }

  pan(dxScreen, dyScreen) {
    this.anim = null;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** 画面座標 (sx,sy) を中心にズーム */
  zoomAt(z, sx, sy) {
    z = Math.min(ZMAX, Math.max(ZMIN, z));
    const wx = sx / this.zoom + this.x, wy = sy / this.zoom + this.y;
    this.zoom = z;
    this.x = wx - sx / z; this.y = wy - sy / z;
    this.clamp();
  }

  nearestStep(z = this.zoom) {
    let best = ZOOMS[0];
    for (const s of ZOOMS) if (Math.abs(Math.log(s / z)) < Math.abs(Math.log(best / z))) best = s;
    return best;
  }

  stepZoom(dir, sx = this.vw / 2, sy = this.vh / 2) {
    // アニメーション中に続けて押されたら、その目標からさらに1段階進める
    const a = this.anim && this.anim.kind === 'zoom' ? this.anim : null;
    let i;
    if (a) {
      i = ZOOMS.indexOf(a.z1) + dir;
      sx = a.sx; sy = a.sy;
    } else {
      const cur = this.nearestStep();
      i = ZOOMS.indexOf(cur);
      if (dir > 0 && cur <= this.zoom + 1e-6) i++;
      else if (dir < 0 && cur >= this.zoom - 1e-6) i--;
    }
    i = Math.max(0, Math.min(ZOOMS.length - 1, i));
    this.animateZoom(ZOOMS[i], sx, sy);
  }

  animateZoom(z, sx, sy) {
    this.anim = { kind: 'zoom', z0: this.zoom, z1: z, sx, sy, t0: performance.now(), dur: 140 };
  }

  /** ワールド位置へ移動（マス x, フロア f を画面中央へ） */
  focus(f, x, zoom) {
    const z = zoom || Math.max(this.zoom, 1.5);
    const usable = this.vh - this.insetTop - this.insetBottom;
    const wx = (x + 0.5) * TILE_W, wy = -(f + 0.5) * FLOOR_H;
    const tx = wx - this.vw / 2 / z;
    const ty = wy - (this.insetTop + usable / 2) / z;
    this.anim = { kind: 'move', x0: this.x, y0: this.y, z0: this.zoom, x1: tx, y1: ty, z1: z, t0: performance.now(), dur: 450 };
  }

  update(now) {
    const a = this.anim;
    if (!a) return;
    let t = Math.min(1, (now - a.t0) / a.dur);
    const e = 1 - Math.pow(1 - t, 3);
    if (a.kind === 'zoom') {
      const z = t >= 1 ? a.z1 : a.z0 * Math.pow(a.z1 / a.z0, e);
      this.zoomAt(z, a.sx, a.sy);
    } else {
      this.zoom = a.z0 + (a.z1 - a.z0) * e;
      this.x = a.x0 + (a.x1 - a.x0) * e;
      this.y = a.y0 + (a.y1 - a.y0) * e;
      this.clamp();
    }
    if (t >= 1) this.anim = null;
  }
}
