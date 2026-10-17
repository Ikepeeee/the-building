// The Building Renderer（Canvas 2D・ピクセルアート）
// const r = new Renderer(canvas, sim); r.resize(w, h); r.render(view); r.setSim(sim);
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F, DAY, LOBBY_FLOORS, TYPES, floorName } from '../sim/constants.js';
import { makeFacilitySprite, lobbyTile, floorTile, shaftSeg, carSprite, CAR_H, SPRITE_TOP, treeSprite } from './facilities.js';
import { peopleAtlas, KIND_INDEX, PW, PH, stressIndex } from './people.js';
import {
  skyColors, nightness, cloudTint, cloudSprite, sunSprite, moonSprite, strataSprite, STRATA_W, STRATA_H,
  flameSprite, boomSprite, BOOM, bellSprite, bombSprite, santaSprite, bubbleSprite, roachIcon, dirtyIcon, warnIcon, mirrored,
} from './scenery.js';
import { hash2, Painter } from './pixel.js';

const TW = TILE_W, FH = FLOOR_H;
const WORLD_W = W * TW;
const LOBBY_SET = new Set(LOBBY_FLOORS);

// 室内に描く人数の上限
const VIS_CAP = {
  office: 6, condo: 4, hotelSingle: 1, hotelTwin: 2, hotelSuite: 3, fastfood: 9, restaurant: 8, shop: 5,
  cinema: 10, partyHall: 14, security: 6, housekeeping: 6, medical: 6, recycling: 4, metro: 14, cathedral: 12,
};
const COMMERCE = new Set(['fastfood', 'restaurant', 'shop', 'cinema', 'partyHall']);
const ROOMS = new Set(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite']);
const SERVICE = new Set(['security', 'housekeeping', 'medical']);
const EVAL_TYPES = new Set(['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'fastfood', 'restaurant', 'shop', 'cinema', 'partyHall']);
const EVAL_COL = { good: '#38d8ff', fair: '#f4d020', bad: '#f03030' };

const isElev = (t) => t === 'elevator' || t === 'express';
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// 雲と星の配置（固定）
const CLOUDS = [];
for (let i = 0; i < 46; i++) {
  CLOUDS.push({ x: hash2(i, 1) * 3200 - 1000, y: -40 - hash2(i, 2) * 2700, shape: (hash2(i, 3) * 3) | 0, sp: 0.6 + hash2(i, 4) * 0.8 });
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

  resize(cssWidth, cssHeight) {
    const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
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
      this.phase(() => this.drawBuilding(view, fLo, fHi, xA, xB, dtMs));
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
      const span = 3400, k = 2;
      let x = ((c.x + drift * c.sp + 1000) % span + span) % span - 1000;
      const y = c.y;
      if (y + spr.height * k < wy0 || y > Math.min(wy1, 0) || x + spr.width * k < wx0 || x > wx1) continue;
      this.img(spr, x, y, spr.width * k, spr.height * k);
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
        for (let cx = Math.floor((t.x - 2) / TW); cx <= Math.floor((t.x + 17) / TW); cx++) {
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

  drawBuilding(view, fLo, fHi, xA, xB, dtMs) {
    const sim = this.sim, ctx = this.ctx;
    const grid = sim.grid || {};
    const objs = sim.objs;
    const night = this.night;
    const nightOn = night > 0.5 ? 1 : 0;
    const frameEsc = ((this.nowMs / 140) | 0) % 4;
    const week = (Math.floor(num(sim.day, Math.floor(this.simTime / DAY)) / 7)) % 4;

    // 1) 空きフロア
    for (let f = fLo; f <= fHi; f++) {
      const row = grid[f];
      if (!row) continue;
      const wy = -(f + 1) * FH;
      let darkFrom = -1;
      for (let x = xA; x <= xB + 1; x++) {
        const v = x <= xB ? row[x] : 0;
        const isFloor = v === -1 || (v > 0 && objs && !objs.has(v));
        if (isFloor) {
          this.img(this.tile('fl' + (x & 3), () => floorTile(x & 3)), x * TW, wy, TW, FH);
          if (darkFrom < 0) darkFrom = x;
        } else if (darkFrom >= 0) {
          if (night > 0.02) { ctx.globalAlpha = 0.5 * night; this.rect(darkFrom * TW, wy, (x - darkFrom) * TW, FH - 2, '#0a0e24'); ctx.globalAlpha = 1; }
          darkFrom = -1;
        }
      }
    }

    // 2) 施設
    const elevs = [];
    const later = this._later || (this._later = []);
    later.length = 0;
    this.visObjs = [];
    let count = 0;
    const [wx0, wy0, wx1, wy1] = this.vb;
    if (objs && typeof objs.values === 'function') {
      for (const o of objs.values()) {
        if (!o || o.type == null) continue;
        const type = o.type;
        if (isElev(type)) {
          const lo = num(o.lo, num(o.f)), hi = num(o.hi, lo);
          if (hi < fLo || lo > fHi) continue;
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
        this.visObjs.push(o);
        if (type === 'lobby') { this.guard(() => this.drawLobby(o, f, num(o.x), tw)); continue; }
        if (type === 'floor') { for (let i = 0; i < tw; i++) this.img(this.tile('fl' + ((num(o.x) + i) & 3), () => floorTile((num(o.x) + i) & 3)), x + i * TW, y, TW, FH); continue; }
        later.push(o, tw, th, x, y, top);
      }
    }
    // ロビーの上に重ねて置かれた移動手段などを後から描く
    for (let i = 0; i < later.length; i += 6) {
      const o = later[i];
      this.guard(() => this.drawFacility(o, o.type, later[i + 1], later[i + 2], later[i + 3], later[i + 4], later[i + 5], nightOn, frameEsc, week));
    }
    this.stats.objs = count;

    // 3) エレベーターのシャフト
    for (const e of elevs) this.guard(() => this.drawShaft(e, fLo, fHi));

    // 4) 外壁・屋上
    this.drawFacade(grid, fLo, fHi, xA, xB);

    // 5) カゴ
    for (const e of elevs) this.guard(() => this.drawCars(e, dtMs));
    this.elevs = elevs;
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
    const frame = type === 'escalator' ? frameEsc : 0;
    const wk = type === 'cinema' ? week : 0;
    return { occ, n, open, dirty, alt, frame, week: wk, night: nightOn };
  }

  drawFacility(o, type, tw, th, x, y, top, nightOn, frameEsc, week) {
    const v = this.facilityState(o, type, nightOn, frameEsc, week);
    const sig = v.n | (v.occ << 5) | (v.dirty << 6) | (v.open << 7) | (v.alt << 8) | (v.night << 10) | (v.week << 11) | (v.frame << 13);
    let m = this.memo.get(o);
    if (!m || m.sig !== sig || m.type !== type || m.tw !== tw || m.th !== th) {
      const key = type + '|' + tw + '|' + th + '|' + sig;
      const img = this.sprite(key, () => makeFacilitySprite(type, tw, th, v));
      let fg = null;
      if (type === 'metro') fg = this.sprite('fg' + key, () => makeFacilitySprite('metroFg', tw, th, v));
      m = { sig, type, tw, th, img, fg, v };
      this.memo.set(o, m);
    }
    const ww = tw * TW, hh = th * FH;
    this.img(m.img, x, y - top, ww, hh + top);
    if (type === 'metro') {
      this.drawTrain(x, y, ww);
      this.img(m.fg, x, y, ww, hh);
    }
    // 暗さ（夜の無人・閉店・空室）
    const night = this.night;
    let dark = 0;
    if (COMMERCE.has(type)) dark = v.open ? 0 : 0.42 + 0.3 * night;
    else if (ROOMS.has(type)) dark = !v.occ ? 0.12 + 0.66 * night : v.n === 0 ? 0.74 * night : 0;
    else if (SERVICE.has(type)) dark = v.n === 0 ? 0.55 * night : 0;
    else if (type === 'stairs' || type === 'escalator') dark = 0.3 * night;
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

  drawTrain(x, y, ww) {
    // 20 ゲーム分周期で到着 → 停車 → 発車
    const t = (((this.simTime % 20) + 20) % 20);
    let off;
    if (t < 3) off = (1 - t / 3) * (ww + 20);
    else if (t < 10) off = 0;
    else if (t < 13) off = -((t - 10) / 3) * (ww + 240);
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
    for (let f = Math.max(lo, fLo); f <= Math.min(hi, fHi); f++) {
      const stop = express ? (LOBBY_SET.has(f) || f < 0 ? 1 : 0) : 1;
      const top = f === hi ? 1 : 0, bot = f === lo ? 1 : 0;
      const key = 'sh' + w + express + stop + top + bot;
      this.img(this.tile(key, () => shaftSeg(w, express, stop, top, bot)), x, -(f + 1) * FH, w * TW, FH);
      if (q) {
        const qf = q[f];
        if (qf) {
          if (qf.up && qf.up.length) this.rect(x + 1, -(f + 1) * FH + 5, 1, 2, '#ffd040');
          if (qf.down && qf.down.length) this.rect(x + w * TW - 2, -(f + 1) * FH + 5, 1, 2, '#ff8040');
        }
      }
    }
  }

  drawCars(e, dtMs) {
    const cars = Array.isArray(e.cars) ? e.cars : [];
    const express = e.type === 'express' ? 1 : 0;
    const w = num(e.w, express ? 6 : 4);
    const x = num(e.x) * TW + 2;
    const [, wy0, , wy1] = this.vb;
    for (const car of cars) {
      if (!car) continue;
      const pos = num(car.pos, num(e.lo));
      const top = -(pos + 1) * FH + 1;
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
    const drawOne = (p, wx, fpos, facing, moving) => {
      const feet = -fpos * FH - 3;
      if (feet < wy0 || feet - PH > wy1 || wx + 4 < wx0 || wx - 4 > wx1) return;
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
    const evalFn = typeof sim.evalLevel === 'function' ? sim.evalLevel.bind(sim) : null;
    for (const o of this.visObjs || []) {
      const type = o.type;
      const tw = num(o.w, (TYPES[type] && TYPES[type].w) || 1), th = num(o.h, (TYPES[type] && TYPES[type].h) || 1);
      const x = num(o.x) * TW, y = -(num(o.f) + th) * FH;
      if (o.infested) { this.drawRoaches(o, x, y, tw * TW, ms); this.badges.push(1, x + tw * TW, y); }
      else if (o.dirty) this.badges.push(2, x + tw * TW, y);
      if (o.unreachable === true) {
        this.badges.push(3, x + tw * TW / 2, y);
        const a = 0.35 + 0.35 * Math.sin(ms / 250);
        this.strokeWorld([x, y, tw * TW, th * FH], `rgba(255,60,40,${a.toFixed(3)})`, Math.max(1, Math.round(this.dpr * 1.5)), false);
      }
      if (num(o.complaintUntil, -1) > now) bubbles.push([x + tw * TW - 15, y - 9]);
      if (evalFn && EVAL_TYPES.has(type) && o.occupied !== false) {
        let lv = null;
        try { lv = evalFn(o); } catch (e) { lv = null; }
        const c = lv && EVAL_COL[lv];
        if (c) { this.rect(x + 2, y + 2, 4, 3, '#000'); this.rect(x + 3, y + 2, 2, 2, c); }
      }
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
        for (let x = 0; x < W; x++) if (row[x]) { if (a < 0) a = x; b = x; }
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
    // 吹き出し
    const bs = bubbleSprite();
    for (const [bx, by] of bubbles) this.img(bs, bx, by - 4 + Math.round(Math.sin(ms / 250) * 1), bs.width, bs.height);
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
    const sc = Math.max(this.S, 1.6 * dpr);
    const b = this.badges;
    for (let i = 0; i < b.length; i += 3) {
      const kind = b[i];
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
    const fs = Math.round(Math.max(10, Math.min(13, 10 * this.S / dpr)) * dpr);
    ctx.font = `bold ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < q.length; i += 4) {
      const n = q[i];
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
    if (view.hover && !view.ghost) {
      const h = view.hover;
      this.strokeWorld([num(h.x) * TW, -(num(h.f) + 1) * FH, TW, FH], 'rgba(255,255,255,0.75)', Math.max(1, dpr), false);
    }
    // ゴースト
    if (view.ghost) this.drawGhost(view.ghost);
    // 爆弾のアラーム（画面の縁）
    if (sim && sim.bomb && !sim.bomb.found) {
      const a = 0.18 + 0.18 * Math.sin(ms / 200);
      const cw = this.canvas.width, ch = this.canvas.height, t = 6 * dpr;
      ctx.fillStyle = `rgba(255,30,30,${a.toFixed(3)})`;
      ctx.fillRect(0, 0, cw, t); ctx.fillRect(0, ch - t, cw, t); ctx.fillRect(0, 0, t, ch); ctx.fillRect(cw - t, 0, t, ch);
    }
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
