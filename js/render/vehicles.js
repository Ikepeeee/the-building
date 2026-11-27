// 空の乗り物: 消防ヘリ・旅客機・バナー機（右向きで描く。左向きは mirrored で反転）
import { Painter } from './pixel.js';

const cache = new Map();
function once(key, w, h, fn) {
  let c = cache.get(key);
  if (!c) { const p = new Painter(w, h); fn(p); c = p.c; cache.set(key, c); }
  return c;
}

// 消防ヘリ（ローターは renderer が描く）。40x18、マストの上端は (22, 3)
export function heliSprite() {
  return once('heli2', 40, 18, (p) => {
    const red = '#d8301e', dk = '#9a1a10';
    // 尾翼とテールブーム
    p.r(0, 1, 4, 9, '#000'); p.r(1, 2, 2, 7, red); p.r(1, 2, 2, 1, '#ffffff');
    p.r(3, 6, 12, 4, '#000'); p.r(3, 7, 12, 2, red); p.r(4, 8, 10, 1, dk);
    // 胴体（丸みのある箱）
    const spans = [[16, 30], [14, 32], [13, 34], [13, 35], [13, 35], [13, 35], [13, 35], [13, 34], [14, 33], [16, 30]];
    spans.forEach(([a, b], i) => p.r(a - 1, 4 + i - (i === 0 ? 1 : 0), b - a + 2, 1 + (i === 0 ? 1 : 0), '#000'));
    p.r(12, 14, 0, 0, '#000');
    spans.forEach(([a, b], i) => { if (i > 0 && i < spans.length - 1) p.r(a, 4 + i, b - a, 1, red); });
    p.r(16, 4, 14, 1, red);
    p.r(13, 10, 22, 1, '#ffffff');
    p.r(14, 11, 19, 1, dk); p.r(15, 12, 16, 1, dk);
    // 窓
    p.r(27, 6, 6, 3, '#9ad8f0'); p.r(33, 7, 1, 2, '#9ad8f0'); p.r(28, 6, 2, 1, '#e8f8ff');
    p.r(18, 6, 5, 3, '#9ad8f0'); p.p(19, 6, '#e8f8ff');
    // マストとエンジン
    p.r(19, 2, 9, 2, '#000'); p.r(20, 2, 7, 1, '#b8b8c0');
    p.r(22, 0, 2, 2, '#3a3a3a');
    // スキッド
    p.r(18, 14, 1, 2, '#2a2a2a'); p.r(29, 14, 1, 2, '#2a2a2a'); p.r(14, 16, 22, 1, '#2a2a2a'); p.p(36, 15, '#2a2a2a');
  });
}

// 旅客機 48x14。night=true なら暗い機体と窓明かり
export function planeSprite(night) {
  return once('plane' + (night ? 'n' : 'd'), 48, 14, (p) => {
    const body = night ? '#20263a' : '#f4f6f8', line = night ? '#0a0c14' : '#3a3e48';
    const tail = night ? '#1a2034' : '#2a5ab0';
    // 尾翼
    for (let y = 0; y < 6; y++) p.r(2 + Math.floor(y * 0.6), y, 5 - Math.floor(y * 0.3), 1, tail);
    p.r(1, 0, 1, 6, line);
    // 胴体
    p.r(2, 5, 40, 5, line); p.r(42, 6, 3, 3, line); p.r(45, 7, 1, 2, line);
    p.r(3, 6, 39, 3, body); p.r(42, 7, 2, 1, body);
    p.r(41, 6, 2, 1, night ? '#3a4050' : '#6a8ab0');
    if (!night) p.r(3, 8, 39, 1, '#2a5ab0');
    for (let x = 10; x < 40; x += 2) p.p(x, 6, night ? '#f0d890' : '#3a4a6a');
    // 主翼とエンジン
    p.r(18, 9, 12, 1, line); p.r(20, 10, 10, 1, line); p.r(23, 11, 7, 1, line);
    p.r(19, 9, 10, 1, night ? '#2a3044' : '#b8bec8'); p.r(21, 10, 8, 1, night ? '#2a3044' : '#b8bec8');
    p.r(22, 11, 5, 2, night ? '#141824' : '#7a808a');
    // 水平尾翼
    p.r(2, 9, 6, 1, line);
  });
}

// バナーを引く小型機 18x9 と、文字のバナー
export function bannerPlaneSprite() {
  return once('bplane', 18, 9, (p) => {
    p.r(2, 2, 2, 4, '#c03020'); p.r(3, 4, 12, 3, '#000'); p.r(4, 5, 10, 1, '#f0d040');
    p.r(14, 4, 2, 3, '#000'); p.r(16, 3, 1, 5, '#6a6a6a');
    p.r(7, 3, 4, 1, '#000'); p.r(8, 4, 2, 1, '#9ad8f0');
    p.r(6, 7, 6, 1, '#000'); p.r(4, 6, 2, 1, '#c03020');
  });
}
export function bannerSprite(text) {
  const w = text.length * 4 + 5;
  return once('banner:' + text, w, 9, (p) => {
    p.r(0, 0, w, 9, '#000'); p.r(1, 1, w - 2, 7, '#fff8e8');
    for (let x = 1; x < w - 1; x += 2) p.p(x, 1, '#f0e0c0');
    p.text(text, 3, 2, '#c02020');
  });
}
