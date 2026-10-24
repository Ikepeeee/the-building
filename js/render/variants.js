// テナントの個性（v2）: VARIANTS ごとの内装・看板・配色と、o.id を種にした小さな差。
// drawVariant(p, type, v) は facilities.js の makeFacilitySprite から呼ばれる。
// v = { occ, n, open, dirty, alt, night, var, seed } 。看板の位置は p.c.sign = {x,y,w,h,bg,fg} に残す（brand を上書きするため）。
import { VARIANTS } from '../sim/constants.js';
import { rng, shade } from './pixel.js';
import { standFig, childFig, sitFig } from './people.js';
import { shell, chairR, chairL, plant, picture, lamp, bed, nightstand, hatFig, coatFig, FIG, INK } from './facilities.js';

const ART = {}, SIGN = {};
const FLIP = new Set(['office', 'condo', 'shop', 'fastfood', 'restaurant', 'hotelSingle', 'hotelTwin', 'hotelSuite']);

export function hasVariantArt(type) { return !!ART[type]; }

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (r, a) => a[(r() * a.length) | 0];
const BRIGHT = ['#e04848', '#f0b030', '#40a0e0', '#60c060', '#c060c0', '#f08040', '#3a5ab0', '#e070a0', '#30b0a0'];

export function variantName(type, vi) {
  const names = VARIANTS[type] || [];
  const i = Math.max(0, Math.min(names.length - 1, vi | 0));
  return names[i] || names[0] || '';
}

export function drawVariant(p, type, v) {
  const name = variantName(type, v.var);
  const r = rng(strHash(type + ':' + name) + ((v.seed | 0) + 1) * 7919);
  try { ART[type](p, v, name, r); } finally { p.g.setTransform(1, 0, 0, 1, 0, 0); p._ox = 0; }
  if (v.flip && FLIP.has(type) && (v.occ || !(type === 'office' || type === 'condo'))) flip(p);
  const r2 = rng(strHash(name) + (v.seed | 0) * 31 + 5);
  if (SIGN[type]) SIGN[type](p, v, name, r2);
}

function flip(p) {
  const W = p.w, H = p.h;
  const g = p.g;
  const tmp = p.c.ownerDocument ? p.c.ownerDocument.createElement('canvas') : new OffscreenCanvas(W, H);
  tmp.width = W; tmp.height = H;
  tmp.getContext('2d').drawImage(p.c, 0, 0);
  g.clearRect(0, 0, W, H);
  g.save(); g.translate(W, 0); g.scale(-1, 1); g.drawImage(tmp, 0, 0); g.restore();
  // 仕切りの線（左は黒、右は少し暗く）を描き直す
  g.drawImage(tmp, 1, 0, 1, H - 3, W - 1, 0, 1, H - 3);
  p._fs = null;
  p.r(0, 0, 1, H, '#000');
}

// 看板（ドット文字）と brand 用の位置
function signPlate(p, text, cx, y, fg, bg, line = '#000') {
  p.sign(text, cx, y, fg, bg, line);
  const tw = text.length * 4 - 1;
  const x = Math.round(cx - tw / 2) - 2;
  p.c.sign = { x, y, w: tw + 4, h: 9, bg, fg };
}
function namePlate(p, x, y, w, h, bg, fg, deco) {
  p.box(x, y, w, h, bg);
  if (deco) deco(p, x, y, w, h);
  p.c.sign = { x, y, w, h, bg, fg };
}

// ---- 共通の部品 ----
// 壁の色を o.id ごとにわずかに変える
function sh(r, p, wall, floor, opt) {
  const fy = shell(p, shade(wall, (r() - 0.5) * 0.14), floor, opt);
  // 幅が設計より広いとき（例: オフィス 72→80px）、中身を中央に寄せる
  if (p._ox) p.g.translate(p._ox, 0);
  return fy;
}
function books(p, x, y, w, h, r, pal) {
  for (let i = x; i < x + w;) {
    const bw = r() < 0.7 ? 1 : 2;
    if (i + bw > x + w) break;
    const bh = h - ((r() * 3) | 0);
    p.r(i, y + h - bh, bw, bh, pick(r, pal));
    i += bw + (r() < 0.12 ? 1 : 0);
  }
}
function shelfBooks(p, x, y, w, h, r, pal, frame = '#7a5230') {
  p.box(x, y, w, h, shade(frame, 0.25), frame);
  for (let sy = y + 1; sy + 5 <= y + h - 1; sy += 5) {
    books(p, x + 1, sy, w - 2, 4, r, pal);
    p.r(x + 1, sy + 4, w - 2, 1, frame);
  }
}
function poster(p, x, y, w, h, r) {
  const bg = pick(r, ['#f8f0d8', '#202838', '#f0d0e0', '#d0e8f0']);
  p.box(x, y, w, h, bg);
  const c1 = pick(r, BRIGHT), c2 = pick(r, BRIGHT);
  if (r() < 0.5) { p.disc(x + (w >> 1), y + (h >> 1), Math.max(1, Math.min(w, h) / 2 - 2 | 0), c1); p.r(x + 1, y + h - 3, w - 2, 1, c2); }
  else { p.r(x + 1, y + 1, (w - 2) >> 1, h - 2, c1); p.r(x + 2, y + h - 4, w - 4, 2, c2); }
}
function invader(p, x, y, c) {
  const m = ['01110', '10101', '11111', '01010', '10001'];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (m[j][i] === '1') p.p(x + i, y + j, c);
}
function stool(p, x, c = '#c0a040') { p.r(x, 17, 4, 1, c); p.r(x + 1, 18, 1, 3, '#555'); p.r(x, 20, 3, 1, '#555'); }
function kneel(p, x, col = FIG, facing = 1) { // 正座
  p.r(facing ? x + 1 : x, 12, 2, 2, col); p.r(x, 14, 3, 5, col); p.r(facing ? x - 1 : x + 1, 19, 4, 2, col);
}
function tatami(p, W, y = 21) {
  p.r(0, y, W, 1, '#b8b070');
  for (let x = 6; x < W; x += 12) p.p(x, y, '#6a6a3a');
}
function shojiPanel(p, x, y, w, h) {
  p.box(x, y, w, h, '#f6f2e6', '#7a5a34');
  for (let i = x + 3; i < x + w - 1; i += 3) p.r(i, y + 1, 1, h - 2, '#c8b898');
  for (let j = y + 4; j < y + h - 1; j += 4) p.r(x + 1, j, w - 2, 1, '#c8b898');
}
function lantern(p, x, y, c = '#e03030') {
  p.r(x + 1, y, 1, 2, '#444'); p.r(x, y + 2, 3, 5, c); p.r(x - 1, y + 3, 5, 3, c);
  p.r(x, y + 3, 3, 1, shade(c, 0.3)); p.r(x, y + 7, 3, 1, '#d8b040');
}
function seatPeople(p, seats, n) {
  for (let i = 0; i < Math.min(n, seats.length); i++) {
    const s = seats[i];
    if (s[2] === 'stand') standFig(p, s[0], 20, FIG, s[1], i & 1);
    else if (s[2] === 'kneel') kneel(p, s[0], FIG, s[1]);
    else sitFig(p, s[0], s[2] || 17, FIG, s[1]);
  }
}
function vacant(p, wall, floor, text, alt) {
  shell(p, wall, floor, { base: shade(wall, -0.12) });
  for (let x = 12; x < p.w; x += 24) p.r(x, 1, 1, 20, shade(wall, -0.06));
  signPlate(p, text, p.w / 2, 6, '#c02020', '#f6f0dc');
  p.c.sign = null;
}

// ================= オフィス（72x24） =================
function deskCluster(p, sx, o) {
  chairR(p, sx, 17, o.chair); chairL(p, sx + 16, 17, o.chair);
  if (o.mon === 'drafting') {
    p.line(sx + 5, 14, sx + 13, 9, '#f4f4f4'); p.line(sx + 5, 15, sx + 13, 10, '#5a5a5a');
    p.r(sx + 9, 13, 1, 8, '#6a6a6a'); p.r(sx + 7, 20, 5, 1, '#6a6a6a');
    p.p(sx + 9, 11, pick(o.r, BRIGHT));
    return [[sx, 1]];
  }
  p.r(sx + 5, 14, 10, 1, o.desk); p.r(sx + 5, 15, 10, 1, o.edge);
  p.r(sx + 6, 16, 1, 5, o.edge); p.r(sx + 13, 16, 1, 5, o.edge);
  const scr = o.screen;
  if (o.mon === 'pc') {
    p.box(sx + 6, 9, 4, 4, '#2a2f38'); p.r(sx + 7, 10, 2, 2, scr); p.r(sx + 7, 13, 2, 1, '#2a2f38');
    p.box(sx + 10, 9, 4, 4, '#2a2f38'); p.r(sx + 11, 10, 2, 2, scr); p.r(sx + 11, 13, 2, 1, '#2a2f38');
    p.p(sx + 9, 13, '#f4f4f4');
  } else if (o.mon === 'wide') {
    p.box(sx + 5, 8, 10, 5, '#1a1d22'); p.r(sx + 6, 9, 8, 3, scr); p.r(sx + 6, 10, 3, 1, '#ffffff'); p.r(sx + 9, 13, 2, 1, '#1a1d22');
  } else if (o.mon === 'triple') {
    for (let i = 0; i < 3; i++) { p.box(sx + 5 + i * 3, 9 - (i === 1 ? 1 : 0), 4, 4, '#1a1d22'); p.r(sx + 6 + i * 3, 10 - (i === 1 ? 1 : 0), 2, 2, i === 1 ? '#40d070' : '#e05050'); }
    p.r(sx + 9, 13, 2, 1, '#1a1d22');
  } else if (o.mon === 'paper') {
    for (let i = 0; i < 3; i++) { const h = 1 + ((o.r() * 4) | 0); p.r(sx + 6 + i * 3, 14 - h, 2, h, i === 1 ? '#f8f4e8' : '#e8e0c8'); }
    p.r(sx + 12, 10, 1, 4, '#444'); p.r(sx + 11, 10, 3, 1, '#2a6a3a');
  } else if (o.mon === 'rgb') {
    const c = pick(o.r, ['#ff40c0', '#40e0ff', '#80ff40']);
    p.box(sx + 6, 8, 8, 5, '#111'); p.r(sx + 7, 9, 6, 3, pick(o.r, ['#3a2a6a', '#1a3a5a'])); invader(p, sx + 8, 9, c);
    p.r(sx + 5, 15, 10, 1, c);
  } else if (o.mon === 'teller') {
    p.r(sx + 8, 11, 4, 3, '#2a2f38'); p.r(sx + 9, 12, 2, 1, scr);
  }
  return [[sx, 1], [sx + 16, 0]];
}
function officeSeats(clusters) {
  const s = [];
  for (const c of clusters) s.push(...c);
  // 左右交互に埋める
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(s[i]);
  for (let i = 1; i < s.length; i += 2) out.push(s[i]);
  return out;
}

ART.office = (p, v, name, r) => {
  p._ox = Math.max(0, (p.w - 72) >> 1);
  const ox = p._ox;
  const n = v.n;
  if (!v.occ) { vacant(p, '#8e959c', '#575d66', 'FOR RENT'); return; }
  const scr = v.night ? '#bfe6ff' : '#7ab8e8';
  const base = { r, chair: pick(r, ['#3a3f48', '#2a4a7a', '#7a2a2a', '#3a5a3a']), desk: '#c8a878', edge: '#7a5a38', screen: scr, mon: 'pc' };
  let clusters = [], extra = [];
  switch (name) {
    case 'it': {
      const wall = pick(r, ['#e6ecef', '#eef0e8', '#e8e8f2']);
      sh(r, p, wall, '#5a6470', { base: '#c0c8cc' });
      const acc = pick(r, ['#2ab0a0', '#f07a30', '#7a5ad0']);
      p.r(1 - ox, 7, p.w - 2, 2, acc);
      p.box(62, 3, 9, 18, '#2a2f38');
      for (let y = 5; y < 19; y += 3) { p.r(63, y, 7, 2, '#3e4450'); p.p(64, y, pick(r, ['#40e070', '#f0c040', '#40a0ff'])); p.p(66, y, '#40e070'); }
      // ビーズクッション
      p.disc(53, 18, 3, pick(r, ['#f08040', '#e04870', '#4a90e0'])); p.r(50, 20, 7, 1, '#3a3a3a');
      if (r() < 0.6) p.box(44, 2, 12, 4, '#ffffff'), p.r(46, 3, 8, 1, acc);
      clusters = [deskCluster(p, 2, { ...base, mon: 'wide', desk: '#e8e8e8', edge: '#8a8a8a', chair: '#202020' }), deskCluster(p, 24, { ...base, mon: 'wide', desk: '#e8e8e8', edge: '#8a8a8a', chair: '#202020' })];
      extra = [[51, 1, 18], [58, 0, 'stand']];
      break;
    }
    case 'law': {
      sh(r, p, '#efe4cc', '#5a3a24', {});
      p.r(1 - ox, 12, p.w - 2, 9, '#6a3a1e'); p.r(1 - ox, 12, p.w - 2, 1, '#9a6a3a');
      for (let x = 6 - ox; x < p.w - ox - 2; x += 10) p.r(x, 14, 6, 5, '#7a4826');
      shelfBooks(p, 3, 2, 18, 19, r, ['#6a1a1a', '#1a3a2a', '#3a2a1a', '#1a2a4a', '#8a6a2a'], '#4a2810');
      p.box(30, 3, 12, 8, '#d8c890'); p.r(32, 5, 8, 1, '#7a5a20'); p.r(32, 7, 6, 1, '#7a5a20');
      // 正義の天秤
      p.r(57, 3, 1, 6, '#c8a040'); p.r(54, 4, 7, 1, '#c8a040'); p.r(53, 6, 3, 1, '#c8a040'); p.r(59, 6, 3, 1, '#c8a040'); p.r(56, 9, 3, 1, '#c8a040');
      chairR(p, 24, 17, '#5a1a14'); chairL(p, 44, 17, '#5a1a14');
      p.r(29, 14, 14, 2, '#5a2e14'); p.r(29, 13, 14, 1, '#7a4a24'); p.r(30, 16, 12, 5, '#4a240e');
      p.r(39, 10, 1, 3, '#c8a040'); p.r(37, 9, 4, 1, '#2a7a3a');
      plant(p, 64, 20, 9);
      clusters = [[[24, 1], [44, 0]]];
      chairR(p, 52, 17, '#5a1a14');
      p.r(55, 14, 6, 1, '#5a2e14'); p.r(56, 15, 1, 6, '#4a240e');
      extra = [[52, 1], [48, 0, 'stand']];
      break;
    }
    case 'design': {
      sh(r, p, '#f6f4f0', pick(r, ['#c8b090', '#9aa0a8', '#d8c8a8']), {});
      for (let i = 0; i < 4; i++) poster(p, 3 + i * 17 + ((r() * 4) | 0), 2 + ((r() * 2) | 0), 8 + ((r() * 4) | 0), 7, r);
      for (let i = 0; i < 3; i++) { const lx = 10 + i * 24; p.r(lx, 0, 1, 2, '#333'); p.r(lx - 1, 2, 3, 2, pick(r, BRIGHT)); }
      const cc = () => pick(r, BRIGHT);
      clusters = [];
      for (const sx of [2, 18, 34]) clusters.push(deskCluster(p, sx, { ...base, mon: 'drafting', chair: cc() }));
      plant(p, 58, 20, 12); plant(p, 64, 20, 7);
      extra = [[52, 0, 'stand'], [46, 1, 'stand']];
      break;
    }
    case 'bank': {
      sh(r, p, '#e8dcc0', '#8a7a62', {});
      for (let i = 0; i < 12; i++) p.p((r() * 70) | 0, (r() * 12) | 0, '#d4c8a8');
      // 金庫
      p.disc(61, 11, 7, '#3a3a40'); p.disc(61, 11, 6, '#9aa0a8'); p.disc(61, 11, 2, '#5a5a62');
      for (let a = 0; a < 6; a++) p.p(61 + Math.round(Math.cos(a) * 4), 11 + Math.round(Math.sin(a) * 4), '#3a3a40');
      p.r(54, 19, 15, 2, '#5a5a62');
      // 窓口
      const tellers = [6, 20, 34];
      seatPeople(p, tellers.map((x) => [x + 3, 1, 'stand']).slice(0, Math.min(3, Math.max(0, n))), 3);
      p.box(1, 13, 48, 8, '#7a5a3a'); p.r(1, 13, 48, 1, '#c8a060');
      for (const x of tellers) { p.r(x, 5, 1, 8, '#a0b8c8'); p.r(x + 12, 5, 1, 8, '#a0b8c8'); p.r(x, 5, 13, 1, '#a0b8c8'); }
      p.g.save(); p.g.globalAlpha = 0.3; p.g.fillStyle = '#c8e8f8'; p.g.fillRect(1, 5, 48, 8); p.g.restore(); p._fs = null;
      for (const x of tellers) p.r(x + 4, 12, 4, 1, '#f0f0f0');
      extra = [[44, 0, 'stand'], [50, 1, 'stand'], [26, 0, 'stand']];
      for (let i = 3; i < n; i++) { const e = extra[i - 3]; if (e) standFig(p, e[0], 20, FIG, e[1], i & 1); }
      return;
    }
    case 'publisher': {
      sh(r, p, '#e8e0d0', '#7a6a58', {});
      shelfBooks(p, 2 - ox, 1, p.w - 4, 8, r, ['#c84040', '#3a6ab0', '#e8c040', '#3a8a5a', '#f4f0e0', '#8a4a8a', '#202020']);
      p.box(6, 10, 7, 3, '#ffffff'); p.r(7, 11, 5, 1, '#c84040'); // カレンダー
      for (let i = 0; i < 4; i++) { const x = 56 + ((r() * 12) | 0); const h = 2 + ((r() * 4) | 0); p.r(x, 21 - h, 4, h, pick(r, ['#f4f0e0', '#e8dcc0', '#d0c8b0'])); }
      clusters = [deskCluster(p, 2, { ...base, mon: 'paper' }), deskCluster(p, 24, { ...base, mon: r() < 0.5 ? 'pc' : 'paper' }), deskCluster(p, 46, { ...base, mon: 'paper' })];
      break;
    }
    case 'game': {
      const wall = pick(r, ['#6a5a9a', '#5a6a9a', '#7a5a8a']);
      sh(r, p, wall, '#3a3450', {});
      p.r(1 - ox, 1, p.w - 2, 1, '#ff40c0'); p.r(1 - ox, 2, p.w - 2, 1, '#40e0ff');
      for (let i = 0; i < 3; i++) { const x = 4 + i * 16 + ((r() * 4) | 0); p.box(x, 4, 9, 7, '#14102a'); invader(p, x + 2, 5, pick(r, ['#80ff40', '#ff40c0', '#40e0ff', '#ffe040'])); }
      // アーケード筐体
      p.box(62, 5, 9, 16, '#c02040'); p.r(63, 7, 7, 5, '#101018'); invader(p, 64, 7, '#ffe040'); p.r(63, 13, 7, 2, '#202020'); p.p(65, 13, '#ff4040'); p.p(67, 14, '#40a0ff');
      clusters = [deskCluster(p, 2, { ...base, mon: 'rgb', chair: '#202020' }), deskCluster(p, 24, { ...base, mon: 'rgb', chair: '#c02040' })];
      p.r(46, 9, 12, 1, '#2a2440'); for (let i = 0; i < 4; i++) p.r(47 + i * 3, 6, 2, 3, pick(r, BRIGHT));
      extra = [[58, 1, 'stand'], [50, 0, 'stand']];
      break;
    }
    case 'trading': {
      sh(r, p, '#d0d8e4', '#3a4458', {});
      p.r(1 - ox, 13, p.w - 2, 8, '#2a3a5a');
      p.box(14, 2, 44, 9, '#0a1018');
      let y = 7;
      for (let x = 15; x < 57; x++) { const ny = Math.max(3, Math.min(9, y + ((r() * 3) | 0) - 1)); p.p(x, ny, ny <= y ? '#40e070' : '#f04040'); y = ny; }
      for (const [cx, cy] of [[5, 4], [64, 4], [64, 9]]) { p.disc(cx, cy, 2, '#f4f4f4'); p.p(cx, cy - 1, INK); p.p(cx + 1, cy, INK); }
      clusters = [deskCluster(p, 2, { ...base, mon: 'triple', chair: '#202020', desk: '#9aa0a8', edge: '#4a505a' }), deskCluster(p, 24, { ...base, mon: 'triple', chair: '#202020', desk: '#9aa0a8', edge: '#4a505a' }), deskCluster(p, 46, { ...base, mon: 'triple', chair: '#202020', desk: '#9aa0a8', edge: '#4a505a' })];
      break;
    }
    default: { // standard
      const wall = pick(r, ['#d3dae0', '#dcd6c8', '#d0dcd0', '#e0d6dc']);
      sh(r, p, wall, pick(r, ['#6f7c8c', '#7a6a5a', '#5a6a5a']), { base: shade(wall, -0.15) });
      const bx = 3 + ((r() * 6) | 0);
      if (r() < 0.5) { p.box(bx, 3, 14, 6, '#ffffff'); p.r(bx + 2, 5, 6, 1, '#4a6ab8'); p.r(bx + 2, 7, 4, 1, '#c84a4a'); }
      else { p.box(bx, 3, 14, 6, '#c89a5a'); for (let i = 0; i < 4; i++) p.r(bx + 2 + i * 3, 4 + (i & 1), 2, 2, pick(r, ['#ffffff', '#f8e070', '#a0d0f0'])); }
      const cx = 30 + ((r() * 8) | 0);
      p.box(cx, 2, 5, 5, '#ffffff'); p.p(cx + 2, 3, INK); p.p(cx + 2, 4, INK); p.p(cx + 3, 4, INK);
      if (r() < 0.6) picture(p, 50 + ((r() * 6) | 0), 3, 9, 6, (r() * 3) | 0);
      clusters = [deskCluster(p, 2, base), deskCluster(p, 24, base), deskCluster(p, 46, base)];
      if (r() < 0.7) plant(p, 66, 20, 7 + ((r() * 4) | 0));
    }
  }
  const seats = officeSeats(clusters).concat(extra);
  seatPeople(p, seats, n);
};
SIGN.office = (p, v, name, r) => {
  if (!v.occ) return;
  const cols = { standard: ['#3a5a8a', '#ffffff'], it: ['#20a090', '#ffffff'], law: ['#4a2810', '#e8c870'], design: ['#ffffff', '#e04870'], bank: ['#1a3a6a', '#f0d060'], publisher: ['#7a2020', '#ffffff'], game: ['#14102a', '#80ff40'], trading: ['#0a1018', '#40e070'] };
  const [bg, fg] = cols[name] || cols.standard;
  // 入口の社名プレート（右上）
  const x = p.w - 20, y = 1;
  namePlate(p, x, y, 18, 5, bg, fg, (pp, px, py, w) => { pp.r(px + 2, py + 2, w - 4, 1, fg); });
};

// ================= マンション（128x24） =================
function family(p, v, pos) { // pos: [[x, kind, facing]]
  for (let i = 0; i < Math.min(v.n, pos.length); i++) {
    const [x, k, f, y] = pos[i];
    if (k === 'sit') sitFig(p, x, y || 15, FIG, f);
    else if (k === 'child') childFig(p, x, 20, FIG, f);
    else if (k === 'kneel') kneel(p, x, FIG, f);
    else if (k === 'lie') p.r(x, y || 12, 2, 2, FIG);
    else standFig(p, x, 20, FIG, f, i & 1);
  }
}
function kitchen(p, x, r, style) {
  const cab = style === 'luxury' ? '#3a2a24' : style === 'minimal' ? '#f8f8f8' : style === 'japanese' ? '#b08850' : '#f0ece0';
  p.box(x, 6, 7, 15, style === 'luxury' ? '#c8c8d0' : '#f4f4f4'); p.r(x + 1, 12, 5, 1, '#c8c8c8'); p.r(x + 5, 8, 1, 2, '#888');
  p.box(x + 7, 15, 15, 6, cab); p.r(x + 7, 14, 15, 1, style === 'luxury' ? '#e8e0d0' : '#8a8a8a');
  if (style !== 'minimal') p.box(x + 8, 3, 13, 5, shade(cab, -0.1));
  p.box(x + 16, 12, 4, 2, '#555');
}
ART.condo = (p, v, name, r) => {
  if (!v.occ) { vacant(p, '#a8987a', '#6e5032', 'FOR SALE'); return; }
  const blank = pick(r, ['#4a7ac8', '#c85a8a', '#58a868', '#e0a030']);
  switch (name) {
    case 'japanese': {
      sh(r, p, '#e8d6a8', '#b8b070', {});
      tatami(p, p.w);
      p.r(1, 3, 126, 1, '#8a5a2a');
      for (let x = 32; x < 128; x += 32) p.r(x, 0, 2, 21, '#8a5a2a');
      kitchen(p, 3, r, 'japanese');
      // ちゃぶ台と座布団
      p.r(40, 17, 14, 1, '#7a4a20'); p.r(41, 18, 1, 3, '#5a3010'); p.r(52, 18, 1, 3, '#5a3010');
      p.p(46, 16, '#ffffff'); p.p(48, 16, '#5a8a3a');
      p.r(35, 20, 5, 1, '#8a4a8a'); p.r(55, 20, 5, 1, '#8a4a8a');
      // 床の間
      p.r(68, 4, 22, 17, '#d8c490'); p.r(68, 18, 22, 3, '#8a5a2a');
      p.box(76, 5, 6, 11, '#f4f0e0'); p.r(77, 7, 1, 6, '#202020'); p.r(79, 8, 1, 4, '#202020'); p.r(75, 5, 8, 1, '#5a3a1a');
      p.r(71, 14, 3, 4, '#3a6a8a'); p.r(72, 11, 1, 3, '#3a8a3a'); p.p(71, 10, '#e04060');
      shojiPanel(p, 95, 1, 8, 20);
      // 布団
      p.r(106, 19, 18, 2, '#f4f4f4'); p.r(110, 18, 14, 2, blank); p.r(107, 18, 3, 1, '#ffffff');
      family(p, v, [[12, 'stand', 0], [43, 'kneel', 1], [56, 'kneel', 0], [110, 'lie', 1, 17]]);
      break;
    }
    case 'family': {
      sh(r, p, '#d8ecf8', '#a07a4a', { base: '#9ab8d0' });
      for (let i = 0; i < 10; i++) p.p(4 + ((r() * 120) | 0), 2 + ((r() * 8) | 0), '#f8e060');
      kitchen(p, 3, r, 'modern');
      p.r(30, 14, 14, 1, '#c87a40'); p.r(31, 15, 1, 6, '#8a4a20'); p.r(42, 15, 1, 6, '#8a4a20');
      chairR(p, 27, 17, '#e04848'); chairL(p, 44, 17, '#40a0e0');
      for (let i = 0; i < 3; i++) { p.box(52 + i * 7, 3, 6, 5, '#ffffff'); p.r(53 + i * 7, 4, 4, 3, pick(r, BRIGHT)); }
      const sofa = pick(r, ['#e0a030', '#40a0e0', '#e04870']);
      p.box(55, 12, 20, 4, sofa); p.box(55, 15, 20, 4, shade(sofa, 0.2));
      p.box(82, 9, 10, 7, '#1a1a1a'); p.r(83, 10, 8, 5, '#4a8ad0'); p.box(81, 16, 12, 5, '#c8a070');
      // おもちゃ
      p.disc(78, 19, 1, '#e04040'); p.r(60, 20, 2, 1, '#f0c030'); p.r(63, 19, 2, 2, '#40c060'); p.r(70, 20, 3, 1, '#4080e0');
      p.r(97, 0, 4, 21, '#c8d8e8'); p.r(97, 0, 1, 21, '#8aa0b8'); p.r(100, 0, 1, 21, '#8aa0b8');
      // 二段ベッド
      p.r(104, 4, 1, 17, '#8a5a2a'); p.r(124, 4, 1, 17, '#8a5a2a');
      p.box(104, 9, 21, 3, '#ffffff'); p.r(108, 8, 16, 2, '#e04870');
      p.box(104, 17, 21, 3, '#ffffff'); p.r(108, 16, 16, 2, '#40a0e0');
      p.r(122, 5, 2, 1, '#8a5a2a'); p.r(122, 8, 2, 1, '#8a5a2a');
      family(p, v, [[14, 'stand', 0], [62, 'sit', 1, 15], [76, 'child', 1], [88, 'child', 0]]);
      break;
    }
    case 'luxury': {
      sh(r, p, '#e8dcc8', '#4a2a18', { base: '#c8a050' });
      p.r(1, 4, 126, 1, '#c8a040'); p.r(1, 18, 126, 1, '#c8a040');
      kitchen(p, 3, r, 'luxury');
      for (let i = 0; i < 4; i++) p.r(12 + i * 3, 8, 2, 4, '#3a6a3a');
      // シャンデリア
      p.r(60, 0, 1, 3, '#806020'); p.r(55, 3, 11, 2, '#e0b040'); for (let i = 55; i < 66; i += 2) p.p(i, 5, '#fff6b0');
      // グランドピアノ
      p.r(28, 12, 18, 3, '#141414'); p.line(30, 12, 42, 6, '#141414'); p.r(28, 15, 18, 1, '#f4f4f4'); p.r(28, 16, 1, 5, '#141414'); p.r(44, 16, 1, 5, '#141414');
      p.r(25, 16, 3, 1, '#3a2a24'); p.r(26, 17, 1, 4, '#3a2a24');
      // 大きな絵
      p.box(66, 5, 18, 9, '#c8a040'); p.r(67, 6, 16, 7, pick(r, ['#3a5a8a', '#8a3a3a', '#3a6a4a'])); p.disc(75, 9, 2, '#f0d060');
      p.box(55, 13, 30, 4, '#f4f0e8'); p.box(55, 16, 30, 3, '#e8e0d0'); p.r(56, 19, 1, 2, '#3a2a24'); p.r(83, 19, 1, 2, '#3a2a24');
      p.r(97, 0, 4, 21, '#c8b088'); p.r(97, 0, 1, 21, '#806020'); p.r(100, 0, 1, 21, '#806020');
      p.box(103, 8, 3, 13, '#c8a040');
      p.box(105, 14, 21, 4, '#ffffff'); p.box(110, 13, 16, 4, '#7a2040'); p.r(111, 14, 14, 1, '#c8a040');
      family(p, v, [[26, 'sit', 1, 16], [64, 'sit', 1, 15], [12, 'stand', 0], [107, 'lie', 1, 11]]);
      break;
    }
    case 'artist': {
      sh(r, p, '#f4f0e8', '#b08a5a', {});
      for (let i = 0; i < 30; i++) p.p((r() * 127) | 0, (r() * 21) | 0, pick(r, BRIGHT));
      for (let i = 0; i < 12; i++) p.r((r() * 124) | 0, 21, 2, 1, pick(r, BRIGHT));
      kitchen(p, 3, r, 'modern');
      // イーゼル
      p.line(40, 20, 44, 6, '#7a4a20'); p.line(48, 20, 44, 6, '#7a4a20');
      p.box(38, 7, 12, 9, '#ffffff'); p.r(39, 8, 10, 7, pick(r, ['#78b8f0', '#f0a050', '#b0e0a0'])); p.disc(45, 11, 2, pick(r, BRIGHT)); p.r(39, 13, 10, 2, pick(r, BRIGHT));
      // 立てかけたキャンバス
      for (let i = 0; i < 3; i++) { const x = 58 + i * 7; p.box(x, 10 + i, 6, 11 - i, '#f8f8f0'); p.r(x + 1, 12 + i, 4, 4, pick(r, BRIGHT)); }
      p.box(82, 16, 10, 5, '#8a6a4a'); for (let i = 0; i < 4; i++) p.r(83 + i * 2, 14, 1, 2, pick(r, BRIGHT));
      plant(p, 92, 20, 11);
      p.r(98, 0, 2, 21, '#d8d0c0');
      p.r(104, 18, 20, 3, '#e8e0d0'); p.r(110, 17, 14, 2, '#6a8aa0'); p.r(105, 17, 4, 1, '#ffffff');
      family(p, v, [[36, 'stand', 1], [84, 'sit', 0, 16], [70, 'stand', 0]]);
      break;
    }
    case 'minimal': {
      sh(r, p, '#f8f8f6', '#d8b888', {});
      kitchen(p, 3, r, 'minimal');
      p.box(52, 15, 16, 4, '#9a9a9a'); p.r(52, 13, 16, 2, '#8a8a8a'); p.r(53, 19, 1, 2, '#555'); p.r(66, 19, 1, 2, '#555');
      p.r(72, 18, 8, 1, '#c8a878'); p.r(75, 19, 1, 2, '#a08060');
      plant(p, 88, 20, 12);
      p.r(40, 0, 1, 5, '#555'); p.r(38, 5, 5, 1, '#202020');
      p.r(100, 2, 1, 19, '#e0e0dc');
      p.r(106, 18, 20, 3, '#f4f4f4'); p.r(112, 17, 14, 2, '#d8d8d8');
      family(p, v, [[60, 'sit', 1, 15], [14, 'stand', 0], [80, 'stand', 0]]);
      break;
    }
    default: { // modern
      const wall = pick(r, ['#efdcae', '#e4e8ec', '#f0e4d8']);
      sh(r, p, wall, '#9a6434', { base: '#a07a4a' });
      for (let x = 3; x < p.w - 1; x += 6) p.r(x, 1, 1, 19, shade(wall, 0.25));
      kitchen(p, 3, r, 'modern');
      p.r(36, 0, 1, 4, '#555'); p.r(34, 4, 5, 2, '#e8b840');
      p.r(30, 14, 14, 1, '#7a4a20'); p.r(30, 15, 14, 1, '#4a2a10'); p.r(32, 16, 1, 5, '#4a2a10'); p.r(41, 16, 1, 5, '#4a2a10');
      chairR(p, 27, 17, '#6a4020'); chairL(p, 44, 17, '#6a4020');
      picture(p, 56, 3, 14, 7, (r() * 3) | 0);
      const sofa = pick(r, ['#c0503a', '#3a70a8', '#5a8a3a', '#8a5aa0']);
      p.box(55, 11, 22, 5, sofa); p.box(55, 15, 22, 4, shade(sofa, 0.18));
      p.box(53, 13, 3, 6, shade(sofa, -0.2)); p.box(76, 13, 3, 6, shade(sofa, -0.2));
      p.box(82, 16, 13, 5, '#6a4222');
      p.box(83, 8, 11, 8, '#1a1a1a'); p.r(84, 9, 9, 6, v.n > 0 && v.night ? '#9ad0ff' : '#3a5a88');
      p.r(97, 0, 4, 21, shade(wall, -0.1)); p.r(97, 0, 1, 21, '#9a8058'); p.r(100, 0, 1, 21, '#9a8058');
      picture(p, 112, 3, 9, 6, (r() * 3) | 0);
      p.box(103, 10, 3, 11, '#6a4020');
      p.box(105, 14, 21, 4, '#ffffff'); p.box(105, 12, 5, 3, '#ffffff');
      p.box(110, 13, 16, 4, blank);
      if (r() < 0.5) plant(p, 46, 20, 8);
      family(p, v, [[14, 'stand', 0], [64, 'sit', 1, 15], [78, 'child', 1], [107, 'lie', 1, 10]]);
    }
  }
};
SIGN.condo = (p, v) => {
  if (!v.occ) return;
  namePlate(p, 2, 1, 14, 4, '#f4f0e0', '#202020', (pp, x, y) => pp.r(x + 2, y + 2, 10, 1, '#7a6a4a'));
};

// ================= ホテル =================
function futon(p, x, w, blanket, guest, dirty, r) {
  p.r(x, 18, w, 3, '#f4f4f4'); p.r(x, 20, w, 1, '#d8d8d8');
  if (!dirty) {
    p.box(x + 1, 16, 4, 2, '#ffffff');
    p.box(x + 5, 17, w - 5, 3, blanket); p.r(x + 6, 18, w - 7, 1, shade(blanket, 0.3));
    if (guest) { p.r(x + 2, 15, 2, 2, FIG); p.box(x + 6, 16, 6, 2, blanket); }
  } else {
    p.box(x + 2 + ((r() * 4) | 0), 16, 4, 2, '#ffffff');
    for (let i = x + 4; i < x + w + 2; i++) { const h = 1 + ((r() * 3) | 0); p.r(i, 20 - h, 1, h, i % 3 ? blanket : shade(blanket, -0.25)); }
    p.p(x + 8, 19, '#c8b890');
  }
}
function hotelRoom(p, v, name, r, kind) {
  const W = p.w;
  const style = name || 'classic';
  const suite = kind === 'suite';
  let wall, floor;
  if (style === 'modern') { wall = '#e6e8ea'; floor = '#5a5e66'; }
  else if (style === 'japanese') { wall = '#eadcb4'; floor = '#b8b070'; }
  else { wall = suite ? '#ecdcae' : pick(r, ['#efe2c4', '#e8d8d0', '#dde4cc']); floor = suite ? '#7a2848' : '#7a3040'; }
  sh(r, p, wall, floor, {});
  const blanket = style === 'modern' ? pick(r, ['#3a3e46', '#d8d8d8', '#c84a30']) : style === 'japanese' ? pick(r, ['#2a4a8a', '#8a3a3a', '#5a6a3a']) : pick(r, ['#3b6cc4', '#c04a4a', '#3a9a6a', '#8a5aa0']);
  if (style === 'classic') { for (let x = 3; x < W - 1; x += 4) p.r(x, 1, 1, 19, shade(wall, 0.2)); if (suite) p.r(1, 4, W - 2, 1, '#c8a040'); }
  if (style === 'modern') { const acc = pick(r, ['#3a6a8a', '#c89a30', '#c86a5a', '#4a8a6a']); p.r(suite ? 56 : 1, 1, suite ? 38 : W - 2, 20, acc); }
  if (style === 'japanese') { tatami(p, W); for (let x = 0; x < W; x += 24) p.r(x + 23, 0, 1, 21, '#8a5a2a'); p.r(1, 3, W - 2, 1, '#8a5a2a'); }
  const guest1 = v.n > 0, guest2 = v.n > 1;
  const extras = (x) => {
    if (v.dirty) { p.box(x, 18, 4, 3, '#ffffff'); p.r(x + 4, 20, 3, 1, '#7ab0d8'); p.p(x - 3, 20, '#e0c040'); }
    else if (v.occ && v.n === 0) { p.box(x, 16, 4, 5, pick(r, ['#b03838', '#3a5a9a', '#2a2a2a'])); p.r(x + 1, 15, 2, 1, '#601818'); }
  };
  if (style === 'japanese') {
    if (kind === 'single') {
      shojiPanel(p, 4, 3, 12, 10);
      futon(p, 2, 18, blanket, guest1, v.dirty, r);
      p.r(23, 17, 7, 1, '#7a4a20'); p.r(24, 18, 1, 3, '#5a3010'); p.r(28, 18, 1, 3, '#5a3010'); p.p(25, 16, '#f4f4f4');
      extras(24);
    } else if (kind === 'twin') {
      shojiPanel(p, 18, 3, 12, 10);
      futon(p, 1, 18, blanket, guest1, v.dirty, r); futon(p, 26, 18, blanket, guest2, v.dirty, r);
      extras(20);
    } else {
      shojiPanel(p, 4, 3, 16, 12);
      p.r(26, 4, 20, 17, '#d8c490'); p.box(33, 5, 6, 10, '#f4f0e0'); p.r(34, 7, 1, 5, '#202020'); p.r(36, 8, 1, 4, '#c02020');
      p.r(29, 17, 3, 4, '#3a6a8a'); p.r(30, 14, 1, 3, '#3a8a3a');
      p.r(6, 17, 14, 1, '#7a4a20'); p.r(7, 18, 1, 3, '#5a3010'); p.r(18, 18, 1, 3, '#5a3010'); p.p(11, 16, '#f4f4f4'); p.p(13, 16, '#5a8a3a');
      futon(p, 52, 18, blanket, guest1, v.dirty, r); futon(p, 72, 18, blanket, guest2, v.dirty, r);
      shojiPanel(p, 48, 1, 2, 20);
      extras(92);
      if (v.n > 2) kneel(p, 4, FIG, 1);
    }
    return;
  }
  const head = style === 'modern' ? '#2a2a2a' : '#7a4a22';
  const myBed = (x, w, g) => {
    bed(p, x, w, blanket, g, v.dirty, r);
    if (style === 'modern') { p.r(x, 10, 3, 4, wall); p.box(x, 13, 3, 8, head); }
  };
  if (kind === 'single') {
    if (style === 'modern') { p.box(12, 3, 10, 6, '#1a1a1a'); p.r(13, 4, 8, 4, '#3a5a88'); p.r(26, 0, 1, 6, '#333'); p.r(25, 6, 3, 2, '#f0f0f0'); }
    else picture(p, 10, 3, 10, 5, (r() * 3) | 0);
    myBed(2, 20, guest1);
    nightstand(p, 25);
    extras(23);
  } else if (kind === 'twin') {
    if (style === 'modern') { p.box(19, 3, 10, 6, '#1a1a1a'); p.r(20, 4, 8, 4, '#3a5a88'); }
    else picture(p, 18, 3, 12, 5, (r() * 3) | 0);
    myBed(1, 18, guest1); myBed(24, 18, guest2);
    nightstand(p, 42);
    if (v.dirty) { p.box(20, 18, 4, 3, '#ffffff'); p.p(41, 20, '#e0c040'); }
    else if (v.occ && v.n === 0) p.box(20, 16, 4, 5, '#b03838');
  } else {
    if (style === 'classic') { p.r(30, 1, 1, 3, '#806020'); p.r(26, 4, 9, 1, '#e0b040'); p.p(26, 5, '#fff2a0'); p.p(30, 5, '#fff2a0'); p.p(34, 5, '#fff2a0'); }
    else { p.r(30, 0, 1, 5, '#333'); p.r(27, 5, 7, 2, '#f4f4f4'); }
    picture(p, 8, 5, 14, 6, (r() * 3) | 0);
    const sofa = style === 'modern' ? '#5a5e66' : '#8a3a5a';
    p.box(4, 13, 20, 4, sofa); p.box(4, 16, 20, 3, shade(sofa, 0.2)); p.box(2, 14, 3, 5, shade(sofa, -0.2)); p.box(23, 14, 3, 5, shade(sofa, -0.2));
    p.r(28, 17, 10, 1, style === 'modern' ? '#e8e8e8' : '#d8b060'); p.r(29, 18, 1, 3, '#806020'); p.r(36, 18, 1, 3, '#806020');
    p.box(41, 16, 10, 5, '#5a3418'); p.box(42, 9, 8, 7, '#1a1a1a'); p.r(43, 10, 6, 5, v.n > 0 && v.night ? '#9ad0ff' : '#3a5a88');
    plant(p, 52, 20, 9);
    if (style === 'classic') { p.r(60, 3, 30, 2, '#b8304a'); p.r(60, 3, 30, 1, '#e0b040'); p.r(60, 5, 2, 9, '#c8405a'); p.r(88, 5, 2, 9, '#c8405a'); }
    myBed(60, 30, guest1);
    if (!v.dirty && guest2) p.r(64, 9, 2, 2, FIG);
    nightstand(p, 91);
    if (v.dirty) { p.box(46, 18, 5, 3, '#ffffff'); p.r(30, 20, 3, 1, '#e0c040'); }
    else if (v.occ && v.n === 0) { p.box(56, 15, 4, 6, '#2a2a2a'); p.box(53, 17, 3, 4, '#b03838'); }
    if (v.n > 2) sitFig(p, 12, 16, FIG, 1);
  }
}
ART.hotelSingle = (p, v, name, r) => hotelRoom(p, v, name, r, 'single');
ART.hotelTwin = (p, v, name, r) => hotelRoom(p, v, name, r, 'twin');
ART.hotelSuite = (p, v, name, r) => hotelRoom(p, v, name, r, 'suite');

// ================= ファストフード（128x24） =================
// 左: 厨房・カウンター（x 4..44）、右: 客席（x 50..124）
const FF_TABLES = [54, 78, 102];
function ffSeats(p, v, tableFn) {
  for (const x of FF_TABLES) tableFn(x);
  if (!v.open) return;
  let k = 0;
  const n = v.n;
  if (k++ < n) standFig(p, 20, 20, FIG, 0, 0);
  if (k++ < n) standFig(p, 30, 20, FIG, 0, 1);
  for (const x of FF_TABLES) {
    if (k++ < n) sitFig(p, x - 5, 17, FIG, 1);
    if (k++ < n) sitFig(p, x + 13, 17, FIG, 0);
  }
  if (k++ < n) standFig(p, 47, 20, FIG, 0, 1);
}
function poleTable(p, x, top, edge, stoolC) {
  p.r(x, 14, 10, 1, top); p.r(x, 15, 10, 1, edge); p.r(x + 4, 16, 2, 4, '#606060'); p.r(x + 2, 20, 6, 1, '#606060');
  p.r(x - 5, 17, 4, 1, stoolC); p.r(x - 4, 18, 1, 3, '#606060');
  p.r(x + 11, 17, 4, 1, stoolC); p.r(x + 13, 18, 1, 3, '#606060');
}
function staff(p, v, xs, hat) { if (v.open && v.n > 0) for (const x of xs) hatFig(p, x, 19, hat, 1); }

ART.fastfood = (p, v, name, r) => {
  const W = p.w;
  switch (name) {
    case 'ramen': {
      sh(r, p, '#c89a5a', '#6a4a2a', {});
      for (let x = 3; x < W; x += 5) p.r(x, 1, 1, 20, '#b0844a');
      // 暖簾
      for (let x = 4; x < 46; x += 6) { p.r(x, 1, 5, 6, '#1a2a5a'); p.p(x + 2, 3, '#ffffff'); }
      lantern(p, 48, 1, '#e03030');
      staff(p, v, [12, 24], '#ffffff');
      p.box(4, 12, 41, 9, '#8a5a2a'); p.r(3, 11, 43, 2, '#5a3416');
      for (const x of [10, 22, 34]) { p.box(x, 7, 7, 4, '#9a9a9a'); for (let i = 0; i < 3; i++) p.p(x + 1 + i * 2, 5 - (i & 1), '#f4f4f4'); }
      ffSeats(p, v, (x) => {
        p.r(x - 2, 14, 14, 1, '#7a4a20'); p.r(x - 2, 15, 14, 1, '#4a2a10'); p.r(x + 4, 16, 2, 5, '#4a2a10');
        p.p(x + 2, 13, '#f0e0c0'); p.p(x + 7, 13, '#f0e0c0');
        stool(p, x - 6, '#a03020'); stool(p, x + 12, '#a03020');
      });
      break;
    }
    case 'sushi': {
      sh(r, p, '#f0e8d8', '#8a6a4a', {});
      for (let x = 1; x < W - 1; x++) p.p(x, 3 + Math.round(Math.sin(x * 0.5)), '#3a6ab0');
      p.r(1, 6, W - 2, 1, '#3a6ab0');
      staff(p, v, [14, 28], '#ffffff');
      // ネタケース
      p.box(4, 12, 41, 9, '#b08a5a'); p.r(3, 11, 43, 1, '#5a3a20');
      p.box(6, 8, 36, 4, '#d8ecf4'); for (let i = 0; i < 8; i++) p.r(8 + i * 4, 10, 3, 1, pick(r, ['#f07050', '#f0a0a0', '#f8f0e8', '#e05030']));
      // 回転レーン
      p.r(50, 13, 74, 2, '#c0c4c8'); p.r(50, 15, 74, 1, '#7a7e84'); p.r(50, 16, 74, 5, '#b08a5a');
      for (let x = 52; x < 122; x += 6) { p.r(x, 12, 4, 1, pick(r, ['#e04040', '#f0c040', '#3a6ab0', '#ffffff'])); p.r(x + 1, 11, 2, 1, pick(r, ['#f07050', '#f8f0e8', '#3a3a3a'])); }
      ffSeats(p, v, (x) => { stool(p, x - 6, '#5a3a20'); stool(p, x + 12, '#5a3a20'); });
      break;
    }
    case 'pizza': {
      sh(r, p, '#b04a30', '#5a3020', {});
      for (let y = 2; y < 20; y += 3) for (let x = (y % 2) * 3; x < W; x += 6) p.r(x, y, 1, 2, '#8a3420');
      for (let y = 4; y < 20; y += 3) p.r(1, y, W - 2, 1, '#c8644a');
      // 窯
      p.r(4, 6, 20, 15, '#6a2a18'); p.disc(14, 8, 7, '#7a3a20');
      p.r(9, 11, 10, 6, '#1a0a04'); p.r(10, 14, 8, 3, v.open ? '#ff8a20' : '#4a2010'); if (v.open) p.r(12, 13, 4, 1, '#ffd040');
      staff(p, v, [30], '#ffffff');
      p.box(26, 12, 19, 9, '#f0e8d8'); p.r(25, 11, 21, 2, '#3a7a3a');
      p.disc(35, 9, 2, '#f0c040'); p.p(34, 9, '#d03020'); p.p(36, 8, '#d03020');
      ffSeats(p, v, (x) => {
        for (let i = 0; i < 12; i += 2) p.r(x - 1 + i, 14, 2, 1, (i / 2) % 2 ? '#ffffff' : '#d02020');
        p.r(x - 1, 15, 12, 2, '#d02020'); p.r(x + 4, 17, 2, 4, '#3a2010');
        chairR(p, x - 4, 17, '#3a7a3a'); chairL(p, x + 11, 17, '#3a7a3a');
      });
      break;
    }
    case 'cafe': {
      sh(r, p, pick(r, ['#e8d8c0', '#dcd0b8', '#e8dcc8']), '#7a5a3a', { base: '#a07a4a' });
      p.box(6, 2, 26, 8, '#2a2a2a'); for (let i = 0; i < 3; i++) { p.r(8, 4 + i * 2, 10 + ((r() * 8) | 0), 1, '#e8e8e8'); }
      p.r(36, 0, 1, 3, '#333'); p.r(34, 3, 5, 2, '#e8b840'); p.r(60, 0, 1, 3, '#333'); p.r(58, 3, 5, 2, '#e8b840'); p.r(84, 0, 1, 3, '#333'); p.r(82, 3, 5, 2, '#e8b840');
      staff(p, v, [20], '#3a2a1a');
      p.box(4, 12, 41, 9, '#6a4a2a'); p.r(3, 11, 43, 2, '#2a1a10');
      p.box(8, 6, 8, 5, '#c0c4c8'); p.r(10, 9, 2, 2, '#202020'); p.p(14, 7, '#e04040');
      p.box(26, 7, 16, 4, '#e8f4f8'); for (let i = 0; i < 4; i++) p.r(28 + i * 4, 9, 2, 1, pick(r, ['#c87a3a', '#f0d090', '#e070a0']));
      plant(p, 120, 20, 10);
      ffSeats(p, v, (x) => {
        p.r(x + 1, 14, 8, 1, '#f4f0e8'); p.r(x + 4, 15, 2, 5, '#3a3a3a'); p.r(x + 2, 20, 6, 1, '#3a3a3a');
        p.p(x + 3, 13, '#ffffff'); p.p(x + 6, 13, '#ffffff');
        chairR(p, x - 4, 17, '#4a3a2a'); chairL(p, x + 11, 17, '#4a3a2a');
      });
      break;
    }
    case 'curry': {
      sh(r, p, '#f4c040', '#8a4a20', {});
      p.r(1, 10, W - 2, 2, '#e07020'); for (let x = 2; x < W; x += 4) p.p(x, 12, '#c04010');
      staff(p, v, [14], '#ffffff');
      p.box(4, 12, 41, 9, '#c86a20'); p.r(3, 11, 43, 2, '#5a2a10');
      p.box(22, 5, 12, 6, '#2a2a2a'); p.r(23, 5, 10, 2, '#e08a20'); p.p(25, 3, '#f4f4f4'); p.p(30, 2, '#f4f4f4');
      p.r(6, 3, 12, 1, '#7a4a20'); for (let i = 0; i < 4; i++) p.box(6 + i * 3, 0 + 1, 2, 2, pick(r, ['#e04020', '#f0c020', '#6a3a10', '#40a040']));
      ffSeats(p, v, (x) => poleTable(p, x, '#e0a020', '#8a4a10', '#c04010'));
      break;
    }
    case 'donut': {
      sh(r, p, '#f8c8d8', '#ffffff', {});
      for (let y = 3; y < 12; y += 4) for (let x = (y % 8) + 2; x < W; x += 8) p.p(x, y, '#ffffff');
      for (let x = 0; x < W; x += 4) p.r(x, 21, 2, 1, '#e070a0');
      p.disc(100, 6, 5, '#c87a3a'); p.disc(100, 6, 4, '#f070b0'); p.disc(100, 6, 1, '#f8c8d8'); for (let i = 0; i < 5; i++) p.p(97 + i * 2, 4 + (i & 1) * 3, pick(r, BRIGHT));
      staff(p, v, [12], '#e070a0');
      p.box(4, 12, 41, 9, '#ffffff'); p.r(3, 11, 43, 1, '#e070a0');
      p.box(6, 6, 36, 6, '#e8f4f8');
      for (let i = 0; i < 8; i++) { const c = pick(r, ['#c87a3a', '#f070b0', '#7a4a2a', '#f0e0a0', '#60b0f0']); p.r(8 + i * 4, 9, 3, 2, c); p.p(9 + i * 4, 9, '#f8f0e0'); }
      ffSeats(p, v, (x) => poleTable(p, x, '#ffffff', '#e070a0', '#f070b0'));
      break;
    }
    default: { // burger
      sh(r, p, '#fff0c0', '#ffffff', {});
      p.r(1, 13, W - 2, 8, '#e04a30'); p.r(1, 13, W - 2, 1, '#ffffff'); p.r(1, 15, W - 2, 1, '#f8c040');
      for (let x = 0; x < W; x += 4) p.r(x, 21, 2, 1, '#d02020');
      p.box(5, 2, 36, 8, '#2a2a2a');
      for (let i = 0; i < 5; i++) { p.r(8 + i * 7, 4, 4, 3, pick(r, ['#f8c040', '#e05030', '#70c050', '#f0e0c0', '#e07040'])); p.r(8 + i * 7, 8, 3, 1, '#c8c8c8'); }
      staff(p, v, [13, 24], '#e03a2a');
      p.box(4, 12, 41, 9, '#f2f2f2'); p.r(5, 15, 39, 2, '#e03a2a'); p.r(3, 11, 43, 2, '#9a9a9a');
      p.box(35, 7, 7, 5, '#404040'); p.r(36, 8, 3, 1, '#80e080');
      ffSeats(p, v, (x) => poleTable(p, x, '#c03020', '#801810', '#f0c030'));
    }
  }
};
const FF_SIGN = {
  burger: ['BURGER', '#e03a2a', '#fff8d0'], ramen: ['RAMEN', '#ffffff', '#c02020'], sushi: ['SUSHI', '#1a2a5a', '#f8f4e8'],
  pizza: ['PIZZA', '#ffffff', '#3a7a3a'], cafe: ['CAFE', '#f0e0c0', '#3a2a1a'], curry: ['CURRY', '#7a2a10', '#f8e080'], donut: ['DONUT', '#e070a0', '#ffffff'],
};
SIGN.fastfood = (p, v, name) => {
  const s = FF_SIGN[name] || FF_SIGN.burger;
  signPlate(p, s[0], 92, 2, s[1], s[2]);
};

// ================= レストラン（192x24） =================
const RS_TABLES = [14, 52, 90, 128];
function rsPeople(p, v, kneelMode) {
  const n = v.open ? v.n : 0;
  let k = 0;
  for (const x of RS_TABLES) {
    if (kneelMode) { if (k++ < n) kneel(p, x - 3, FIG, 1); if (k++ < n) kneel(p, x + 19, FIG, 0); }
    else { if (k++ < n) sitFig(p, x - 4, 16, FIG, 1); if (k++ < n) sitFig(p, x + 19, 16, FIG, 0); }
  }
}
function rsChairs(p, c) {
  for (const x of RS_TABLES) {
    p.r(x - 5, 10, 1, 7, c); p.r(x - 5, 16, 4, 1, shade(c, 0.2)); p.r(x - 4, 17, 1, 4, c);
    p.r(x + 22, 10, 1, 7, c); p.r(x + 19, 16, 4, 1, shade(c, 0.2)); p.r(x + 21, 17, 1, 4, c);
  }
}
function kitchenWindow(p, v, fire) {
  p.box(166, 2, 24, 10, '#c8ccd0'); p.r(167, 3, 22, 8, '#e8ecef');
  if (fire && v.open) { for (let i = 0; i < 6; i++) p.r(170 + i * 3, 9 - (i & 1), 2, 2 + (i & 1), i % 2 ? '#ffb020' : '#ff6010'); }
  if (v.open && v.n > 0) { p.r(176, 5, 2, 2, FIG); p.r(175, 3, 4, 2, '#ffffff'); p.r(175, 7, 4, 4, '#ffffff'); }
  p.r(166, 12, 24, 1, '#c0c0c0');
}
ART.restaurant = (p, v, name, r) => {
  const W = p.w;
  switch (name) {
    case 'italian': {
      sh(r, p, '#f4e8cc', '#6a3a20', {});
      p.r(1, 12, W - 2, 9, '#b0583a'); for (let y = 13; y < 21; y += 3) { p.r(1, y, W - 2, 1, '#d8a080'); for (let x = (y % 2) * 4; x < W; x += 8) p.r(x, y + 1, 1, 2, '#d8a080'); }
      for (let x = 1; x < W - 1; x += 6) { p.r(x, 1, 2, 3, '#2a8a3a'); p.r(x + 2, 1, 2, 3, '#ffffff'); p.r(x + 4, 1, 2, 3, '#d02020'); }
      p.box(40, 5, 16, 6, '#7a4a20'); for (let i = 0; i < 5; i++) p.r(42 + i * 3, 6, 1, 4, '#2a6a2a');
      kitchenWindow(p, v, true);
      rsChairs(p, '#6a3a1a');
      rsPeople(p, v, false);
      for (const x of RS_TABLES) { for (let i = 0; i < 18; i += 2) p.r(x + i, 12, 2, 3, (i / 2) % 2 ? '#ffffff' : '#d02020'); p.r(x + 8, 15, 2, 6, '#3a1a0a'); p.r(x + 8, 9, 1, 3, '#2a6a2a'); }
      break;
    }
    case 'chinese': {
      sh(r, p, '#b02020', '#5a1010', {});
      for (let x = 2; x < W; x += 6) { p.p(x, 6, '#e8c040'); p.p(x + 3, 8, '#e8c040'); }
      for (let x = 1; x < W - 1; x++) p.p(x, 3 + Math.round(Math.sin(x * 0.3) * 1.5), '#e8c040');
      p.r(1, 13, W - 2, 8, '#6a1010'); p.r(1, 13, W - 2, 1, '#e8c040');
      for (const x of [34, 72, 128, 150]) lantern(p, x, 0, '#f03030');
      kitchenWindow(p, v, true);
      rsChairs(p, '#3a0a0a');
      rsPeople(p, v, false);
      for (const x of RS_TABLES) { p.box(x, 12, 18, 3, '#ffffff'); p.r(x + 4, 11, 10, 1, '#e8c040'); p.r(x + 8, 15, 2, 6, '#2a0a0a'); p.p(x + 6, 10, '#f0f0f0'); p.p(x + 11, 10, '#40a040'); }
      break;
    }
    case 'japanese': {
      sh(r, p, '#d8c090', '#5a3a20', {});
      for (let x = 2; x < W; x += 4) p.r(x, 1, 1, 11, '#b89a60');
      for (let x = 0; x < W; x += 38) p.r(x + 37, 0, 2, 21, '#5a3416');
      p.r(1, 12, W - 2, 1, '#5a3416');
      for (const x of [33, 71, 128, 150]) lantern(p, x, 1, '#f4ecd8');
      kitchenWindow(p, v, false);
      // 座敷（畳の小上がり）
      for (const x of RS_TABLES) { p.r(x - 6, 19, 30, 2, '#b8b070'); p.r(x - 6, 18, 30, 1, '#7a5a30'); }
      rsPeople(p, v, true);
      for (const x of RS_TABLES) { p.r(x + 2, 16, 14, 1, '#4a2a10'); p.r(x + 3, 17, 1, 1, '#4a2a10'); p.r(x + 14, 17, 1, 1, '#4a2a10'); p.p(x + 6, 15, '#c02020'); p.p(x + 10, 15, '#f4f4f4'); }
      break;
    }
    case 'steak': {
      sh(r, p, '#8a4a30', '#2a1a10', {});
      for (let y = 2; y < 12; y += 3) { p.r(1, y, W - 2, 1, '#6a3420'); for (let x = (y % 2) * 3; x < W; x += 6) p.r(x, y + 1, 1, 2, '#6a3420'); }
      p.r(1, 12, W - 2, 9, '#4a2a18'); for (let x = 8; x < W; x += 16) p.r(x, 13, 1, 7, '#3a1a0a');
      for (const x of [20, 56, 122, 144]) { p.box(x, 3, 12, 7, '#c8a040'); p.r(x + 1, 4, 10, 5, pick(r, ['#4a6a3a', '#6a4a2a', '#3a4a6a'])); }
      kitchenWindow(p, v, true);
      // ボックス席
      for (const x of RS_TABLES) { p.box(x - 7, 9, 4, 12, '#6a1a14'); p.box(x + 21, 9, 4, 12, '#6a1a14'); }
      rsPeople(p, v, false);
      for (const x of RS_TABLES) { p.r(x - 1, 13, 20, 2, '#5a3018'); p.r(x + 8, 15, 2, 6, '#3a1a0a'); p.p(x + 4, 12, '#8a4a30'); p.p(x + 13, 12, '#8a4a30'); }
      break;
    }
    default: { // french
      sh(r, p, '#a8382e', '#3a2014', {});
      for (let x = 4; x < W - 1; x += 8) { p.p(x, 3, '#c0503e'); p.p(x + 4, 7, '#c0503e'); p.p(x, 11, '#c0503e'); }
      p.r(1, 12, W - 2, 1, '#d8a840');
      p.r(1, 13, W - 2, 8, '#e8cfa0'); for (let x = 6; x < W; x += 12) p.r(x, 14, 1, 6, '#c8ac78');
      p.r(1, 20, W - 2, 1, '#8a6038');
      for (let x = 8; x < W - 30; x += 38) { p.r(x, 5, 2, 3, '#ffe080'); p.p(x, 4, '#806020'); }
      kitchenWindow(p, v, false);
      plant(p, 2, 20, 10);
      rsChairs(p, '#5a2a10');
      rsPeople(p, v, false);
      for (const x of RS_TABLES) {
        p.box(x, 12, 18, 3, '#ffffff'); p.r(x, 15, 1, 4, '#f0f0f0'); p.r(x + 17, 15, 1, 4, '#f0f0f0');
        p.r(x + 8, 15, 2, 6, '#3a1a0a');
        p.r(x + 8, 9, 1, 3, '#ffffff'); p.p(x + 8, 8, v.open ? '#ffb020' : '#7a5a3a');
      }
    }
  }
  if (v.open && v.n > 2) { standFig(p, 158, 20, FIG, 0, 0); p.r(155, 14, 4, 1, '#d0d0d0'); }
};
const RS_SIGN = {
  french: ['BISTRO', '#e8c870', '#5a1010'], italian: ['TRATTORIA', '#ffffff', '#2a7a3a'], chinese: ['CHINA', '#f0d040', '#a01010'],
  japanese: ['WASHOKU', '#f4ecd8', '#3a2414'], steak: ['STEAK', '#f0d080', '#2a1408'],
};
SIGN.restaurant = (p, v, name) => {
  const s = RS_SIGN[name] || RS_SIGN.french;
  signPlate(p, s[0], 96, 2, s[1], s[2]);
};

// ================= ショップ（96x24） =================
ART.shop = (p, v, name, r) => {
  const W = p.w;
  const goods = (x, y, w, h, pal) => { for (let i = x; i < x + w;) { const gw = 2 + ((r() * 2) | 0), gh = 2 + ((r() * (h - 1)) | 0); if (i + gw > x + w) break; p.r(i, y + h - gh, gw, gh, pick(r, pal)); i += gw + 1; } };
  let wall = '#e4eef6', floor = '#c8bca8';
  switch (name) {
    case 'fashion': {
      wall = '#f8eef0'; floor = '#d8c8c0';
      sh(r, p, wall, floor, {});
      for (let x = 1; x < W - 1; x += 6) p.r(x, 1, 3, 2, '#202020');
      for (const [x0, x1] of [[4, 30], [34, 52]]) {
        p.r(x0, 6, x1 - x0, 1, '#8a8a8a'); p.r(x0, 6, 1, 15, '#8a8a8a'); p.r(x1 - 1, 6, 1, 15, '#8a8a8a');
        for (let x = x0 + 2; x < x1 - 3; x += 4) { const c = pick(r, BRIGHT.concat(['#f4f4f4', '#202020'])); p.p(x + 1, 7, '#555'); p.r(x, 8, 3, 6 + ((r() * 4) | 0), c); }
      }
      // マネキン
      p.r(58, 4, 2, 2, '#f4f0ec'); p.r(57, 6, 4, 8, pick(r, BRIGHT)); p.r(58, 14, 1, 5, '#e8e0d8'); p.r(56, 20, 6, 1, '#888');
      p.box(64, 3, 8, 16, '#c8e4f4'); p.r(66, 4, 1, 12, '#ffffff');
      break;
    }
    case 'books': {
      wall = '#e8dcc4'; floor = '#8a6a4a';
      sh(r, p, wall, floor, {});
      for (const sx of [2, 26, 50]) shelfBooks(p, sx, 2, 22, 19, r, ['#c84040', '#3a6ab0', '#e8c040', '#3a8a5a', '#f4f0e0', '#8a4a8a', '#202020', '#e07030'], '#6a4224');
      p.line(48, 20, 52, 4, '#8a6a3a'); p.line(50, 20, 54, 4, '#8a6a3a');
      break;
    }
    case 'electronics': {
      wall = '#dfe6ee'; floor = '#8a9098';
      sh(r, p, wall, floor, {});
      for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) { const x = 3 + i * 11, y = 2 + j * 6; p.box(x, y, 10, 6, '#111'); p.r(x + 1, y + 1, 8, 4, pick(r, ['#3a8ad0', '#40c060', '#e05050', '#f0c040', '#8a5ad0'])); p.r(x + 2, y + 2, 3, 1, '#ffffff'); }
      p.box(3, 15, 54, 6, '#3a4048'); p.r(3, 14, 54, 1, '#c8d0d8');
      for (let i = 0; i < 8; i++) p.r(6 + i * 6, 12, 3 + (i & 1), 2, pick(r, ['#202020', '#c0c0c8', '#4a4a50']));
      p.r(60, 3, 12, 18, '#2a3038'); for (let y = 5; y < 20; y += 4) p.r(61, y, 10, 1, '#4a5058'), p.p(63, y - 1, '#40a0ff');
      break;
    }
    case 'flowers': {
      wall = '#e0f0d8'; floor = '#a0947a';
      sh(r, p, wall, floor, {});
      for (let i = 0; i < 4; i++) { const x = 6 + i * 16; p.r(x + 2, 0, 1, 3, '#5a5a5a'); p.disc(x + 2, 4, 2, '#3a8a3a'); p.p(x + 1, 5, '#2a6a2a'); }
      for (const [y, x0] of [[12, 3], [16, 6], [20, 3]]) {
        p.r(x0, y, 66, 1, '#7a5a3a');
        for (let x = x0 + 1; x < x0 + 64; x += 5) { p.r(x, y - 3, 4, 3, '#6a7a8a'); for (let k = 0; k < 3; k++) p.p(x + k + ((r() * 2) | 0), y - 4 - ((r() * 3) | 0), pick(r, ['#f04060', '#f0d040', '#f8a0c0', '#a060e0', '#ffffff', '#ff8030'])); p.p(x + 1, y - 4, '#3a8a3a'); }
      }
      break;
    }
    case 'toys': {
      wall = '#fff4c0'; floor = '#c8a080';
      sh(r, p, wall, floor, {});
      for (let x = 1; x < W - 1; x += 8) p.r(x, 1, 4, 20, '#fff8d8');
      for (const sx of [3, 27]) { p.box(sx, 4, 21, 17, '#e8a060'); for (const row of [9, 14, 19]) { p.r(sx + 1, row, 19, 1, '#8a5a30'); goods(sx + 2, row - 4, 17, 4, BRIGHT); } }
      // くま
      p.disc(58, 15, 4, '#a06a3a'); p.disc(58, 9, 3, '#a06a3a'); p.p(56, 6, '#a06a3a'); p.p(60, 6, '#a06a3a'); p.p(57, 9, INK); p.p(59, 9, INK); p.r(55, 19, 7, 2, '#a06a3a');
      // 風船
      for (let i = 0; i < 3; i++) { const x = 64 + i * 4; p.disc(x, 4 + (i & 1) * 2, 2, pick(r, BRIGHT)); p.r(x, 7 + (i & 1) * 2, 1, 8, '#888'); }
      break;
    }
    case 'sports': {
      wall = '#e0e8f0'; floor = '#7a8a5a';
      sh(r, p, wall, floor, {});
      // 自転車
      p.disc(8, 17, 3, INK); p.disc(8, 17, 2, wall); p.disc(22, 17, 3, INK); p.disc(22, 17, 2, wall);
      p.line(8, 17, 14, 12, '#e03030'); p.line(14, 12, 22, 17, '#e03030'); p.line(14, 12, 13, 17, '#e03030'); p.r(12, 11, 4, 1, INK); p.line(20, 10, 22, 17, '#e03030'); p.r(19, 10, 3, 1, INK);
      // ボールの籠
      p.box(28, 13, 16, 8, '#8a8a8a'); for (let i = 0; i < 6; i++) p.disc(30 + i * 2 + (i & 1), 12 - (i & 1), 2, pick(r, ['#f08030', '#ffffff', '#e0d040', '#3a3a3a']));
      // 靴の壁
      for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { const x = 48 + i * 6, y = 4 + j * 5; p.r(x, y + 2, 5, 1, '#c8c8c8'); p.r(x, y, 4, 2, pick(r, BRIGHT)); p.p(x, y - 1, pick(r, BRIGHT)); }
      p.line(72, 4, 74, 14, '#3a3a3a'); p.disc(72, 3, 2, '#40a0e0');
      break;
    }
    case 'grocery': {
      wall = '#f0f4e8'; floor = '#b8b0a0';
      sh(r, p, wall, floor, {});
      p.box(50, 3, 24, 18, '#c8d0d8'); p.r(51, 4, 22, 16, '#d8eef8');
      for (const y of [8, 13, 19]) { p.r(51, y, 22, 1, '#9aa0a8'); for (let x = 52; x < 72; x += 2) p.r(x, y - 3, 1, 3, pick(r, ['#e04040', '#40a0e0', '#f0c040', '#40c060', '#ffffff'])); }
      for (let i = 0; i < 4; i++) {
        const x = 3 + i * 11;
        p.box(x, 16, 10, 5, '#b08050'); p.r(x + 1, 18, 8, 1, '#8a6038');
        const c = pick(r, ['#e03030', '#f08020', '#f0d020', '#50b040', '#8a3aa0']);
        for (let k = 0; k < 4; k++) p.disc(x + 2 + k * 2, 14 + (k & 1), 1, c);
      }
      p.box(3, 4, 44, 9, '#d8c8a8'); p.r(4, 8, 42, 1, '#8a6a40'); goods(5, 4, 40, 4, ['#e04848', '#f0b030', '#40a0e0', '#ffffff', '#c8a060']); goods(5, 9, 40, 3, ['#e04848', '#f0b030', '#60c060', '#ffffff']);
      break;
    }
    default: break;
  }
  if (v.open && v.n > 0) standFig(p, 84, 19, pick(r, ['#2a5a9a', '#9a2a3a', '#2a7a4a']), 0, 0);
  p.box(77, 13, 18, 8, pick(r, ['#6a8ab0', '#b08a6a', '#8a6ab0'])); p.r(76, 12, 20, 1, '#444');
  p.box(87, 9, 6, 3, '#333'); p.p(88, 10, '#80e080');
  if (!v.open) return;
  const pos = [24, 48, 72, 14, 38];
  for (let i = 0; i < Math.min(v.n, pos.length); i++) standFig(p, pos[i], 20, FIG, i % 2, i % 2);
};
const SHOP_SIGN = {
  fashion: ['MODE', '#202020', '#ffffff'], books: ['BOOKS', '#f4ecd8', '#6a2a1a'], electronics: ['DENKI', '#ffffff', '#2a5ab0'],
  flowers: ['FLOWER', '#ffffff', '#3a8a3a'], toys: ['TOYS', '#e04040', '#fff4c0'], sports: ['SPORTS', '#ffffff', '#e05020'], grocery: ['MARKET', '#ffffff', '#3a8a3a'],
};
SIGN.shop = (p, v, name) => {
  const s = SHOP_SIGN[name] || SHOP_SIGN.fashion;
  signPlate(p, s[0], 86, 0, s[1], s[2]);
};
