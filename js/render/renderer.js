// The Building Renderer（Canvas 2D・ピクセルアート）
// const r = new Renderer(canvas, sim); r.resize(w, h); r.render(view); r.setSim(sim);
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F, DAY, LOBBY_FLOORS, TYPES, floorName } from '../sim/constants.js';
import { makeFacilitySprite, lobbyTile, floorTile, shaftSeg, carSprite, CAR_H, SPRITE_TOP, treeSprite, machineRoom, pitSprite, fireEscapeSprite, fireEscapeTop, ESC_W, frameTile, craneSprite, truckSprite } from './facilities.js';
import { heliSprite, planeSprite, bannerPlaneSprite, bannerSprite } from './vehicles.js';
import { peopleAtlas, KIND_INDEX, PW, PH, stressIndex, STRESS_COLORS } from './people.js';
import {
  skyColors, nightness, cloudTint, cloudSprite, sunSprite, moonSprite, strataSprite, STRATA_W, STRATA_H,
  flameSprite, boomSprite, BOOM, bellSprite, bombSprite, santaSprite, bubbleSprite, roachIcon, dirtyIcon, warnIcon, mirrored,
} from './scenery.js';
import { hash2, Painter } from './pixel.js';

const TW = TILE_W, FH = FLOOR_H;
const WORLD_W = W * TW;
const CH_W = 32 * TILE_W, CH_H = 8 * FLOOR_H;   // チャンクの大きさ（ワールドpx）
const EMPTY = [];
const LOBBY_SET = new Set(LOBBY_FLOORS);

// 室内に描く人数の上限
const VIS_CAP = {
  office: 6, condo: 4, hotelSingle: 1, hotelTwin: 2, hotelSuite: 3, fastfood: 9, restaurant: 8, shop: 5,
  cinema: 10, partyHall: 14, security: 6, housekeeping: 6, medical: 6, metro: 14, cathedral: 12,
};
const COMMERCE = new Set(['fastfood', 'restaurant', 'shop', 'cinema', 'partyHall']);
const ROOMS = new Set(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite']);
const SERVICE = new Set(['security', 'housekeeping', 'medical']);
const EVAL_TYPES = new Set(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'fastfood', 'restaurant', 'shop', 'cinema', 'partyHall']);
const EVAL_COL = { good: '#38d8ff', fair: '#f4d020', bad: '#f03030' };

const isElev = (t) => t === 'elevator' || t === 'express';
const FLOOR_LABEL = (f) => floorName(f).replace(/F$/, '');
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// 雲と星の配置（固定）
const CLOUDS = [];
for (let i = 0; i < 130; i++) {
  CLOUDS.push({ x: hash2(i, 1) * (WORLD_W + 2400) - 1200, y: -40 - hash2(i, 2) * 2700, shape: (hash2(i, 3) * 3) | 0, sp: 0.6 + hash2(i, 4) * 0.8 });
}
const STARS = [];
for (let i = 0; i < 220; i++) STARS.push([hash2(i, 11), hash2(i, 12), hash2(i, 13)]);
const TREES = [];
for (let wx = -600; wx < WORLD_W + 600; wx += 22) {
  const h = hash2(wx, 7);
  if (h < 0.55) TREES.push({ x: wx + Math.round(hash2(wx, 8) * 10), alt: (h * 100) | 0 });
}
const FW_COLS = ['#ff5050', '#ffd040', '#60ff80', '#60c0ff', '#ff70e0', '#ffffff'];
const CONF_COLS = ['#ff5070', '#ffd040', '#60e080', '#60b0ff', '#ffffff', '#ff90d0'];

export class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.cssW = canvas.clientWidth || canvas.width || 300;
    this.cssH = canvas.clientHeight || canvas.height || 150;
    this.opts = { cache: true, lod: true };   // cache: 静的レイヤーのチャンク化、lod: 引いたときの簡略描画
    this.cache = new Map();      // スプライトキャッシュ
    this.tiles = new Map();      // タイル
    this.carAnim = new WeakMap();
    this.walkDir = new WeakMap();
    this.lastMs = 0;
    this.stats = { objs: 0, people: 0, ms: 0 };
    this.badges = [];      // [kind, wx, wy, ...] 1=ゴキブリ 2=要清掃 3=到達不能
    this.qBadges = [];     // [count, wx, wy, side, ...]
    this.atlas = null;
    this.setSim(sim);
    this.resize(this.cssW, this.cssH);
  }

  setSim(sim) {
    this.sim = sim || null;
    this.memo = new WeakMap();
    this.carAnim = new WeakMap();
    this.walkDir = new WeakMap();
  }

  // dpr を渡すとそれを使う（UI の解像度調整用）。省略時は window.devicePixelRatio
  resize(cssWidth, cssHeight, dprArg) {
    const want = (typeof dprArg === 'number' && dprArg > 0) ? dprArg : ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const dpr = Math.min(3, Math.max(0.5, want));
    this.dpr = dpr;
    this.cssW = Math.max(1, cssWidth | 0);
    this.cssH = Math.max(1, cssHeight | 0);
    const c = this.canvas;
    c.width = Math.round(this.cssW * dpr);
    c.height = Math.round(this.cssH * dpr);
    if (c.style) { c.style.width = this.cssW + 'px'; c.style.height = this.cssH + 'px'; }
    this.ctx = c.getContext('2d', { alpha: false });
  }

  // ---------------- 公開ヘルパ ----------------
  // ゲーム内の時刻（時の小数）
  hourOf(sim = this.sim) {
    if (!sim) return 12;
    if (typeof sim.hour === 'number' && isFinite(sim.hour)) return sim.hour + num(sim.minute) / 60;
    const t = num(sim.time, 720);
    return ((((t % DAY) + DAY) % DAY) / 60);
  }

  // ---------------- 描画 ----------------
  render(view = {}) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const ctx = this.ctx;
    const sim = this.sim;
    const cam = view.cam || { x: 0, y: -FH * 10, zoom: 1 };
    const zoom = Math.max(0.05, num(cam.zoom, 1));
    const S = zoom * this.dpr;
    this.S = S; this.cx = num(cam.x); this.cy = num(cam.y);
    this.nowMs = num(view.nowMs, t0);
    this._view = view;
    const dtMs = this.lastMs ? Math.min(200, Math.max(0, this.nowMs - this.lastMs)) : 16;
    this.lastMs = this.nowMs;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    const vw = this.cssW / zoom, vh = this.cssH / zoom;
    const wx0 = this.cx, wy0 = this.cy, wx1 = wx0 + vw, wy1 = wy0 + vh;
    this.vb = [wx0, wy0, wx1, wy1];
    const hour = this.hourOf(sim);
    const night = nightness(hour);
    this.night = night;
    this.hour = hour;
    this.simTime = num(sim && sim.time, 0);

    this.drawSky(hour, night, wx0, wy0, wx1, wy1);
    this.drawGround(wx0, wy0, wx1, wy1);

    if (sim) {
      const fHi = Math.min(MAX_F, Math.floor(-wy0 / FH));
      const fLo = Math.max(MIN_F, Math.floor(-wy1 / FH));
      const xA = Math.max(0, Math.floor(wx0 / TW)), xB = Math.min(W - 1, Math.floor(wx1 / TW));
      this.fLo = fLo; this.fHi = fHi; this.xA = xA; this.xB = xB;
      this.lodOn = this.opts.lod && zoom < 0.6;
      if (this.opts.cache) {
        // 夜の度合いを 1/16 刻みにして、チャンクの描き直しを抑える
        this.night = Math.round(this.night * 16) / 16;
        this.phase(() => this.drawChunks(view));
        this.phase(() => this.drawBuilding(view, fLo, fHi, xA, xB, dtMs, 'dynamic'));
      } else {
        this.phase(() => this.drawBuilding(view, fLo, fHi, xA, xB, dtMs));
      }
      if (view.overlay === 'eval') this.phase(() => this.drawEvalOverlay());
      this.phase(() => this.drawPeople());
      this.phase(() => this.drawOverlays(view));
      this.phase(() => this.drawBadges());
    }
    this.phase(() => this.drawUI(view));
    // フロア番号は最後（景色・木・UI 枠の上）
    this.phase(() => this.drawFloorLabels());
    this.stats.ms = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
  }

  // 1 段階ぶんの描画。例外が起きてもクリップ・変換・透明度を必ず元に戻す
  phase(fn) {
    const ctx = this.ctx;
    ctx.save();
    try { fn(); } catch (e) { this._warn(e); }
    finally {
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
    }
  }
  // 1 オブジェクトぶん（失敗しても他は描き続ける）
  guard(fn) {
    try { fn(); } catch (e) { this._warn(e); this.ctx.globalAlpha = 1; }
  }

  _warn(e) {
    this.lastError = e;
    if (!this._warned) { this._warned = true; console.warn('[Renderer]', e); }
  }

  // ワールド → デバイスpx（丸め）
  X(wx) { return Math.round((wx - this.cx) * this.S); }
  Y(wy) { return Math.round((wy - this.cy) * this.S); }
  img(c, wx, wy, ww, wh) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    const w = this.X(wx + ww) - x0, h = this.Y(wy + wh) - y0;
    if (w > 0 && h > 0) this.ctx.drawImage(c, x0, y0, w, h);
  }
  imgPart(c, sx, sy, sw, sh, wx, wy, ww, wh) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    const w = this.X(wx + ww) - x0, h = this.Y(wy + wh) - y0;
    if (w > 0 && h > 0) this.ctx.drawImage(c, sx, sy, sw, sh, x0, y0, w, h);
  }
  rect(wx, wy, ww, wh, col) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    const w = this.X(wx + ww) - x0, h = this.Y(wy + wh) - y0;
    if (w > 0 && h > 0) { this.ctx.fillStyle = col; this.ctx.fillRect(x0, y0, w, h); }
  }
  // 最低 1 デバイスpx は塗る
  rect1(wx, wy, ww, wh, col) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    const w = Math.max(1, this.X(wx + ww) - x0), h = Math.max(1, this.Y(wy + wh) - y0);
    this.ctx.fillStyle = col; this.ctx.fillRect(x0, y0, w, h);
  }

  // ---------------- 空 ----------------
  drawSky(hour, night, wx0, wy0, wx1, wy1) {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    const [top, bot] = skyColors(hour);
    const gy = this.Y(0);
    if (gy > 0) {
      const g = ctx.createLinearGradient(0, this.Y(-(MAX_F + 8) * FH), 0, gy);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, Math.min(ch, gy));
    }
    if (gy <= 0) return;
    const skyH = Math.min(ch, gy);
    // 星
    if (night > 0.05) {
      const px = Math.max(1, Math.round(this.dpr));
      const tw = this.nowMs / 900;
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const y = s[1] * ch;
        if (y >= skyH - 4) continue;
        const a = night * (0.45 + 0.55 * Math.abs(Math.sin(tw + s[2] * 30)));
        ctx.globalAlpha = a;
        ctx.fillStyle = s[2] > 0.85 ? '#ffe8b0' : '#ffffff';
        ctx.fillRect(Math.round(s[0] * cw), Math.round(y), s[2] > 0.92 ? px * 2 : px, s[2] > 0.92 ? px * 2 : px);
      }
      ctx.globalAlpha = 1;
    }
    // 太陽・月（画面に固定）
    const ps = Math.max(2, Math.round(this.dpr * 2.5));
    if (hour >= 5.2 && hour <= 19) {
      const t = (hour - 5.2) / 13.8;
      const x = cw * (0.08 + 0.84 * t), y = ch * 0.1 + Math.pow(Math.abs(t - 0.5) * 2, 2) * ch * 0.35;
      if (y < skyH) ctx.drawImage(sunSprite(), Math.round(x), Math.round(y), 16 * ps, 16 * ps);
    } else {
      const hh = hour < 12 ? hour + 24 : hour;
      const t = (hh - 19.5) / 10;
      const x = cw * (0.1 + 0.8 * t), y = ch * 0.08 + Math.pow(Math.abs(t - 0.5) * 2, 2) * ch * 0.3;
      if (y < skyH) ctx.drawImage(moonSprite(), Math.round(x), Math.round(y), 14 * ps, 14 * ps);
    }
    // 雲
    const tint = cloudTint(hour);
    const drift = this.nowMs * 0.004;
    for (const c of CLOUDS) {
      const spr = cloudSprite(c.shape, tint);
      const span = WORLD_W + 2400, k = 2;
      let x = ((c.x + drift * c.sp + 1200) % span + span) % span - 1200;
      const y = c.y;
      if (y + spr.height * k < wy0 || y > Math.min(wy1, 0) || x + spr.width * k < wx0 || x > wx1) continue;
      this.img(spr, x, y, spr.width * k, spr.height * k);
    }
    this.drawPlanes(hour, night, skyH);
  }

  // 飛行機（時刻を種にして決定的に、ときどき空を横切る。画面に固定した遠景）
  drawPlanes(hour, night, skyH) {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height, dpr = this.dpr, ms = this.nowMs;
    const T = this.simTime;
    const nightMode = night > 0.5;
    for (let k = 0; k < 2; k++) {
      const P = k ? 290 : 200, offs = k * 97, dur = 45;
      const idx = Math.floor((T + offs) / P);
      const ph = ((T + offs) - idx * P) / dur;
      if (ph < 0 || ph >= 1) continue;
      if (hash2(idx, k + 3) > 0.62) continue;
      const dir = hash2(idx, k + 7) < 0.5 ? 1 : -1;
      const banner = !nightMode && hash2(idx, k + 11) < 0.3;
      const ps = Math.max(2, Math.round(dpr * 2));
      const y = Math.round(ch * (0.05 + hash2(idx, k + 13) * 0.3));
      if (y + 20 * ps >= skyH) continue;
      let spr = banner ? bannerPlaneSprite() : planeSprite(nightMode);
      const bn = banner ? bannerSprite('THE BUILDING') : null;
      const total = (spr.width + (bn ? bn.width + 6 : 0)) * ps;
      const x0 = dir > 0 ? -total + ph * (cw + total * 2) - total * 0 : cw - ph * (cw + total * 2) + total;
      const key = (banner ? 'bp' : nightMode ? 'pn' : 'pd') + (dir > 0 ? 'R' : 'L');
      if (dir < 0) spr = this.tile(key, () => mirrored(spr));
      const sw = spr.width * ps, sh = spr.height * ps;
      const px = Math.round(dir > 0 ? x0 + (bn ? (bn.width + 6) * ps : 0) : x0 - sw - (bn ? (bn.width + 6) * ps : 0));
      if (bn) {
        const bx = dir > 0 ? px - (bn.width + 6) * ps : px + sw + 6 * ps;
        const by = y + Math.round(Math.sin(ms / 200) * ps);
        ctx.fillStyle = '#555';
        ctx.fillRect(dir > 0 ? bx + bn.width * ps : px + sw, y + 4 * ps, 6 * ps, Math.max(1, ps >> 1));
        ctx.drawImage(bn, bx, by, bn.width * ps, bn.height * ps);
      }
      ctx.drawImage(spr, px, y, sw, sh);
      if (nightMode) {
        const blink = ((ms / 450) | 0) % 2;
        ctx.fillStyle = blink ? '#ff3030' : '#601010';
        ctx.fillRect(px + (dir > 0 ? 24 * ps : sw - 26 * ps), y + 10 * ps, 2 * ps, 2 * ps);
        if (((ms / 900) | 0) % 3 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(dir > 0 ? px : px + sw - 2 * ps, y, 2 * ps, 2 * ps); }
        ctx.fillStyle = '#30ff60'; ctx.fillRect(px + (dir > 0 ? sw - 3 * ps : ps), y + 7 * ps, ps, ps);
      }
    }
  }

  // ---------------- 地面 ----------------
  drawGround(wx0, wy0, wx1, wy1) {
    const ctx = this.ctx;
    if (wy1 <= 0) { this.drawTrees(wx0, wx1); return; }
    const st = strataSprite();
    const yTop = Math.max(0, wy0);
    const yEnd = Math.min(wy1, STRATA_H);
    if (yEnd > yTop) {
      const x0 = Math.floor(wx0 / STRATA_W) * STRATA_W;
      for (let x = x0; x < wx1; x += STRATA_W) this.imgPart(st, 0, yTop, STRATA_W, yEnd - yTop, x, yTop, STRATA_W, yEnd - yTop);
    }
    if (wy1 > STRATA_H) {
      ctx.fillStyle = '#4c443e';
      const y = Math.max(0, this.Y(STRATA_H));
      ctx.fillRect(0, y, this.canvas.width, this.canvas.height - y);
    }
    this.drawTrees(wx0, wx1);
  }
  drawTrees(wx0, wx1) {
    if (this.vb[1] > 0 || this.vb[3] < -40) return;
    const row = this.sim && this.sim.grid ? this.sim.grid[0] : null;
    for (const t of TREES) {
      if (t.x + 15 < wx0 || t.x > wx1) continue;
      if (row) {
        let blocked = false;
        for (let cx = Math.floor((t.x - 26) / TW); cx <= Math.floor((t.x + 41) / TW); cx++) {
          if (cx >= 0 && cx < W && row[cx]) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      let spr = this.tiles.get('tree' + (t.alt % 4));
      if (!spr) { spr = treeSprite(t.alt % 4); this.tiles.set('tree' + (t.alt % 4), spr); }
      this.img(spr, t.x, -spr.height + 4, spr.width, spr.height);
    }
  }

  // ---------------- 建物 ----------------
  tile(key, make) {
    let c = this.tiles.get(key);
    if (!c) { c = make(); this.tiles.set(key, c); }
    return c;
  }
  sprite(key, make) {
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size > 3000) this.cache.clear();
      c = make();
      this.cache.set(key, c);
    }
    return c;
  }

  // 毎フレーム描き直す（チャンクに焼かない）施設: 動きがあるもの
  isDynamic(o) {
    const t = o.type;
    return t === 'metro' || t === 'escalator' || !!o.destroyed || (t === 'garbage' && !!o.truck) || this.isBuilding(o);
  }

  // mode: 'all' = 全部、'static' = チャンク用（動かないもの）、'dynamic' = 毎フレーム分（動くもの・カゴ）
  // list があれば sim.objs の代わりにそれを走査する（チャンクの索引）
  drawBuilding(view, fLo, fHi, xA, xB, dtMs, mode = 'all', list = null) {
    const sim = this.sim, ctx = this.ctx;
    const grid = sim.grid || {};
    const objs = sim.objs;
    const night = this.night;
    const nightOn = night > 0.5 ? 1 : 0;
    const frameEsc = this.lodOn ? 0 : ((this.nowMs / 140) | 0) % 4;
    const week = (Math.floor(num(sim.day, Math.floor(this.simTime / DAY)) / 7)) % 4;
    const doStatic = mode !== 'dynamic', doDyn = mode !== 'static';

    // 1) 空きフロア
    if (doStatic) for (let f = fLo; f <= fHi; f++) {
      const row = grid[f];
      if (!row) continue;
      const wy = -(f + 1) * FH;
      let darkFrom = -1;
      for (let x = xA; x <= xB + 1; x++) {
        const v = x <= xB ? row[x] : 0;
        let isFloor = v === -1;
        if (v > 0 && objs) { const ov = objs.get(v); isFloor = !ov || ov.type === 'stairs' || ov.type === 'escalator'; }
        if (isFloor) {
          if (darkFrom < 0) darkFrom = x;
        } else if (darkFrom >= 0) {
          this.floorRun(darkFrom, x, wy);
          if (night > 0.02) { ctx.globalAlpha = 0.5 * night; this.rect(darkFrom * TW, wy, (x - darkFrom) * TW, FH - 2, '#0a0e24'); ctx.globalAlpha = 1; }
          darkFrom = -1;
        }
      }
    }

    // 2) 施設
    const elevs = this._elevs || (this._elevs = []);
    const later = this._later || (this._later = []);
    const trans = this._trans || (this._trans = []);
    elevs.length = 0; later.length = 0; trans.length = 0;
    const vis = this._vis || (this._vis = []);
    if (mode !== 'static') vis.length = 0;
    let count = 0;
    const vb = this.vb, wx0 = vb[0], wy0 = vb[1], wx1 = vb[2], wy1 = vb[3];
    const iter = list || (objs && typeof objs.values === 'function' ? objs.values() : null);
    if (iter) {
      for (const o of iter) {
        if (!o || o.type == null) continue;
        const type = o.type;
        if (isElev(type)) {
          const lo = num(o.lo, num(o.f)), hi = num(o.hi, lo);
          if (hi + 1 < fLo || lo - 1 > fHi) continue;
          const ox = num(o.x) * TW, ow = num(o.w, TYPES[type] ? TYPES[type].w : 4) * TW;
          if (ox + ow < wx0 || ox > wx1) continue;
          elevs.push(o);
          continue;
        }
        const tw = num(o.w, (TYPES[type] && TYPES[type].w) || 1);
        const th = num(o.h, (TYPES[type] && TYPES[type].h) || 1);
        const f = num(o.f);
        const top = SPRITE_TOP[type] || 0;
        const x = num(o.x) * TW, y = -(f + th) * FH;
        if (x + tw * TW < wx0 || x > wx1 || y - top > wy1 || y + th * FH < wy0) continue;
        count++;
        if (mode !== 'static') vis.push(o);
        const dyn = mode === 'all' ? false : this.isDynamic(o);
        if (mode === 'static' ? dyn : mode === 'dynamic' ? !dyn : false) continue;
        try {
          if (type === 'lobby') { this.drawLobby(o, f, num(o.x), tw); continue; }
          if (type === 'floor') { this.floorRun(num(o.x), num(o.x) + tw, y); continue; }
        } catch (e) { this._warn(e); continue; }
        if (type === 'stairs' || type === 'escalator') trans.push(o, tw, th, x, y, top);
        else later.push(o, tw, th, x, y, top);
      }
    }
    if (mode !== 'static') this.visObjs = vis;
    // 施設 → 移動手段（階段・エスカレーター）の順に重ねる（v2: 移動手段は施設の上に置ける）
    for (let k = 0; k < 2; k++) {
      const L = k ? trans : later;
      for (let i = 0; i < L.length; i += 6) {
        try { this.drawFacility(L[i], L[i].type, L[i + 1], L[i + 2], L[i + 3], L[i + 4], L[i + 5], nightOn, frameEsc, week); }
        catch (e) { this._warn(e); ctx.globalAlpha = 1; }
      }
    }
    if (mode !== 'static') this.stats.objs = count;

    if (doStatic) {
      // 3) 外壁・屋上・非常階段
      this.drawFacade(grid, fLo, fHi, xA, xB);
      try { this.drawFireEscapes(grid, fLo, fHi); } catch (e) { this._warn(e); }
    }
    // 4) エレベーターのシャフト・機械室・ピット（施設の上に重ねる）。工事中のシャフトは動きがあるので毎フレーム
    for (const e of elevs) {
      const b = this.isBuilding(e);
      if (mode === 'all' || (mode === 'static' && !b) || (mode === 'dynamic' && b)) {
        try { this.drawShaft(e, fLo, fHi); } catch (err) { this._warn(err); }
      }
      if (doDyn && !this.lodOn) try { this.drawQueueLamps(e, fLo, fHi); } catch (err) { this._warn(err); }
    }

    // 5) カゴ
    if (doDyn) {
      for (const e of elevs) { try { this.drawCars(e, dtMs); } catch (err) { this._warn(err); } }
      this.elevs = elevs;
    }
  }

  drawQueueLamps(e, fLo, fHi) {
    const q = e.q;
    if (!q) return;
    const w = num(e.w, e.type === 'express' ? 6 : 4), x = num(e.x) * TW;
    const lo = num(e.lo, num(e.f)), hi = num(e.hi, lo);
    for (let f = Math.max(lo, fLo); f <= Math.min(hi, fHi); f++) {
      const qf = q[f];
      if (!qf) continue;
      if (qf.up && qf.up.length) this.rect(x + 1, -(f + 1) * FH + 5, 1, 2, '#ffd040');
      if (qf.down && qf.down.length) this.rect(x + w * TW - 2, -(f + 1) * FH + 5, 1, 2, '#ff8040');
    }
  }

  // ---------------- 静的レイヤーのチャンク ----------------
  // 32 マス × 8 フロアごとに、動かないもの（フロア・施設・外壁・非常階段・シャフト）を
  // オフスクリーンに焼いておき、中身の状態が変わったときだけ描き直す。
  chunkIndex() {
    const sim = this.sim, objs = sim.objs;
    const rev = typeof sim.revision === 'number' ? sim.revision : -1;
    const size = objs && objs.size || 0;
    const ci = this._cidx;
    this._cidxFrame = (this._cidxFrame || 0) + 1;
    if (ci && ci.sim === sim && ci.rev === rev && ci.size === size && (rev >= 0 || this._cidxFrame % 120)) return ci;
    const map = new Map();
    const put = (key, o) => { let a = map.get(key); if (!a) { a = []; map.set(key, a); } a.push(o); };
    if (objs) for (const o of objs.values()) {
      if (!o || o.type == null) continue;
      let x0, x1, y0, y1;
      if (isElev(o.type)) {
        const lo = num(o.lo, num(o.f)), hi = num(o.hi, lo);
        x0 = num(o.x) * TW; x1 = x0 + num(o.w, 4) * TW; y0 = -(hi + 2) * FH; y1 = -(lo - 1) * FH;
      } else {
        const tw = num(o.w, (TYPES[o.type] && TYPES[o.type].w) || 1), th = num(o.h, (TYPES[o.type] && TYPES[o.type].h) || 1);
        x0 = num(o.x) * TW; x1 = x0 + tw * TW; y0 = -(num(o.f) + th) * FH - (SPRITE_TOP[o.type] || 0); y1 = -num(o.f) * FH;
      }
      for (let cx = Math.floor((x0 - 4) / CH_W); cx <= Math.floor((x1 + 3) / CH_W); cx++) {
        for (let cy = Math.floor((y0 - 4) / CH_H); cy <= Math.floor((y1 + 3) / CH_H); cy++) put(cx * 4096 + cy, o);
      }
    }
    this._cidx = { sim, rev, size, map };
    return this._cidx;
  }

  chunkSig(list, base, nightOn, frameEsc, week) {
    const sim = this.sim;
    let h = base | 0;
    if (!list) return h;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      let s;
      if (isElev(o.type)) {
        const st = Array.isArray(o.stops) ? o.stops : null;
        s = (num(o.lo) * 977 + num(o.hi) * 131 + (st ? st.length * 7 + (st[0] | 0) * 3 + (st[st.length - 1] | 0) : 1) + (this.isBuilding(o) ? 5 : 0)) | 0;
      } else if (this.isDynamic(o)) {
        s = 17;
      } else {
        // 割り当てなしの軽い署名（見た目に効くものだけ）
        const t = o.type;
        let n = o.inCount | 0;
        const cap = VIS_CAP[t];
        if (cap != null && n > cap) n = cap;
        if (t === 'garbage') n = ((num(o.fill) * 12) | 0) + ((num(o.bags) > 0) ? 100 : 0);
        else if (t === 'parking') n = o.used | 0;
        let open = 1;
        if (COMMERCE.has(t) && typeof sim.isOpen === 'function') { try { open = sim.isOpen(o) ? 1 : 0; } catch (e) { open = 1; } }
        s = (n | ((o.occupied !== false) << 7) | ((o.dirty ? 1 : 0) << 8) | (open << 9) | ((o.variant | 0) << 10) | (((num(o.burnt) * 8) | 0) << 14)
          | ((o.infested ? 1 : 0) << 18) | (o.unreachable ? 1 << 19 : 0) | (t === 'cinema' ? week << 20 : 0)) ^ (nightOn << 23);
      }
      h = Math.imul(h ^ s, 16777619) ^ num(o.id);
    }
    return h;
  }

  drawChunks(view) {
    const sim = this.sim;
    this._frame = (this._frame || 0) + 1;
    const S = this.S;
    const cs = S >= 1 ? 1 : S >= 0.5 ? 0.5 : 0.25;
    const idx = this.chunkIndex();
    const vb = this.vb;
    const cx0 = Math.floor((vb[0] - 24) / CH_W), cx1 = Math.floor((vb[2] + 24) / CH_W);
    const cy0 = Math.max(Math.floor(-(MAX_F + 6) * FH / CH_H), Math.floor(vb[1] / CH_H)), cy1 = Math.min(Math.ceil(-MIN_F * FH / CH_H) + 1, Math.floor(vb[3] / CH_H));
    const xMinC = Math.floor(-40 / CH_W), xMaxC = Math.floor((WORLD_W + 40) / CH_W);
    const nightOn = this.night > 0.5 ? 1 : 0;
    const week = (Math.floor(num(sim.day, Math.floor(this.simTime / DAY)) / 7)) % 4;
    const rev = typeof sim.revision === 'number' ? sim.revision : 0;
    const base = (rev * 7919 + Math.round(this.night * 16) * 131 + cs * 1000) | 0;
    const cache = this.chunks || (this.chunks = new Map());
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = Math.max(cx0, xMinC); cx <= Math.min(cx1, xMaxC); cx++) {
        const key = cs * 1e9 + cx * 4096 + cy;
        const list = idx.map.get(cx * 4096 + cy) || null;
        let ch = cache.get(key);
        if (ch) { cache.delete(key); cache.set(key, ch); }
        // 中身の確認は 3 フレームに 1 回ずつ分散（構造や夜の段階が変わったときは即時）
        const b2 = base ^ (idx.size * 31);
        const check = !ch || ch.base !== b2 || ((cx + cy * 7 + this._frame) % 3 === 0);
        const sig = check ? this.chunkSig(list, b2, nightOn, 0, week) : ch.sig;
        if (ch) ch.base = b2;
        if (!ch || ch.sig !== sig) {
          if (!ch) { ch = { c: makeCanvasLike(Math.ceil(CH_W * cs), Math.ceil(CH_H * cs)), sig: 0, base: b2 }; cache.set(key, ch); this._chunkPx = (this._chunkPx || 0) + ch.c.width * ch.c.height; }
          this.renderChunk(view, ch, cx * CH_W, cy * CH_H, cs, list);
          ch.sig = sig;
          this.stats.chunkRedraw = (this.stats.chunkRedraw || 0) + 1;
        }
        this.img(ch.c, cx * CH_W, cy * CH_H, CH_W, CH_H);
      }
    }
    // 古いチャンクを捨てる（約 8M ピクセル = 32MB まで）
    while (this._chunkPx > 8e6 && cache.size > 4) {
      const k = cache.keys().next().value;
      const c = cache.get(k).c;
      this._chunkPx -= c.width * c.height;
      cache.delete(k);
    }
  }

  renderChunk(view, ch, x0, y0, cs, list) {
    const save = [this.ctx, this.S, this.cx, this.cy, this.vb, this.fLo, this.fHi, this.xA, this.xB];
    const g = ch.c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ch.c.width, ch.c.height);
    g.imageSmoothingEnabled = false;
    this.ctx = g; this.S = cs; this.cx = x0; this.cy = y0;
    this.vb = [x0, y0, x0 + CH_W, y0 + CH_H];
    const fHi = Math.min(MAX_F, Math.floor(-y0 / FH)), fLo = Math.max(MIN_F, Math.floor(-(y0 + CH_H) / FH));
    const xA = Math.max(0, Math.floor(x0 / TW) - 1), xB = Math.min(W - 1, Math.floor((x0 + CH_W) / TW) + 1);
    this.fLo = fLo; this.fHi = fHi; this.xA = xA; this.xB = xB;
    try { this.drawBuilding(view, fLo, fHi, xA, xB, 0, 'static', list || EMPTY); }
    catch (e) { this._warn(e); }
    finally {
      [this.ctx, this.S, this.cx, this.cy, this.vb, this.fLo, this.fHi, this.xA, this.xB] = save;
    }
  }

  // 空きフロアの連続を、まとめた帯のスプライトから一度に描く
  floorRun(xs, xe, wy) {
    const strip = this.tile('flstrip', () => {
      const c = makeCanvasLike(64 * TW, FH);
      const g = c.getContext('2d');
      for (let i = 0; i < 64; i++) g.drawImage(this.tile('fl' + (i & 3), () => floorTile(i & 3)), i * TW, 0);
      return c;
    });
    for (let x = xs; x < xe;) {
      const n = Math.min(xe - x, 60);
      this.imgPart(strip, (x & 3) * TW, 0, n * TW, FH, x * TW, wy, n * TW, FH);
      x += n;
    }
  }

  drawLobby(o, f, x0, tw) {
    const wy = -(f + 1) * FH;
    for (let i = 0; i < tw; i++) {
      const x = x0 + i;
      if (x < this.xA - 1 || x > this.xB + 1) continue;
      let kind = (x % 6 === 0) ? 'pillar' : (x % 6 === 3) ? 'lamp' : 'wall';
      if (f === 0 && i === 0) kind = 'doorL';
      else if (f === 0 && i === tw - 1) kind = 'doorR';
      else if (x % 12 === 8 && i > 0 && i < tw - 1) kind = 'plant';
      const col = x & 3;
      this.img(this.tile('lb' + kind + col, () => lobbyTile(col, kind)), x * TW, wy, TW, FH);
    }
    if (this.isBuilding(o)) this.drawConstruction(o, x0 * TW, wy, tw * TW, FH, f, 1, true);
  }

  facilityState(o, type, nightOn, frameEsc, week) {
    const sim = this.sim;
    const occ = o.occupied !== false ? 1 : 0;
    let n = Math.max(0, num(o.inCount) | 0);
    const cap = VIS_CAP[type];
    if (cap != null) {
      if (type === 'cinema' || type === 'partyHall' || type === 'metro' || type === 'fastfood' || type === 'restaurant') {
        // 大人数の施設は割合で間引く
        n = Math.min(cap, n > cap ? cap : n);
      } else n = Math.min(cap, n);
    }
    let open = 1;
    if (COMMERCE.has(type)) {
      try { open = typeof sim.isOpen === 'function' ? (sim.isOpen(o) ? 1 : 0) : 1; } catch (e) { open = 1; }
    }
    const dirty = o.dirty ? 1 : 0;
    const alt = (num(o.id) % 3 + 3) % 3;
    if (type === 'metro' && this.hour < 5) n = 0;
    if (type === 'garbage') {
      // 袋の量（fill 0..1 → 0..12、満杯以上は 13 = あふれ）。fill が無ければ bags / capacity
      let fl = num(o.fill, NaN);
      if (!(fl === fl)) fl = num(o.bags) / ((TYPES.garbage && TYPES.garbage.capacity) || 400);
      fl = Math.max(0, fl);
      n = fl >= 1 ? 13 : Math.min(12, Math.round(fl * 12));
      if (n === 0 && num(o.bags) > 0) n = 1;
      open = o.truck ? 1 : 0;
    } else if (type === 'parking') {
      n = Math.max(0, Math.min((TYPES.parking && TYPES.parking.spaces) || 12, num(o.used) | 0));
    }
    const frame = type === 'escalator' ? frameEsc : 0;
    const wk = type === 'cinema' ? week : 0;
    const id = num(o.id);
    const hh = Math.floor(hash2(id, 4242) * 4096);
    const seed = hh % 12;
    const vr = Math.max(0, num(o.variant) | 0) & 15;
    const des = o.destroyed === 'bomb' ? 1 : o.destroyed === 'fire' ? 2 : o.destroyed ? 1 : 0;
    return { occ, n, open, dirty, alt, frame, week: wk, night: nightOn, var: vr, seed, flip: (hh >> 6) & 1, destroyed: des };
  }

  drawFacility(o, type, tw, th, x, y, top, nightOn, frameEsc, week) {
    const v = this.facilityState(o, type, nightOn, frameEsc, week);
    if (v.destroyed) { v.n = 0; v.occ = 0; v.dirty = 0; v.open = 1; v.night = 0; v.frame = 0; v.week = 0; v.var = 0; }
    const sig = (v.n | (v.occ << 5) | (v.dirty << 6) | (v.open << 7) | (v.alt << 8) | (v.night << 10) | (v.week << 11) | (v.frame << 13)
      | (v.var << 15) | (v.seed << 19) | (v.destroyed << 23) | (v.flip << 25)) >>> 0;
    let m = this.memo.get(o);
    if (!m || m.sig !== sig || m.type !== type || m.tw !== tw || m.th !== th) {
      const art = v.destroyed === 2 ? 'ruinFire' : v.destroyed ? 'ruinBomb' : type;
      const key = type + '|' + tw + '|' + th + '|' + sig;
      const img = this.sprite(key, () => makeFacilitySprite(art, tw, th, v));
      let fg = null;
      if (type === 'metro') fg = this.sprite('fg' + key, () => makeFacilitySprite('metroFg', tw, th, v));
      m = { sig, type, tw, th, img, fg, v };
      this.memo.set(o, m);
    }
    const ww = tw * TW, hh = th * FH;
    if (this.isBuilding(o)) {
      // 工事中: 下から仕上がっていく（上の方は骨組み）
      this.img(m.img, x, y, ww, hh);
      this.drawConstruction(o, x, y, ww, hh, num(o.f), th, type !== 'stairs' && type !== 'escalator');
      return;
    }
    this.img(m.img, x, y - top, ww, hh + top);
    if (v.destroyed) {
      // 焼け跡のくすぶり・瓦礫の土ぼこり
      const ms = this.nowMs;
      this.ctx.globalAlpha = 0.35;
      for (let i = 0; i < Math.max(2, tw >> 2); i++) {
        const ph = ((ms / 2600) + hash2(num(o.id), i)) % 1;
        const r = 2 + ph * 5;
        this.rect(x + 4 + hash2(i, num(o.id)) * (ww - 8) - r, y + hh - 8 - ph * 26, r * 2, r * 1.3, v.destroyed === 2 ? '#2a2826' : '#9a968c');
      }
      this.ctx.globalAlpha = 1;
      return;
    }
    if (type === 'metro') {
      this.drawTrain(x, y, ww);
      this.img(m.fg, x, y, ww, hh);
    }
    if (type === 'garbage' && o.truck) this.drawTruck(o.truck, x, y, ww, hh);
    // 暗さ（夜の無人・閉店・空室）
    const night = this.night;
    let dark = 0;
    if (COMMERCE.has(type)) dark = v.open ? 0 : 0.42 + 0.3 * night;
    else if (ROOMS.has(type)) dark = !v.occ ? 0.12 + 0.66 * night : v.n === 0 ? 0.74 * night : 0;
    else if (SERVICE.has(type)) dark = v.n === 0 ? 0.55 * night : 0;
    // 階段・エスカレーターは細い帯だけなので暗くしない（四角く暗くすると後ろの施設まで隠れる）
    if (dark > 0.01) {
      this.ctx.globalAlpha = Math.min(0.85, dark);
      this.rect(x + 1, y, ww - 1, hh - 2, '#080c22');
      this.ctx.globalAlpha = 1;
    } else if (night > 0.3 && (ROOMS.has(type) || COMMERCE.has(type))) {
      // 夜の明かり（暖色）
      this.ctx.globalAlpha = 0.1 * night;
      this.rect(x + 1, y, ww - 1, hh - 3, '#ffd070');
      this.ctx.globalAlpha = 1;
    }
    if (o.infested) {
      this.ctx.globalAlpha = 0.24 + 0.06 * Math.sin(this.nowMs / 300);
      this.rect(x + 1, y, ww - 1, hh - 2, '#7a9a10');
      this.ctx.globalAlpha = 1;
    } else if (o.dirty) {
      this.ctx.globalAlpha = 0.2;
      this.rect(x + 1, y, ww - 1, hh - 2, '#8a6a30');
      this.ctx.globalAlpha = 1;
      for (let i = 0; i < tw * 2; i++) this.rect(x + 2 + ((hash2(num(o.id), i + 40) * (ww - 4)) | 0), y + FH * th - 4 - ((hash2(i, 41) * 3) | 0), 1, 1, '#5a4020');
    }
    const burnt = num(o.burnt);
    if (burnt > 0) {
      this.ctx.globalAlpha = Math.min(0.9, 0.25 + burnt * 0.65);
      this.rect(x, y, ww, hh - 2, '#1a0c06');
      this.ctx.globalAlpha = 1;
      for (let i = 0; i < tw * 2; i++) {
        if (hash2(num(o.id), i) < burnt * 0.7) this.rect(x + ((hash2(i, num(o.id)) * ww) | 0), y + FH * th - 6 - ((hash2(i, 3) * 8) | 0), 2, 1 + ((hash2(i, 5) * 3) | 0), '#000');
      }
    }
  }

  isBuilding(o) { return typeof o.constructUntil === 'number' && o.constructUntil > this.simTime; }

  // 工事中の演出: 骨組み・足場・防音ネット・作業員・溶接の火花・クレーン・進み具合
  drawConstruction(o, x, y, ww, hh, f0, th, crane) {
    const ctx = this.ctx, ms = this.nowMs, now = this.simTime;
    const t1 = num(o.constructUntil), t0 = Math.min(num(o.constructStart, t1 - 60), t1 - 0.01);
    const pr = Math.max(0, Math.min(1, (now - t0) / (t1 - t0)));
    const uh = Math.round((1 - pr) * (hh - 3));
    const id = num(o.id);
    // 骨組み（まだ仕上がっていない上の部分）
    if (uh > 0) {
      const fr = this.tile('frame', frameTile);
      for (let j = 0; j < th; j++) {
        const by = y + j * FH;
        const h = Math.min(FH, y + uh - by);
        if (h <= 0) break;
        for (let xx = 0; xx < ww; xx += 16) {
          const w = Math.min(16, ww - xx);
          this.imgPart(fr, 0, 0, w, h, x + xx, by, w, h);
        }
      }
      this.rect(x, y + uh - 1, ww, 1, '#e8dcb0');
    }
    // 防音ネット（作業している前線のすぐ上は開けておく）
    const netH = uh - 9;
    if (netH > 2) {
      ctx.globalAlpha = 0.42;
      this.rect(x + 1, y, ww - 2, netH, ((id >> 1) & 1) ? '#2f7a8a' : '#3a8a4a');
      ctx.globalAlpha = 0.25;
      for (let xx = 3; xx < ww - 2; xx += 4) this.rect(x + xx, y, 1, netH, '#123018');
      ctx.globalAlpha = 1;
    }
    // 足場（パイプと板）
    const sTop = y - 2, sBot = Math.min(y + hh - 3, y + uh + 8);
    if (sBot > sTop) {
      for (let xx = 2; xx < ww; xx += 16) this.rect(x + xx, sTop, 1, sBot - sTop, '#d8b040');
      this.rect(x + ww - 2, sTop, 1, sBot - sTop, '#d8b040');
      for (let yy = sTop + 6; yy < sBot; yy += 8) { this.rect(x, yy, ww, 1, '#8a6a20'); this.rect(x, yy + 1, ww, 0.5, '#5a4410'); }
    }
    // 作業員（黄色いヘルメット、オレンジのベスト）
    const feet = uh > 2 ? y + uh - 1 : y + hh - 4;
    const cnt = Math.max(1, Math.min(4, Math.round(ww / 40)));
    for (let i = 0; i < cnt; i++) {
      const wx = x + 4 + ((i + 0.5) / cnt) * (ww - 10) + Math.sin(ms / 1700 + i * 2 + id) * 4;
      const ham = ((ms / 180 + i) | 0) % 2;
      this.rect(wx, feet - 8, 3, 1, '#f0d020');
      this.rect(wx + 1, feet - 7, 2, 2, '#1a1a1a');
      this.rect(wx, feet - 5, 3, 3, '#f08020');
      this.rect(wx + 1, feet - 4, 1, 1, '#e8e8a0');
      this.rect(wx, feet - 2, 1, 2, '#2a2a3a'); this.rect(wx + 2, feet - 2, 1, 2, '#2a2a3a');
      this.rect(wx + 3, feet - 6 + ham, 1, 1, '#1a1a1a'); this.rect(wx + 4, feet - 7 + ham * 2, 1, 2, '#6a6a6a');
    }
    // 溶接の火花
    if (pr < 0.98) {
      const sx = x + 6 + hash2(id, Math.floor(ms / 1500)) * (ww - 12), sy = feet - 6;
      if (((ms / 90) | 0) % 3) {
        this.rect(sx, sy, 1, 1, '#ffffff');
        for (let i = 0; i < 6; i++) {
          const a = hash2(i, (ms / 90) | 0) * Math.PI * 2, d = 1 + hash2((ms / 90) | 0, i) * 4;
          this.rect(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.7 + d * 0.3, 1, 1, i % 2 ? '#ffe060' : '#ffa020');
        }
        ctx.globalAlpha = 0.25; this.rect(sx - 3, sy - 3, 7, 7, '#c8e8ff'); ctx.globalAlpha = 1;
      }
    }
    // クレーン（上が空いている大きめの施設）
    const grid = this.sim.grid;
    const cx = Math.floor((x + ww / 2) / TW), above = grid && grid[f0 + th];
    if (crane && ww >= 48 && (f0 + th > MAX_F || !above || !above[cx])) {
      const cr = this.tile('crane', craneSprite);
      const mastX = x + ww - 14;
      const sx0 = mastX - 51, sy0 = y - cr.height;
      this.img(cr, sx0, sy0, cr.width, cr.height);
      const tx = sx0 + 6 + (0.5 + 0.5 * Math.sin(ms / 2600 + id)) * 38;
      const hookY = sy0 + 10 + (0.5 + 0.5 * Math.sin(ms / 1900 + id)) * (cr.height + Math.max(0, uh) - 20);
      this.rect(tx - 1, sy0 + 6, 3, 2, '#3a3a3a');
      this.rect1(tx, sy0 + 8, 0.5, hookY - sy0 - 8, '#2a2a2a');
      this.rect(tx - 1, hookY, 3, 2, '#3a3a3a');
      this.rect(tx - 6, hookY + 2, 13, 2, '#c84a2a'); this.rect(tx - 6, hookY + 2, 13, 0.5, '#e87a5a');
    }
    // 進み具合のバー
    if (this.S / this.dpr >= 0.9) {
      const bw = Math.min(ww - 6, 40);
      this.rect(x + 3, y + 2, bw, 3, '#000');
      this.rect(x + 4, y + 3, (bw - 2) * pr, 1, '#f0d020');
    }
  }

  // ごみ収集車: in = 左のシャッターから後ろ向きに入る、load = 作業員が袋を積む、out = 前向きに出ていく
  drawTruck(tr, x, y, ww, hh) {
    const ctx = this.ctx, ms = this.nowMs;
    const t = Math.max(0, Math.min(1, num(tr.t)));
    const park = x + 12, outside = x - 62;
    const ease = (k) => k * k * (3 - 2 * k);
    let tx = park;
    if (tr.phase === 'in') tx = outside + (park - outside) * ease(t);
    else if (tr.phase === 'out') tx = park + (outside - park) * ease(t);
    const spr = this.tile('truck', truckSprite);
    const ty = y + hh - 3 - 21;
    ctx.save();
    try {
      const cx0 = this.X(x + 1), cx1 = this.X(x + ww);
      ctx.beginPath(); ctx.rect(cx0, this.Y(y), cx1 - cx0, this.Y(y + hh) - this.Y(y)); ctx.clip();
      const bob = tr.phase === 'load' ? 0 : ((ms / 120) | 0) % 2 * 0.5;
      this.img(spr, tx, ty + bob, spr.width, spr.height);
      // 回転灯
      if (((ms / 250) | 0) % 2) this.rect(tx + 17, ty, 2, 2, '#ffb030');
      if (tr.phase === 'load') {
        // 作業員が袋を投入口へ運ぶ
        const hop = tx + 52, pile = x + 80;
        for (let i = 0; i < 2; i++) {
          const ph = ((ms / 1400) + i * 0.5) % 1;
          const k = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
          const wx = pile + (hop + 4 - pile) * k;
          const feet = y + hh - 4;
          this.rect(wx, feet - 8, 3, 1, '#f0d020'); this.rect(wx + 1, feet - 7, 2, 2, '#1a1a1a');
          this.rect(wx, feet - 5, 3, 3, '#3a8a4a'); this.rect(wx + 1, feet - 4, 1, 1, '#e8e8a0');
          this.rect(wx, feet - 2, 1, 2, '#2a2a3a'); this.rect(wx + 2, feet - 2, 1, 2, '#2a2a3a');
          if (ph < 0.5) { this.rect(wx - 3, feet - 7, 4, 3, '#000'); this.rect(wx - 2, feet - 6, 2, 2, i ? '#e8e8e0' : '#2a2a2e'); }
        }
        // 投入口の圧縮動作
        if (((ms / 300) | 0) % 2) this.rect(hop - 1, ty + 9, 5, 1, '#f0d020');
      }
    } finally { ctx.restore(); }
  }

  drawTrain(x, y, ww) {
    // 5:00〜24:00 に 75 ゲーム分ごと: 4分で到着 → 8分停車 → 3分で発車
    const tod = this.hour * 60;
    if (tod < 300) return;
    const t = (tod - 300) % 75;
    let off;
    if (t < 4) off = (1 - t / 4) * (ww + 20);
    else if (t < 12) off = 0;
    else if (t < 15) off = -((t - 12) / 3) * (ww + 240);
    else return;
    off = Math.round(off);
    const ctx = this.ctx;
    const cx0 = this.X(x + 1), cx1 = this.X(x + ww);
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(cx0, this.Y(y + 24), cx1 - cx0, this.Y(y + 72) - this.Y(y + 24)); ctx.clip();
      const tr = this.tile('train', makeTrain);
      this.img(tr, x + 4 + off, y + 34, tr.width, tr.height);
    } finally {
      ctx.restore();
    }
  }


  drawShaft(e, fLo, fHi) {
    const express = e.type === 'express' ? 1 : 0;
    const w = num(e.w, express ? 6 : 4);
    const lo = num(e.lo, num(e.f)), hi = num(e.hi, lo);
    const x = num(e.x) * TW;
    const q = e.q || null;
    const stops = this.stopSet(e);
    for (let f = Math.max(lo, fLo); f <= Math.min(hi, fHi); f++) {
      const label = stops.has(f) ? FLOOR_LABEL(f) : '';
      const key = 'sh' + w + express + label;
      this.img(this.tile(key, () => shaftSeg(w, express, label)), x, -(f + 1) * FH, w * TW, FH);
    }
    this.drawMachinePit(x, w, express, lo, hi, fLo, fHi);
    if (this.isBuilding(e)) this.drawConstruction(e, x, -(hi + 2) * FH, w * TW, (hi - lo + 3) * FH, lo - 1, hi - lo + 3, false);
  }
  // 止まる階（sim の e.stops。無ければ lo..hi − config.skip、急行はロビー階と地下）
  stopSet(e) {
    const memo = this._stops || (this._stops = new WeakMap());
    const lo = num(e.lo, num(e.f)), hi = num(e.hi, lo);
    const src = Array.isArray(e.stops) ? e.stops : (e.config && Array.isArray(e.config.skip) ? e.config.skip : null);
    let m = memo.get(e);
    if (m && m.src === src && m.len === (src ? src.length : -1) && m.lo === lo && m.hi === hi && m.type === e.type) return m.set;
    const set = new Set();
    if (Array.isArray(e.stops)) for (const f of e.stops) set.add(f);
    else {
      const skip = e.config && Array.isArray(e.config.skip) ? new Set(e.config.skip) : null;
      for (let f = lo; f <= hi; f++) {
        if (skip ? !skip.has(f) : (e.type !== 'express' || LOBBY_SET.has(f) || f < 0)) set.add(f);
      }
    }
    memo.set(e, { src, len: src ? src.length : -1, lo, hi, type: e.type, set });
    return set;
  }

  drawMachinePit(x, w, express, lo, hi, fLo, fHi) {
    if (hi + 1 >= fLo && hi + 1 <= fHi + 1) this.img(this.tile('mr' + w + express, () => machineRoom(w, express)), x, -(hi + 2) * FH, w * TW, FH);
    if (lo - 1 >= fLo - 1 && lo - 1 <= fHi) this.img(this.tile('pit' + w + express, () => pitSprite(w, express)), x, -lo * FH, w * TW, FH);
  }

  drawCars(e, dtMs) {
    if (this.isBuilding(e)) return;
    const cars = Array.isArray(e.cars) ? e.cars : [];
    const express = e.type === 'express' ? 1 : 0;
    const w = num(e.w, express ? 6 : 4);
    const x = num(e.x) * TW + 2;
    const [, wy0, , wy1] = this.vb;
    const lo = num(e.lo, num(e.f)), hi = num(e.hi, lo);
    const shaftTop = -(hi + 1) * FH;
    const cw = w * TW - 4;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      if (!car) continue;
      const pos = num(car.pos, num(e.lo));
      const top = -(pos + 1) * FH + 1;
      const vel = num(car.v, 0);
      // ロープ（カゴの上から機械室へ）と釣り合いおもり（引いた視点では省略）
      if (!this.lodOn && top > wy0 - 4 && shaftTop < wy1) {
        const cx = x + (cw >> 1);
        this.rect1(cx - 2, Math.max(shaftTop, wy0 - 2), 0.5, top - Math.max(shaftTop, wy0 - 2), '#15151a');
        this.rect1(cx + 1, Math.max(shaftTop, wy0 - 2), 0.5, top - Math.max(shaftTop, wy0 - 2), '#15151a');
      }
      const cwPos = lo + hi - pos;
      const cwTop = -(cwPos + 1) * FH + 4;
      if (!this.lodOn && ci === 0 && cwTop + 10 > wy0 && cwTop < wy1) {
        const cwx = x + cw - 3 + (ci & 1);
        this.rect(cwx, shaftTop, 1, cwTop - shaftTop, '#2a2a30');
        this.rect(cwx - 1, cwTop, 3, 10, '#6a6458'); this.rect(cwx - 1, cwTop, 3, 1, '#2a2a2a'); this.rect(cwx - 1, cwTop + 9, 3, 1, '#2a2a2a');
      }
      let a = this.carAnim.get(car);
      if (!a) { a = { open: 0 }; this.carAnim.set(car, a); }
      const target = car.state === 'doors' ? 4 : 0;
      if (a.open !== target) {
        a.acc = (a.acc || 0) + dtMs;
        while (a.acc >= 45 && a.open !== target) { a.acc -= 45; a.open += a.open < target ? 1 : -1; }
      } else a.acc = 0;
      if (top + CAR_H < wy0 || top > wy1) continue;
      const n = Array.isArray(car.pass) ? car.pass.length : num(car.pass);
      const nv = Math.min(n, 30);
      const spr = this.sprite('car' + w + express + '|' + nv + '|' + a.open, () => carSprite(w, express, nv, a.open));
      this.img(spr, x, top, w * TW - 4, CAR_H);
      // 速度に応じた動きの線（加減速が見える）
      const sp = this.lodOn ? 0 : Math.abs(vel);
      if (sp > 1.5) {
        const k = Math.min(1, (sp - 1.5) / 8);
        this.ctx.globalAlpha = 0.25 + 0.35 * k;
        const len = 3 + k * 10;
        const ty = vel > 0 ? top + CAR_H : top - len;
        for (const dx of [2, (cw >> 1), cw - 3]) this.rect1(x + dx, ty, 0.5, len, '#e8e0c0');
        this.ctx.globalAlpha = 1;
      }
    }
  }

  // 各フロアの外壁の位置（構造のまとまりの左端・右端）。sim.revision が変わったら作り直す。
  // 一番外側の端は必ず、内側の端は外に 6 マス以上の空きがあるときだけ非常階段を付ける。
  floorEdges(grid) {
    const sim = this.sim;
    const rev = typeof sim.revision === 'number' ? sim.revision : -1;
    const c = this._edges;
    this._edgeFrame = (this._edgeFrame || 0) + 1;
    if (c && c.grid === grid && c.rev === rev && (rev >= 0 || this._edgeFrame % 60)) return c;
    const GAP = 6;
    const left = [], right = [];   // left[f] = 左側に階段を付けるマス x の配列
    for (let f = 0; f <= MAX_F; f++) {
      const row = grid[f];
      const L = [], R = [];
      left.push(L); right.push(R);
      if (!row) continue;
      let x = 0;
      while (x < W) {
        while (x < W && !row[x]) x++;
        if (x >= W) break;
        const a = x;
        while (x < W && row[x]) x++;
        const b = x - 1;
        let gl = 0; for (let k = a - 1; k >= 0 && !row[k] && gl < GAP; k--) gl++;
        let gr = 0; for (let k = b + 1; k < W && !row[k] && gr < GAP; k++) gr++;
        if (gl >= GAP || gl === a) L.push(a);
        if (gr >= GAP || b + gr === W - 1) R.push(b);
      }
    }
    this._edges = { grid, rev, left, right };
    return this._edges;
  }

  // 非常階段（飾り）: 地上の各フロアの外壁に、ジグザグの階段と踊り場
  drawFireEscapes(grid, fLo, fHi) {
    const { left, right } = this.floorEdges(grid);
    const [wx0, , wx1] = this.vb;
    const spr0 = this.tile('fe0', () => fireEscapeSprite(0)), spr1 = this.tile('fe1', () => fireEscapeSprite(1));
    const spr0R = this.tile('fe0R', () => mirrored(spr0)), spr1R = this.tile('fe1R', () => mirrored(spr1));
    const top = this.tile('feTop', fireEscapeTop), topR = this.tile('feTopR', () => mirrored(top));
    const lit = this.night > 0.3;
    for (let f = Math.max(0, fLo); f <= Math.min(MAX_F, fHi); f++) {
      const wy = -(f + 1) * FH;
      const par = f & 1;
      const upL = f < MAX_F ? left[f + 1] : null, upR = f < MAX_F ? right[f + 1] : null;
      for (const ex of left[f]) {
        const lx = ex * TW - 3 - ESC_W;
        if (lx + ESC_W < wx0 || lx > wx1) continue;
        this.img(par ? spr1 : spr0, lx, wy, ESC_W, FH);
        if (!upL || upL.indexOf(ex) < 0) this.img(top, lx, wy - 6, ESC_W, 9);
        if (lit) this.rect(lx + 16, wy + 13, 1, 1, '#ffe08a');
      }
      for (const ex of right[f]) {
        const rx = (ex + 1) * TW + 3;
        if (rx + ESC_W < wx0 || rx > wx1) continue;
        this.img(par ? spr1R : spr0R, rx, wy, ESC_W, FH);
        if (!upR || upR.indexOf(ex) < 0) this.img(topR, rx, wy - 6, ESC_W, 9);
        if (lit) this.rect(rx + 1, wy + 13, 1, 1, '#ffe08a');
      }
    }
  }

  drawFacade(grid, fLo, fHi, xA, xB) {
    const ctx = this.ctx;
    const objs = this.sim && this.sim.objs && typeof this.sim.objs.get === 'function' ? this.sim.objs : null;
    const xa = Math.max(0, xA - 1), xb = Math.min(W - 1, xB + 1);
    const wallA = '#d4d0c4', wallB = '#8a8478', base = '#5e5850';
    for (let f = fLo; f <= fHi; f++) {
      const row = grid[f];
      if (!row) continue;
      const above = grid[f + 1];
      const below = grid[f - 1];
      const wy = -(f + 1) * FH;
      const ug = f < 0;
      for (let x = xa; x <= xb; x++) {
        if (!row[x]) continue;
        const wx = x * TW;
        const l = x === 0 || !row[x - 1], r = x === W - 1 || !row[x + 1];
        if (l) {
          this.rect(wx - 3, wy, 1, FH, '#000'); this.rect(wx - 2, wy, 2, FH, ug ? base : wallA); this.rect(wx - 1, wy, 1, FH, ug ? '#3e3a34' : wallB);
        }
        if (r) {
          this.rect(wx + TW + 2, wy, 1, FH, '#000'); this.rect(wx + TW, wy, 2, FH, ug ? base : wallA); this.rect(wx + TW, wy, 1, FH, ug ? '#3e3a34' : wallB);
        }
        if (!ug && (f === MAX_F || !above || !above[x]) && !(objs && (objs.get(row[x]) || {}).type === 'cathedral')) {
          const ext0 = l ? 3 : 0, ext1 = r ? 3 : 0;
          this.rect(wx - ext0, wy - 4, TW + ext0 + ext1, 1, '#000');
          this.rect(wx - ext0, wy - 3, TW + ext0 + ext1, 2, '#bcb6a8');
          this.rect(wx - ext0, wy - 1, TW + ext0 + ext1, 1, '#7a7468');
        }
        if (ug && (f === MIN_F || !below || !below[x])) {
          this.rect(wx - (l ? 3 : 0), wy + FH, TW + (l ? 3 : 0) + (r ? 3 : 0), 3, base);
          this.rect(wx - (l ? 3 : 0), wy + FH + 3, TW + (l ? 3 : 0) + (r ? 3 : 0), 1, '#2a2622');
        }
      }
    }
  }

  // ---------------- 人 ----------------
  drawPeople() {
    const sim = this.sim, ctx = this.ctx;
    const atlas = this.atlas || (this.atlas = peopleAtlas());
    const [wx0, wy0, wx1, wy1] = this.vb;
    let count = 0;
    const S = this.S;
    const lod = this.lodOn;
    const dw = Math.max(1, Math.round(3 * S)), dh = Math.max(1, Math.round(7 * S));
    let lastCol = null;
    const sel = this._view && this._view.selectedPerson || null;
    this._selPos = null;
    const drawOne = (p, wx, fpos, facing, moving) => {
      const feet = -fpos * FH - 3;
      if (p === sel) this._selPos = { wx, feet };
      if (feet < wy0 || feet - PH > wy1 || wx + 4 < wx0 || wx - 4 > wx1) return;
      if (lod) {
        // 引いた視点: スプライトの代わりに小さな四角（ストレス色）
        const k = p.kind;
        const c = k === 'guard' ? '#2f5ce0' : k === 'vip' ? '#f2c418' : (k === 'bride' || k === 'groom') ? '#ffffff' : STRESS_COLORS[stressIndex(num(p.stress))];
        if (c !== lastCol) { ctx.fillStyle = c; lastCol = c; }
        ctx.fillRect(Math.round((wx - 1.5 - this.cx) * S), Math.round((feet - this.cy) * S) - dh, dw, dh);
        count++;
        return;
      }
      let kind = p.kind;
      let ki = KIND_INDEX[kind];
      if (ki === undefined) ki = 0;
      const id = num(p.id);
      if (kind === 'resident' && id % 4 === 3) ki = KIND_INDEX.child;
      else if (kind === 'weddingGuest' && id % 2) ki = KIND_INDEX.weddingGuest2;
      const s = stressIndex(num(p.stress));
      const fr = moving ? ((Math.floor(wx / 2) & 1)) : 0;
      const sx = (s * 4 + fr * 2 + facing) * PW, sy = ki * PH;
      const x0 = Math.round((wx - 3.5 - this.cx) * S), y0 = Math.round((feet - PH - this.cy) * S);
      const x1 = Math.round((wx + 3.5 - this.cx) * S), y1 = Math.round((feet - this.cy) * S);
      ctx.drawImage(atlas, sx, sy, PW, PH, x0, y0, x1 - x0, y1 - y0);
      count++;
    };
    // 移動中の人
    const act = sim.active;
    if (act && typeof act[Symbol.iterator] === 'function') {
      const hasDP = typeof sim.drawPos === 'function';
      for (const p of act) {
        if (!p) continue;
        const st = p.state;
        if (st === 'ride' || st === 'wait') continue;
        let pos = null;
        try { pos = hasDP ? sim.drawPos(p) : null; } catch (e) { pos = null; }
        let px, pf;
        if (pos) { px = num(pos.x, NaN); pf = num(pos.f, NaN); }
        else { px = num(p.x, NaN); pf = num(p.f, NaN); }
        if (!(px === px) || !(pf === pf)) continue;
        const wx = px * TW + TW / 2;
        let d = this.walkDir.get(p);
        if (!d) { d = { x: wx, f: 1 }; this.walkDir.set(p, d); }
        if (wx > d.x + 0.01) d.f = 1; else if (wx < d.x - 0.01) d.f = 0;
        const moving = Math.abs(wx - d.x) > 0.001 || st === 'stairs';
        d.x = wx;
        drawOne(p, wx, pf, d.f, moving);
      }
    }
    // エレベーター待ちの列
    this.qBadges.length = 0;
    for (const e of this.elevs || []) {
      const q = e.q;
      if (!q) continue;
      const w = num(e.w, e.type === 'express' ? 6 : 4);
      const ex = num(e.x) * TW;
      for (const k in q) {
        const f = +k;
        if (!(f >= this.fLo - 1 && f <= this.fHi + 1)) continue;
        const qf = q[k];
        if (!qf) continue;
        const up = Array.isArray(qf.up) ? qf.up : [], dn = Array.isArray(qf.down) ? qf.down : [];
        const nu = Math.min(up.length, 40), nd = Math.min(dn.length, 40);
        if (up.length > 8) this.qBadges.push(up.length, ex - 1, -(f + 1) * FH + 1, -1);
        if (dn.length > 8) this.qBadges.push(dn.length, ex + w * TW + 1, -(f + 1) * FH + 1, 1);
        const spU = up.length > 14 ? 3 : 4, spD = dn.length > 14 ? 3 : 4;
        for (let i = nu - 1; i >= 0; i--) drawOne(typeof up[i] === 'object' ? up[i] : { kind: 'visitor', stress: 0 }, ex - 4 - i * spU, f, 1, false);
        for (let i = nd - 1; i >= 0; i--) drawOne(typeof dn[i] === 'object' ? dn[i] : { kind: 'visitor', stress: 0 }, ex + w * TW + 4 + i * spD, f, 0, false);
      }
    }
    this.stats.people = count;
  }

  // ---------------- 重ね描き（事件・評価など） ----------------
  drawOverlays(view) {
    const sim = this.sim, ctx = this.ctx;
    const now = this.simTime;
    const ms = this.nowMs;
    // 施設ごと
    const bubbles = [];
    this.badges.length = 0;
    const zc = this.S / this.dpr;
    const evalFn = typeof sim.evalLevel === 'function' ? sim.evalLevel.bind(sim) : null;
    for (const o of this.visObjs || []) {
      const type = o.type;
      const tw = num(o.w, (TYPES[type] && TYPES[type].w) || 1), th = num(o.h, (TYPES[type] && TYPES[type].h) || 1);
      const x = num(o.x) * TW, y = -(num(o.f) + th) * FH;
      if (o.destroyed || this.isBuilding(o)) continue;
      if (o.infested) { if (!this.lodOn) this.drawRoaches(o, x, y, tw * TW, ms); this.badges.push(1, x + tw * TW, y); }
      else if (o.dirty) this.badges.push(2, x + tw * TW, y);
      if (o.unreachable === true) {
        this.badges.push(3, x + tw * TW / 2, y);
        const a = 0.35 + 0.35 * Math.sin(ms / 250);
        this.strokeWorld([x, y, tw * TW, th * FH], `rgba(255,60,40,${a.toFixed(3)})`, Math.max(1, Math.round(this.dpr * 1.5)), false);
      }
      if (num(o.complaintUntil, -1) > now) bubbles.push([x + tw * TW - 15, y - 9]);
      if (evalFn && !this.lodOn && EVAL_TYPES.has(type) && o.occupied !== false) {
        let lv = null;
        try { lv = evalFn(o); } catch (e) { lv = null; }
        const c = lv && EVAL_COL[lv];
        if (c) { this.rect(x + 2, y + 2, 4, 3, '#000'); this.rect(x + 3, y + 2, 2, 2, c); }
      }
      if (o.brand && zc >= 1.9) this.drawBrand(o, x, y, tw * TW);
    }
    // 爆弾捜索
    const bomb = sim.bomb;
    if (bomb) {
      const searched = bomb.searched;
      const has = (f) => (searched && typeof searched.has === 'function') ? searched.has(f) : Array.isArray(searched) ? searched.includes(f) : false;
      for (let f = this.fLo; f <= this.fHi; f++) {
        const row = sim.grid && sim.grid[f];
        if (!row) continue;
        let a = -1, b = -1;
        for (let x = this.xA; x <= this.xB; x++) if (row[x]) { if (a < 0) a = x; b = x; }
        if (a < 0) continue;
        const wy = -(f + 1) * FH;
        if (has(f)) {
          ctx.globalAlpha = 0.16; this.rect(a * TW, wy, (b - a + 1) * TW, FH - 2, '#40a0ff'); ctx.globalAlpha = 1;
          this.rect(a * TW - 14, wy + 8, 8, 8, '#2060c0'); this.rect(a * TW - 12, wy + 12, 2, 2, '#fff'); this.rect(a * TW - 10, wy + 13, 1, 1, '#fff'); this.rect(a * TW - 9, wy + 10, 2, 3, '#fff');
        }
      }
      if (bomb.found) {
        const bx = num(bomb.x) * TW, by = -num(bomb.f) * FH - 3 - 10;
        this.img(bombSprite(), bx, by, 9, 10);
        if ((ms / 150 | 0) % 2) this.rect(bx + 5, by - 1, 2, 2, '#ffe040');
      }
    }
    // 火災
    const fires = Array.isArray(sim.fires) ? sim.fires : [];
    for (const fi of fires) {
      if (!fi) continue;
      const f = num(fi.f), x0 = num(fi.x0), x1 = Math.max(x0, num(fi.x1, x0));
      if (f < this.fLo - 1 || f > this.fHi + 1) continue;
      const wy = -(f + 1) * FH;
      ctx.globalAlpha = 0.28 + 0.1 * Math.sin(ms / 90);
      this.rect(x0 * TW, wy, (x1 - x0 + 1) * TW, FH - 2, '#ff5010');
      ctx.globalAlpha = 1;
      for (let x = x0; x <= x1; x++) {
        const fr = ((ms / 110 + x * 1.7) | 0) % 4;
        this.img(flameSprite(fr), x * TW, wy + FH - 3 - 16, TW, 16);
      }
      // 煙
      ctx.globalAlpha = 0.45;
      for (let x = x0; x <= x1; x += 2) {
        const ph = ((ms / 1400 + hash2(x, f)) % 1);
        const r = 3 + ph * 6;
        this.rect(x * TW + 4 - r + Math.sin(ph * 6 + x) * 3, wy - ph * 22 + 2, r * 2, r * 1.4, ph < 0.5 ? '#4a4a4a' : '#7a7a7a');
      }
      ctx.globalAlpha = 1;
    }
    // エフェクト
    const effs = Array.isArray(sim.effects) ? sim.effects : [];
    for (const ef of effs) {
      if (!ef) continue;
      const dur = Math.max(0.01, num(ef.dur, 30));
      const pr = Math.max(0, Math.min(1, (now - num(ef.t0, now)) / dur));
      const cx = num(ef.x) * TW + TW / 2, cy = -(num(ef.f) + 0.5) * FH;
      this.drawEffect(ef.kind, cx, cy, pr, ef, ms);
    }
    // サンタ
    const santa = sim.santa;
    if (santa && typeof santa === 'object') this.guard(() => this.drawSanta(santa, ms));
    // 消防ヘリ
    const heli = sim.heli;
    if (heli && typeof heli === 'object') this.guard(() => this.drawHeli(heli, ms));
    // 吹き出し
    const bs = bubbleSprite();
    for (const [bx, by] of bubbles) this.img(bs, bx, by - 4 + Math.round(Math.sin(ms / 250) * 1), bs.width, bs.height);
  }

  // 看板の上に店名・社名（brand）を重ねる（ズーム時のみ、日本語可）
  drawBrand(o, x, y, ow) {
    const m = this.memo.get(o);
    const sg = m && m.img && m.img.sign;
    if (!sg) return;
    const ctx = this.ctx, dpr = this.dpr;
    const x0 = this.X(x + sg.x), y0 = this.Y(y + sg.y), x1 = this.X(x + sg.x + sg.w), y1 = this.Y(y + sg.y + sg.h);
    let w = x1 - x0, h = y1 - y0;
    if (h < 6 * dpr) return;
    const text = String(o.brand);
    let fs = Math.min(h * 0.72, 16 * dpr);
    ctx.font = `bold ${fs}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    let tw = ctx.measureText(text).width;
    // 看板より長ければ看板を少し広げ、それでも足りなければ文字を縮める
    const maxW = Math.max(w, Math.min(tw + 6 * dpr, w * 2.2));
    if (tw + 4 * dpr > maxW) { fs = Math.max(7 * dpr, fs * (maxW - 4 * dpr) / tw); ctx.font = `bold ${fs}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`; tw = ctx.measureText(text).width; }
    const bw = Math.max(w, Math.min(maxW, tw + 6 * dpr));
    const fx0 = this.X(x) + 2 * dpr, fx1 = this.X(x + ow) - 2 * dpr;
    let bx = Math.round(x0 + w / 2 - bw / 2);
    bx = Math.max(fx0, Math.min(fx1 - bw, bx));
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, y0 - 1, Math.round(bw) + 2, h + 2);
    ctx.fillStyle = sg.bg || '#f6f0dc';
    ctx.fillRect(bx, y0, Math.round(bw), h);
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, y0, bw, h); ctx.clip();
    ctx.fillStyle = sg.fg || '#202020';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + (bw - tw) / 2, y0 + h / 2 + dpr * 0.5);
    ctx.restore();
  }

  drawHeli(h, ms) {
    const ctx = this.ctx;
    const hx = num(h.x, NaN) * TW, hf = num(h.f, NaN);
    if (!(hx === hx) || !(hf === hf)) return;
    const hy = -(hf + 0.5) * FH;
    const st = this._heli || (this._heli = { x: hx, dir: 1 });
    if (h.phase === 'spray' && h.targetX != null) st.dir = num(h.targetX) * TW >= hx - 1 ? 1 : -1;
    else if (hx > st.x + 0.01) st.dir = 1; else if (hx < st.x - 0.01) st.dir = -1;
    st.x = hx;
    const base = heliSprite();
    const spr = st.dir > 0 ? base : this.tile('heliL', () => mirrored(base));
    const [wx0, wy0, wx1, wy1] = this.vb;
    const bob = Math.sin(ms / 220) * 1.2;
    const K = 1.5;
    const sx = hx - 20 * K, sy = hy - 9 * K + bob;
    // 散水
    if (h.phase === 'spray') {
      const tx = num(h.targetX, hx / TW) * TW, tf = num(h.targetF, hf - 3);
      const by = sy + 26 * K / 1.5 + 6, bx = hx - 2;
      this.rect1(hx, sy + 16 * K, 0.5, by - sy - 16 * K, '#3a3a3a');
      this.rect(bx, by, 5, 4, '#e07a20'); this.rect(bx, by, 5, 1, '#000');
      const ty = -(tf + 1) * FH + 4, bottom = -tf * FH - 3;
      if (bottom > wy0 && by < wy1) {
        ctx.globalAlpha = 0.22 + 0.06 * Math.sin(ms / 120);
        this.rect(tx - 28, ty, 56, bottom - ty, '#9ad4ff');
        ctx.globalAlpha = 1;
        for (let i = 0; i < 60; i++) {
          const ph = ((ms / 650) + i / 60) % 1;
          const spread = (hash2(i, 77) - 0.5) * (8 + ph * 48);
          const x = bx + 2 + (tx - bx - 2) * ph + spread;
          const y = by + 4 + (bottom - by - 4) * ph;
          ctx.globalAlpha = 0.85 - ph * 0.3;
          this.rect1(x, y, 1, 2 + ph * 2, i % 3 ? '#7ac4f8' : '#e8f6ff');
        }
        ctx.globalAlpha = 1;
        // しぶき
        for (let i = 0; i < 10; i++) {
          const ph = ((ms / 400) + i / 10) % 1;
          ctx.globalAlpha = 1 - ph;
          this.rect1(tx + (hash2(i, 5) - 0.5) * 50, bottom - 2 - ph * 5, 1, 1, '#ffffff');
        }
        ctx.globalAlpha = 1;
      }
    }
    if (sx + 40 * K < wx0 || sx > wx1 || sy + 18 * K < wy0 || sy - 4 > wy1) return;
    this.img(spr, sx, sy, spr.width * K, spr.height * K);
    // メインローター（回転は長さの変化で表現）
    const mast = sx + (st.dir > 0 ? 23 : 17) * K;
    const fr = ((ms / 35) | 0) % 4;
    const half = [21, 14, 5, 14][fr] * K;
    ctx.globalAlpha = 0.22; this.rect(mast - 21 * K, sy, 42 * K, 1.5, '#c8ccd0'); ctx.globalAlpha = 1;
    this.rect(mast - half, sy, half * 2, 1.5, '#202024');
    this.rect(mast - 1.5, sy, 3, 2, '#3a3a3a');
    // テールローター
    const tr = st.dir > 0 ? sx + 3 * K : sx + 37 * K;
    const tf2 = ((ms / 30) | 0) % 2;
    this.rect(tr - (tf2 ? 4 : 0), sy + 6 - (tf2 ? 0 : 4), tf2 ? 9 : 1.5, tf2 ? 1.5 : 9, '#3a3a40');
    // 回転灯
    if (((ms / 300) | 0) % 2) this.rect(sx + (st.dir > 0 ? 24 : 15) * K, sy + 3 * K, 1.5, 1.5, '#ff4040');
  }

  drawSanta(santa, ms) {
    const ctx = this.ctx, sim = this.sim;
    const sx = num(santa.x, NaN) * TW;
    let sf = num(santa.f, NaN);
    if (!(sx === sx) || !(sf === sf)) return;
    // 進行方向（前フレームとの差）
    const st = this._santa || (this._santa = { x: sx, dir: 1 });
    if (sx > st.x + 0.01) st.dir = 1; else if (sx < st.x - 0.01) st.dir = -1;
    st.x = sx;
    const base = santaSprite();
    const spr = st.dir > 0 ? (this._santaR || (this._santaR = mirrored(base))) : base;
    const SW = spr.width, SH = spr.height;
    // 建物の中に重ならないよう、そりの下にある一番高い屋上より上に置く
    let roof = Infinity;
    const grid = sim.grid;
    if (grid) {
      const c0 = Math.max(0, Math.floor(sx / TW) - 1), c1 = Math.min(W - 1, Math.floor((sx + SW) / TW) + 1);
      for (let f = MAX_F; f >= MIN_F && f >= 0; f--) {
        const row = grid[f];
        if (!row) continue;
        let hit = false;
        for (let c = c0; c <= c1; c++) if (row[c]) { hit = true; break; }
        if (hit) { roof = -(f + 1) * FH - 6; if (f === MAX_F) roof -= 90; break; }
      }
    }
    const bob = Math.sin(ms / 300) * 2;
    let sy = -(sf + 1) * FH + bob;
    if (sy + SH > roof) sy = roof - SH;
    // きらきらの軌跡（そりの後ろ）
    const tailX = st.dir > 0 ? sx : sx + SW;
    for (let i = 0; i < 14; i++) {
      const ph = ((ms / 900 + i / 14) % 1);
      ctx.globalAlpha = (1 - ph) * 0.9;
      const tx = tailX - st.dir * (2 + ph * 46), ty = sy + 11 + Math.sin(i * 1.7 + ms / 400) * 3 + ph * 4;
      const c = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#fff2a0' : '#ffd060';
      this.rect1(tx, ty, 1, 1, c);
      if (i % 4 === 0 && ph < 0.4) { this.rect1(tx - 1, ty, 3, 1, c); this.rect1(tx, ty - 1, 1, 3, c); }
    }
    ctx.globalAlpha = 1;
    this.img(spr, sx, sy, SW, SH);
    // トナカイの赤い鼻
    if ((ms / 250 | 0) % 2) this.rect(st.dir > 0 ? sx + SW - 2 : sx + 1, sy + 6, 1, 1, '#ff4040');
  }

  drawRoaches(o, x, y, ww, ms) {
    const id = num(o.id);
    const th = num(o.h, 1);
    const n = Math.min(14, 4 + Math.floor(ww / 12));
    for (let i = 0; i < n; i++) {
      const sp = 0.006 + hash2(id, i) * 0.008;
      const span = ww - 8;
      const ph = (ms * sp + hash2(i, id) * span * 2) % (span * 2);
      const fwd = ph < span;
      const rx = x + 3 + (fwd ? ph : span * 2 - ph);
      const lane = i % 3; // 0=床 1=壁 2=天井
      const ry = lane === 0 ? y + th * FH - 5 : lane === 1 ? y + 5 + ((hash2(id, i + 9) * 9) | 0) : y + 1;
      const leg = ((ms / 70 + i) | 0) % 2;
      // 体 4x2 + 頭 + 脚
      this.rect(rx, ry, 4, 2, '#4a1e06');
      this.rect(rx + 1, ry, 2, 1, '#8a4a1a');
      const hx = fwd ? rx + 4 : rx - 1;
      this.rect(hx, ry, 1, 1, '#1a0802');
      this.rect(fwd ? hx + 1 : hx - 1, ry - 1, 1, 1, '#1a0802');
      this.rect(rx + leg, ry + 2, 1, 1, '#1a0802');
      this.rect(rx + 2 + leg, ry + 2, 1, 1, '#1a0802');
      this.rect(rx + 1 - leg, ry - 1, 1, 1, '#1a0802');
      this.rect(rx + 3 - leg, ry - 1, 1, 1, '#1a0802');
    }
  }

  // 状態バッジ（施設の右上・画面上の最小サイズを保つ）と待ち人数
  drawBadges() {
    const ctx = this.ctx, dpr = this.dpr, ms = this.nowMs;
    const zc = this.S / dpr;
    // 引いた視点では小さく（全体が見えるときに画面を埋めないように）
    const sc = zc >= 0.75 ? Math.max(this.S, 1.6 * dpr) : Math.max(this.S, 0.9 * dpr);
    const b = this.badges;
    for (let i = 0; i < b.length; i += 3) {
      const kind = b[i];
      if (zc < 0.6 && kind === 2) continue;
      const spr = kind === 1 ? roachIcon() : kind === 2 ? dirtyIcon() : warnIcon();
      const w = Math.round(spr.width * sc), h = Math.round(spr.height * sc);
      let sx = this.X(b[i + 1]), sy = this.Y(b[i + 2]);
      if (kind === 3) {
        sx -= w >> 1; sy += Math.round(2 * this.S);
        if ((ms / 400 | 0) % 2) ctx.globalAlpha = 0.55;
      } else { sx -= w + Math.round(2 * this.S); sy += Math.round(2 * this.S); }
      if (kind === 1) sy += Math.round(Math.sin(ms / 120) * dpr);
      ctx.drawImage(spr, sx, sy, w, h);
      ctx.globalAlpha = 1;
    }
    // エレベーター待ちの人数
    const q = this.qBadges;
    if (!q.length) return;
    const fs = Math.round(Math.max(zc < 0.6 ? 8 : 10, Math.min(13, 10 * zc)) * dpr);
    ctx.font = `bold ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < q.length; i += 4) {
      const n = q[i];
      if (zc < 0.6 && n <= 25) continue;
      const label = String(n);
      const tw = ctx.measureText(label).width;
      const pw = Math.round(tw + fs * 0.8), ph = Math.round(fs * 1.25);
      const ax = this.X(q[i + 1]), ay = this.Y(q[i + 2]);
      const x = q[i + 3] < 0 ? ax - pw - Math.round(2 * dpr) : ax + Math.round(2 * dpr);
      const y = ay - ph - Math.round(1 * dpr);
      const col = n > 25 ? '#e02020' : n > 15 ? '#f07a10' : '#e8b810';
      const pulse = n > 25 ? 0.75 + 0.25 * Math.sin(ms / 150) : 1;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#000';
      roundRect(ctx, x - dpr, y - dpr, pw + 2 * dpr, ph + 2 * dpr, ph / 2); ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, x, y, pw, ph, ph / 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = n > 15 ? '#ffffff' : '#000000';
      ctx.fillText(label, x + (pw - tw) / 2, y + ph / 2 + dpr * 0.5);
    }
  }

  drawEffect(kind, cx, cy, pr, ef, ms) {
    const ctx = this.ctx;
    const [wx0, wy0, wx1, wy1] = this.vb;
    if (cx + 140 < wx0 || cx - 140 > wx1 || cy + 120 < wy0 || cy - 200 > wy1) return;
    if (kind === 'explosion') {
      const k = Math.min(7, Math.floor(pr * 8));
      const sz = BOOM * 2;
      this.img(boomSprite(k), cx - sz / 2, cy - sz / 2, sz, sz);
      if (pr < 0.12) { ctx.globalAlpha = 0.5 * (1 - pr / 0.12); this.rect(cx - 160, cy - 60, 320, 120, '#fff8d0'); ctx.globalAlpha = 1; }
    } else if (kind === 'smoke') {
      ctx.globalAlpha = 0.55 * (1 - pr);
      for (let i = 0; i < 6; i++) {
        const ph = (pr + i / 6) % 1;
        const r = 4 + ph * 10;
        this.rect(cx - r + Math.sin(i * 3 + ph * 4) * 6, cy - ph * 40 - r, r * 2, r * 1.5, i % 2 ? '#5a5a5a' : '#8a8a8a');
      }
      ctx.globalAlpha = 1;
    } else if (kind === 'bells') {
      const b = bellSprite();
      const sw = Math.round(Math.sin(ms / 160) * 2);
      const by = cy - FH * 0.5 - 16;
      this.img(b, cx - 14 + sw, by, 9, 10);
      this.img(b, cx + 6 - sw, by, 9, 10);
      // 音符
      for (let i = 0; i < 3; i++) {
        const ph = (ms / 1500 + i / 3) % 1;
        ctx.globalAlpha = 1 - ph;
        const nx = cx - 20 + i * 18 + Math.sin(ph * 6) * 3, ny = by - 4 - ph * 22;
        this.rect(nx, ny, 2, 2, '#ffe060'); this.rect(nx + 1, ny - 4, 1, 4, '#ffe060'); this.rect(nx + 2, ny - 4, 2, 1, '#ffe060');
      }
      ctx.globalAlpha = 1;
      this.drawConfetti(cx, cy, pr, ms);
    } else if (kind === 'confetti') {
      this.drawConfetti(cx, cy, pr, ms);
    } else if (kind === 'fireworks') {
      if (pr >= 1) return;
      const seed = num(ef.t0) * 7 + num(ef.x);
      const fade = pr > 0.9 ? (1 - pr) * 10 : 1;
      for (let b = 0; b < 6; b++) {
        const cyc = ms / 2200 + b / 6 + hash2(seed, b);
        const lp = cyc % 1, gen = Math.floor(cyc);
        const bx = cx + (hash2(seed + gen, b) - 0.5) * 160;
        const by = cy - 60 - hash2(b, seed + gen) * 90;
        const col = FW_COLS[(hash2(seed + gen, b + 5) * FW_COLS.length) | 0];
        if (lp < 0.25) {
          const t = lp / 0.25;
          ctx.globalAlpha = fade;
          this.rect1(bx, cy + (by - cy) * t, 1, 4, '#fff0c0');
          ctx.globalAlpha = 1;
          continue;
        }
        const t = (lp - 0.25) / 0.75;
        const rad = 5 + Math.sqrt(t) * 34;
        if (t < 0.12) { ctx.globalAlpha = 0.5 * (1 - t / 0.12) * fade; this.rect(bx - 10, by - 10, 20, 20, '#fff8e0'); }
        ctx.globalAlpha = Math.max(0, 1 - t * t) * fade;
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const px = bx + Math.cos(a) * rad, py = by + Math.sin(a) * rad + t * t * 12;
          this.rect1(px - 1, py - 1, 3, 3, i % 3 ? col : '#ffffff');
          this.rect1(bx + Math.cos(a) * rad * 0.7, by + Math.sin(a) * rad * 0.7 + t * t * 9, 1, 1, col);
        }
        ctx.globalAlpha = 1;
      }
    } else if (kind === 'sparkle') {
      for (let i = 0; i < 6; i++) {
        const ph = ((ms / 700) + hash2(i, 3)) % 1;
        const s = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
        const sx = cx + (hash2(i, 1) - 0.5) * 40, sy = cy + (hash2(i, 2) - 0.5) * 20;
        ctx.globalAlpha = s;
        this.rect(sx - 2, sy, 5, 1, '#fff8b0'); this.rect(sx, sy - 2, 1, 5, '#fff8b0');
      }
      ctx.globalAlpha = 1;
    }
  }

  drawConfetti(cx, cy, pr, ms) {
    for (let i = 0; i < 40; i++) {
      const ph = ((ms / 2400) + hash2(i, 9)) % 1;
      const x = cx + (hash2(i, 4) - 0.5) * 110 + Math.sin(ms / 300 + i) * 3;
      const y = cy - 40 + ph * 50;
      this.rect(x, y, (i % 3) ? 2 : 1, (i % 3) ? 1 : 2, CONF_COLS[i % CONF_COLS.length]);
    }
  }

  // ---------------- UI 系の重ね描き ----------------
  drawUI(view) {
    const ctx = this.ctx, sim = this.sim, dpr = this.dpr;
    const ms = this.nowMs;
    // 選択枠
    if (sim && view.selectedId != null && sim.objs && typeof sim.objs.get === 'function') {
      const o = sim.objs.get(view.selectedId);
      if (o) {
        const b = this.objBounds(o);
        const a = 0.6 + 0.4 * Math.sin(ms / 180);
        this.strokeWorld(b, `rgba(255,230,60,${a.toFixed(3)})`, 2 * dpr, true);
      }
    }
    // ホバー
    if (view.hover && !view.ghost && !(Array.isArray(view.ghosts) && view.ghosts.length)) {
      const h = view.hover;
      this.strokeWorld([num(h.x) * TW, -(num(h.f) + 1) * FH, TW, FH], 'rgba(255,255,255,0.75)', Math.max(1, dpr), false);
    }
    // ゴースト
    if (sim && view.marked && typeof view.marked.forEach === 'function') this.guard(() => this.drawMarked(view.marked));
    if (sim && view.selectedPerson) this.guard(() => this.drawSelectedPerson(view.selectedPerson));
    if (view.ghost) this.drawGhost(view.ghost);
    if (Array.isArray(view.ghosts)) for (const g of view.ghosts) if (g) this.guard(() => this.drawGhost(g));
    // 爆弾のアラーム（画面の縁）
    if (sim && sim.bomb && !sim.bomb.found) {
      const a = 0.18 + 0.18 * Math.sin(ms / 200);
      const cw = this.canvas.width, ch = this.canvas.height, t = 6 * dpr;
      ctx.fillStyle = `rgba(255,30,30,${a.toFixed(3)})`;
      ctx.fillRect(0, 0, cw, t); ctx.fillRect(0, ch - t, cw, t); ctx.fillRect(0, 0, t, ch); ctx.fillRect(cw - t, 0, t, ch);
    }
  }

  // ---- 評価の一括表示（斜線ハッチ＋半透明）。チャンクとは別に、見えている施設だけ毎フレーム重ねる ----
  hatch(col) {
    const m = this._hatch || (this._hatch = new Map());
    let pat = m.get(col);
    if (!pat) {
      const k = Math.max(1, Math.round(this.dpr));
      const c = makeCanvasLike(8 * k, 8 * k), g = c.getContext('2d');
      g.strokeStyle = col; g.lineWidth = 2 * k; g.lineCap = 'square';
      g.beginPath(); g.moveTo(-2 * k, 2 * k); g.lineTo(2 * k, -2 * k); g.moveTo(0, 8 * k); g.lineTo(8 * k, 0); g.moveTo(6 * k, 10 * k); g.lineTo(10 * k, 6 * k); g.stroke();
      pat = this.ctx.createPattern(c, 'repeat');
      m.set(col, pat);
    }
    return pat;
  }
  drawEvalOverlay() {
    const sim = this.sim, ctx = this.ctx;
    const evalFn = typeof sim.evalLevel === 'function' ? sim.evalLevel.bind(sim) : null;
    const COL = { good: '#3a8aff', fair: '#f0c820', bad: '#ff3030' };
    for (const o of this.visObjs || EMPTY) {
      const t = o.type;
      if (t === 'lobby' || t === 'floor' || t === 'stairs' || t === 'escalator' || isElev(t)) continue;
      const b = this.objBounds(o);
      let col, a = 0.28;
      if (o.destroyed) { col = '#1a1a1a'; a = 0.45; }
      else if (this.isBuilding(o)) col = '#ff9a20';
      else {
        let lv = null;
        try { lv = evalFn ? evalFn(o) : null; } catch (e) { lv = null; }
        col = COL[lv] || '#9a9aa4';
      }
      const x0 = this.X(b[0]), y0 = this.Y(b[1]), x1 = this.X(b[0] + b[2]), y1 = this.Y(b[1] + b[3] - 2);
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 0.6; ctx.fillStyle = this.hatch(col); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (o.destroyed) { ctx.fillStyle = this.hatch('#e8e8e8'); ctx.globalAlpha = 0.35; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, this.dpr);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    }
    ctx.globalAlpha = 1;
  }

  // ---- コピー用に選んだ施設: 薄い枠と、スマホの複数選択のようなチェックのバッジ ----
  drawMarked(marked) {
    const ctx = this.ctx, dpr = this.dpr, objs = this.sim.objs;
    if (!objs || typeof objs.get !== 'function') return;
    const vb = this.vb;
    const r = Math.max(7 * dpr, Math.min(11 * dpr, 6 * this.S));
    marked.forEach((id) => {
      const o = objs.get(id);
      if (!o) return;
      const b = this.objBounds(o);
      if (b[0] > vb[2] || b[0] + b[2] < vb[0] || b[1] > vb[3] || b[1] + b[3] < vb[1]) return;
      const x0 = this.X(b[0]), y0 = this.Y(b[1]), x1 = this.X(b[0] + b[2]), y1 = this.Y(b[1] + b[3]);
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#2a7aff'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1; ctx.strokeStyle = '#2a7aff'; ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(x0 + dpr, y0 + dpr, x1 - x0 - 2 * dpr, y1 - y0 - 2 * dpr);
      const cx = x1 - r - 3 * dpr, cy = y0 + r + 3 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, r + 1.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#1a73e8'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.38); ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5 * dpr, r * 0.28); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    });
  }

  // ---- 選択中の人: 頭上で弾む矢印と、体のまわりの枠。乗車中はカゴ、室内なら施設に印 ----
  drawSelectedPerson(p) {
    const ctx = this.ctx, dpr = this.dpr, ms = this.nowMs;
    let box = null;   // ワールド座標 [x, y, w, h]
    if (this._selPos) {
      const { wx, feet } = this._selPos;
      box = [wx - 3, feet - 9, 6, 10];
    } else if (p.state === 'ride') {
      for (const e of this.elevs || EMPTY) {
        for (const c of e.cars || EMPTY) {
          if (c && Array.isArray(c.pass) && c.pass.indexOf(p) >= 0) {
            const w = num(e.w, e.type === 'express' ? 6 : 4);
            box = [num(e.x) * TW + 2, -(num(c.pos) + 1) * FH + 1, w * TW - 4, CAR_H];
          }
        }
      }
    } else if (p.loc && p.loc.type) {
      box = this.objBounds(p.loc);
    }
    if (!box) return;
    const x0 = this.X(box[0]), y0 = this.Y(box[1]), x1 = this.X(box[0] + box[2]), y1 = this.Y(box[1] + box[3]);
    const pulse = 0.65 + 0.35 * Math.sin(ms / 160);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#000'; ctx.strokeRect(x0 - 2 * dpr, y0 - 2 * dpr, x1 - x0 + 4 * dpr, y1 - y0 + 4 * dpr);
    ctx.strokeStyle = `rgba(255,224,48,${pulse.toFixed(3)})`; ctx.strokeRect(x0 - 3 * dpr, y0 - 3 * dpr, x1 - x0 + 6 * dpr, y1 - y0 + 6 * dpr);
    // 弾む矢印
    const cx = (x0 + x1) / 2, bob = Math.abs(Math.sin(ms / 220)) * 6 * dpr;
    const ay = y0 - 6 * dpr - bob, aw = 10 * dpr, ah = 12 * dpr;
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffe030'; ctx.beginPath(); ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.9 + 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(cx - aw, ay - ah); ctx.lineTo(cx + aw, ay - ah); ctx.lineTo(cx, ay); ctx.closePath();
    ctx.fillStyle = '#ffe030'; ctx.fill(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#ffe030'; ctx.fillRect(cx - 3 * dpr, ay - ah - 6 * dpr, 6 * dpr, 6 * dpr);
    ctx.strokeRect(cx - 3 * dpr, ay - ah - 6 * dpr, 6 * dpr, 6 * dpr);
  }

  objBounds(o) {
    const type = o.type;
    if (isElev(type)) {
      const lo = num(o.lo, num(o.f)), hi = num(o.hi, lo);
      const w = num(o.w, TYPES[type] ? TYPES[type].w : 4);
      return [num(o.x) * TW, -(hi + 1) * FH, w * TW, (hi - lo + 1) * FH];
    }
    const tw = num(o.w, (TYPES[type] && TYPES[type].w) || 1), th = num(o.h, (TYPES[type] && TYPES[type].h) || 1);
    return [num(o.x) * TW, -(num(o.f) + th) * FH, tw * TW, th * FH];
  }

  strokeWorld(b, col, lw, corners) {
    const ctx = this.ctx;
    const x0 = this.X(b[0]), y0 = this.Y(b[1]), x1 = this.X(b[0] + b[2]), y1 = this.Y(b[1] + b[3]);
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, x1 - x0 - lw, y1 - y0 - lw);
    if (corners) {
      ctx.fillStyle = col;
      const c = 6 * this.dpr, t = lw * 1.5;
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        ctx.fillRect(sx > 0 ? cx - t : cx - c + t, sy > 0 ? cy - t : cy, c, t);
        ctx.fillRect(sx > 0 ? cx - t : cx, sy > 0 ? cy - t : cy - c + t, t, c);
      }
    }
  }

  drawGhost(g) {
    const ctx = this.ctx, dpr = this.dpr;
    let b;
    if (g.lo != null || g.hi != null) {
      const lo = Math.min(num(g.lo), num(g.hi, num(g.lo))), hi = Math.max(num(g.lo), num(g.hi, num(g.lo)));
      b = [num(g.x) * TW, -(hi + 1) * FH, num(g.w, 4) * TW, (hi - lo + 1) * FH];
    } else {
      const h = num(g.h, 1);
      b = [num(g.x) * TW, -(num(g.f) + h) * FH, num(g.w, 1) * TW, h * FH];
    }
    const ok = g.ok !== false;
    // エレベーターは機械室とピットも含めて出す
    if (g.lo != null || g.hi != null) {
      const lo = Math.min(num(g.lo), num(g.hi, num(g.lo))), hi = Math.max(num(g.lo), num(g.hi, num(g.lo)));
      const w = num(g.w, 4), express = (g.type === 'express' || w >= 6) ? 1 : 0, x = num(g.x) * TW;
      ctx.globalAlpha = 0.6;
      this.img(this.tile('mr' + w + express, () => machineRoom(w, express)), x, -(hi + 2) * FH, w * TW, FH);
      this.img(this.tile('pit' + w + express, () => pitSprite(w, express)), x, -lo * FH, w * TW, FH);
      ctx.globalAlpha = 1;
      this.strokeWorld([x, -(hi + 2) * FH, w * TW, (hi - lo + 3) * FH], ok ? 'rgba(80,255,120,0.55)' : 'rgba(255,70,70,0.55)', Math.max(1, dpr), false);
    }
    // 施設の見た目を薄く出す（UI が ghost.type を渡した場合）
    const type = g.type;
    if (ok && type && TYPES[type] && !isElev(type) && type !== 'floor' && type !== 'lobby' && type !== 'bulldoze') {
      const tw = num(g.w, TYPES[type].w || 1), th = num(g.h, TYPES[type].h || 1);
      const spr = this.sprite(type + '|' + tw + '|' + th + '|ghost', () => makeFacilitySprite(type, tw, th, { occ: 1, n: 0, open: 1, dirty: 0, alt: 0, frame: 0, week: 0, night: 0 }));
      ctx.globalAlpha = 0.55;
      const top = spr.oy || 0;
      this.img(spr, b[0], b[1] - top, tw * TW, th * FH + top);
      ctx.globalAlpha = 1;
    }
    const pulse = 0.25 + 0.08 * Math.sin(this.nowMs / 160);
    ctx.globalAlpha = pulse;
    this.rect(b[0], b[1], b[2], b[3], ok ? '#30e060' : '#ff3030');
    ctx.globalAlpha = 1;
    this.strokeWorld(b, ok ? 'rgba(80,255,120,0.95)' : 'rgba(255,70,70,0.95)', Math.max(1, Math.round(1.5 * dpr)), false);
    const label = g.label;
    if (label) {
      const fs = Math.round(12 * dpr);
      ctx.font = `bold ${fs}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
      const tw = ctx.measureText(label).width;
      const pad = 4 * dpr;
      let lx = Math.round((this.X(b[0]) + this.X(b[0] + b[2])) / 2 - tw / 2 - pad);
      let ly = this.Y(b[1]) - fs - pad * 3;
      lx = Math.max(2, Math.min(this.canvas.width - tw - pad * 2 - 2, lx));
      if (ly < 2) ly = this.Y(b[1] + b[3]) + pad;
      ctx.fillStyle = ok ? 'rgba(10,60,25,0.88)' : 'rgba(90,10,10,0.9)';
      roundRect(ctx, lx, ly, tw + pad * 2, fs + pad * 2, 3 * dpr); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(label, lx + pad, ly + pad + 1);
    }
  }

  drawFloorLabels() {
    const ctx = this.ctx, dpr = this.dpr;
    const zoom = this.S / dpr;
    const fhCss = FH * zoom;
    const step = fhCss >= 12 ? 1 : fhCss >= 5 ? 5 : 10;
    const fs = Math.round(Math.max(8, Math.min(11, fhCss * 0.42)) * dpr);
    ctx.font = `600 ${fs}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    const fLo = Math.max(MIN_F, Math.floor(-this.vb[3] / FH)), fHi = Math.min(MAX_F, Math.floor(-this.vb[1] / FH));
    const padX = Math.round(3 * dpr), ph = Math.round(fs * 1.3), x0 = Math.round(2 * dpr);
    for (let f = fLo; f <= fHi; f++) {
      const n = f >= 0 ? f + 1 : -f;
      if (step > 1 && f !== 0 && n % step !== 0) continue;
      const cy = Math.round((this.Y(-(f + 1) * FH) + this.Y(-f * FH)) / 2);
      const label = floorName(f);
      const lobby = LOBBY_SET.has(f);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = lobby ? 'rgba(80,52,0,0.5)' : 'rgba(0,0,0,0.38)';
      roundRect(ctx, x0, cy - (ph >> 1), Math.round(tw + padX * 2), ph, ph / 2); ctx.fill();
      ctx.fillStyle = lobby ? 'rgba(255,220,110,0.95)' : 'rgba(255,255,255,0.92)';
      ctx.fillText(label, x0 + padX, cy + Math.round(dpr * 0.5));
    }
  }
}

function makeCanvasLike(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// 地下鉄の車両（3両）
function makeTrain() {
  const carW = 76, n = 3;
  const p = new Painter(carW * n + 4, 28);
  for (let i = 0; i < n; i++) {
    const x = i * (carW + 1);
    p.box(x, 0, carW, 26, '#d8dce0');
    p.r(x + 1, 1, carW - 2, 2, '#eef0f2');
    p.r(x + 1, 16, carW - 2, 3, '#2a7ad0'); p.r(x + 1, 19, carW - 2, 1, '#e0c040');
    for (let wx = x + 5; wx < x + carW - 8; wx += 12) {
      if ((wx - x) % 36 === 29) { p.box(wx, 4, 8, 21, '#9aa0a8'); p.r(wx + 4, 5, 1, 19, '#5a6068'); p.r(wx + 1, 6, 2, 6, '#c8e4f4'); p.r(wx + 5, 6, 2, 6, '#c8e4f4'); continue; }
      p.box(wx, 5, 9, 8, '#203040'); p.r(wx + 1, 6, 7, 6, '#fff4c8');
      if ((wx * 7) % 3) { p.r(wx + 3, 8, 2, 2, '#1a1a1a'); p.r(wx + 2, 10, 4, 2, '#1a1a1a'); }
    }
    p.r(x + 4, 25, carW - 8, 3, '#2a2a2e');
    if (i === 0) { p.r(x + 1, 6, 3, 5, '#fff8a0'); }
  }
  return p.c;
}
