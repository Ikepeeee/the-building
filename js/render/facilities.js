// 施設スプライト（室内の断面図）を手続き的に描く。1 ワールドpx = 1 ドット。
// すべてのスプライトは幅 w*TILE_W、高さ h*FLOOR_H（大聖堂は上に尖塔ぶん伸びる → canvas.oy）。
// 1フロアの帯の中: 行 0..20 = 室内、21 = 床面、22 = スラブ、23 = 黒い線。
import { TILE_W, FLOOR_H } from '../sim/constants.js';
import { Painter, rng, shade } from './pixel.js';
import { standFig, childFig, sitFig } from './people.js';
import { drawVariant, hasVariantArt } from './variants.js';

export const INK = '#141414';
export const SLAB = '#77746c';
export const FIG = '#1a1a1a';

export function shell(p, wall, floor, opt = {}) {
  const W = p.w, H = p.h - (p.oy || 0), y0 = p.oy || 0;
  const fy = y0 + H - 3;
  p.r(0, y0, W, H - 3, wall);
  p.r(0, y0, W, 1, shade(wall, -0.28));
  if (opt.base) p.r(0, fy - 1, W, 1, opt.base);
  p.r(0, fy, W, 1, floor);
  p.r(0, fy + 1, W, 1, SLAB);
  p.r(0, fy + 2, W, 1, '#000');
  p.r(0, y0, 1, H, '#000');
  p.r(W - 1, y0, 1, H - 3, shade(wall, -0.35));
  return fy;
}

// ---- 部品 ----
export function chairR(p, x, seatY, c = '#3a3f48') { // 右向きに座る椅子（背もたれが左）
  p.r(x - 1, seatY - 5, 1, 6, c); p.r(x - 1, seatY, 4, 1, c); p.r(x + 1, seatY + 1, 1, 2, c); p.r(x, seatY + 3, 3, 1, c);
}
export function chairL(p, x, seatY, c = '#3a3f48') {
  p.r(x + 3, seatY - 5, 1, 6, c); p.r(x, seatY, 4, 1, c); p.r(x + 1, seatY + 1, 1, 2, c); p.r(x, seatY + 3, 3, 1, c);
}
export function plant(p, x, yb, tall = 8) {
  p.box(x, yb - 3, 5, 4, '#b0603a');
  const g = ['#2f8a3a', '#3fa84a', '#246a2c'];
  for (let i = 0; i < tall; i++) {
    const w = i < 2 ? 3 : i < tall - 2 ? 5 : 3;
    p.r(x + 2 - (w >> 1), yb - 4 - i, w, 1, g[i % 3]);
  }
  p.p(x + 1, yb - 6, '#1d5a24'); p.p(x + 3, yb - 8, '#1d5a24');
}
export function picture(p, x, y, w, h, alt = 0) {
  p.box(x, y, w, h, '#8cc4e8');
  const hill = ['#4a9a4a', '#c87a3a', '#6a6ab8'][alt % 3];
  p.r(x + 1, y + h - 3, w - 2, 2, hill);
  p.p(x + w - 3, y + 2, '#f8e060');
}
export function lamp(p, x, y, c = '#ffe68a') {
  p.r(x + 1, y, 1, 2, '#444'); p.r(x, y + 2, 3, 2, c); p.p(x + 1, y + 4, '#fff8d0');
}
export function guardFig(p, x, yFeet, facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(x, yFeet - 8, 4, 1, '#1b3486'); p.r(hx, yFeet - 7, 2, 1, FIG);
  p.r(x, yFeet - 6, 3, 4, '#2f5ce0'); p.p(facing ? x + 2 : x, yFeet - 6, '#f0d040');
  p.r(x, yFeet - 2, 1, 2, '#14214f'); p.r(x + 2, yFeet - 2, 1, 2, '#14214f');
}
export function maidFig(p, x, yFeet, facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(hx, yFeet - 8, 2, 1, '#ffffff'); p.r(hx, yFeet - 7, 2, 1, FIG);
  p.r(x, yFeet - 6, 3, 4, '#2c2c48'); p.r(facing ? x + 1 : x, yFeet - 5, 2, 3, '#ffffff');
  p.r(x, yFeet - 2, 1, 2, FIG); p.r(x + 2, yFeet - 2, 1, 2, FIG);
}
export function coatFig(p, x, yFeet, coat = '#ffffff', facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(hx, yFeet - 8, 2, 2, FIG);
  p.r(x, yFeet - 6, 3, 5, coat); p.r(facing ? x : x + 2, yFeet - 6, 1, 5, shade(coat, -0.2));
  p.r(x, yFeet - 1, 1, 1, FIG); p.r(x + 2, yFeet - 1, 1, 1, FIG);
}
export function hatFig(p, x, yFeet, hat, facing = 1) {
  standFig(p, x, yFeet, FIG, facing);
  p.r(x, yFeet - 8, 3, 1, hat);
}

// ---- 各施設 ----
const DRAW = {};

DRAW.office = (p, v) => {
  if (!v.occ) {
    shell(p, '#8e959c', '#575d66', { base: '#7a8188' });
    for (let x = 12; x < p.w; x += 24) p.r(x, 1, 1, 20, '#848b92');
    p.sign('FOR RENT', p.w / 2, 6);
    return;
  }
  shell(p, '#d3dae0', '#6f7c8c', { base: '#b2bcc6' });
  // ホワイトボードと時計
  p.box(4, 3, 14, 6, '#ffffff'); p.r(6, 5, 6, 1, '#4a6ab8'); p.r(6, 7, 4, 1, '#c84a4a');
  p.box(33, 2, 5, 5, '#ffffff'); p.p(35, 3, INK); p.p(35, 4, INK); p.p(36, 4, INK);
  p.box(52, 3, 9, 6, '#9fb4c8'); p.r(54, 5, 5, 1, '#6a7f95');
  plant(p, 66, 20, 9);
  const seats = [];
  for (const sx of [2, 24, 46]) {
    chairR(p, sx, 17);
    chairL(p, sx + 16, 17);
    // 机
    p.r(sx + 5, 14, 10, 1, '#c8a878'); p.r(sx + 5, 15, 10, 1, '#7a5a38');
    p.r(sx + 6, 16, 1, 5, '#5a4028'); p.r(sx + 13, 16, 1, 5, '#5a4028');
    // PC
    p.box(sx + 6, 9, 4, 4, '#2a2f38'); p.r(sx + 7, 10, 2, 2, v.night ? '#bfe6ff' : '#7ab8e8'); p.r(sx + 7, 13, 2, 1, '#2a2f38');
    p.box(sx + 10, 9, 4, 4, '#2a2f38'); p.r(sx + 11, 10, 2, 2, v.night ? '#bfe6ff' : '#7ab8e8'); p.r(sx + 11, 13, 2, 1, '#2a2f38');
    p.p(sx + 9, 13, '#f4f4f4');
    seats.push([sx, 1], [sx + 16, 0]);
  }
  const order = [0, 3, 1, 4, 2, 5];
  for (let i = 0; i < Math.min(v.n, 6); i++) {
    const [x, f] = seats[order[i]];
    sitFig(p, f ? x : x, 17, FIG, f);
  }
};

DRAW.condo = (p, v) => {
  if (!v.occ) {
    shell(p, '#a8987a', '#6e5032', { base: '#8a7a5e' });
    p.r(98, 0, 3, 21, '#968766'); p.r(98, 0, 1, 21, '#7a6a4e');
    p.sign('FOR SALE', 48, 6);
    return;
  }
  const fy = shell(p, '#efdcae', '#9a6434', { base: '#a07a4a' });
  for (let x = 3; x < p.w - 1; x += 6) p.r(x, 1, 1, 19, '#f6e8c4');
  // キッチン
  p.r(10, 3, 15, 5, '#d8c49a'); p.box(10, 3, 15, 5, '#dcc8a0'); p.r(17, 4, 1, 3, '#9a8460');
  p.box(3, 6, 7, 15, '#f4f4f4'); p.r(4, 12, 5, 1, '#c8c8c8'); p.r(8, 8, 1, 2, '#888'); p.r(8, 14, 1, 3, '#888');
  p.box(10, 15, 15, 6, '#f0ece0'); p.r(10, 14, 15, 1, '#8a8a8a'); p.r(17, 16, 1, 4, '#c8c0b0');
  p.box(19, 12, 4, 2, '#555'); p.r(20, 11, 2, 1, '#888');
  // ダイニング
  p.r(36, 0, 1, 4, '#555'); p.r(34, 4, 5, 2, '#e8b840'); p.p(36, 6, '#fff3c0');
  p.r(30, 14, 14, 1, '#7a4a20'); p.r(30, 15, 14, 1, '#4a2a10'); p.r(32, 16, 1, 5, '#4a2a10'); p.r(41, 16, 1, 5, '#4a2a10');
  chairR(p, 27, 17, '#6a4020'); chairL(p, 44, 17, '#6a4020');
  // リビング
  picture(p, 56, 3, 14, 7, v.alt);
  const sofa = ['#c0503a', '#3a70a8', '#5a8a3a'][v.alt % 3];
  p.box(55, 11, 22, 5, sofa); p.box(55, 15, 22, 4, shade(sofa, 0.18));
  p.box(53, 13, 3, 6, shade(sofa, -0.2)); p.box(76, 13, 3, 6, shade(sofa, -0.2));
  p.r(56, 19, 1, 2, INK); p.r(75, 19, 1, 2, INK);
  p.box(82, 16, 13, 5, '#6a4222'); p.r(87, 18, 3, 1, '#3a2210');
  p.box(83, 8, 11, 8, '#1a1a1a'); p.r(84, 9, 9, 6, v.n > 0 && v.night ? '#9ad0ff' : '#3a5a88'); p.p(85, 10, '#c8e8ff');
  // 仕切り壁
  p.r(97, 0, 4, 21, '#d8c08c'); p.r(97, 0, 1, 21, '#9a8058'); p.r(100, 0, 1, 21, '#9a8058');
  // 寝室
  picture(p, 112, 3, 9, 6, v.alt + 1);
  const blank = ['#4a7ac8', '#c85a8a', '#58a868'][v.alt % 3];
  p.box(103, 10, 3, 11, '#6a4020');
  p.box(105, 14, 21, 4, '#ffffff'); p.box(105, 12, 5, 3, '#ffffff');
  p.box(110, 13, 16, 4, blank); p.r(111, 14, 14, 1, shade(blank, 0.25));
  p.r(106, 18, 1, 3, '#4a2a10'); p.r(124, 18, 1, 3, '#4a2a10');
  // 家族
  if (v.n >= 1) standFig(p, 14, fy - 1, FIG, 0, 0);
  if (v.n >= 2) sitFig(p, 64, 15, FIG, 1);
  if (v.n >= 3) childFig(p, 78, fy - 1, FIG, 1);
  if (v.n >= 4) { p.r(107, 12, 2, 2, FIG); }
};

export function bed(p, x, w, blanket, guest, dirty, rnd) {
  p.box(x, 10, 3, 11, '#7a4a22');
  p.r(x + 3, 18, 1, 3, '#4a2a10'); p.r(x + w - 1, 18, 1, 3, '#4a2a10');
  p.box(x + 2, 14, w - 1, 5, '#ffffff'); p.r(x + 3, 17, w - 3, 1, '#d8d8e0');
  if (!dirty) {
    p.box(x + 3, 12, 5, 3, '#ffffff');
    p.box(x + 8, 13, w - 7, 5, blanket); p.r(x + 9, 14, w - 9, 1, shade(blanket, 0.3));
    if (guest) { p.r(x + 4, 10, 3, 3, FIG); p.box(x + 9, 11, 7, 3, blanket); }
  } else {
    // 乱れたベッド
    p.box(x + 3 + ((rnd() * 3) | 0), 12, 5, 3, '#ffffff');
    for (let i = x + 8; i < x + w; i++) {
      const hgt = 2 + ((rnd() * 3) | 0);
      p.r(i, 16 - hgt, 1, hgt + 1, (i % 3 === 0) ? shade(blanket, -0.25) : blanket);
    }
    p.p(x + 6, 15, '#c8b890'); p.p(x + 12, 16, '#c8b890');
    p.r(x + w - 2, 16, 3, 5, blanket); p.p(x + w, 20, shade(blanket, -0.3));
  }
}
export function nightstand(p, x) {
  p.box(x, 16, 5, 5, '#7a4a22'); p.r(x + 1, 18, 3, 1, '#4a2a10');
  p.r(x + 2, 13, 1, 3, '#444'); p.box(x, 10, 5, 4, '#f4d070');
}
function hotelBase(p, suite) {
  const fy = suite ? shell(p, '#ecdcae', '#7a2848', { base: '#b89a5a' }) : shell(p, '#c9d8e6', '#7a3040', { base: '#9aa8b8' });
  if (suite) p.r(1, 4, p.w - 2, 1, '#c8a040');
  return fy;
}
function hotelExtras(p, v, x) {
  if (v.dirty) {
    // 散らかったもの
    p.box(x, 18, 4, 3, '#ffffff'); p.r(x + 5, 20, 3, 1, '#7ab0d8'); p.p(x - 3, 20, '#e0c040');
  } else if (v.occ && v.n === 0) {
    p.box(x, 16, 4, 5, '#b03838'); p.r(x + 1, 15, 2, 1, '#601818');
  }
}

DRAW.hotelSingle = (p, v) => {
  hotelBase(p, false);
  const rnd = rng(17 + v.alt);
  picture(p, 10, 3, 10, 5, v.alt);
  bed(p, 2, 20, ['#3b6cc4', '#c04a4a', '#3a9a6a'][v.alt % 3], v.n > 0, v.dirty, rnd);
  nightstand(p, 25);
  hotelExtras(p, v, 23);
  if (!v.occ && !v.dirty) p.p(27, 8, '#ffffff');
};
DRAW.hotelTwin = (p, v) => {
  hotelBase(p, false);
  const rnd = rng(29 + v.alt);
  const bc = ['#3b6cc4', '#c04a4a', '#3a9a6a'][(v.alt + 1) % 3];
  picture(p, 18, 3, 12, 5, v.alt);
  bed(p, 1, 18, bc, v.n > 0, v.dirty, rnd);
  bed(p, 24, 18, bc, v.n > 1, v.dirty, rnd);
  nightstand(p, 43 - 1);
  if (v.dirty) { p.box(20, 18, 4, 3, '#ffffff'); p.p(41, 20, '#e0c040'); }
  else if (v.occ && v.n === 0) { p.box(20, 16, 4, 5, '#b03838'); }
};
DRAW.hotelSuite = (p, v) => {
  hotelBase(p, true);
  const rnd = rng(41 + v.alt);
  // シャンデリア
  p.r(30, 1, 1, 3, '#806020'); p.r(26, 4, 9, 1, '#e0b040'); p.p(26, 5, '#fff2a0'); p.p(30, 5, '#fff2a0'); p.p(34, 5, '#fff2a0');
  // ソファとテーブルとテレビ
  picture(p, 8, 5, 14, 6, v.alt);
  p.box(4, 13, 20, 4, '#8a3a5a'); p.box(4, 16, 20, 3, '#a85478'); p.box(2, 14, 3, 5, '#6a2a44'); p.box(23, 14, 3, 5, '#6a2a44');
  p.r(5, 19, 1, 2, INK); p.r(22, 19, 1, 2, INK);
  p.r(28, 17, 10, 1, '#d8b060'); p.r(29, 18, 1, 3, '#806020'); p.r(36, 18, 1, 3, '#806020');
  p.p(32, 16, '#e04080'); p.p(33, 15, '#e04080');
  p.box(41, 16, 10, 5, '#5a3418'); p.box(42, 9, 8, 7, '#1a1a1a'); p.r(43, 10, 6, 5, v.n > 0 && v.night ? '#9ad0ff' : '#3a5a88');
  plant(p, 52, 20, 9);
  // 天蓋つきベッド
  p.r(60, 3, 30, 2, '#b8304a'); p.r(60, 3, 30, 1, '#e0b040');
  p.r(60, 5, 2, 9, '#c8405a'); p.r(88, 5, 2, 9, '#c8405a');
  bed(p, 60, 30, '#d8b048', v.n > 0, v.dirty, rnd);
  if (!v.dirty && v.n > 1) p.r(64, 9, 2, 2, FIG);
  nightstand(p, 91);
  if (v.dirty) { p.box(46, 18, 5, 3, '#ffffff'); p.r(30, 20, 3, 1, '#e0c040'); p.p(56, 20, '#7ab0d8'); }
  else if (v.occ && v.n === 0) { p.box(56, 15, 4, 6, '#2a2a2a'); p.box(53, 17, 3, 4, '#b03838'); }
  if (v.n > 2) sitFig(p, 12, 16, FIG, 1);
};

DRAW.fastfood = (p, v) => {
  const W = p.w;
  shell(p, '#fff0c0', '#ffffff', {});
  p.r(1, 13, W - 2, 8, '#e04a30'); p.r(1, 13, W - 2, 1, '#ffffff'); p.r(1, 15, W - 2, 1, '#f8c040');
  for (let x = 0; x < W; x += 4) p.r(x, 21, 2, 1, '#d02020');
  p.box(5, 2, 36, 8, '#2a2a2a');
  const mc = ['#f8c040', '#e05030', '#70c050', '#f0e0c0', '#e07040'];
  for (let i = 0; i < 5; i++) { p.r(8 + i * 7, 4, 4, 3, mc[i]); p.r(8 + i * 7, 8, 3, 1, '#c8c8c8'); }
  p.sign('BURGER', 96, 3, '#e03a2a', '#fff8d0');
  // 店員
  if (v.open && v.n > 0) { hatFig(p, 13, 19, '#e03a2a', 1); hatFig(p, 24, 19, '#e03a2a', 1); }
  p.box(4, 12, 41, 9, '#f2f2f2'); p.r(5, 15, 39, 2, '#e03a2a'); p.r(3, 11, 43, 2, '#9a9a9a');
  p.box(35, 7, 7, 5, '#404040'); p.r(36, 8, 3, 1, '#80e080');
  p.r(7, 10, 3, 1, '#f8c040'); p.r(16, 10, 4, 1, '#c04020');
  // テーブル
  const tables = [54, 78, 102];
  for (const x of tables) {
    p.r(x, 14, 10, 1, '#c03020'); p.r(x, 15, 10, 1, '#801810'); p.r(x + 4, 16, 2, 4, '#606060'); p.r(x + 2, 20, 6, 1, '#606060');
    p.r(x - 5, 17, 4, 1, '#f0c030'); p.r(x - 4, 18, 1, 3, '#606060');
    p.r(x + 11, 17, 4, 1, '#f0c030'); p.r(x + 13, 18, 1, 3, '#606060');
  }
  if (!v.open) return;
  const n = v.n;
  let k = 0;
  if (k++ < n) standFig(p, 20, 20, FIG, 0, 0);
  if (k++ < n) standFig(p, 30, 20, FIG, 0, 1);
  for (const x of tables) {
    if (k++ < n) sitFig(p, x - 5, 17, FIG, 1);
    if (k++ < n) sitFig(p, x + 13, 17, FIG, 0);
  }
  if (k++ < n) standFig(p, 47, 20, FIG, 0, 1);
};

DRAW.restaurant = (p, v) => {
  const W = p.w;
  shell(p, '#a8382e', '#3a2014', {});
  for (let x = 4; x < W - 1; x += 8) { p.p(x, 3, '#c0503e'); p.p(x + 4, 7, '#c0503e'); p.p(x, 11, '#c0503e'); }
  p.r(1, 12, W - 2, 1, '#d8a840');
  p.r(1, 13, W - 2, 8, '#e8cfa0'); for (let x = 6; x < W; x += 12) p.r(x, 14, 1, 6, '#c8ac78');
  p.r(1, 20, W - 2, 1, '#8a6038');
  for (let x = 8; x < W - 30; x += 38) { p.r(x, 5, 2, 3, '#ffe080'); p.p(x, 4, '#806020'); }
  // 厨房の窓
  p.box(166, 2, 24, 10, '#c8ccd0'); p.r(167, 3, 22, 8, '#e8ecef');
  if (v.open && v.n > 0) { p.r(176, 5, 2, 2, FIG); p.r(175, 3, 4, 2, '#ffffff'); p.r(175, 7, 4, 4, '#ffffff'); }
  p.r(166, 12, 24, 1, '#c0c0c0');
  plant(p, 2, 20, 10);
  const tables = [14, 52, 90, 128];
  for (const x of tables) {
    // 椅子
    p.r(x - 5, 10, 1, 7, '#5a2a10'); p.r(x - 5, 16, 4, 1, '#7a3a18'); p.r(x - 4, 17, 1, 4, '#5a2a10');
    p.r(x + 22, 10, 1, 7, '#5a2a10'); p.r(x + 19, 16, 4, 1, '#7a3a18'); p.r(x + 21, 17, 1, 4, '#5a2a10');
  }
  const n = v.open ? v.n : 0;
  let k = 0;
  for (const x of tables) {
    if (k++ < n) sitFig(p, x - 4, 16, FIG, 1);
    if (k++ < n) sitFig(p, x + 19, 16, FIG, 0);
  }
  for (const x of tables) {
    p.box(x, 12, 18, 3, '#ffffff'); p.r(x, 15, 1, 4, '#f0f0f0'); p.r(x + 17, 15, 1, 4, '#f0f0f0');
    p.r(x + 8, 15, 2, 6, '#3a1a0a');
    p.r(x + 8, 9, 1, 3, '#ffffff'); p.p(x + 8, 8, v.open ? '#ffb020' : '#7a5a3a');
    p.p(x + 4, 11, '#c8e0f0'); p.p(x + 13, 11, '#c8e0f0');
  }
  if (v.open && v.n > 2) { standFig(p, 158, 20, FIG, 0, 0); p.r(155, 14, 4, 1, '#d0d0d0'); p.r(160, 15, 1, 1, '#ffffff'); }
};

DRAW.shop = (p, v) => {
  const W = p.w;
  shell(p, '#e4eef6', '#c8bca8', {});
  for (let x = 1; x < W - 1; x += 6) p.r(x, 1, 3, 2, (x / 6) % 2 ? '#e86a8a' : '#ffffff');
  const rnd = rng(77 + v.alt);
  const goods = ['#e04848', '#f0b030', '#40a0e0', '#60c060', '#c060c0', '#f08040', '#ffffff', '#3a5ab0'];
  for (const sx of [3, 27, 51]) {
    p.box(sx, 4, 21, 17, '#d8c8a8');
    for (const row of [9, 14, 19]) {
      p.r(sx + 1, row, 19, 1, '#8a6a40');
      for (let x = sx + 2; x < sx + 19;) {
        const w = 2 + ((rnd() * 2) | 0), h = 2 + ((rnd() * 2) | 0);
        if (x + w > sx + 20) break;
        p.r(x, row - h, w, h, goods[(rnd() * goods.length) | 0]);
        x += w + 1;
      }
    }
  }
  if (v.open && v.n > 0) standFig(p, 84, 19, '#2a5a9a', 0, 0);
  p.box(77, 13, 18, 8, '#6a8ab0'); p.r(76, 12, 20, 1, '#444');
  p.box(87, 8, 6, 4, '#333'); p.p(88, 9, '#80e080');
  if (!v.open) return;
  const pos = [24, 48, 72, 14, 38];
  for (let i = 0; i < Math.min(v.n, pos.length); i++) standFig(p, pos[i], 20, FIG, i % 2, i % 2);
};

const SCREENS = [
  (p, x, y, w, h) => { p.r(x, y, w, h, '#78b8f0'); p.r(x, y + h - 9, w, 9, '#4a9a4a'); p.disc(x + w - 14, y + 7, 4, '#f8e060'); p.r(x + 20, y + h - 14, 3, 6, FIG); p.r(x + 19, y + h - 16, 4, 2, FIG); },
  (p, x, y, w, h) => { p.r(x, y, w, h, '#101838'); p.r(x, y + h - 8, w, 8, '#20406a'); p.disc(x + 18, y + 8, 4, '#f0f0d0'); for (let i = 0; i < 8; i++) p.p(x + 5 + i * 11, y + 3 + (i * 7) % 9, '#ffffff'); },
  (p, x, y, w, h) => { p.r(x, y, w, h, '#f0a050'); p.r(x, y + h - 8, w, 8, '#c86a30'); p.r(x + 60, y + 8, 3, 14, '#3a8a3a'); p.r(x + 57, y + 12, 3, 2, '#3a8a3a'); p.r(x + 63, y + 10, 3, 2, '#3a8a3a'); },
  (p, x, y, w, h) => { p.r(x, y, w, h, '#060818'); p.disc(x + 50, y + 15, 9, '#c86a4a'); p.r(x + 36, y + 15, 29, 1, '#e8c0a0'); for (let i = 0; i < 12; i++) p.p(x + 4 + i * 7, y + 2 + (i * 5) % 26, '#ffffff'); },
];

DRAW.cinema = (p, v) => {
  const W = p.w, fy = p.h - 3;
  shell(p, '#1e1828', '#3a1a24', {});
  // ロビー
  p.r(1, 1, 47, fy - 1, '#4a2f5a');
  for (let x = 3; x < 46; x += 4) p.p(x, 3, v.open ? '#ffe070' : '#7a6a40');
  const pc = [['#e04848', '#f8d040'], ['#3a6ad0', '#ffffff'], ['#40a060', '#f0f0f0']];
  for (let i = 0; i < 3; i++) {
    const x = 3 + i * 14;
    p.box(x, 8, 11, 16, pc[(i + v.week) % 3][0]); p.r(x + 2, 11, 7, 6, pc[(i + v.week) % 3][1]); p.r(x + 2, 19, 7, 1, '#ffffff'); p.r(x + 2, 21, 5, 1, '#ffffff');
  }
  p.box(26, 31, 20, fy - 31, '#c8a040'); p.r(28, 33, 16, 5, '#f8f0d0');
  if (v.open) standFig(p, 34, 37, FIG, 0);
  p.r(48, 1, 2, fy - 1, '#120c18');
  // スクリーン（右端に寄せる）
  const dx = Math.max(0, W - 248);
  p.r(147 + dx, 3, 4, 40, '#a01828'); p.r(242 + dx, 3, 4, 40, '#a01828');
  p.box(151 + dx, 6, 91, 31, '#f4f4f4');
  if (v.open) SCREENS[v.week % SCREENS.length](p, 152 + dx, 7, 89, 29);
  else p.r(152 + dx, 7, 89, 29, '#8a8a94');
  for (let x = 147 + dx; x < 151 + dx; x += 2) p.r(x, 3, 1, 40, '#801020');
  p.r(146 + dx, 1, 101, 3, '#c02838'); p.r(146 + dx, 3, 101, 1, '#e0b040');
  if (dx) { for (let x = 148; x < 146 + dx; x += 10) p.r(x, 12, 2, 2, '#4a3a5a'); }
  // 客席（ひな壇）
  let k = 0;
  const n = v.open ? v.n : 0;
  for (let t = 0; t < 5; t++) {
    const x0 = 52 + t * 19, ty = fy - (4 - t) * 6;
    p.r(x0, ty, 19, fy - ty, '#2a1420'); p.r(x0, ty, 19, 1, '#5a2a3a');
    for (const sx of [x0 + 3, x0 + 11]) {
      p.r(sx, ty - 8, 1, 7, '#b02030'); p.r(sx, ty - 2, 5, 1, '#b02030'); p.r(sx + 3, ty - 1, 1, 1, '#601020');
      if (k++ < n) { sitFig(p, sx + 1, ty - 3, '#6a5a7a', 1); p.p(sx + 2, ty - 10, '#8a7a9a'); }
    }
  }
  // 映写の光
  p.box(51, 4, 5, 4, '#3a3a3a');
  if (v.open && v.n > 0) {
    const g = p.g; g.save(); g.globalAlpha = 0.13; g.fillStyle = '#fff6d0';
    g.beginPath(); g.moveTo(56, 6); g.lineTo(151 + dx, 7); g.lineTo(151 + dx, 37); g.closePath(); g.fill(); g.restore(); p._fs = null;
  }
};

DRAW.partyHall = (p, v) => {
  const W = p.w, fy = p.h - 3;
  shell(p, '#f2e2c4', '#b0804a', {});
  p.r(1, 34, W - 2, fy - 34, '#d8bc8a'); p.r(1, 34, W - 2, 1, '#a88050');
  const st = W - 44;
  for (let x = 4; x < st - 4; x += 36) {
    p.r(x, 1, 4, fy - 1, '#e2cca0'); p.r(x, 1, 1, fy - 1, '#c4aa7a'); p.r(x + 3, 1, 1, fy - 1, '#c4aa7a');
    const wx = x + 13;
    p.box(wx, 9, 12, 18, v.night ? '#1a2850' : '#8ab8e0'); p.r(wx + 1, 8, 10, 1, '#000'); p.r(wx + 3, 7, 6, 1, '#000');
    p.r(wx + 2, 8, 8, 1, v.night ? '#1a2850' : '#8ab8e0'); p.r(wx + 5, 9, 1, 17, '#f2e2c4');
  }
  // 舞台
  p.r(st, 4, 43, 32, '#901828');
  for (let x = st + 1; x < st + 42; x += 4) p.r(x, 4, 1, 32, '#6a1020');
  p.r(st, 2, 43, 4, '#c03040'); p.r(st, 6, 43, 1, '#e0b040');
  p.box(st, 36, 43, fy - 36, '#6a3a1a'); p.r(st + 1, 37, 41, 1, '#9a6030');
  p.r(st + 22, 28, 1, 8, '#444'); p.p(st + 22, 27, '#888');
  // シャンデリア
  for (const cx of W > 230 ? [52, 124, 172] : [52, 124]) {
    p.r(cx, 1, 1, 4, '#806020'); p.r(cx - 5, 5, 11, 2, '#e0b040'); p.r(cx - 3, 7, 7, 1, '#c89020');
    for (let i = -5; i <= 5; i += 2) p.p(cx + i, 4, v.open ? '#fff6b0' : '#c8b070');
    p.p(cx, 8, '#fff6b0');
  }
  const tables = W > 230 ? [18, 60, 102, 144, 178] : [18, 60, 102, 144];
  const n = v.open ? v.n : 0;
  let k = 0;
  if (n > 0) standFig(p, st + 20, 35, '#c02060', 0, 0);
  const spots = [];
  for (const x of tables) spots.push([x - 5, 1], [x + 18, 0]);
  spots.push([40, 0], [84, 1], [126, 0]);
  for (const [x, f] of spots) { if (++k < n) standFig(p, x, fy - 1, FIG, f, k % 2); }
  for (const x of tables) {
    p.box(x, 35, 16, 3, '#ffffff'); p.r(x + 1, 38, 14, fy - 38, '#f0ece4'); p.r(x + 1, 38, 1, fy - 38, '#d0ccc4');
    p.r(x + 7, 32, 2, 3, '#e04080'); p.p(x + 6, 33, '#40a040'); p.p(x + 9, 33, '#40a040');
  }
};

DRAW.security = (p, v) => {
  const fy = shell(p, '#b4c2d2', '#4f5a68', { base: '#8c9aaa' });
  p.box(4, 2, 40, 12, '#2a2f3a');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    p.box(6 + i * 12, 3 + j * 5, 11, 5, '#111');
    p.r(7 + i * 12, 4 + j * 5, 9, 3, (i + j) % 2 ? '#3a8a5a' : '#4a7aa8');
    p.r(8 + i * 12, 5 + j * 5, 4, 1, '#b8f0c8');
  }
  p.r(3, 14, 42, 1, '#3a4048'); p.box(4, 15, 40, 6, '#6a7480');
  p.sign('SECURITY', 72, 3, '#1b3486', '#f4f6fa');
  p.box(96, 3, 28, 18, '#8a96a4');
  for (let x = 103; x < 124; x += 7) p.r(x, 4, 1, 16, '#5a6470');
  for (let x = 98; x < 124; x += 7) { p.r(x, 5, 3, 1, '#5a6470'); p.r(x, 7, 3, 1, '#5a6470'); p.p(x + 4, 12, '#d0d0d0'); }
  const pos = [48, 60, 68, 78, 86, 56];
  for (let i = 0; i < Math.min(v.n, 6); i++) guardFig(p, pos[i], fy - 1, i === 0 ? 0 : i % 2);
};

DRAW.housekeeping = (p, v) => {
  const fy = shell(p, '#d4e6dc', '#7a8c82', { base: '#b0c4b8' });
  for (const x of [4, 16, 28]) {
    p.box(x, 10, 11, 11, '#f4f4f4'); p.r(x + 1, 11, 9, 1, '#c8d0d8'); p.p(x + 8, 12, '#40c040');
    p.disc(x + 5, 16, 2, '#3a3a3a'); p.disc(x + 5, 16, 1, '#8ab8d8');
  }
  p.box(42, 3, 22, 18, '#c8a878');
  const tc = ['#ffffff', '#f0c0d0', '#c0e0f8', '#ffffff', '#f8f0b0'];
  for (const row of [8, 13, 19]) {
    p.r(43, row, 20, 1, '#8a6a40');
    for (let i = 0; i < 4; i++) { p.r(44 + i * 5, row - 3, 4, 3, tc[(i + row) % tc.length]); p.r(44 + i * 5, row - 2, 4, 1, '#d8d8d8'); }
  }
  for (const x of [70, 94]) {
    p.r(x + 2, 9, 12, 3, '#ffffff'); p.r(x + 3, 8, 5, 1, '#f0c0d0');
    p.box(x, 12, 16, 7, '#9aa4ac'); p.r(x + 1, 14, 14, 1, '#7a848c');
    p.r(x + 15, 8, 1, 4, '#5a646c');
    p.r(x + 2, 19, 2, 2, INK); p.r(x + 12, 19, 2, 2, INK);
  }
  const pos = [36, 66, 88, 110, 58, 82];
  for (let i = 0; i < Math.min(v.n, 6); i++) maidFig(p, pos[i], fy - 1, i % 2);
};

DRAW.medical = (p, v) => {
  // v.n = 患者数（下位3ビット、0..3） + 職員数×8（0..3）
  const pts = v.n & 7, staff = (v.n >> 3) & 3;
  const fy = shell(p, '#eef4f2', '#9ab8b4', { base: '#cfe0dc' });
  p.box(6, 2, 11, 11, '#ffffff'); p.r(10, 4, 3, 7, '#20a050'); p.r(8, 6, 7, 3, '#20a050');
  if (staff > 0) coatFig(p, 12, 19, '#f0a0c0', 1);
  p.box(4, 14, 26, 7, '#d0dcd8'); p.r(3, 13, 28, 1, '#7a8a88');
  const beds = p.w < 200 ? [36, 74, 112] : [38, 80, 122];
  for (let i = 0; i < 3; i++) {
    const x = beds[i];
    const sick = i < pts;
    p.r(x - 2, 1, 38, 1, '#888');
    // 患者がいるベッドはカーテンを半分閉める
    p.r(x - 2, 2, sick ? 10 : 6, 18, '#a8d0e8'); p.r(x, 2, 1, 18, '#88b0c8'); p.r(x + 2, 2, 1, 18, '#88b0c8'); if (sick) p.r(x + 5, 2, 1, 18, '#88b0c8');
    p.box(x + 8, 14, 22, 4, '#ffffff'); p.box(x + 8, 12, 5, 3, '#ffffff');
    p.r(x + 9, 18, 1, 3, '#888'); p.r(x + 28, 18, 1, 3, '#888'); p.r(x + 8, 18, 22, 1, '#a0a8a8');
    if (sick) {
      // 横になった患者: 枕の上の頭と、布団のふくらみ
      p.r(x + 9, 11, 3, 2, '#2a2a2a'); p.p(x + 10, 13, '#f0d0b8');
      p.box(x + 12, 12, 17, 4, '#9ad8c8'); p.r(x + 15, 11, 9, 1, '#9ad8c8'); p.r(x + 14, 11, 11, 1, '#000'); p.r(x + 14, 11, 1, 1, '#000');
      p.r(x + 15, 12, 9, 1, '#b8e8dc');
      // 点滴（中身あり）と心電図
      p.r(x + 32, 5, 1, 16, '#888'); p.box(x + 31, 4, 3, 5, '#d8f0ff'); p.r(x + 32, 6, 1, 2, '#e8c040'); p.r(x + 30, 20, 5, 1, '#888');
      p.line(x + 32, 9, x + 28, 13, '#c8d8e0');
      p.box(x + 22, 4, 7, 5, '#202a28'); p.r(x + 23, 6, 2, 1, '#40e080'); p.p(x + 25, 5, '#40e080'); p.r(x + 26, 6, 2, 1, '#40e080');
    } else {
      p.box(x + 13, 13, 16, 3, '#9ad8c8');
      p.r(x + 32, 5, 1, 16, '#888'); p.box(x + 31, 4, 3, 5, '#d8f0ff'); p.r(x + 30, 20, 5, 1, '#888');
    }
  }
  const mx = p.w - 42, sx = p.w - 24;
  p.box(mx, 5, 13, 9, '#202a28'); p.r(mx + 1, 9, 3, 1, '#40e080'); p.r(mx + 4, 7, 1, 2, '#40e080'); p.r(mx + 5, 10, 1, 1, '#40e080'); p.r(mx + 6, 9, 5, 1, '#40e080');
  p.box(sx, 3, 20, 18, '#e0e8e8');
  for (const row of [8, 13]) { p.r(sx + 1, row, 18, 1, '#9aa'); for (let i = 0; i < 6; i++) p.r(sx + 2 + i * 3, row - 3, 2, 3, ['#e05050', '#ffffff', '#5090e0', '#f0c040'][i % 4]); }
  p.r(sx + 1, 18, 18, 1, '#9aa');
  if (staff > 1) coatFig(p, sx - 6, fy - 1, '#ffffff', 0);
  if (staff > 2) coatFig(p, beds[1] - 6, fy - 1, '#ffffff', 1);
  if (pts > 0 && staff > 0) coatFig(p, beds[0] + 30, fy - 1, '#ffffff', 0);
};


DRAW.metro = (p, v) => {
  const W = p.w;
  // 下の 2 フロア：ホーム（背景）
  const fy = shell(p, '#4a4e56', '#5a5e64', {});
  for (let x = 1; x < W - 1; x += 8) p.r(x, 26, 1, 30, '#42464e');
  p.r(1, 30, W - 2, 4, '#e0c040'); p.r(1, 34, W - 2, 1, '#a08820');
  for (let x = 20; x < W - 20; x += 60) { p.box(x, 38, 26, 12, '#f4f4f4'); p.r(x + 2, 40, 10, 8, ['#e05050', '#4080d0', '#40a060', '#f0a030'][(x / 60) % 4 | 0]); p.r(x + 14, 41, 9, 1, '#888'); p.r(x + 14, 44, 7, 1, '#888'); }
  for (let x = 12; x < W; x += 40) { p.r(x, 25, 12, 1, '#f0f8e0'); }
  // 線路
  p.r(1, 62, W - 2, 7, '#2a2a2e'); p.r(1, 64, W - 2, 1, '#9a9aa0');
  // 上のフロア：コンコース
  p.r(0, 0, W, 21, '#dfe3e6');
  for (let x = 4; x < W; x += 4) p.r(x, 1, 1, 20, '#d0d5d9');
  for (let y = 4; y < 21; y += 4) p.r(1, y, W - 2, 1, '#d0d5d9');
  p.r(0, 0, W, 1, '#a8acb0');
  p.r(1, 21, W - 2, 1, '#9aa0a6'); p.r(0, 22, W, 1, SLAB); p.r(0, 23, W, 1, '#000');
  p.r(0, 0, 1, p.h, '#000');
  // 改札
  p.box(92, 2, 56, 9, '#1a4a9a'); p.text('METRO', 110, 4, '#ffffff'); p.r(94, 9, 52, 1, '#e0c040');
  for (let x = 96; x <= 144; x += 12) { p.box(x, 13, 4, 8, '#6a7a8a'); p.r(x + 1, 14, 2, 1, '#40e070'); }
  p.box(172, 7, 10, 14, '#3a7ac0'); p.r(174, 9, 6, 4, '#c8e8ff'); p.box(186, 7, 10, 14, '#3a7ac0'); p.r(188, 9, 6, 4, '#c8e8ff');
  // ホームへの階段
  p.r(8, 22, 40, 2, '#4a4e56');
  for (let i = 0; i < 9; i++) {
    const x = 8 + i * 4, y = 21 + i * 4;
    p.r(x, y, 4, 58 - y, '#7a7e86'); p.r(x, y, 4, 1, '#b8bcc2'); p.r(x, y + 1, 1, 3, '#4a4e56');
  }
  p.r(8, 22, 1, 36, '#4a4e56');
  p.line(10, 15, 46, 51, '#202020'); p.r(46, 51, 1, 7, '#202020');
  const n = v.n;
  const pos = [60, 112, 126, 200, 160, 218];
  for (let i = 0; i < Math.min(n, 3); i++) standFig(p, pos[i] + 10, 20, FIG, i % 2, i % 2);
};
// ホーム手前（電車の前に描く層）
function metroFg(p, v) {
  const W = p.w, fy = p.h - 3;
  p.r(0, 58, W, 1, '#f0d020'); p.r(0, 59, W, fy - 59, '#8a8e94'); p.r(0, 60, W, 1, '#6a6e74');
  for (let x = 6; x < W; x += 16) p.r(x, 61, 8, fy - 62, '#7e8288');
  for (let x = 58; x < W - 4; x += 60) { p.r(x, 24, 4, 34, '#b8bcc2'); p.r(x, 24, 1, 34, '#8a8e94'); p.r(x + 3, 24, 1, 34, '#6a6e74'); p.r(x - 1, 24, 6, 2, '#6a6e74'); p.box(x - 6, 27, 16, 6, '#1a4a9a'); p.text('M', x, 28, '#ffffff'); }
  p.r(0, fy, W, 1, '#5a5e64'); p.r(0, fy + 1, W, 1, SLAB); p.r(0, fy + 2, W, 1, '#000'); p.r(0, 24, 1, 48, '#000');
  const pos = [64, 80, 96, 136, 150, 170, 186, 206, 222, 54, 116];
  for (let i = 0; i < Math.min(Math.max(0, v.n - 3), pos.length); i++) standFig(p, pos[i], 57, FIG, i % 2, i % 2);
}

DRAW.cathedral = (p, v) => {
  const oy = p.oy, W = p.w;
  const stone = '#cdc5b4', dark = '#a8a090', slate = '#565a78';
  // 屋根（三角）
  for (let y = 0; y < 34; y++) {
    const half = Math.round((y / 34) * 92);
    p.r(120 - half, oy - 34 + y, half * 2, 1, (y % 3 === 0) ? '#4a4e6a' : slate);
    p.p(120 - half - 1, oy - 34 + y, INK); p.p(120 + half, oy - 34 + y, INK);
  }
  p.r(26, oy - 1, W - 52, 1, INK);
  const tower = (x, w, top, apex) => {
    p.box(x, oy - top, w, top, stone);
    for (let yy = oy - top + 4; yy < oy; yy += 6) p.r(x + 1, yy, w - 2, 1, dark);
    // 尖塔
    const h = top - apex;
    for (let y = 0; y < h; y++) {
      const half = Math.max(1, Math.round(((y + 1) / h) * (w / 2 + 1)));
      p.r(x + w / 2 - half, oy - top - h + y, half * 2, 1, slate);
      p.p(x + w / 2 - half - 1, oy - top - h + y, INK); p.p(x + w / 2 + half, oy - top - h + y, INK);
    }
    // 十字架
    const cx = x + w / 2 - 1;
    p.r(cx, oy - top - h - 8, 2, 8, '#f0c830'); p.r(cx - 2, oy - top - h - 6, 6, 2, '#f0c830');
    // 鐘楼の窓
    p.box(x + w / 2 - 4, oy - top + 6, 8, 12, '#2a2a3a'); p.r(x + w / 2 - 3, oy - top + 5, 6, 1, INK);
    p.box(x + w / 2 - 2, oy - top + 10, 4, 4, '#e0b030');
  };
  tower(16, 28, 40, 0);
  tower(196, 28, 40, 0);
  // 中央塔
  p.box(106, oy - 50, 28, 50, stone);
  for (let yy = oy - 46; yy < oy; yy += 6) p.r(107, yy, 26, 1, dark);
  for (let y = 0; y < 30; y++) {
    const half = Math.max(1, Math.round(((y + 1) / 30) * 15));
    p.r(120 - half, oy - 80 + y, half * 2, 1, slate);
    p.p(120 - half - 1, oy - 80 + y, INK); p.p(120 + half, oy - 80 + y, INK);
  }
  p.r(119, oy - 88, 2, 9, '#f0c830'); p.r(116, oy - 85, 8, 2, '#f0c830');
  // バラ窓
  p.disc(120, oy - 28, 8, INK);
  const rose = ['#d02838', '#2848c8', '#f0c830', '#28a050', '#8838b8'];
  for (let a = 0; a < 10; a++) {
    const ang = (a / 10) * Math.PI * 2;
    p.disc(120 + Math.round(Math.cos(ang) * 4), oy - 28 + Math.round(Math.sin(ang) * 4), 2, rose[a % 5]);
  }
  p.disc(120, oy - 28, 2, '#f8f0c0');
  // 室内
  const fy = shell(p, '#dcd4c2', '#b02030', {});
  p.r(1, fy, 18, 1, '#8a8070'); p.r(W - 19, fy, 18, 1, '#8a8070');
  const rnd = rng(99);
  const glass = ['#d02838', '#2848c8', '#f0c830', '#28a050', '#8838b8', '#30a0d0'];
  for (let x = 6; x < W - 10; x += 26) {
    p.r(x, oy, 3, 21, '#b8b0a0'); p.r(x, oy, 1, 21, '#9a9282');
    if (x + 26 > W - 10) break;
    const gx = x + 8;
    if (gx > 100 && gx < 136) continue;
    p.box(gx, oy + 3, 10, 14, INK); p.r(gx + 1, oy + 2, 8, 1, INK); p.r(gx + 3, oy + 1, 4, 1, INK);
    for (let yy = oy + 2; yy < oy + 16; yy++) for (let xx = gx + 1; xx < gx + 9; xx++) {
      if (yy === oy + 2 && (xx < gx + 2 || xx > gx + 7)) continue;
      p.p(xx, yy, ((xx - gx) % 4 === 0 || (yy - oy) % 5 === 0) ? '#202028' : glass[(rnd() * glass.length) | 0]);
    }
  }
  // 祭壇
  p.r(119, oy + 2, 2, 10, '#e0b030'); p.r(116, oy + 4, 8, 2, '#e0b030');
  p.box(106, oy + 14, 28, 7, '#f0e8d8'); p.r(107, oy + 15, 26, 2, '#d0a030');
  p.r(108, oy + 11, 1, 3, '#ffffff'); p.p(108, oy + 10, '#ffb020'); p.r(131, oy + 11, 1, 3, '#ffffff'); p.p(131, oy + 10, '#ffb020');
  // 長椅子
  for (let x = 20; x < W - 20; x += 13) {
    if (x > 96 && x < 140) continue;
    p.r(x, oy + 12, 1, 9, '#5a3018'); p.r(x, oy + 16, 9, 2, '#7a4420'); p.r(x + 8, oy + 17, 1, 4, '#5a3018');
  }
  for (let i = 0; i < Math.min(v.n, 12); i++) {
    const x = 22 + (i % 6) * 13 + (i >= 6 ? 104 + 13 : 0);
    sitFig(p, x + 1, oy + 16, FIG, 1);
  }
};

// ---- タイル（ロビー・空きフロア） ----
export function lobbyTile(col, kind) {
  const p = new Painter(TILE_W, FLOOR_H);
  p.r(0, 0, 8, 21, '#efe6d2');
  const r = rng(13 + col * 7);
  for (let i = 0; i < 4; i++) p.p((r() * 8) | 0, 2 + ((r() * 18) | 0), '#dcd0b6');
  p.r(0, 0, 8, 2, '#d8ccb0'); p.r(0, 2, 8, 1, '#bfb294');
  for (let x = 0; x < 8; x++) p.p(x, 21, ((x >> 1) + col) % 2 ? '#9a9080' : '#faf6ee');
  p.r(0, 20, 8, 1, '#d4c8ae');
  p.r(0, 22, 8, 1, SLAB); p.r(0, 23, 8, 1, '#000');
  if (kind === 'pillar') {
    p.r(1, 3, 6, 17, '#f8f4ea'); p.r(1, 3, 1, 17, '#d8d0bc'); p.r(6, 3, 1, 17, '#bfb4a0'); p.r(3, 5, 1, 13, '#e4dccc'); p.r(4, 5, 1, 13, '#e8e0d0');
    p.r(0, 3, 8, 2, '#e8dec8'); p.r(0, 3, 8, 1, '#a89c80'); p.r(0, 18, 8, 3, '#e0d6c0'); p.r(0, 18, 8, 1, '#a89c80');
  } else if (kind === 'lamp') {
    p.r(3, 3, 2, 1, '#888'); p.r(2, 4, 4, 2, '#ffe7a0'); p.r(3, 6, 2, 1, '#fffbe0');
  } else if (kind === 'doorL' || kind === 'doorR') {
    p.box(1, 5, 7, 16, '#a8d8ec'); p.r(4, 6, 1, 14, '#000'); p.r(2, 7, 1, 5, '#e8f8ff'); p.r(5, 7, 1, 5, '#e8f8ff');
    p.r(0, 4, 8, 1, '#5a5040');
    if (kind === 'doorL') p.r(0, 0, 1, 24, '#000');
  } else if (kind === 'plant') {
    plant(p, 1, 20, 9);
  }
  return p.c;
}
export function floorTile(col) {
  const p = new Painter(TILE_W, FLOOR_H);
  p.r(0, 0, 8, 21, '#9c978a');
  p.r(0, 0, 8, 1, '#7a756a');
  if (col === 0) { p.r(0, 0, 2, 21, '#8a857a'); p.r(1, 0, 1, 21, '#7e796e'); }
  p.r(0, 21, 8, 1, '#6a665e'); p.r(0, 22, 8, 1, SLAB); p.r(0, 23, 8, 1, '#000');
  if (col === 2) { p.r(3, 1, 3, 1, '#6a665e'); }
  return p.c;
}

// ---- 移動手段 ----
// 本家と同じく、背景のない細い斜めの帯だけを描く（後ろのテナントがほぼ隠れない）。
// 左下（この階の床）から右上（上の階の床）へ、黒縁・明るい踏み面・段の刻みの帯。
function diagonalBand(p, x0, x1, fy, body, top, edge, stepAt) {
  for (let x = x0; x < x1; x++) {
    const t = (x - x0) / (x1 - x0 - 1);
    const y = Math.round(fy - 1 - t * (fy - 1));
    p.p(x, y - 1, edge);
    p.p(x, y, stepAt(x) ? edge : top);
    p.r(x, y + 1, 1, 2, body);
    p.p(x, y + 3, edge);
  }
  // 上下の踊り場（床に沿った短い板）
  p.r(x0 - 3, fy - 1, 3, 1, top); p.r(x0 - 3, fy, 3, 1, edge);
  p.r(x1, 0, 3, 1, top); p.r(x1, 1, 3, 1, edge);
}
function stairsArt(p, v) {
  const W = p.w, fy = p.h - 3;
  diagonalBand(p, 4, W - 4, fy, '#a8a49a', '#e4e0d6', '#2a2824', (x) => x % 3 === 0);
}
function escalatorArt(p, v) {
  const W = p.w, fy = p.h - 3, x0 = 4, x1 = W - 4;
  diagonalBand(p, x0, x1, fy, '#9aa2ac', '#d8dee6', '#24282e', (x) => (x + v.frame) % 4 === 0);
  // 細い手すり（線だけ）
  for (let x = x0; x < x1; x += 1) {
    const t = (x - x0) / (x1 - x0 - 1);
    p.p(x, Math.round(fy - 1 - t * (fy - 1)) - 5, '#2c3e50');
  }
}
export function shaftSeg(w, express, label) {
  // 本家風: 飾りのない暗いシャフトに、止まる階だけ大きく淡い階数
  const W = w * TILE_W;
  const p = new Painter(W, FLOOR_H);
  const bg = express ? '#2e2c32' : '#3a3a3e';
  p.r(0, 0, W, 24, bg);
  p.r(1, 0, 1, 24, shade(bg, 0.12)); p.r(W - 2, 0, 1, 24, shade(bg, -0.25));
  p.r(1, 23, W - 2, 1, shade(bg, -0.3));
  if (label) {
    const len = label.length;
    let k = 3;
    while (k > 1 && len * 4 * k - k > W - 4) k--;
    if (len * 4 * k - k > W - 2) k = 1;
    const tw = len * 4 * k - k, th = 5 * k;
    p.textK(label, Math.round((W - tw) / 2), Math.round((22 - th) / 2), express ? '#54505c' : '#5c5c62', k);
  }
  p.r(0, 0, 1, 24, '#141416'); p.r(W - 1, 0, 1, 24, '#141416');
  return p.c;
}
// エレベーターの機械室（hi+1 階）とピット（lo-1 階）
export function machineRoom(w, express) {
  // 小さな灰色の機械室: 上向きの ▲ と巻上機
  const W = w * TILE_W;
  const p = new Painter(W, FLOOR_H);
  const bg = express ? '#3a3840' : '#46464c';
  p.box(0, 2, W, 22, bg, '#141416');
  p.r(1, 3, W - 2, 1, shade(bg, 0.2));
  const cx = W >> 1;
  for (let i = 0; i < 4; i++) p.r(cx - i, 5 + i, i * 2 + 1, 1, '#9a9aa2');     // ▲
  p.disc(cx - 4, 15, 3, '#24242a'); p.disc(cx - 4, 15, 2, '#7a7a84'); p.p(cx - 4, 15, '#24242a');
  p.box(cx + 1, 13, 6, 5, '#5a5a64'); p.r(cx + 2, 14, 4, 1, '#7a7a86');
  p.r(cx - 7, 19, 15, 2, '#2e2e34');
  return p.c;
}
export function pitSprite(w, express) {
  // ピット: 下向きの ▼
  const W = w * TILE_W;
  const p = new Painter(W, FLOOR_H);
  const bg = express ? '#2a2830' : '#323236';
  p.box(0, 0, W, 21, bg, '#141416');
  const cx = W >> 1;
  for (let i = 0; i < 4; i++) p.r(cx - 3 + i, 13 + i, 7 - i * 2, 1, '#8a8a92'); // ▼
  for (const bx of [3, W - 6]) { p.r(bx, 8, 3, 1, '#9a9aa2'); for (let y = 9; y < 18; y += 2) p.r(bx, y, 3, 1, '#7a6a20'); }
  return p.c;
}

// 破壊された施設: 'bomb' = 瓦礫、'fire' = 焼け跡
function ruinArt(p, kind, v) {
  const W = p.w, H = p.h, fy = H - 3;
  const r = rng(7001 + (v.seed | 0) * 131 + W);
  const fire = kind === 'fire';
  p.r(0, 0, W, fy, fire ? '#2a2420' : '#6e6a62');
  // 壁のしみ・ひび
  for (let i = 0; i < W / 3; i++) {
    const x = (r() * W) | 0, y = (r() * fy) | 0;
    p.r(x, y, 1 + ((r() * 3) | 0), 1, fire ? (r() < 0.5 ? '#141210' : '#3a3028') : (r() < 0.5 ? '#5a564e' : '#8a867c'));
  }
  if (fire) {
    // すすの筋と焦げた骨組み
    for (let x = 4; x < W - 2; x += 6 + ((r() * 6) | 0)) {
      const h = 6 + ((r() * (fy - 8)) | 0);
      p.r(x, fy - h, 2, h, '#0e0c0a'); p.p(x + 2, fy - h + 2, '#4a3020');
    }
    for (let i = 0; i < W / 10; i++) p.r((r() * (W - 4)) | 0, (r() * 6) | 0, 3, 1, '#000');
    // 焦げた家具の残骸
    for (let x = 6; x < W - 10; x += 14 + ((r() * 10) | 0)) {
      p.r(x, fy - 5, 8, 1, '#1a1410'); p.r(x + 1, fy - 4, 1, 4, '#1a1410'); p.r(x + 6, fy - 4, 1, 4, '#1a1410');
      if (r() < 0.5) p.r(x + 2, fy - 7, 3, 2, '#3a2a1a');
    }
    // 灰と残り火
    for (let x = 1; x < W - 1; x++) { const h = (r() * 2) | 0; if (h) p.r(x, fy - h, 1, h, r() < 0.15 ? '#c84a10' : '#4a4440'); }
  } else {
    // 崩れた天井
    for (let x = 0; x < W; x += 4 + ((r() * 6) | 0)) {
      const len = 2 + ((r() * 7) | 0);
      p.r(x, 0, 3 + ((r() * 4) | 0), len, '#8a867c'); p.r(x, len, 3, 1, '#4a4640');
    }
    // むき出しの鉄筋
    for (let x = 3; x < W - 3; x += 9 + ((r() * 6) | 0)) p.line(x, 1, x + ((r() * 6) | 0) - 3, 4 + ((r() * 7) | 0), '#7a3a20');
    // 瓦礫の山
    for (let x = 1; x < W - 1; x++) {
      const h = Math.round(3 + Math.sin(x * 0.35 + r()) * 2 + r() * 4 + (Math.sin(x * 0.07) + 1) * 3);
      p.r(x, fy - h, 1, h, (x + h) % 3 ? '#9a958a' : '#7a766c');
      p.p(x, fy - h, '#b8b4a8');
    }
    for (let i = 0; i < W / 4; i++) {
      const x = (r() * (W - 4)) | 0, y = fy - 2 - ((r() * 8) | 0);
      p.box(x, y, 3 + ((r() * 3) | 0), 2 + ((r() * 2) | 0), r() < 0.3 ? '#b0a090' : '#8a867c', '#3a3832');
    }
    p.r(W >> 1, 2, 2, 2, '#e8e0a0');
  }
  p.r(0, fy, W, 1, fire ? '#1a1612' : '#5a564e'); p.r(0, fy + 1, W, 1, SLAB); p.r(0, fy + 2, W, 1, '#000');
  p.r(0, 0, 1, H, '#000'); p.r(W - 1, 0, 1, fy, '#000');
  // 立入禁止テープ
  for (let x = 1; x < W - 1; x++) p.p(x, fy - 12 + ((x >> 3) & 1), ((x >> 1) & 1) ? '#f0d020' : '#202020');
}

export const CAR_H = 20;
export function carSprite(w, express, n, open) {
  // サーモンピンクの箱に明るい横帯、中に乗客の影
  const W = w * TILE_W - 4;
  const p = new Painter(W, CAR_H);
  const body = express ? '#d88878' : '#e8a090', band = express ? '#eebcae' : '#f6c8b8';
  p.box(0, 0, W, CAR_H, body, '#2a1a18');
  p.r(1, 1, W - 2, 1, shade(body, 0.2));
  // 開いた扉の中は少し明るい
  const iw = W - 4, ix = 2, half = iw >> 1;
  const gap = Math.round(half * (open / 4));
  if (gap > 0) p.r(ix + half - gap, 3, gap * 2, CAR_H - 6, '#fbe4da');
  p.r(1, 7, W - 2, 4, band);
  const slots = Math.max(1, Math.floor((iw - 1) / 4));
  const vis = Math.min(n, slots);
  for (let i = 0; i < vis; i++) standFig(p, ix + 1 + i * 4, CAR_H - 3, '#3a2420', i % 2, 0);
  if (n > slots) for (let i = 0; i < Math.min(n - slots, slots); i++) p.r(ix + 2 + i * 4, 4, 2, 2, '#6a4a44');
  // 扉の合わせ目
  if (gap < half) { p.r(ix + half - gap - 1, 2, 1, CAR_H - 5, shade(body, -0.3)); if (gap > 0) p.r(ix + half + gap, 2, 1, CAR_H - 5, shade(body, -0.3)); }
  p.r(1, CAR_H - 2, W - 2, 1, shade(body, -0.35));
  return p.c;
}

// ---- 施設スプライトの生成 ----
export const SPRITE_TOP = { cathedral: 88 };

export function makeFacilitySprite(type, wTiles, hFloors, v) {
  // 異常な大きさでも巨大なキャンバスを作らない
  wTiles = Math.max(1, Math.min(64, wTiles | 0)); hFloors = Math.max(1, Math.min(6, hFloors | 0));
  const W = wTiles * TILE_W, H = hFloors * FLOOR_H;
  const top = SPRITE_TOP[type] || 0;
  const p = new Painter(W, H + top);
  p.oy = top;
  try {
    if (type === 'ruinBomb' || type === 'ruinFire') ruinArt(p, type === 'ruinFire' ? 'fire' : 'bomb', v);
    else if (hasVariantArt(type)) drawVariant(p, type, v);
    else if (type === 'stairs') stairsArt(p, v);
    else if (type === 'escalator') escalatorArt(p, v);
    else if (type === 'metroFg') metroFg(p, v);
    else if (DRAW[type]) DRAW[type](p, v);
    else genericArt(p, type, v);
  } catch (e) {
    genericArt(p, type, v);
  }
  p.c.oy = top;
  return p.c;
}

function genericArt(p, type, v) {
  shell(p, '#c8c0b0', '#7a7468', {});
  const name = String(type || '?').slice(0, Math.max(1, Math.floor((p.w - 6) / 4)));
  p.sign(name, p.w / 2, 6, '#333');
}

// ---- 地上の木 ----
export function treeSprite(alt) {
  const p = new Painter(15, 26);
  const g = ['#2f7a34', '#3e9a42', '#245e28'];
  const r = rng(5 + alt);
  p.r(6, 15, 3, 11, '#6a4424'); p.r(6, 15, 1, 11, '#4a2c14');
  const cy = 9, rad = 6 + (alt % 2);
  p.disc(7, cy, rad + 1, '#1a3a1c');
  p.disc(7, cy, rad, g[0]);
  for (let i = 0; i < 18; i++) p.p(2 + ((r() * 11) | 0), 3 + ((r() * 11) | 0), g[1 + (i % 2)]);
  p.disc(5, cy - 2, 2, g[1]);
  return p.c;
}

// ---- 非常階段（外壁に付ける飾り）。左側用、幅 18・高さ 24。parity で登る向きが交互になる ----
export const ESC_W = 18;
export function fireEscapeSprite(parity) {
  const p = new Painter(ESC_W, FLOOR_H);
  const steel = '#8a9098', dark = '#3a3e46', rail = '#4a5058', hi = '#b8bec6';
  // 支柱と壁への腕木
  p.r(0, 0, 1, 24, rail);
  p.r(16, 20, 2, 1, dark); p.r(16, 2, 2, 1, dark);
  // 踊り場（床の高さ）
  p.r(0, 21, 18, 1, hi); p.r(0, 22, 18, 1, steel); p.r(0, 23, 18, 1, dark);
  // 階段（踊り場の片側から上の踊り場の反対側へ）
  const a = parity ? 15 : 2, b = parity ? 2 : 15, dir = b > a ? 1 : -1;
  const n = Math.abs(b - a);
  for (let i = 0; i <= n; i++) {
    const x = a + dir * i;
    const y = Math.round(20 - (i / n) * 21);
    p.r(x, y, 1, 1, hi); p.r(x, y + 1, 1, 1, steel); p.r(x, y + 2, 1, 1, dark);
    p.p(x, y - 6, rail);                    // 手すり
    if (i % 4 === 0) p.r(x, y - 6, 1, 6, rail);
  }
  // 踊り場の手すり（階段の上がり口と反対側）
  const lx = parity ? 0 : 9;
  p.r(lx, 15, 9, 1, rail); p.r(lx, 15, 1, 6, rail); p.r(lx + 8, 15, 1, 6, rail);
  p.r(lx + 4, 16, 1, 5, rail);
  return p.c;
}
// 最上階の上（屋上の高さ）の踊り場
export function fireEscapeTop() {
  const p = new Painter(ESC_W, 9);
  p.r(0, 0, 18, 1, '#4a5058'); p.r(0, 0, 1, 7, '#4a5058'); p.r(8, 0, 1, 6, '#4a5058');
  p.r(0, 6, 18, 1, '#b8bec6'); p.r(0, 7, 18, 1, '#8a9098'); p.r(0, 8, 18, 1, '#3a3e46');
  return p.c;
}

// ---- ごみ集積所（地下2フロア、w16 = 128x48）。v.n = 袋の量（0..12、13 = あふれ）、v.open = シャッターが開いている ----
function bag(p, bx, by, c) {
  p.r(bx + 1, by - 4, 5, 5, '#000'); p.r(bx, by - 3, 7, 3, '#000');
  p.r(bx + 1, by - 3, 5, 3, c); p.r(bx + 2, by - 4, 3, 1, c); p.p(bx + 2, by - 3, shade(c, 0.35));
  p.r(bx + 3, by - 6, 1, 2, '#000'); p.p(bx + 2, by - 6, '#000'); p.p(bx + 4, by - 6, '#000');
}
export const GARBAGE_BAGS = 13;
// 分別ライン: 上段にコンベアと選別作業員、下段に色分けしたリサイクル箱と圧縮機
function sortingLine(p, x0, x1, fy, v) {
  const w = x1 - x0;
  p.r(x0 - 2, 1, 2, fy - 1, '#6a6a62');
  p.sign('RECYCLE', x0 + 18, 1, '#ffffff', '#2f6ab0');
  // 中二階の床とコンベア
  p.r(x0, 22, w, 2, '#5a5a52');
  p.box(x0 + 2, 17, w - 22, 4, '#2e2e30'); for (let x = x0 + 4; x < x0 + w - 22; x += 4) p.p(x, 18, '#8a8a8a');
  const it = ['#4a90d0', '#40a040', '#e0c040', '#c0c0c0', '#a05a30', '#e05050'];
  for (let i = 0, x = x0 + 5; x < x0 + w - 26; x += 7, i++) p.r(x, 15 + (i & 1), 3 + (i % 2), 2 - (i & 1) + 1, it[i % it.length]);
  for (const lx of [x0 + 6, x0 + w - 26]) p.r(lx, 21, 1, 1, '#3a3a3a');
  // 投入ホッパー（右上）
  p.r(x0 + w - 20, 10, 16, 1, '#000'); p.line(x0 + w - 20, 10, x0 + w - 16, 18, '#000'); p.line(x0 + w - 4, 10, x0 + w - 8, 18, '#000');
  p.r(x0 + w - 18, 11, 12, 3, '#7a7a72'); p.r(x0 + w - 16, 14, 8, 3, '#6a6a62');
  // 選別の作業員（中二階）
  for (const wx of [x0 + 12, x0 + 26]) {
    p.r(wx, 10, 3, 1, '#f0d020'); p.r(wx + 1, 11, 2, 2, '#1a1a1a'); p.r(wx, 13, 3, 4, '#3a8a4a'); p.r(wx + 1, 14, 1, 1, '#e8e8a0');
  }
  // 色分けの箱（缶・びん・ペット・紙）
  const bins = [['#3a6ad0', 'CAN'], ['#3aa050', 'BIN'], ['#e0b020', 'PET'], ['#c04040', 'PAP']];
  const bw = 11;
  for (let i = 0; i < 4; i++) {
    const bx = x0 + 2 + i * (bw + 2);
    p.box(bx, fy - 12, bw, 12, bins[i][0]); p.r(bx - 1, fy - 13, bw + 2, 2, shade(bins[i][0], -0.35));
    p.r(bx + 3, fy - 8, 5, 1, '#ffffff'); p.r(bx + 2, fy - 7, 1, 3, '#ffffff'); p.r(bx + 8, fy - 7, 1, 3, '#ffffff'); p.r(bx + 3, fy - 4, 5, 1, '#ffffff');
  }
  // 圧縮機とベール
  const cx = x0 + 4 * (bw + 2) + 4;
  if (cx + 14 < x1) {
    p.box(cx, fy - 18, x1 - cx, 18, '#d8b020');
    for (let x = cx + 1; x < x1 - 1; x += 4) p.r(x, fy - 17, 2, 3, '#202020');
    p.box(cx + 3, fy - 11, Math.min(10, x1 - cx - 6), 7, '#3a3a3a');
  }
  p.box(x0 + 4, 26, 12, 8, '#8a7a5a'); p.box(x0 + 18, 26, 12, 8, '#5a7a9a'); p.r(x0 + 4, 30, 26, 1, '#3a3a32');
}

DRAW.garbage = (p, v) => {
  const W = p.w, H = p.h, fy = H - 3;
  shell(p, '#8a8a80', '#5a5a52', {});
  // 天井の配管と照明
  p.r(1, 2, W - 2, 2, '#6a6a62'); for (let x = 10; x < W; x += 32) { p.r(x, 4, 12, 1, '#f0f8d0'); p.r(x, 5, 12, 1, '#c8d0b0'); }
  // 荷捌き場（左）: 床の黄黒ライン・矢印
  for (let x = 1; x < 70; x += 4) p.r(x, fy - 1, 2, 1, ((x >> 2) & 1) ? '#f0d020' : '#202020');
  for (let i = 0; i < 3; i++) { const x = 20 + i * 14; p.r(x, 30, 6, 1, '#d8d8c8'); p.r(x + 4, 29, 1, 3, '#d8d8c8'); p.p(x + 5, 30, '#d8d8c8'); }
  // シャッター（左の壁）とスロープの気配
  p.r(1, 6, 9, fy - 6, '#3a3a36');
  p.line(1, 6, 9, 14, '#6a6a60');
  const sh = v.open ? 10 : fy - 7;
  p.r(2, 7, 7, sh, '#a8a8a0'); for (let y = 8; y < 7 + sh; y += 2) p.r(2, y, 7, 1, '#888880');
  p.r(2, 7 + sh, 7, 1, '#5a5a52');
  p.r(10, 6, 2, fy - 6, '#f0d020'); for (let y = 8; y < fy; y += 6) p.r(10, y, 2, 3, '#202020');
  p.sign('GOMI', 40, 9, '#ffffff', '#3a7a3a');
  // ごみ置き場（右）: フェンスとコンテナ
  const gx = 72, gx1 = W >= 180 ? 130 : W - 1;   // ごみ置き場の範囲（その右は分別ライン）
  p.r(gx, 22, gx1 - gx, 1, '#6a6a60'); // 中二階
  p.r(gx, 23, gx1 - gx, 1, '#4a4a42');
  for (let x = gx; x < gx1; x += 6) { p.r(x, 24, 1, fy - 24, '#9a9a90'); }
  p.r(gx, 24, gx1 - gx, 1, '#9a9a90');
  if (gx1 < W - 1) sortingLine(p, gx1 + 2, W - 2, fy, v);
  for (const cx of [gx + 30, gx + 42]) { p.box(cx, fy - 9, 11, 9, '#2f7a46'); p.r(cx - 1, fy - 10, 13, 1, '#1f5a32'); }
  p.box(gx + 4, 14, 8, 8, '#3a6ad0'); p.box(gx + 14, 14, 8, 8, '#e0b020'); p.box(gx + 24, 14, 8, 8, '#3aa050');
  // 袋の山（下の段から、あふれると中二階・通路にも）
  const n = v.n | 0;
  const slots = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) slots.push([gx + 3 + i * 7 + (row & 1) * 3, fy - row * 4]);
  for (let i = 0; i < 6; i++) slots.push([gx + 36 + (i % 3) * 8, 22 - ((i / 3) | 0) * 4]);
  for (let i = 0; i < 6; i++) slots.push([50 + i * 6 - (i & 1), fy - (i & 1) * 3]);
  const shown = n >= GARBAGE_BAGS ? slots.length : Math.round((n / 12) * 12);
  const cols = ['#2a2a2e', '#e8e8e0', '#c8d8e8', '#3a3a40'];
  for (let i = 0; i < Math.min(shown, slots.length); i++) bag(p, slots[i][0], slots[i][1], cols[i % 4]);
  if (n >= GARBAGE_BAGS) for (let i = 0; i < 4; i++) { const x = gx + 6 + i * 12; p.p(x, 26, '#6a8a3a'); p.p(x + 1, 25, '#6a8a3a'); p.p(x, 24, '#6a8a3a'); }
};

// 収集車（パッカー車）。左向き（運転席が左、投入口が右）56x22
export function truckSprite() {
  const p = new Painter(56, 22);
  // 荷箱
  p.box(16, 2, 34, 15, '#f4f4f0'); p.r(17, 9, 32, 2, '#2f8a4a'); p.r(17, 3, 32, 1, '#ffffff');
  p.text('ECO', 26, 4, '#2f8a4a');
  // 投入口（後ろ）
  p.box(49, 4, 7, 14, '#c8c8c0'); p.r(50, 8, 5, 6, '#202020'); p.r(50, 14, 5, 1, '#f0d020');
  // 運転席
  p.box(2, 6, 15, 11, '#3a6ad0'); p.r(4, 8, 7, 4, '#9ad8f0'); p.r(5, 8, 2, 1, '#e8f8ff'); p.r(1, 13, 2, 3, '#000'); p.p(1, 13, '#ffe080');
  p.r(2, 16, 52, 2, '#3a3a3a');
  // 車輪
  for (const wx of [8, 30, 43]) { p.disc(wx, 18, 3, '#000'); p.disc(wx, 18, 1, '#9a9a9a'); }
  p.r(17, 0, 2, 2, '#f08020');
  return p.c;
}

// ---- 駐車場（w24 = 192x24）。v.n = 駐車台数、seed で車種と色 ----
const CAR_COLS = ['#d03030', '#3a6ad0', '#f4f4f4', '#2a2a2e', '#c8c8d0', '#e0b020', '#2f8a4a', '#8a3aa0', '#e07030'];
function parkedCar(p, x, kind, col) {
  const y = 20;
  const dk = shade(col, -0.35), win = '#9ad0e8';
  if (kind === 0) { // セダン
    p.r(x + 3, y - 7, 8, 1, '#000'); p.r(x + 2, y - 6, 10, 2, col); p.r(x + 4, y - 6, 3, 2, win); p.r(x + 8, y - 6, 2, 2, win);
    p.r(x, y - 4, 15, 3, col); p.r(x, y - 2, 15, 1, dk);
  } else if (kind === 1) { // ハッチバック
    p.r(x + 3, y - 7, 7, 1, '#000'); p.r(x + 2, y - 6, 9, 2, col); p.r(x + 3, y - 6, 3, 2, win); p.r(x + 7, y - 6, 3, 2, win);
    p.r(x + 1, y - 4, 12, 3, col); p.r(x + 1, y - 2, 12, 1, dk);
  } else if (kind === 2) { // SUV
    p.r(x + 2, y - 9, 11, 1, '#000'); p.r(x + 1, y - 8, 13, 4, col); p.r(x + 2, y - 7, 4, 2, win); p.r(x + 7, y - 7, 4, 2, win);
    p.r(x, y - 4, 15, 3, col); p.r(x, y - 2, 15, 1, dk);
  } else if (kind === 3) { // ワゴン車
    p.r(x + 1, y - 10, 13, 1, '#000'); p.r(x, y - 9, 15, 7, col); p.r(x + 1, y - 8, 3, 3, win); p.r(x + 5, y - 8, 4, 2, win); p.r(x + 10, y - 8, 4, 2, win);
    p.r(x, y - 2, 15, 1, dk);
  } else { // スポーツカー
    p.r(x + 4, y - 6, 6, 1, '#000'); p.r(x + 3, y - 5, 8, 1, col); p.r(x + 5, y - 5, 4, 1, win);
    p.r(x, y - 4, 15, 3, col); p.r(x, y - 2, 15, 1, dk); p.p(x + 14, y - 4, '#ffe080');
  }
  p.disc(x + 3, y, 1, '#111'); p.disc(x + 11, y, 1, '#111');
}
DRAW.parking = (p, v) => {
  const W = p.w;
  const fy = shell(p, '#9a9a92', '#6a6a64', {});
  p.r(1, 14, W - 2, 7, '#8a8a82'); p.r(1, 14, W - 2, 1, '#7a7a72');
  for (let x = 12; x < W; x += 40) { p.r(x, 1, 14, 1, '#f0f8d0'); p.r(x, 2, 14, 1, '#c8d0b0'); }
  // 柱
  for (let x = 48; x < W - 8; x += 48) { p.r(x - 2, 1, 4, 20, '#b0b0a8'); p.r(x - 2, 1, 1, 20, '#c8c8c0'); p.r(x + 1, 1, 1, 20, '#8a8a82'); p.r(x - 2, 10, 4, 2, '#f0d020'); }
  // 区画の線と番号
  const n = v.n | 0;
  const r = rng(301 + (v.seed | 0) * 17);
  for (let i = 0; i < 12; i++) {
    const x = 2 + i * 16;
    p.r(x, fy, 1, 1, '#ffffff'); p.r(x, fy - 1, 1, 1, '#d8d8d0');
    p.text(String((i + 1) % 10), x + 6, 8, '#d8d8d0');
  }
  // 出口の案内とスロープの矢印
  p.box(W - 22, 3, 18, 6, '#2f8a4a'); p.text('EXIT', W - 20, 4, '#ffffff');
  p.r(W - 30, 5, 5, 1, '#ffffff'); p.r(W - 27, 4, 1, 3, '#ffffff'); p.p(W - 26, 5, '#ffffff');
  // 車（駐車台数ぶん。区画ごとに車種と色をずらす）
  const order = [0, 2, 4, 6, 8, 10, 1, 3, 5, 7, 9, 11];
  const kinds = [], colors = [];
  for (let i = 0; i < 12; i++) { kinds.push((r() * 5) | 0); colors.push(CAR_COLS[(r() * CAR_COLS.length) | 0]); }
  for (let k = 0; k < Math.min(12, n); k++) { const i = order[k]; parkedCar(p, 2 + i * 16 + 1, kinds[i], colors[i]); }
};

// ---- 工事中の骨組みタイル（16x24）とクレーン ----
export function frameTile() {
  const p = new Painter(16, FLOOR_H);
  p.r(0, 0, 16, 24, '#7e786c');
  for (let i = 0; i < 9; i++) p.p((i * 7) % 16, (i * 11) % 22, '#8e887c');
  p.r(0, 0, 2, 24, '#4a4640'); p.r(0, 21, 16, 3, '#5a564e'); p.r(0, 21, 16, 1, '#3a3630'); p.r(0, 10, 16, 1, '#5a564e');
  p.line(2, 20, 15, 11, '#66605a'); p.line(2, 10, 15, 1, '#66605a');
  p.p(1, 4, '#c87a30'); p.p(1, 15, '#c87a30');
  return p.c;
}
export function craneSprite() {
  const p = new Painter(64, 44);
  const y = '#e8c020', k = '#000';
  // マスト（ラチス）
  p.r(49, 6, 1, 38, k); p.r(54, 6, 1, 38, k); p.r(50, 6, 4, 38, y);
  for (let yy = 8; yy < 44; yy += 5) { p.line(50, yy, 53, yy + 4, '#8a6a10'); p.r(50, yy, 4, 1, '#c8a010'); }
  // 運転室
  p.box(46, 6, 6, 5, '#e8c020'); p.r(47, 7, 3, 2, '#9ad8f0');
  // ジブ（腕）とカウンタージブ
  p.r(2, 3, 62, 1, k); p.r(2, 6, 62, 1, k); p.r(2, 4, 62, 2, y);
  for (let x = 4; x < 62; x += 4) p.p(x, 4 + ((x >> 2) & 1), '#8a6a10');
  p.box(57, 6, 6, 5, '#7a7a7a');
  p.r(51, 0, 2, 3, k); p.line(51, 0, 4, 3, '#3a3a3a'); p.line(52, 0, 62, 3, '#3a3a3a');
  return p.c;
}

// ---- 連絡通路のタイル（8x24）。kind: 0 中、1 左端、2 右端。par で斜材の向きを交互に ----
export function bridgeTile(kind, par, night) {
  const p = new Painter(TILE_W, FLOOR_H);
  const steel = '#5a626c', dk = '#2a2e34', hi = '#9aa4ae';
  // 上部トラス（上弦・下弦・斜材）
  p.r(0, 0, 8, 1, dk); p.r(0, 1, 8, 1, hi); p.r(0, 5, 8, 1, steel); p.r(0, 6, 8, 1, dk);
  p.line(par ? 0 : 7, 5, par ? 7 : 0, 1, steel);
  // ガラス（後ろの空が透けるよう半透明）
  p.g.save(); p.g.globalAlpha = night ? 0.8 : 0.4; p.g.fillStyle = night ? '#ffe2a0' : '#bfe4f4'; p.g.fillRect(0, 7, 8, 13); p.g.restore(); p._fs = null;
  p.g.save(); p.g.globalAlpha = night ? 0.25 : 0.55; p.g.fillStyle = '#ffffff'; p.g.fillRect(2 + par, 8, 1, 4); p.g.restore(); p._fs = null;
  if (night && par) { p.r(3, 7, 2, 1, '#fff2b0'); }
  p.r(0, 14, 8, 1, steel);            // 手すり
  if (par === 0) p.r(0, 7, 1, 13, steel); // 方立て
  // 床（デッキ）と下面
  p.r(0, 20, 8, 1, '#c8ccd2'); p.r(0, 21, 8, 1, '#8a9098'); p.r(0, 22, 8, 1, steel); p.r(0, 23, 8, 1, dk);
  if (par) p.p(4, 22, hi);
  if (kind === 1) { p.r(0, 0, 2, 24, dk); p.r(1, 1, 1, 22, steel); }
  if (kind === 2) { p.r(6, 0, 2, 24, dk); p.r(6, 1, 1, 22, steel); }
  return p.c;
}
