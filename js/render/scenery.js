// 空・雲・太陽と月・地層・エフェクト用スプライト
import { Painter, rng, lerpColor, shade } from './pixel.js';

// 時刻（時の小数）→ 空の上端色・下端色
const SKY_KEYS = [
  [0, '#060a1e', '#141c44'],
  [4.5, '#0a1030', '#1e2654'],
  [5.5, '#2a2a5e', '#d8785a'],
  [6.5, '#5a8ad0', '#f6c48a'],
  [8, '#3a86e2', '#a8d8f8'],
  [15.5, '#3a86e2', '#a8d8f8'],
  [17, '#4a6cb4', '#f6b070'],
  [18, '#2c2c6a', '#f07040'],
  [19, '#141640', '#5a3460'],
  [20, '#070b22', '#161e48'],
  [24, '#060a1e', '#141c44'],
];
export function skyColors(h) {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    if (h >= a[0] && h <= b[0]) {
      const t = (h - a[0]) / (b[0] - a[0] || 1);
      return [lerpColor(a[1], b[1], t), lerpColor(a[2], b[2], t)];
    }
  }
  return [SKY_KEYS[0][1], SKY_KEYS[0][2]];
}
// 夜の度合い 0..1
export function nightness(h) {
  if (h >= 20 || h < 4.5) return 1;
  if (h < 6.5) return 1 - (h - 4.5) / 2;
  if (h < 17.5) return 0;
  return (h - 17.5) / 2.5;
}
// 雲の色調 0=昼 1=夕焼け 2=夜
export function cloudTint(h) {
  if (h >= 19.5 || h < 5) return 2;
  if ((h >= 16.8 && h < 19.5) || (h >= 5 && h < 7)) return 1;
  return 0;
}

const CLOUD_TINTS = [
  ['#ffffff', '#dde6f0', '#b8c6d6'],
  ['#ffd8c0', '#f0a890', '#b87a8a'],
  ['#4a5478', '#3a4266', '#2c3354'],
];
const cloudCache = new Map();
export function cloudSprite(shape, tint) {
  const key = shape * 4 + tint;
  let c = cloudCache.get(key);
  if (c) return c;
  const r = rng(101 + shape * 31);
  const W = 40 + shape * 14, H = 16;
  const p = new Painter(W, H);
  const [hi, mid, lo] = CLOUD_TINTS[tint];
  const blobs = [];
  const n = 4 + shape;
  for (let i = 0; i < n; i++) {
    const rad = 4 + ((r() * 4) | 0);
    blobs.push([6 + ((i + 0.5) / n) * (W - 12) + (r() * 4 - 2), H - 3 - rad * 0.6 - r() * 3, rad]);
  }
  for (const [x, y, rd] of blobs) p.disc(Math.round(x), Math.round(y) + 1, rd, lo);
  for (const [x, y, rd] of blobs) p.disc(Math.round(x), Math.round(y), rd - 1, mid);
  for (const [x, y, rd] of blobs) p.disc(Math.round(x) - 1, Math.round(y) - 1, Math.max(1, rd - 3), hi);
  p.g.clearRect(0, H - 2, W, 2);
  p.r(4, H - 3, W - 8, 1, lo);
  c = p.c;
  cloudCache.set(key, c);
  return c;
}

let SUN = null, MOON = null;
export function sunSprite() {
  if (SUN) return SUN;
  const p = new Painter(16, 16);
  p.disc(8, 8, 7, '#ffd040'); p.disc(8, 8, 6, '#ffe878'); p.disc(7, 7, 3, '#fff6c0');
  return (SUN = p.c);
}
export function moonSprite() {
  if (MOON) return MOON;
  const p = new Painter(14, 14);
  p.disc(7, 7, 6, '#f4f0d8'); p.p(5, 5, '#d8d4bc'); p.p(9, 8, '#d8d4bc'); p.r(6, 9, 2, 1, '#d8d4bc');
  p.g.globalCompositeOperation = 'destination-out'; p.disc(10, 5, 5, '#000'); p.g.globalCompositeOperation = 'source-over';
  return (MOON = p.c);
}

// 地層（横 64px で繰り返す）
export const STRATA_W = 64, STRATA_H = 320;
let STRATA = null;
export function strataSprite() {
  if (STRATA) return STRATA;
  const p = new Painter(STRATA_W, STRATA_H);
  const layers = [
    [6, '#5a3a1e'], [44, '#7a5230'], [80, '#8a6238'], [118, '#6e4a2a'], [150, '#9a7448'],
    [196, '#7c6a56'], [240, '#6a5a4c'], [290, '#5c5048'], [999, '#4c443e'],
  ];
  const r = rng(4242);
  for (let x = 0; x < STRATA_W; x++) {
    let prev = 0;
    for (let i = 0; i < layers.length; i++) {
      const base = layers[i][0];
      const wav = i === 0 ? 0 : Math.round(Math.sin((x / STRATA_W) * Math.PI * 2 * (1 + (i % 3)) + i) * 2);
      const y1 = Math.min(STRATA_H, base + wav);
      p.r(x, prev, 1, y1 - prev, layers[i][1]);
      if (i > 0) p.p(x, prev, shade(layers[i][1], 0.18));
      prev = y1;
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = (r() * STRATA_W) | 0, y = 8 + ((r() * (STRATA_H - 8)) | 0);
    const w = 1 + ((r() * 3) | 0);
    p.r(x, y, Math.min(w, STRATA_W - x), 1 + (w > 2 ? 1 : 0), r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)');
  }
  // 地表：歩道と縁石
  p.r(0, 0, STRATA_W, 1, '#d8d4c8'); p.r(0, 1, STRATA_W, 2, '#a8a498'); p.r(0, 3, STRATA_W, 1, '#7a766c');
  for (let x = 0; x < STRATA_W; x += 16) p.p(x, 1, '#8a867c');
  p.r(0, 4, STRATA_W, 2, '#4a7a34');
  return (STRATA = p.c);
}

// 炎（4コマ）
const flameCache = [];
export function flameSprite(frame) {
  if (flameCache[frame]) return flameCache[frame];
  const W = 8, H = 16;
  const p = new Painter(W, H);
  const r = rng(300 + frame * 17);
  for (let x = 0; x < W; x++) {
    const h = 6 + Math.round(Math.sin((x + frame * 2) * 1.3) * 3 + r() * 5);
    for (let y = 0; y < h; y++) {
      const yy = H - 1 - y;
      const k = y / h;
      p.p(x, yy, k > 0.8 ? '#e02010' : k > 0.5 ? '#ff7a10' : k > 0.25 ? '#ffc020' : '#fff4a0');
    }
  }
  for (let i = 0; i < 3; i++) p.p((r() * W) | 0, (r() * 5) | 0, '#ff9a20');
  return (flameCache[frame] = p.c);
}

// 爆発（8コマ、48x48）
const boomCache = [];
export const BOOM = 48;
export function boomSprite(k) {
  if (boomCache[k]) return boomCache[k];
  const p = new Painter(BOOM, BOOM);
  const c = BOOM / 2;
  const r = rng(900 + k);
  const t = k / 7;
  const R = 5 + t * 18;
  if (k < 6) {
    p.disc(c, c, Math.round(R), t < 0.5 ? '#e02010' : '#6a4a3a');
    p.disc(c, c, Math.round(R * 0.75), t < 0.6 ? '#ff8a10' : '#8a6a5a');
    p.disc(c, c, Math.round(R * 0.45), t < 0.4 ? '#fff4a0' : '#ffb030');
  } else {
    for (let i = 0; i < 9; i++) p.disc(c + Math.round((r() - 0.5) * R * 1.4), c + Math.round((r() - 0.5) * R * 1.2), 3 + ((r() * 4) | 0), i % 2 ? '#5a5a5a' : '#7a7a7a');
  }
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = R + 2 + r() * 6;
    const x = Math.round(c + Math.cos(a) * d), y = Math.round(c + Math.sin(a) * d);
    if (x >= 0 && y >= 0 && x < BOOM && y < BOOM) p.r(x, y, 2, 2, k < 4 ? '#ffd040' : '#3a3a3a');
  }
  return (boomCache[k] = p.c);
}

let BELL = null;
export function bellSprite() {
  if (BELL) return BELL;
  const p = new Painter(9, 10);
  p.r(4, 0, 1, 1, '#000'); p.r(3, 1, 3, 1, '#000'); p.r(2, 2, 5, 1, '#000');
  p.r(2, 2, 5, 5, '#000'); p.r(1, 6, 7, 2, '#000'); p.r(0, 8, 9, 1, '#000');
  p.r(3, 2, 3, 5, '#f0c830'); p.r(2, 6, 5, 2, '#f0c830'); p.r(3, 3, 1, 3, '#fff0a0');
  p.r(4, 9, 1, 1, '#806010');
  return (BELL = p.c);
}

let BOMB = null;
export function bombSprite() {
  if (BOMB) return BOMB;
  const p = new Painter(9, 10);
  p.disc(4, 6, 3, '#000'); p.disc(4, 6, 2, '#2a2a3a'); p.p(3, 5, '#8a8aa0');
  p.r(4, 1, 1, 2, '#8a6a40'); p.r(5, 0, 1, 1, '#8a6a40');
  return (BOMB = p.c);
}

let SANTA = null;
export function santaSprite() {
  if (SANTA) return SANTA;
  const p = new Painter(46, 16);
  // そり
  p.r(28, 13, 16, 1, '#c8a040'); p.r(43, 11, 1, 2, '#c8a040'); p.r(28, 12, 1, 1, '#c8a040');
  p.box(30, 7, 13, 6, '#d02020'); p.r(31, 8, 11, 1, '#f04040'); p.r(30, 12, 13, 1, '#f0c830');
  // サンタ
  p.r(35, 1, 4, 2, '#e02020'); p.p(39, 2, '#ffffff'); p.r(35, 3, 3, 2, '#ffd8b0'); p.r(35, 5, 4, 2, '#ffffff');
  p.r(34, 5, 5, 3, '#e02020'); p.r(34, 5, 1, 1, '#ffffff');
  // 袋
  p.box(39, 3, 5, 5, '#8a6a3a');
  // トナカイ ×2
  for (const x of [2, 15]) {
    p.r(x + 1, 7, 8, 3, '#8a5a2a'); p.r(x + 1, 10, 1, 3, '#6a3a1a'); p.r(x + 7, 10, 1, 3, '#6a3a1a');
    p.r(x, 4, 2, 4, '#8a5a2a'); p.r(x - 1, 5, 1, 1, '#8a5a2a'); p.p(x - 1, 6, '#e02020');
    p.p(x, 2, '#5a3a1a'); p.p(x + 1, 3, '#5a3a1a'); p.p(x + 2, 2, '#5a3a1a'); p.p(x - 1, 2, '#5a3a1a');
  }
  p.r(10, 8, 20, 1, '#5a3a1a');
  return (SANTA = p.c);
}

let BUBBLE = null;
export function bubbleSprite() {
  if (BUBBLE) return BUBBLE;
  const p = new Painter(15, 13);
  p.box(0, 0, 15, 10, '#ffffff');
  p.r(3, 10, 3, 1, '#000'); p.r(3, 9, 3, 1, '#ffffff'); p.p(4, 9, '#ffffff'); p.r(3, 11, 2, 1, '#000'); p.p(3, 12, '#000');
  p.p(4, 10, '#ffffff');
  // 怒りマーク
  p.r(3, 2, 1, 4, '#e02020'); p.r(3, 7, 1, 1, '#e02020');
  p.r(6, 2, 1, 4, '#e02020'); p.r(6, 7, 1, 1, '#e02020');
  p.r(9, 3, 3, 1, '#e02020'); p.r(9, 6, 3, 1, '#e02020'); p.r(9, 3, 1, 4, '#e02020'); p.r(11, 3, 1, 4, '#e02020');
  return (BUBBLE = p.c);
}


// ---- 状態バッジ（画面上で最小サイズを保って描く） ----
const iconCache = new Map();
function icon(key, w, h, draw) {
  let c = iconCache.get(key);
  if (!c) { const p = new Painter(w, h); draw(p); c = p.c; iconCache.set(key, c); }
  return c;
}
// ゴキブリ
export function roachIcon() {
  return icon('roach', 11, 11, (p) => {
    p.disc(5, 5, 5, '#000'); p.disc(5, 5, 4, '#e8f0c0');
    p.r(4, 2, 3, 1, '#2a1004'); p.r(3, 3, 5, 5, '#6a3010'); p.r(4, 4, 3, 3, '#8a4a1a'); p.r(5, 3, 1, 5, '#3a1806');
    p.p(2, 4, '#2a1004'); p.p(8, 4, '#2a1004'); p.p(2, 7, '#2a1004'); p.p(8, 7, '#2a1004');
    p.p(3, 1, '#2a1004'); p.p(7, 1, '#2a1004');
  });
}
// 要清掃（ほうき）
export function dirtyIcon() {
  return icon('dirty', 11, 11, (p) => {
    p.disc(5, 5, 5, '#000'); p.disc(5, 5, 4, '#cfe8ff');
    p.line(7, 2, 4, 6, '#8a5a2a'); p.line(8, 2, 5, 6, '#6a3a1a');
    p.r(2, 6, 4, 2, '#f0c040'); p.r(2, 8, 1, 1, '#f0c040'); p.r(4, 8, 1, 1, '#f0c040'); p.r(6, 8, 1, 1, '#c09020');
  });
}
// 到達不能（黄色い三角に「!」）
export function warnIcon() {
  return icon('warn', 13, 12, (p) => {
    for (let y = 0; y < 12; y++) {
      const half = Math.round((y / 11) * 6);
      p.r(6 - half, y, half * 2 + 1, 1, '#000');
      if (y > 1 && y < 11) { const h2 = Math.max(0, half - 1); p.r(6 - h2, y, h2 * 2 + 1, 1, '#ffd020'); }
    }
    p.r(6, 3, 1, 4, '#000'); p.r(6, 8, 1, 2, '#000');
  });
}
export function mirrored(c) {
  const p = new Painter(c.width, c.height);
  p.g.translate(c.width, 0); p.g.scale(-1, 1); p.g.drawImage(c, 0, 0);
  return p.c;
}
