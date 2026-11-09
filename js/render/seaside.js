// 「海辺のリゾート」の背景（sim.theme === 'seaside'）: 海・波・島・船・カモメ・灯台・砂浜・ヤシ・砂の地層・台風
// スプライトはすべてここでキャッシュし、毎フレーム動かすのは波・船・カモメ・灯台の光・雨だけ。
import { Painter, rng, shade } from './pixel.js';

const cache = new Map();
function once(key, w, h, fn) {
  let c = cache.get(key);
  if (!c) { const p = new Painter(w, h); fn(p); c = p.c; cache.set(key, c); }
  return c;
}

export const SEA_H = 72;            // 水平線の高さ（地面からのワールドpx）
export const WAVE_W = 256;          // 波スプライトの横幅（繰り返し）

// 波のハイライト（透明地に白い筋）。frame 0..7、rough = 荒れた海
export function waveFrame(frame, rough) {
  return once('wave' + frame + (rough ? 'r' : 'c'), WAVE_W, SEA_H, (p) => {
    const r = rng(77 + (rough ? 1000 : 0));
    for (let row = 4; row < SEA_H - 2; row += rough ? 3 : 4) {
      const k = row / SEA_H;                 // 手前ほど長く太い
      const n = Math.round(6 + k * 10);
      for (let i = 0; i < n; i++) {
        const base = r() * WAVE_W;
        const len = Math.round(2 + k * (rough ? 12 : 8) * r());
        const x = Math.round(base + (frame / 8) * (rough ? 40 : 16) * (0.5 + k)) % WAVE_W;
        const a = rough ? 0.35 + k * 0.45 : 0.18 + k * 0.3;
        p.g.globalAlpha = a; p.r(x, row + (((frame + i) & 3) === 0 ? 1 : 0), Math.min(len, WAVE_W - x), 1, '#ffffff');
      }
    }
    p.g.globalAlpha = 1; p._fs = null;
    // 波打ち際の泡
    for (let x = 0; x < WAVE_W; x++) {
      const h = Math.round(1.5 + Math.sin((x + frame * (rough ? 6 : 3)) * 0.09) * 1.2 + (rough ? Math.sin(x * 0.31 + frame) * 1.5 : 0));
      if (h > 0) p.r(x, SEA_H - 2 - h, 1, h, '#f4fbff');
    }
  });
}

// 遠くの島（シルエット）
export function islandSprite(k) {
  return once('isl' + k, 120, 22, (p) => {
    const r = rng(310 + k * 17);
    const peaks = 2 + (k % 2);
    for (let x = 0; x < 120; x++) {
      let h = 0;
      for (let i = 0; i < peaks; i++) { const c = 20 + i * 40 + r() * 0 + (k * 13 % 20); const d = Math.abs(x - c); h = Math.max(h, 18 - d * (0.35 + i * 0.08)); }
      h = Math.round(Math.max(0, h + Math.sin(x * 0.5) * 0.8));
      if (h > 0) { p.r(x, 22 - h, 1, h, '#4a6a7a'); p.p(x, 22 - h, '#6a8a96'); }
    }
  });
}

// 船（0: ヨット、1: クルーザー、2: 漁船）
export function boatSprite(k) {
  return once('boat' + k, 24, 18, (p) => {
    if (k === 0) {
      p.r(11, 1, 1, 13, '#3a3a3a');
      for (let y = 2; y < 13; y++) { p.r(12, y, Math.round((y - 1) * 0.8), 1, '#ffffff'); p.r(11 - Math.round((y - 2) * 0.5), y, Math.round((y - 2) * 0.5), 1, '#f0f0f0'); }
      p.r(4, 14, 16, 2, '#ffffff'); p.r(5, 16, 14, 1, '#2a5ab0');
    } else if (k === 1) {
      p.r(3, 12, 19, 3, '#ffffff'); p.r(4, 15, 17, 1, '#c8d0d8');
      p.r(8, 9, 9, 3, '#f4f4f4'); p.r(9, 10, 6, 1, '#3a5a7a'); p.r(11, 7, 3, 2, '#e8e8e8');
    } else {
      p.r(4, 12, 16, 3, '#c84a30'); p.r(5, 15, 14, 1, '#7a2a1a');
      p.r(13, 8, 5, 4, '#f0e8d8'); p.r(14, 9, 2, 1, '#3a5a7a'); p.r(8, 3, 1, 9, '#5a4a3a'); p.r(6, 5, 5, 1, '#5a4a3a');
    }
  });
}

// カモメ（2コマ）
export function gullSprite(frame) {
  return once('gull' + frame, 9, 4, (p) => {
    if (frame) { p.r(0, 0, 2, 1, '#f4f4f4'); p.r(2, 1, 2, 1, '#f4f4f4'); p.r(4, 2, 1, 1, '#3a3a3a'); p.r(5, 1, 2, 1, '#f4f4f4'); p.r(7, 0, 2, 1, '#f4f4f4'); }
    else { p.r(0, 2, 2, 1, '#f4f4f4'); p.r(2, 1, 2, 1, '#f4f4f4'); p.r(4, 2, 1, 1, '#3a3a3a'); p.r(5, 1, 2, 1, '#f4f4f4'); p.r(7, 2, 2, 1, '#f4f4f4'); }
  });
}

// 灯台（岬の岩の上）。ランプは (14, 6)
export function lighthouseSprite() {
  return once('lh', 30, 48, (p) => {
    // 岩
    for (let x = 0; x < 30; x++) { const h = Math.round(8 + Math.sin(x * 0.4) * 2 + (x > 8 && x < 22 ? 3 : 0)); p.r(x, 48 - h, 1, h, x % 3 ? '#5a5a54' : '#4a4a44'); }
    // 塔（紅白）
    for (let y = 10; y < 38; y++) { const half = Math.round(3 + (y - 10) * 0.08); p.r(14 - half, y, half * 2 + 1, 1, ((y / 5) | 0) % 2 ? '#d83a2a' : '#f4f4f0'); }
    p.r(10, 9, 9, 1, '#2a2a2a'); p.r(11, 4, 7, 5, '#2a2a2a'); p.r(12, 5, 5, 3, '#fff2a0'); p.r(12, 2, 5, 2, '#3a3a3a'); p.p(14, 1, '#3a3a3a');
  });
}

// ヤシの木（lean: -1 / 0 / 1 で風になびく向き）26x34、根元は (12, 33)
export function palmSprite(alt, lean) {
  return once('palm' + alt + '|' + lean, 30, 34, (p) => {
    const tc = '#8a6238', td = '#6a4626';
    const bend = (alt % 2 ? 4 : -3) + lean * 3;
    // 幹（少し曲がる）
    let topX = 14, topY = 9;
    for (let y = 33; y >= 9; y--) {
      const t = (33 - y) / 24;
      const x = Math.round(14 + bend * t * t);
      p.r(x - 1, y, 3, 1, (y % 3) ? tc : td);
      topX = x; topY = y;
    }
    // 葉
    const g1 = '#2f8a3a', g2 = '#46a84a', g3 = '#246a2c';
    const fronds = [[-11, 3], [-8, -3], [-2, -6], [5, -5], [10, 0], [12, 5], [-12, 8], [8, 8]];
    for (const [dx0, dy0] of fronds) {
      const dx = dx0 + lean * 4, dy = dy0 + (lean && dx0 * lean < 0 ? 3 : 0);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(topX + dx * t), y = Math.round(topY + dy * t + t * t * 4);
        p.r(x, y, 2, 1, i % 3 === 0 ? g3 : i % 2 ? g1 : g2);
        if (i > 2 && i < steps) p.p(x + (dx > 0 ? 0 : 1), y + 1, g3);
      }
    }
    // ヤシの実
    p.r(topX - 1, topY + 1, 2, 2, '#7a5a20'); p.r(topX + 1, topY + 2, 2, 2, '#6a4a18');
  });
}

// 砂の地層（横 64px で繰り返す）。minFloor より下は「掘れない」水と岩盤
export function sandStrata(depthPx) {
  return once('sand' + depthPx, 64, depthPx + 16, (p) => {
    const H = depthPx + 16;
    const r = rng(9090);
    p.r(0, 0, 64, depthPx, '#e4cc94');
    // 砂の層
    const layers = [[4, '#f0dcae'], [Math.round(depthPx * 0.35), '#dcc086'], [Math.round(depthPx * 0.6), '#c8aa74'], [depthPx, '#a89470']];
    let prev = 0;
    for (const [y1, c] of layers) {
      for (let x = 0; x < 64; x++) { const w = prev ? Math.round(Math.sin((x / 64) * Math.PI * 2 * 2 + prev) * 1.5) : 0; p.r(x, prev + w, 1, Math.max(0, y1 - prev - w), c); }
      prev = y1;
    }
    // 地下水（下の方は青みがかる）
    const wt = Math.round(depthPx * 0.62);
    p.r(0, wt, 64, depthPx - wt, '#9c8258');
    for (let y = wt + 2; y < depthPx; y += 3) for (let x = (y * 7) % 5; x < 64; x += 5) p.p(x, y, '#7a9ab0');
    for (let x = 0; x < 64; x++) p.p(x, wt + Math.round(Math.sin(x * 0.4) * 0.8), '#8ab0cc');
    // 貝殻と小石
    for (let i = 0; i < 40; i++) p.p((r() * 64) | 0, 5 + ((r() * (depthPx - 6)) | 0), r() < 0.5 ? '#fff4e0' : '#9a8a6a');
    // 砂浜の表面
    p.r(0, 0, 64, 1, '#fff2c8'); p.r(0, 1, 64, 2, '#f0dcae');
    for (let x = 0; x < 64; x += 9) p.p(x, 1, '#d8c08a');
    // 下端: これより下は掘れない
    p.r(0, depthPx, 64, 2, '#2a2a30');
    for (let y = depthPx + 2; y < H; y++) p.r(0, y, 64, 1, '#24323e');
  });
}
// 掘れない層（水と岩盤）の繰り返しタイル 64x64
export function deepTile() {
  return once('deep', 64, 64, (p) => {
    p.r(0, 0, 64, 64, '#24323e');
    const r = rng(4411);
    for (let y = 4; y < 64; y += 8) for (let x = 0; x < 64; x++) p.p(x, y + Math.round(Math.sin((x + y) * 0.2) * 1.5), '#2e4252');
    for (let i = 0; i < 30; i++) p.r((r() * 60) | 0, (r() * 62) | 0, 2 + ((r() * 3) | 0), 1, '#1a242c');
    for (let y = 0; y < 64; y += 16) for (let x = (y / 2) % 16; x < 64; x += 16) { p.line(x, y, x + 6, y + 6, '#3a5262'); }
  });
}
