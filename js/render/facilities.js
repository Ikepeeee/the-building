// 施設スプライト（室内の断面図）を手続き的に描く。1 ワールドpx = 1 ドット。
// すべてのスプライトは幅 w*TILE_W、高さ h*FLOOR_H（大聖堂は上に尖塔ぶん伸びる → canvas.oy）。
// 1フロアの帯の中: 行 0..20 = 室内、21 = 床面、22 = スラブ、23 = 黒い線。
import { TILE_W, FLOOR_H } from '../sim/constants.js';
import { Painter, rng, shade } from './pixel.js';
import { standFig, childFig, sitFig } from './people.js';

const INK = '#141414';
const SLAB = '#77746c';
const FIG = '#1a1a1a';

function shell(p, wall, floor, opt = {}) {
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
function chairR(p, x, seatY, c = '#3a3f48') { // 右向きに座る椅子（背もたれが左）
  p.r(x - 1, seatY - 5, 1, 6, c); p.r(x - 1, seatY, 4, 1, c); p.r(x + 1, seatY + 1, 1, 2, c); p.r(x, seatY + 3, 3, 1, c);
}
function chairL(p, x, seatY, c = '#3a3f48') {
  p.r(x + 3, seatY - 5, 1, 6, c); p.r(x, seatY, 4, 1, c); p.r(x + 1, seatY + 1, 1, 2, c); p.r(x, seatY + 3, 3, 1, c);
}
function plant(p, x, yb, tall = 8) {
  p.box(x, yb - 3, 5, 4, '#b0603a');
  const g = ['#2f8a3a', '#3fa84a', '#246a2c'];
  for (let i = 0; i < tall; i++) {
    const w = i < 2 ? 3 : i < tall - 2 ? 5 : 3;
    p.r(x + 2 - (w >> 1), yb - 4 - i, w, 1, g[i % 3]);
  }
  p.p(x + 1, yb - 6, '#1d5a24'); p.p(x + 3, yb - 8, '#1d5a24');
}
function picture(p, x, y, w, h, alt = 0) {
  p.box(x, y, w, h, '#8cc4e8');
  const hill = ['#4a9a4a', '#c87a3a', '#6a6ab8'][alt % 3];
  p.r(x + 1, y + h - 3, w - 2, 2, hill);
  p.p(x + w - 3, y + 2, '#f8e060');
}
function lamp(p, x, y, c = '#ffe68a') {
  p.r(x + 1, y, 1, 2, '#444'); p.r(x, y + 2, 3, 2, c); p.p(x + 1, y + 4, '#fff8d0');
}
function guardFig(p, x, yFeet, facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(x, yFeet - 8, 4, 1, '#1b3486'); p.r(hx, yFeet - 7, 2, 1, FIG);
  p.r(x, yFeet - 6, 3, 4, '#2f5ce0'); p.p(facing ? x + 2 : x, yFeet - 6, '#f0d040');
  p.r(x, yFeet - 2, 1, 2, '#14214f'); p.r(x + 2, yFeet - 2, 1, 2, '#14214f');
}
function maidFig(p, x, yFeet, facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(hx, yFeet - 8, 2, 1, '#ffffff'); p.r(hx, yFeet - 7, 2, 1, FIG);
  p.r(x, yFeet - 6, 3, 4, '#2c2c48'); p.r(facing ? x + 1 : x, yFeet - 5, 2, 3, '#ffffff');
  p.r(x, yFeet - 2, 1, 2, FIG); p.r(x + 2, yFeet - 2, 1, 2, FIG);
}
function coatFig(p, x, yFeet, coat = '#ffffff', facing = 1) {
  const hx = facing ? x + 1 : x;
  p.r(hx, yFeet - 8, 2, 2, FIG);
  p.r(x, yFeet - 6, 3, 5, coat); p.r(facing ? x : x + 2, yFeet - 6, 1, 5, shade(coat, -0.2));
  p.r(x, yFeet - 1, 1, 1, FIG); p.r(x + 2, yFeet - 1, 1, 1, FIG);
}
function hatFig(p, x, yFeet, hat, facing = 1) {
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

function bed(p, x, w, blanket, guest, dirty, rnd) {
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
function nightstand(p, x) {
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
  // スクリーン
  p.r(147, 3, 4, 40, '#a01828'); p.r(242, 3, 4, 40, '#a01828');
  p.box(151, 6, 91, 31, '#f4f4f4');
  if (v.open) SCREENS[v.week % SCREENS.length](p, 152, 7, 89, 29);
  else p.r(152, 7, 89, 29, '#8a8a94');
  for (let x = 147; x < 151; x += 2) p.r(x, 3, 1, 40, '#801020');
  p.r(146, 1, 101, 3, '#c02838'); p.r(146, 3, 101, 1, '#e0b040');
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
    g.beginPath(); g.moveTo(56, 6); g.lineTo(151, 7); g.lineTo(151, 37); g.closePath(); g.fill(); g.restore(); p._fs = null;
  }
};

DRAW.partyHall = (p, v) => {
  const W = p.w, fy = p.h - 3;
  shell(p, '#f2e2c4', '#b0804a', {});
  p.r(1, 34, W - 2, fy - 34, '#d8bc8a'); p.r(1, 34, W - 2, 1, '#a88050');
  for (let x = 4; x < 168; x += 36) {
    p.r(x, 1, 4, fy - 1, '#e2cca0'); p.r(x, 1, 1, fy - 1, '#c4aa7a'); p.r(x + 3, 1, 1, fy - 1, '#c4aa7a');
    const wx = x + 13;
    p.box(wx, 9, 12, 18, v.night ? '#1a2850' : '#8ab8e0'); p.r(wx + 1, 8, 10, 1, '#000'); p.r(wx + 3, 7, 6, 1, '#000');
    p.r(wx + 2, 8, 8, 1, v.night ? '#1a2850' : '#8ab8e0'); p.r(wx + 5, 9, 1, 17, '#f2e2c4');
  }
  // 舞台
  p.r(172, 4, 43, 32, '#901828');
  for (let x = 173; x < 214; x += 4) p.r(x, 4, 1, 32, '#6a1020');
  p.r(172, 2, 43, 4, '#c03040'); p.r(172, 6, 43, 1, '#e0b040');
  p.box(172, 36, 43, fy - 36, '#6a3a1a'); p.r(173, 37, 41, 1, '#9a6030');
  p.r(194, 28, 1, 8, '#444'); p.p(194, 27, '#888');
  // シャンデリア
  for (const cx of [52, 124]) {
    p.r(cx, 1, 1, 4, '#806020'); p.r(cx - 5, 5, 11, 2, '#e0b040'); p.r(cx - 3, 7, 7, 1, '#c89020');
    for (let i = -5; i <= 5; i += 2) p.p(cx + i, 4, v.open ? '#fff6b0' : '#c8b070');
    p.p(cx, 8, '#fff6b0');
  }
  const tables = [18, 60, 102, 144];
  const n = v.open ? v.n : 0;
  let k = 0;
  if (n > 0) standFig(p, 192, 35, '#c02060', 0, 0);
  const spots = [];
  for (const x of tables) spots.push([x - 5, 1], [x + 18, 0]);
  spots.push([162, 1], [168, 0], [40, 0], [84, 1], [126, 0]);
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
  const fy = shell(p, '#eef4f2', '#9ab8b4', { base: '#cfe0dc' });
  p.box(6, 2, 11, 11, '#ffffff'); p.r(10, 4, 3, 7, '#20a050'); p.r(8, 6, 7, 3, '#20a050');
  if (v.n > 0) coatFig(p, 12, 19, '#f0a0c0', 1);
  p.box(4, 14, 26, 7, '#d0dcd8'); p.r(3, 13, 28, 1, '#7a8a88');
  const beds = [38, 80, 122];
  for (let i = 0; i < 3; i++) {
    const x = beds[i];
    p.r(x - 2, 1, 38, 1, '#888');
    p.r(x - 2, 2, 6, 18, '#a8d0e8'); p.r(x, 2, 1, 18, '#88b0c8'); p.r(x + 2, 2, 1, 18, '#88b0c8');
    p.box(x + 8, 14, 22, 4, '#ffffff'); p.box(x + 8, 12, 5, 3, '#ffffff');
    p.r(x + 9, 18, 1, 3, '#888'); p.r(x + 28, 18, 1, 3, '#888'); p.r(x + 8, 18, 22, 1, '#a0a8a8');
    p.box(x + 13, 13, 16, 3, '#9ad8c8');
    if (v.n > i + 1) p.r(x + 9, 10, 3, 3, FIG);
    p.r(x + 32, 5, 1, 16, '#888'); p.box(x + 31, 4, 3, 5, '#d8f0ff'); p.r(x + 30, 20, 5, 1, '#888');
  }
  p.box(168, 5, 13, 9, '#202a28'); p.r(169, 9, 3, 1, '#40e080'); p.r(172, 7, 1, 2, '#40e080'); p.r(173, 10, 1, 1, '#40e080'); p.r(174, 9, 5, 1, '#40e080');
  p.box(184, 3, 20, 18, '#e0e8e8');
  for (const row of [8, 13]) { p.r(185, row, 18, 1, '#9aa'); for (let i = 0; i < 6; i++) p.r(186 + i * 3, row - 3, 2, 3, ['#e05050', '#ffffff', '#5090e0', '#f0c040'][i % 4]); }
  p.r(185, 18, 18, 1, '#9aa');
  if (v.n > 1) coatFig(p, 160, fy - 1, '#ffffff', 0);
  if (v.n > 4) coatFig(p, 72, fy - 1, '#ffffff', 1);
  if (v.n > 5) standFig(p, 34, fy - 1, FIG, 0, 1);
};

DRAW.recycling = (p, v) => {
  const W = p.w, fy = p.h - 3;
  shell(p, '#6c6a5a', '#4a483e', {});
  for (let x = 25; x < W; x += 25) p.r(x, 1, 1, fy - 1, '#5c5a4c');
  p.r(1, 3, W - 2, 3, '#8a8070'); p.r(1, 6, W - 2, 1, '#5a5448');
  for (let x = 10; x < W; x += 30) { p.r(x, 2, 2, 5, '#a09888'); p.r(x + 12, 9, 10, 1, '#f0f8d0'); p.r(x + 12, 8, 10, 1, '#555'); }
  // 圧縮機
  p.box(8, 18, 44, fy - 18, '#d8b020');
  for (let x = 9; x < 51; x += 4) { p.r(x, 19, 2, 3, INK); }
  p.box(16, 25, 14, 9, '#3a3a3a'); p.r(17, 26, 12, 7, '#5a6a6a');
  p.box(36, 26, 10, 14, '#b89010'); p.r(39, 30, 4, 1, INK);
  p.r(20, 10, 4, 8, '#7a7468'); p.r(14, 8, 16, 3, '#7a7468');
  // コンベア
  p.box(56, 32, 82, 4, '#3a3a3a');
  for (let x = 58; x < 136; x += 4) p.p(x, 33, '#9a9a9a');
  for (const x of [60, 96, 132]) p.r(x, 36, 2, fy - 36, '#4a4a4a');
  const items = ['#4a90d0', '#40a040', '#e0c040', '#c0c0c0', '#a05a30'];
  for (let i = 0; i < 9; i++) p.r(62 + i * 8, 29 + (i % 2), 4, 3 - (i % 2), items[i % items.length]);
  // 分別箱
  const bc = ['#3a7ad0', '#3aa050', '#e0b020'];
  for (let i = 0; i < 3; i++) {
    const x = 142 + i * 18;
    p.box(x, 28, 16, fy - 28, bc[i]); p.r(x - 1, 27, 18, 2, shade(bc[i], -0.3));
    p.r(x + 6, 33, 4, 1, '#ffffff'); p.r(x + 5, 34, 1, 3, '#ffffff'); p.r(x + 10, 34, 1, 3, '#ffffff'); p.r(x + 6, 37, 4, 1, '#ffffff');
  }
  // 積まれたベール
  p.box(60, 12, 14, 9, '#8a7a5a'); p.box(76, 12, 14, 9, '#5a7a9a'); p.box(68, 3 + 6, 0, 0, '#000');
  p.r(60, 21, 30, 1, '#2a2a22');
  const pos = [54, 100, 120, 186];
  for (let i = 0; i < Math.min(v.n, 4); i++) hatFig(p, pos[i], fy - 1, '#f0d020', i % 2);
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
function stairsArt(p, v) {
  const W = p.w, H = p.h, fy = H - 3;
  p.r(0, 0, W, fy, '#c6c0b0'); p.r(0, 0, W, 1, '#9a9484');
  p.r(0, fy, W, 1, '#8a8478'); p.r(0, fy + 1, W, 1, SLAB); p.r(0, fy + 2, W, 1, '#000');
  p.r(0, 0, 1, H, '#000');
  const steps = 7, rise = fy / steps, run = (W - 8) / steps;
  for (let i = 0; i < steps; i++) {
    const x = Math.round(4 + i * run), y = Math.round(fy - (i + 1) * rise);
    p.r(x, y, Math.ceil(run), fy - y, '#9a948a');
    p.r(x, y, Math.ceil(run), 1, '#4a463e');
    p.r(x, y + 1, 1, Math.max(1, Math.round(rise) - 1), '#4a463e');
  }
  p.line(6, fy - 7, W - 4, -1, '#2a2a2a');
  for (let i = 1; i < steps; i += 2) {
    const x = Math.round(4 + i * run + run / 2), y = Math.round(fy - (i + 1) * rise);
    p.r(x, y - 6, 1, 6, '#5a5650');
  }
}
function escalatorArt(p, v) {
  const W = p.w, H = p.h, fy = H - 3;
  p.r(0, 0, W, fy, '#d4d0c4'); p.r(0, 0, W, 1, '#a8a498');
  p.r(0, fy, W, 1, '#8a8478'); p.r(0, fy + 1, W, 1, SLAB); p.r(0, fy + 2, W, 1, '#000');
  p.r(0, 0, 1, H, '#000');
  const x0 = 4, x1 = W - 4;
  const g = p.g;
  for (let x = x0; x < x1; x++) {
    const t = (x - x0) / (x1 - x0);
    const y = Math.round(fy - 2 - t * (fy - 1));
    // ガラスの欄干
    p.r(x, y - 6, 1, 5, '#b8dcec');
    p.p(x, y - 7, '#202020');
    p.p(x, y, ((x + v.frame) % 4 === 0) ? '#3a3a3a' : '#6a6a70');
    p.r(x, y + 1, 1, 4, '#a8b0b8');
    p.p(x, y + 5, '#5a6068');
  }
  p.r(0, fy - 1, x0 + 2, 1, '#6a6a70'); p.r(x1 - 2, 0, 6, 1, '#6a6a70');
}
export function shaftSeg(w, express, stop, top, bottom) {
  const W = w * TILE_W;
  const p = new Painter(W, FLOOR_H);
  const bg = express ? '#3e3646' : '#4a4a54';
  p.r(0, 0, W, 24, bg);
  p.r(2, 0, 1, 24, express ? '#62566e' : '#6c6c78'); p.r(W - 3, 0, 1, 24, express ? '#62566e' : '#6c6c78');
  p.r((W >> 1) - 3, 0, 1, 24, '#26262c'); p.r((W >> 1) + 2, 0, 1, 24, '#26262c');
  p.r(1, 21, W - 2, 1, '#6a6670'); p.r(1, 22, W - 2, 1, '#5a5860'); p.r(1, 23, W - 2, 1, '#202024');
  if (stop) { p.r(3, 2, W - 6, 1, '#8a8a96'); p.r((W >> 1) - 1, 0, 2, 2, '#f0c040'); }
  if (top) { p.r(0, 0, W, 3, '#5a5a62'); p.r(0, 0, W, 1, '#000'); p.r((W >> 1) - 4, 3, 8, 2, '#2a2a2e'); }
  if (bottom) { p.r(1, 17, W - 2, 4, '#3a3a40'); p.r(4, 18, 3, 3, '#8a7a30'); p.r(W - 7, 18, 3, 3, '#8a7a30'); }
  p.r(0, 0, 1, 24, '#000'); p.r(W - 1, 0, 1, 24, '#000');
  return p.c;
}
export const CAR_H = 20;
export function carSprite(w, express, n, open) {
  const W = w * TILE_W - 4;
  const p = new Painter(W, CAR_H);
  const frame = express ? '#d89a5a' : '#e8d8a8';
  p.box(0, 0, W, CAR_H, frame);
  p.r(1, 1, W - 2, 1, shade(frame, 0.3));
  p.p((W >> 1) - 1, 1, express ? '#ff6040' : '#40d060');
  const ix = 2, iw = W - 4, iy = 3, ih = CAR_H - 5;
  p.r(ix, iy, iw, ih, '#fff2c4');
  const slots = Math.max(1, Math.floor((iw - 1) / 4));
  const vis = Math.min(n, slots * 2);
  for (let i = 0; i < Math.min(vis, slots); i++) standFig(p, ix + 1 + i * 4, iy + ih - 1, FIG, i % 2, 0);
  if (vis > slots) for (let i = 0; i < vis - slots; i++) p.r(ix + 3 + i * 4, iy + ih - 9, 2, 2, '#4a4a4a');
  // 扉
  const half = iw >> 1;
  const pw = Math.round(half * (1 - open / 4));
  if (pw > 0) {
    p.r(ix, iy, pw, ih, '#b4bcc6'); p.r(ix + iw - pw, iy, pw, ih, '#b4bcc6');
    p.r(ix + pw - 1, iy, 1, ih, '#7a828c'); p.r(ix + iw - pw, iy, 1, ih, '#7a828c');
    // 扉の窓（中の人の頭が見える）
    const g = p.g;
    if (pw > 2) {
      g.save(); g.globalAlpha = 0.55; g.fillStyle = '#d8f0ff';
      g.fillRect(ix + 1, iy + 2, pw - 3, 4); g.fillRect(ix + iw - pw + 2, iy + 2, pw - 3, 4);
      g.restore(); p._fs = null;
      // 窓越しの頭
      for (let i = 0; i < Math.min(vis, slots); i++) {
        const hx = ix + 1 + i * 4 + 1;
        if (hx < ix + pw - 2 || hx >= ix + iw - pw + 2) p.r(hx, iy + ih - 8 < iy + 2 ? iy + 2 : iy + ih - 8, 2, 2, '#3a3a3a');
      }
    }
  }
  p.r(0, CAR_H - 2, W, 1, shade(frame, -0.4));
  return p.c;
}

// ---- 施設スプライトの生成 ----
export const SPRITE_TOP = { cathedral: 88 };

export function makeFacilitySprite(type, wTiles, hFloors, v) {
  const W = wTiles * TILE_W, H = hFloors * FLOOR_H;
  const top = SPRITE_TOP[type] || 0;
  const p = new Painter(W, H + top);
  p.oy = top;
  try {
    if (type === 'stairs') stairsArt(p, v);
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
