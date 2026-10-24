// 人のスプライト（7x8 のセルに 3px 幅 × 8px 高の人型）。種類 × ストレス × 歩行コマ × 向き をアトラス化する。
import { Painter } from './pixel.js';

export const PW = 7, PH = 8;           // セルの大きさ（ワールドpx）
export const PCX = 3;                  // セル内の体の中心列

export const STRESS_COLORS = ['#141414', '#f06aa8', '#e01818'];
export const stressIndex = (s) => (s >= 60 ? 2 : s >= 30 ? 1 : 0);

export const KINDS = ['worker', 'resident', 'guest', 'visitor', 'guard', 'maid', 'vip', 'bride', 'groom', 'weddingGuest', 'child', 'weddingGuest2', 'santa'];
export const KIND_INDEX = Object.create(null);
KINDS.forEach((k, i) => { KIND_INDEX[k] = i; });

// facing right で描く。m(x) で左右反転。
function drawPerson(p, ox, oy, kind, c, frame, dir) {
  const m = (x) => (dir ? x : 6 - x);
  const R = (x, y, w, h, col) => {
    for (let i = 0; i < w; i++) p.r(ox + m(x + i), oy + y, 1, h, col);
  };
  const legs = (col, top = 6) => {
    if (frame === 0) { R(2, top, 1, 8 - top, col); R(4, top, 1, 8 - top, col); }
    else { R(3, top, 1, 8 - top, col); }
  };
  switch (kind) {
    case 'child':
      R(3, 2, 2, 2, c); R(2, 4, 3, 2, c);
      if (frame === 0) { R(2, 6, 1, 2, c); R(4, 6, 1, 2, c); } else R(3, 6, 1, 2, c);
      return;
    case 'guard':
      R(2, 0, 4, 1, '#1b3486'); R(3, 1, 2, 1, c);
      R(2, 2, 3, 4, '#2f5ce0'); R(4, 2, 1, 1, '#f0d040');
      legs('#14214f');
      return;
    case 'maid':
      R(3, 0, 2, 1, '#ffffff'); R(3, 1, 2, 1, c);
      R(2, 2, 3, 4, '#2c2c48'); R(3, 3, 2, 3, '#ffffff');
      legs(c);
      return;
    case 'vip':
      R(3, 0, 2, 2, c);
      R(2, 2, 3, 4, '#f2c418'); R(2, 2, 1, 4, '#b88a08');
      R(4, 2, 1, 1, '#ffffff');
      legs('#5a4004');
      return;
    case 'groom':
      R(3, 0, 2, 2, c);
      R(2, 2, 3, 4, '#ffffff'); R(2, 2, 1, 4, '#c8c8d4'); R(4, 2, 1, 1, '#141414');
      legs('#e8e8f0');
      return;
    case 'bride':
      R(1, 0, 1, 4, '#ffffff'); R(2, 0, 1, 1, '#ffffff');
      R(3, 0, 2, 2, c);
      R(2, 2, 3, 3, '#ffffff'); R(1, 5, 5, 3, '#ffffff'); R(1, 5, 1, 3, '#d4d4e0');
      R(5, 3, 1, 2, '#ff7aa8');
      return;
    case 'weddingGuest':
    case 'weddingGuest2': {
      const d = kind === 'weddingGuest' ? '#a040b8' : '#2c8a5a';
      R(3, 0, 2, 2, c);
      R(2, 2, 3, 4, d);
      legs(c);
      return;
    }
    case 'santa':
      R(3, 0, 2, 1, '#e02020'); R(3, 1, 2, 1, '#ffd8b0'); R(2, 2, 3, 4, '#e02020'); R(2, 4, 3, 1, '#141414');
      R(4, 1, 1, 2, '#ffffff');
      legs('#141414');
      return;
    default: break;
  }
  // 一般（シルエット）
  R(3, 0, 2, 2, c);
  R(2, 2, 3, 4, c);
  legs(c);
  if (kind === 'worker') { R(5, 4, 1, 2, '#7a4a22'); R(6, 4, 1, 2, '#5a3412'); }
  else if (kind === 'guest') { R(0, 4, 2, 3, '#c03838'); R(1, 3, 1, 1, '#601818'); }
  else if (kind === 'visitor') { R(5, 4, 1, 2, '#e8a020'); }
}

let ATLAS = null;
export function peopleAtlas() {
  if (ATLAS) return ATLAS;
  const cols = 12; // stress(3) * frame(2) * dir(2)
  const p = new Painter(cols * PW, KINDS.length * PH);
  KINDS.forEach((k, ki) => {
    for (let s = 0; s < 3; s++) for (let fr = 0; fr < 2; fr++) for (let d = 0; d < 2; d++) {
      const ci = s * 4 + fr * 2 + d;
      drawPerson(p, ci * PW, ki * PH, k, STRESS_COLORS[s], fr, d);
    }
  });
  ATLAS = p.c;
  return ATLAS;
}

// アトラス上のセル座標
export function atlasCell(kindIdx, s, frame, dir) {
  return [(s * 4 + frame * 2 + dir) * PW, kindIdx * PH];
}

// スプライト内に描く静止した人（施設の中の人影）。facing: 1=右, 0=左
export function standFig(p, x, yFeet, col = '#1a1a1a', facing = 1, legs = 0) {
  // x はセルの左端ではなく体の左端（幅3）
  const hx = facing ? x + 1 : x;
  p.r(hx, yFeet - 7, 2, 2, col);
  p.r(x, yFeet - 5, 3, 4, col);
  if (legs) p.r(x + 1, yFeet - 1, 1, 2, col);
  else { p.r(x, yFeet - 1, 1, 2, col); p.r(x + 2, yFeet - 1, 1, 2, col); }
}
export function childFig(p, x, yFeet, col = '#1a1a1a', facing = 1) {
  p.r(facing ? x + 1 : x, yFeet - 5, 2, 2, col);
  p.r(x, yFeet - 3, 3, 2, col);
  p.r(x, yFeet - 1, 1, 2, col); p.r(x + 2, yFeet - 1, 1, 2, col);
}
// 座った人。seatY は座面の行。facing=1 なら右向き（机は右）
export function sitFig(p, x, seatY, col = '#1a1a1a', facing = 1) {
  if (facing) {
    p.r(x + 1, seatY - 7, 2, 2, col);
    p.r(x, seatY - 5, 3, 5, col);
    p.r(x + 3, seatY - 3, 1, 1, col);
    p.r(x + 3, seatY - 1, 2, 1, col);
    p.r(x + 4, seatY, 1, 4, col);
  } else {
    p.r(x, seatY - 7, 2, 2, col);
    p.r(x, seatY - 5, 3, 5, col);
    p.r(x - 1, seatY - 3, 1, 1, col);
    p.r(x - 2, seatY - 1, 2, 1, col);
    p.r(x - 2, seatY, 1, 4, col);
  }
}
