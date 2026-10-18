// ピクセルアート用の小さな道具箱（オフスクリーンキャンバス・ドット描画・3x5 ドットフォント）

export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  let c;
  if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = w; c.height = h;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    c = new OffscreenCanvas(w, h);
  } else {
    throw new Error('canvas unavailable');
  }
  return c;
}

// 決まった種から同じ乱数列を返す（スプライトの見た目を毎回同じにする）
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 3x5 ドットフォント（看板用）
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110', '!': '010010010000010', '-': '000000111000000',
  '$': '011110010011110', '+': '000010111010000', '.': '000000000000010', ' ': '000000000000000',
};
export const textWidth = (s) => (s.length ? s.length * 4 - 1 : 0);

// 1 スプライト分のペインタ
export class Painter {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = makeCanvas(w, h);
    this.g = this.c.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this._fs = null;
  }
  col(c) { if (c !== this._fs) { this.g.fillStyle = c; this._fs = c; } }
  r(x, y, w, h, c) { this.col(c); this.g.fillRect(x, y, w, h); }
  p(x, y, c) { this.col(c); this.g.fillRect(x, y, 1, 1); }
  // 輪郭付きの箱
  box(x, y, w, h, fill, line = '#000') {
    this.r(x, y, w, h, line);
    if (w > 2 && h > 2) this.r(x + 1, y + 1, w - 2, h - 2, fill);
  }
  hl(x, y, w, c) { this.r(x, y, w, 1, c); }
  vl(x, y, h, c) { this.r(x, y, 1, h, c); }
  // ドット線（Bresenham）
  line(x0, y0, x1, y1, c) {
    this.col(c);
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // 塗りつぶし円
  disc(cx, cy, rad, c) {
    this.col(c);
    for (let y = -rad; y <= rad; y++) {
      const hw = Math.floor(Math.sqrt(rad * rad - y * y + rad * 0.8));
      this.g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  }
  text(s, x, y, c) {
    this.col(c);
    s = String(s).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]] || FONT[' '];
      for (let k = 0; k < 15; k++) if (g.charCodeAt(k) === 49) this.g.fillRect(x + i * 4 + (k % 3), y + ((k / 3) | 0), 1, 1);
    }
  }
  // 拡大した 3x5 フォント（k 倍）
  textK(s, x, y, c, k) {
    this.col(c);
    s = String(s).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]] || FONT[' '];
      for (let j = 0; j < 15; j++) if (g.charCodeAt(j) === 49) this.g.fillRect(x + (i * 4 + (j % 3)) * k, y + ((j / 3) | 0) * k, k, k);
    }
  }
  // 看板（白いプレートに文字）
  sign(s, cx, y, fg = '#c02020', bg = '#f6f0dc', line = '#000') {
    const tw = textWidth(s);
    const x = Math.round(cx - tw / 2) - 2;
    this.box(x, y, tw + 4, 9, bg, line);
    this.text(s, x + 2, y + 2, fg);
  }
}

// 色ユーティリティ
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k < 0) { r *= 1 + k; g *= 1 + k; b *= 1 + k; } else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

export function lerpColor(a, b, t) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const r = ((na >> 16) & 255) + ((((nb >> 16) & 255) - ((na >> 16) & 255)) * t);
  const g = ((na >> 8) & 255) + ((((nb >> 8) & 255) - ((na >> 8) & 255)) * t);
  const bl = (na & 255) + (((nb & 255) - (na & 255)) * t);
  const h = (v) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(bl);
}
