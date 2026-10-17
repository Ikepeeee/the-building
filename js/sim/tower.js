// The Building: シミュレーション本体（DOM 非依存）
// 契約は docs/SPEC.md の「Sim API」を参照。
import { W, MIN_F, MAX_F, DAY, START_MONEY, STAR_POP, TYPES, floorName, fmtMoney } from './constants.js';
import { Heap, makeRng } from './util.js';
import {
  SAVE_VERSION, NF, FI, LOBBY_SET, TRANSPORT, ELEV, HOTEL, COMMERCE, NOISY, TENANT, TRANSIENT,
  STAFF_KIND, SIM, STAY, VISIT_RATE, VISIT_CAP, isStopFloor,
} from './rules.js';
import { EventsMixin } from './events.js';
import { PanelMixin } from './panel.js';

const K_ELEV = 1, K_EXP = 2, K_STAIR = 3, K_ESC = 4;
const KIND_NAMES = [null, 'elev', 'express', 'stairs', 'esc'];
const dk = (d) => (d > 0 ? 'up' : 'down');
const legTo = (p) => p.legs[p.li].to;
const LUNCH = ['fastfood', 'restaurant'];
const DINNER = ['restaurant', 'fastfood'];
const LEISURE = ['shop', 'restaurant', 'fastfood', 'cinema'];
// 'sound' 通知の最小間隔（ゲーム分）
const SOUND_GAP = { cash: 30, ding: 5, complaint: 30, roach: 30 };
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class Tower {
  constructor(opts = {}) {
    this.listeners = Object.create(null);
    this.seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.reset();
  }

  reset() {
    this.rng = makeRng(this.seed);
    this.time = 6 * 60;
    this.money = START_MONEY;
    this.star = 1;
    this.tower = false;
    this.pop = 0;
    this.ledger = { income: 0, expense: 0 };
    this.yesterday = null;
    this.grid = {};
    for (let f = MIN_F; f <= MAX_F; f++) this.grid[f] = new Int32Array(W);
    this.objs = new Map();
    this.active = new Set();
    this.fires = [];
    this.bomb = null;
    this.fire = null;
    this.effects = [];
    this.santa = null;
    this.vip = null;
    this.wedding = null;
    this.nextId = 1;   // 施設 id（grid に入る）
    this.nextPid = 1;  // 人の id（保存しない）
    this.events = new Heap();
    this.flags = { vipOk: false, vipNext: 0, weddingNext: 0, nextBomb: null, nextFire: null, bombAt: null, fireAt: null, firstTenant: false };
    this.pending = new Map();
    this.promptSeq = 1;
    this._reemit = [];
    this._snd = Object.create(null);
    this.dayLog = this.newDayLog();
    this.revision = 0;
    // 統計（テスト・デバッグ用）: 到着数、救済数、ストレス合計、移動時間合計
    this.stats = { trips: 0, rescues: 0, stress: 0, tripTime: 0 };
    this.reindex();
  }

  newDayLog() { return { rent: 0, sale: 0, hotel: 0, shop: 0, inOffice: 0, inCondo: 0, out: 0, buyback: 0 }; }

  // ---- カレンダー: 0日目 = 4月1日、1ゲーム日 = 1日（365日周期）----
  get date() {
    let d = this.day % 365;
    for (let i = 0; i < 12; i++) {
      const m = (i + 3) % 12; // 4月から
      if (d < MONTH_DAYS[m]) return { month: m + 1, day: d + 1 };
      d -= MONTH_DAYS[m];
    }
    return { month: 3, day: 31 };
  }
  isXmasEve() { const d = this.date; return d.month === 12 && d.day === 24; }

  topBuiltFloor() {
    if (this._topRev === this.revision) return this._top;
    let top = 0;
    for (let f = MAX_F; f >= MIN_F; f--) { if (this.grid[f].some((c) => c !== 0)) { top = f; break; } }
    this._top = top; this._topRev = this.revision;
    return top;
  }

  updateSanta() {
    const h = (this.time % DAY) / 60;
    if (h >= 18 && this.isXmasEve()) {
      const t = (h - 18) / 6;
      this.santa = { x: -10 + t * (W + 20), f: this.topBuiltFloor() + 3 + Math.sin(t * Math.PI * 8) * 0.5 };
    } else if (this.santa) this.santa = null;
  }

  // ================= 基本 =================
  on(name, fn) { (this.listeners[name] ||= []).push(fn); return () => this.off(name, fn); }
  off(name, fn) {
    const l = this.listeners[name];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  emit(name, data) {
    const l = this.listeners[name];
    if (!l) return;
    for (const fn of l.slice()) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
  msg(text, kind = 'info', f, x) {
    const m = { text, kind };
    if (f !== undefined && f !== null) { m.f = f; m.x = x ?? W / 2; }
    this.emit('message', m);
  }
  sound(name) {
    const gap = SOUND_GAP[name] || 0;
    const last = this._snd[name];
    if (gap && last !== undefined && this.time - last < gap) return;
    this._snd[name] = this.time;
    this.emit('sound', { name });
  }
  effect(kind, f, x, dur = 30) { this.effects.push({ kind, f, x, t0: this.time, dur }); }

  get day() { return Math.floor(this.time / DAY); }
  get hour() { return Math.floor(this.time / 60) % 24; }
  get minute() { return Math.floor(this.time) % 60; }
  get weekday() { return this.day % 7; }
  isWeekend(d = this.day) { return d % 7 >= 5; }

  r() { return this.rng(); }
  rand(n) { return this.rng() * n; }
  pick(a) { return a[Math.floor(this.rng() * a.length)]; }

  cell(f, x) { const row = this.grid[f]; return row && x >= 0 && x < W ? row[x] : 0; }
  supported(f, x) {
    if (f === 0) return true;
    return f > 0 ? this.cell(f - 1, x) !== 0 : this.cell(f + 1, x) !== 0;
  }
  objAt(f, x) { const c = this.cell(f, Math.floor(x)); return c > 0 ? this.objs.get(c) || null : null; }
  // ロビーの上には移動手段（階段・エスカレーター・エレベーター）を重ねて置ける
  isLobbyCell(c) { if (c <= 0) return false; const o = this.objs.get(c); return !!o && o.type === 'lobby'; }
  isTransportCell(c) { if (c <= 0) return false; const o = this.objs.get(c); return !!o && TRANSPORT.has(o.type); }
  baseCell(f, x, except) {
    for (const o of this.byType.lobby) if (o !== except && !o.dead && o.f === f && x >= o.x && x < o.x + o.w) return o.id;
    return -1;
  }

  earn(v) { this.money += v; this.ledger.income += v; }
  spend(v) { this.money -= v; this.ledger.expense += v; }
  at(t, fn) { this.events.push(t, fn); }
  later(mins, fn) { this.events.push(this.time + mins, fn); }

  isOpen(o, h = this.hour) {
    const T = TYPES[o.type];
    if (!T || !T.open) return true;
    return h >= T.open[0] && h < T.open[1];
  }

  // ---- 評価 ----
  hasEval(o) { return !!o && (TENANT.has(o.type) || HOTEL.has(o.type) || COMMERCE.has(o.type)); }
  evalScore(o) {
    let s = o.evalN ? (o.eval * 3 + o.evalSum) / (3 + o.evalN) : o.eval;
    if (o.noisy) s += 20;
    if (o.infested) s += 40;
    return s;
  }
  evalLevel(o) {
    if (!this.hasEval(o)) return null;
    if (TENANT.has(o.type) && !o.occupied && !o.evalN) return null;
    const s = this.evalScore(o);
    return s < 20 ? 'good' : s < 45 ? 'fair' : 'bad';
  }
  evalFactor(o) {
    const l = this.evalLevel(o);
    return l === 'bad' ? 0.25 : l === 'fair' ? 0.6 : 1;
  }
  recordEval(o, p) {
    if (!o || o.dead) return;
    o.evalSum += Math.min(100, p.stress);
    o.evalN++;
    o.cWait += p.sWait;
    o.cStair += p.sStair;
  }
  recordEvalValue(o, v) {
    if (!o || o.dead) return;
    o.evalSum += v; o.evalN++; o.cWait += v / 2;
  }

  // ================= インデックス・経路グラフ =================
  reindex() {
    const byType = {};
    for (const k in TYPES) byType[k] = [];
    this.byType = byType;
    this.elevs = [];
    this.stairsAt = new Map();
    this.escAt = new Map();
    this.facs = [];
    this.hotels = [];
    this.byFloor = new Map();
    for (const o of this.objs.values()) {
      byType[o.type].push(o);
      if (ELEV.has(o.type)) { this.elevs.push(o); continue; }
      if (o.type === 'stairs' || o.type === 'escalator') {
        const m = o.type === 'stairs' ? this.stairsAt : this.escAt;
        if (!m.has(o.f)) m.set(o.f, []);
        m.get(o.f).push(o);
        continue;
      }
      if (o.type !== 'lobby') this.facs.push(o);
      if (HOTEL.has(o.type)) this.hotels.push(o);
      for (let r = 0; r < o.h; r++) {
        const f = o.f + r;
        if (!this.byFloor.has(f)) this.byFloor.set(f, []);
        this.byFloor.get(f).push(o);
      }
    }
    // 騒音: マンション・ホテルの同じ階 4 マス以内に飲食・映画館・パーティーホール
    for (const o of this.facs) {
      if (o.type !== 'condo' && !HOTEL.has(o.type)) continue;
      o.noisy = false;
      for (const n of this.byFloor.get(o.f) || []) {
        if (!NOISY.has(n.type)) continue;
        const gap = Math.max(n.x - (o.x + o.w), o.x - (n.x + n.w));
        if (gap <= 4) { o.noisy = true; break; }
      }
    }
    // 出入口: 1F のロビーと地下鉄駅（最上段）
    this.entrances = [];
    for (const o of byType.lobby) if (o.f === 0) this.entrances.push({ f: 0, x0: o.x, x1: o.x + o.w, obj: o });
    for (const o of byType.metro) this.entrances.push({ f: o.f + o.h - 1, x0: o.x, x1: o.x + o.w, obj: o, metro: true });
    this.buildGraph();
    // 到達不能フラグ（どの出入口からもその階へ行けない）
    for (const o of this.facs) o.unreachable = o.type !== 'metro' && this.entranceDist(o.f) === Infinity;
    for (const o of byType.lobby) o.unreachable = false;
    this.revision++;
  }

  buildGraph() {
    const cost = new Float64Array(NF * NF).fill(Infinity);
    const kind = new Uint8Array(NF * NF);
    const C = SIM.COST;
    const set = (a, b, c, k) => {
      const i = FI(a) * NF + FI(b);
      if (c < cost[i]) { cost[i] = c; kind[i] = k; }
    };
    for (const e of this.elevs) {
      const st = e.stops, exp = e.type === 'express';
      const base = exp ? C.expBase : C.elevBase, per = exp ? C.expPer : C.elevPer, k = exp ? K_EXP : K_ELEV;
      for (let i = 0; i < st.length; i++) {
        for (let j = i + 1; j < st.length; j++) {
          const c = base + per * (st[j] - st[i]);
          set(st[i], st[j], c, k); set(st[j], st[i], c, k);
        }
      }
    }
    for (const [f] of this.stairsAt) { set(f, f + 1, C.stairs, K_STAIR); set(f + 1, f, C.stairs, K_STAIR); }
    for (const [f] of this.escAt) { set(f, f + 1, C.esc, K_ESC); set(f + 1, f, C.esc, K_ESC); }
    const adj = [];
    for (let u = 0; u < NF; u++) {
      const a = [];
      for (let v = 0; v < NF; v++) if (cost[u * NF + v] < Infinity) a.push(v);
      adj.push(Int16Array.from(a));
    }
    this.gCost = cost; this.gKind = kind; this.adj = adj;
    this.rcache = new Map();
  }

  routeFrom(a) {
    let r = this.rcache.get(a);
    if (r) return r;
    const dist = new Float64Array(NF).fill(Infinity);
    const prev = new Int16Array(NF).fill(-1);
    const done = new Uint8Array(NF);
    const cost = this.gCost, adj = this.adj;
    dist[FI(a)] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < NF; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      const row = adj[u], base = u * NF;
      for (let k = 0; k < row.length; k++) {
        const v = row[k], d = best + cost[base + v];
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    r = { dist, prev, legs: new Map() };
    this.rcache.set(a, r);
    return r;
  }
  dist(a, b) { return a === b ? 0 : this.routeFrom(a).dist[FI(b)]; }

  route(a, b) {
    if (a === b) return [];
    const r = this.routeFrom(a);
    if (r.dist[FI(b)] === Infinity) return null;
    let legs = r.legs.get(b);
    if (legs) return legs;
    legs = [];
    for (let f = b; f !== a;) {
      const u = r.prev[FI(f)] + MIN_F;
      legs.push({ kind: KIND_NAMES[this.gKind[FI(u) * NF + FI(f)]], from: u, to: f });
      f = u;
    }
    legs.reverse();
    r.legs.set(b, legs);
    return legs;
  }

  // 出入口
  pickEntranceTo(f) {
    let best = null, bd = Infinity;
    for (const e of this.entrances) {
      const d = this.dist(e.f, f) + this.rand(0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  pickExitFrom(f) {
    let best = null, bd = Infinity;
    for (const e of this.entrances) {
      const d = this.dist(f, e.f) + this.rand(0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  entranceDist(f) {
    let bd = Infinity;
    for (const e of this.entrances) bd = Math.min(bd, this.dist(e.f, f));
    return bd;
  }
  pickVisitorEntrance(f) {
    const ok = this.entrances.filter((e) => this.dist(e.f, f) < Infinity);
    if (!ok.length) return null;
    const metro = ok.filter((e) => e.metro), lobby = ok.filter((e) => !e.metro);
    if (metro.length && lobby.length) return this.pick(this.r() < 0.35 ? metro : lobby);
    return this.pick(ok);
  }
  lobbyEntrance() {
    const l = this.entrances.filter((e) => !e.metro);
    return l.length ? this.pick(l) : null;
  }

  // ================= 建設 =================
  check(tool, p) {
    const r = this._plan(tool, p || {});
    return { ok: r.ok, reason: r.reason, cost: r.cost, ghost: r.ghost };
  }

  build(tool, p) {
    const r = this._plan(tool, p || {});
    if (!r.ok) { this.sound('error'); return { ok: false, reason: r.reason, cost: r.cost, ghost: r.ghost }; }
    if (r.cost) this.spend(r.cost);
    r.apply();
    this.sound(tool === 'bulldoze' ? 'bulldoze' : 'build');
    this.checkStar();
    return { ok: true, reason: '', cost: r.cost, ghost: r.ghost };
  }

  _plan(tool, p) {
    if (tool === 'bulldoze') return this._planBulldoze(p);
    const T = TYPES[tool];
    if (!T) return { ok: false, reason: '不明なツールです', cost: 0, ghost: null };
    let r;
    if (T.drag === 'v') r = this._planElevator(tool, T, p);
    else if (T.drag === 'h') r = this._planHoriz(tool, T, p);
    else r = this._planFacility(tool, T, p);
    if (r.ok && T.star > this.star) return { ...r, ok: false, reason: `★${T.star}で解放されます` };
    if (r.ok && r.cost > this.money) return { ...r, ok: false, reason: `資金が足りません（${fmtMoney(r.cost)}）` };
    return r;
  }

  _planHoriz(tool, T, p) {
    const f = p.f | 0;
    const xa = Math.floor(p.x), xb = Math.floor(p.x2 ?? p.x);
    const x1 = Math.max(0, Math.min(xa, xb)), x2 = Math.min(W - 1, Math.max(xa, xb));
    const w = x2 - x1 + 1;
    const ghost = { x: x1, w, f, h: 1 };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (f < MIN_F || f > MAX_F) return fail('建設範囲の外です');
    if (w < 1) return fail('建設範囲の外です');
    if (tool === 'lobby') {
      if (!LOBBY_SET.has(f)) return fail('ロビーは1Fと15F・30F…90Fにのみ置けます');
      if (w < (T.minW || 1)) return fail(`ロビーは幅${T.minW}マス以上必要です`);
      let fresh = 0;
      for (let x = x1; x <= x2; x++) {
        const c = this.cell(f, x);
        if (c > 0) { if (this.isTransportCell(c)) continue; return fail('他の施設と重なっています'); }
        if (c === 0) {
          if (!this.supported(f, x)) return fail(f < 0 ? '上の階に支えがありません' : '下の階に支えがありません');
          fresh++;
        }
      }
      const cost = T.costPerTile * w + fresh * TYPES.floor.costPerTile;
      return { ok: true, reason: '', cost, ghost, apply: () => this._place('lobby', f, x1, w, 1) };
    }
    // floor: 支えのある空マスだけに張る
    const cells = [];
    let unsupported = 0;
    for (let x = x1; x <= x2; x++) {
      if (this.cell(f, x) !== 0) continue;
      if (this.supported(f, x)) cells.push(x); else unsupported++;
    }
    if (!cells.length) return fail(unsupported ? (f < 0 ? '上の階に支えがありません' : '下の階に支えがありません') : 'すでにフロアがあります');
    const cost = cells.length * T.costPerTile;
    return {
      ok: true, reason: '', cost, ghost,
      apply: () => { for (const x of cells) this.grid[f][x] = -1; this.revision++; },
    };
  }

  _planFacility(tool, T, p) {
    const w = T.w, h = T.h || 1, f = p.f | 0, x = Math.floor(p.x);
    const ghost = { x, w, f, h };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (x < 0 || x + w > W || f < MIN_F || f + h - 1 > MAX_F) return fail('建設範囲の外です');
    const top = f + h - 1;
    if (T.only === 'top' && f !== MAX_F) return fail(`${floorName(MAX_F)}にのみ建設できます`);
    if (T.only === 'basement' && top >= 0) return fail('地下にのみ建設できます');
    if (T.only === 'aboveGround' && f < 0) return fail('地上にのみ建設できます');
    if (T.only === 'lobbyFloor' && !LOBBY_SET.has(f)) return fail('ロビー階にのみ建設できます');
    if (tool === 'stairs' || tool === 'escalator') {
      if (f + 1 > MAX_F) return fail('上の階がありません');
      for (let xi = x; xi < x + w; xi++) if (this.cell(f + 1, xi) === 0) return fail('上の階にもフロアが必要です');
    }
    let fresh = 0;
    for (let r = 0; r < h; r++) {
      for (let xi = x; xi < x + w; xi++) {
        const c = this.cell(f + r, xi);
        if (c > 0) { if (TRANSPORT.has(tool) && this.isLobbyCell(c)) continue; return fail('他の施設と重なっています'); }
        if (c === 0) fresh++;
      }
    }
    if (f > 0) {
      for (let xi = x; xi < x + w; xi++) if (this.cell(f, xi) === 0 && !this.supported(f, xi)) return fail('下の階に支えがありません');
    } else if (top < 0) {
      for (let xi = x; xi < x + w; xi++) if (this.cell(top, xi) === 0 && !this.supported(top, xi)) return fail('上の階に支えがありません');
    }
    const cost = T.cost + fresh * TYPES.floor.costPerTile;
    return { ok: true, reason: '', cost, ghost, apply: () => this._place(tool, f, x, w, h) };
  }

  _planElevator(tool, T, p) {
    const fa = p.f | 0, fb = (p.f2 ?? p.f) | 0, x = Math.floor(p.x), w = T.w;
    const lo = Math.max(MIN_F, Math.min(fa, fb)), hi = Math.min(MAX_F, Math.max(fa, fb));
    const ghost = { x, w, lo, hi };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (x < 0 || x + w > W) return fail('建設範囲の外です');
    if (hi - lo + 1 < 2) return fail('上下にドラッグして2フロア以上にしてください');
    if (hi - lo + 1 > T.maxSpan) return fail(`最大${T.maxSpan}フロアまでです`);
    let fresh = 0;
    for (let f = lo; f <= hi; f++) {
      for (let xi = x; xi < x + w; xi++) {
        const c = this.cell(f, xi);
        if (c > 0) { if (this.isLobbyCell(c)) continue; return fail('他の施設と重なっています'); }
        if (c === 0) fresh++;
      }
    }
    for (let xi = x; xi < x + w; xi++) {
      if (lo > 0 && this.cell(lo, xi) === 0 && !this.supported(lo, xi)) return fail('下の階に支えがありません');
      if (hi < 0 && this.cell(hi, xi) === 0 && !this.supported(hi, xi)) return fail('上の階に支えがありません');
    }
    for (let f = lo; f <= hi; f++) if (!this.rowBuiltOutside(f, x, w)) return fail(`${floorName(f)}にフロアがありません（空中には通せません）`);
    let stops = 0;
    for (let f = lo; f <= hi; f++) if (isStopFloor(tool, f)) stops++;
    if (stops < 2) return fail('停止階（ロビー階・地下）が2つ以上必要です');
    const cost = T.cost + fresh * TYPES.floor.costPerTile;
    return { ok: true, reason: '', cost, ghost, apply: () => this._placeElevator(tool, x, lo, hi) };
  }

  _planBulldoze(p) {
    const f = p.f | 0;
    const xa = Math.floor(p.x), xb = Math.floor(p.x2 ?? p.x);
    const x1 = Math.max(0, Math.min(xa, xb)), x2 = Math.min(W - 1, Math.max(xa, xb));
    let ghost = { x: x1, w: x2 - x1 + 1, f, h: 1 };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (f < MIN_F || f > MAX_F) return fail('範囲の外です');
    const ids = new Set();
    for (let x = x1; x <= x2; x++) { const c = this.cell(f, x); if (c > 0) ids.add(c); }
    if (ids.size) {
      const list = [...ids].map((id) => this.objs.get(id)).filter(Boolean);
      if (list.length === 1 && x1 === x2) {
        const o = list[0];
        ghost = ELEV.has(o.type) ? { x: o.x, w: o.w, lo: o.lo, hi: o.hi } : { x: o.x, w: o.w, f: o.f, h: o.h };
      }
      return { ok: true, reason: '', cost: 0, ghost, apply: () => { for (const o of list) if (!o.dead) this.removeObj(o); } };
    }
    const cells = [];
    let blocked = 0, empty = 0;
    for (let x = x1; x <= x2; x++) {
      if (this.cell(f, x) !== -1) { empty++; continue; }
      if (this.canRemoveFloor(f, x)) cells.push(x); else blocked++;
    }
    if (!cells.length) return fail(blocked ? '支えている上下の構造を先に撤去してください' : '何もありません');
    return {
      ok: true, reason: '', cost: 0, ghost,
      apply: () => {
        for (const x of cells) if (this.canRemoveFloor(f, x)) this.grid[f][x] = 0;
        this.revision++;
      },
    };
  }

  canRemoveFloor(f, x) {
    if (this.cell(f, x) !== -1) return false;
    if (f >= 0 && this.cell(f + 1, x) !== 0) return false;
    if (f <= 0 && this.cell(f - 1, x) !== 0) return false;
    // 下の階の階段・エスカレーターがこのフロアに通じている
    const below = this.cell(f - 1, x);
    if (below > 0) { const o = this.objs.get(below); if (o && (o.type === 'stairs' || o.type === 'escalator')) return false; }
    return true;
  }

  makeObj(type, f, x, w, h, id) {
    const o = {
      id: id ?? this.nextId++, type, f, x, w, h,
      occupied: !(TENANT.has(type) || HOTEL.has(type)),
      inCount: 0, dead: false,
      eval: 0, evalSum: 0, evalN: 0, badDays: 0, cWait: 0, cStair: 0,
      members: [], complaintUntil: 0, complaint: '', burnt: 0, burning: false,
      salesToday: 0, custToday: 0, salesYesterday: 0, custYesterday: 0, noisy: false,
    };
    if (HOTEL.has(type)) Object.assign(o, { dirty: false, infested: false, dirtySince: null, cleaner: null, checkedIn: 0, cleanFail: -1e9 });
    this.objs.set(o.id, o);
    if (o.id >= this.nextId) this.nextId = o.id + 1;
    return o;
  }

  _place(type, f, x, w, h) {
    const o = this.makeObj(type, f, x, w, h);
    for (let r = 0; r < h; r++) {
      for (let xi = x; xi < x + w; xi++) if (type !== 'lobby' || this.grid[f + r][xi] <= 0) this.grid[f + r][xi] = o.id;
    }
    if (STAFF_KIND[type]) this.createStaff(o);
    this.reindex();
    return o;
  }

  _placeElevator(type, x, lo, hi, id, carPos) {
    const T = TYPES[type];
    const o = this.makeObj(type, lo, x, T.w, hi - lo + 1, id);
    o.lo = lo; o.hi = hi; o.q = {};
    o.cap = T.cap; o.speed = SIM.SPEED[type];
    this.initElevator(o);
    o.cars = (carPos && carPos.length ? carPos : [o.sLo]).map((f) => this.newCar(o, f));
    for (let f = lo; f <= hi; f++) for (let xi = x; xi < x + T.w; xi++) this.grid[f][xi] = o.id;
    this.reindex();
    return o;
  }

  // 空中（その階にほかの構造が何もない）にはシャフトを通せない
  rowBuiltOutside(f, x, w) {
    const row = this.grid[f];
    if (!row) return false;
    for (let i = 0; i < W; i++) if ((i < x || i >= x + w) && row[i] !== 0) return true;
    return false;
  }

  initElevator(e) {
    e.f = e.lo; e.h = e.hi - e.lo + 1;
    e.stops = [];
    e.isStop = new Uint8Array(NF);
    for (let f = e.lo; f <= e.hi; f++) if (isStopFloor(e.type, f)) { e.stops.push(f); e.isStop[FI(f)] = 1; }
    e.sLo = e.stops[0]; e.sHi = e.stops[e.stops.length - 1];
    if (!e.qn) { e.qn = new Int32Array(NF); e.waitN = 0; }
    if (!e.wSum) { e.wSum = new Float64Array(12); e.wN = new Int32Array(12); e.wb = 0; e.avgWait = 0; e.peakWait = 0; e.peakWaitYesterday = 0; e.peakWaitRecent = 0; }
  }

  newCar(e, f) {
    let pos = Math.max(e.sLo, Math.min(e.sHi, Math.round(f)));
    if (!e.isStop[FI(pos)]) pos = e.sLo;
    return { pos, dir: 0, state: 'idle', pass: [], timer: 0, target: null, drop: new Int16Array(NF) };
  }

  nearestStop(e, f) {
    let best = e.sLo, bd = Infinity;
    for (const s of e.stops) { const d = Math.abs(s - f); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  planExtend(e, dir) {
    const T = TYPES[e.type];
    const f = dir > 0 ? e.hi + 1 : e.lo - 1;
    const fail = (reason) => ({ ok: false, reason, cost: 0 });
    if (f > MAX_F || f < MIN_F) return fail('これ以上延長できません');
    if (e.hi - e.lo + 2 > T.maxSpan) return fail(`最大${T.maxSpan}フロアまでです`);
    if (!this.rowBuiltOutside(f, e.x, e.w)) return fail(`${floorName(f)}にフロアがありません（空中には延長できません）`);
    let fresh = 0;
    for (let xi = e.x; xi < e.x + e.w; xi++) {
      const c = this.cell(f, xi);
      if (c > 0 && !this.isLobbyCell(c)) return fail('他の施設と重なっています');
      if (c === 0) fresh++;
      if (dir < 0 && f > 0 && c === 0 && !this.supported(f, xi)) return fail('下の階に支えがありません');
    }
    const cost = SIM.EXTEND_COST[e.type] + fresh * TYPES.floor.costPerTile;
    if (cost > this.money) return { ok: false, reason: '資金が足りません', cost };
    return { ok: true, reason: '', cost, f };
  }

  extendElevator(e, dir) {
    const r = this.planExtend(e, dir);
    if (!r.ok) return r;
    this.spend(r.cost);
    for (let xi = e.x; xi < e.x + e.w; xi++) this.grid[r.f][xi] = e.id;
    if (dir > 0) e.hi = r.f; else e.lo = r.f;
    this.initElevator(e);
    this.reindex();
    this.sound('build');
    return { ok: true, reason: '', cost: r.cost };
  }

  addCar(e) {
    const T = TYPES[e.type];
    if (e.cars.length >= T.maxCars) return { ok: false, reason: `カゴは最大${T.maxCars}台です` };
    if (this.money < T.carCost) return { ok: false, reason: '資金が足りません' };
    this.spend(T.carCost);
    // 既存のカゴから最も遠い停止階に置く
    let best = e.sLo, bd = -1;
    for (const s of e.stops) {
      let d = Infinity;
      for (const c of e.cars) d = Math.min(d, Math.abs(c.pos - s));
      if (d > bd) { bd = d; best = s; }
    }
    e.cars.push(this.newCar(e, best));
    this.sound('build');
    return { ok: true, reason: '', cost: T.carCost };
  }

  removeCar(e) {
    if (e.cars.length <= 1) return { ok: false, reason: 'カゴは最低1台必要です' };
    let ci = 0;
    e.cars.forEach((c, i) => { if (c.pass.length < e.cars[ci].pass.length) ci = i; });
    const c = e.cars.splice(ci, 1)[0];
    const f = this.nearestStop(e, Math.round(c.pos));
    for (const p of c.pass) this.dropOff(e, p, f);
    c.pass = [];
    this.sound('bulldoze');
    return { ok: true, reason: '' };
  }

  removeObj(o) {
    if (!o || o.dead) return;
    o.dead = true;
    const lo = ELEV.has(o.type) ? o.lo : o.f, hi = ELEV.has(o.type) ? o.hi : o.f + o.h - 1;
    const tr = TRANSPORT.has(o.type);
    for (let f = lo; f <= hi; f++) {
      for (let xi = o.x; xi < o.x + o.w; xi++) if (this.grid[f][xi] === o.id) this.grid[f][xi] = tr ? this.baseCell(f, xi, o) : -1;
    }
    for (const p of o.members.slice()) this.purge(p, false);
    o.members = [];
    o.occupied = false;
    this.objs.delete(o.id);
    if (this.fire && this.fire.burning.has(o)) { this.fire.burning.delete(o); this.updateFires(); }
    this.reindex();
    if (ELEV.has(o.type)) {
      for (const c of o.cars) {
        const f = Math.max(o.lo, Math.min(o.hi, Math.round(c.pos)));
        const pass = c.pass; c.pass = [];
        for (const p of pass) this.dropOff(o, p, f);
      }
      for (const k in o.q) {
        for (const d of ['up', 'down']) {
          const line = o.q[k][d]; o.q[k][d] = [];
          for (const p of line) { p.elev = null; p.state = 'walk'; this.reroute(p); }
        }
      }
      o.qn.fill(0); o.waitN = 0;
    }
    this.recalcPop();
  }

  dropOff(e, p, f) {
    p.f = f; p.x = e.x + e.w / 2;
    p.car = null; p.elev = null; p.state = 'walk';
    this.reroute(p);
  }

  // ================= 人口・★ =================
  recalcPop() {
    let pop = 0;
    for (const o of this.byType.office) if (o.occupied) pop += TYPES.office.cap;
    for (const o of this.byType.condo) if (o.occupied) pop += TYPES.condo.cap;
    for (const o of this.hotels) if (o.occupied) pop += o.members.length;
    this.pop = pop;
    this.checkStar();
  }

  starReqs(n) {
    const c = (t) => this.byType[t].length > 0;
    const popReq = (k) => ({ label: `人口 ${STAR_POP[k].toLocaleString('en-US')}人（現在 ${this.pop.toLocaleString('en-US')}人）`, done: this.pop >= STAR_POP[k] });
    switch (n) {
      case 2: return [popReq(2)];
      case 3: return [popReq(3), { label: '警備室', done: c('security') }];
      case 4: return [popReq(4), { label: '医療センター', done: c('medical') }, { label: 'リサイクルセンター', done: c('recycling') },
        { label: 'VIPの高評価', done: this.flags.vipOk }];
      case 5: return [popReq(5), { label: '地下鉄駅', done: c('metro') }];
      case 6: return [{ label: '100Fの大聖堂', done: c('cathedral') }, { label: '大聖堂での結婚式', done: this.tower }];
      default: return [];
    }
  }

  checkStar() {
    while (this.star < 5 && this.starReqs(this.star + 1).every((r) => r.done)) {
      this.star++;
      const unlocked = Object.values(TYPES).filter((t) => t.star === this.star).map((t) => t.name);
      this.msg(`★${this.star} に昇格しました！${unlocked.length ? ` ${unlocked.join('・')}が解放されます` : ''}`, 'star');
      this.emit('star', { star: this.star });
      this.sound('fanfare');
      if (this.star === 2) {
        const d = this.day;
        if (this.flags.nextBomb === null) this.flags.nextBomb = d + 10 + Math.floor(this.rand(10));
        if (this.flags.nextFire === null) this.flags.nextFire = d + 14 + Math.floor(this.rand(10));
      }
    }
  }

  starProgress() {
    if (this.tower) return { star: this.star, next: null, reqs: [] };
    if (this.star >= 5) return { star: 5, next: 'TOWER', reqs: this.starReqs(6) };
    return { star: this.star, next: this.star + 1, reqs: this.starReqs(this.star + 1) };
  }

  // ================= 人 =================
  newPerson(kind, home) {
    return {
      id: this.nextPid++, kind, home, state: 'out', stress: 0, f: 0, x: 0,
      legs: null, li: 0, tx: 0, dest: null, loc: null, elev: null, car: null, legObj: null,
      stairT: 0, stairDur: 1, esc: false, waitT: 0, tripT: 0, sWait: 0, sStair: 0,
      task: null, patrol: null, checked: false,
    };
  }

  spotIn(o) { return o.x + 0.5 + this.rand(Math.max(0, o.w - 1)); }

  spawnAt(p, ent) {
    p.f = ent.f; p.x = ent.x0 + 0.5 + this.rand(Math.max(0, ent.x1 - ent.x0 - 1));
    p.state = 'walk'; p.loc = null;
    this.active.add(p);
  }

  startTrip(p, f, x, cb) {
    const legs = this.route(p.f, f);
    if (!legs) return false;
    if (p.state === 'wait' || p.state === 'ride') this.detach(p);
    if (p.state === 'in' && p.loc) p.loc.inCount--;
    p.loc = null;
    p.stress = 0; p.sWait = 0; p.sStair = 0; p.tripT = 0; p.patrol = null;
    p.legs = legs; p.li = 0; p.dest = { f, x, cb };
    p.state = 'walk';
    this.active.add(p);
    this.aimNext(p);
    return true;
  }

  reroute(p, depth = 0) {
    if (!p.dest || depth > 3) { this.rescue(p); return; }
    const legs = this.route(p.f, p.dest.f);
    if (!legs) { this.rescue(p); return; }
    p.legs = legs; p.li = 0; p.state = 'walk';
    this.active.add(p);
    this.aimNext(p, depth + 1);
  }

  aimNext(p, depth = 0) {
    if (p.li >= p.legs.length) { p.legObj = null; p.tx = p.dest.x; return; }
    const leg = p.legs[p.li];
    if (leg.kind === 'elev' || leg.kind === 'express') {
      const e = this.pickElevator(leg, p.x);
      if (!e) { this.reroute(p, depth); return; }
      p.legObj = e;
      p.tx = p.x < e.x + e.w / 2 ? e.x - 0.5 : e.x + e.w + 0.5;
    } else {
      const s = this.pickStairs(leg.kind, Math.min(leg.from, leg.to), p.x);
      if (!s) { this.reroute(p, depth); return; }
      p.legObj = s;
      p.tx = leg.to > leg.from ? s.x + 0.5 : s.x + s.w - 0.5;
    }
  }

  pickElevator(leg, x) {
    const type = leg.kind === 'express' ? 'express' : 'elevator';
    const a = leg.from, b = leg.to, k = dk(b - a);
    let best = null, bs = Infinity;
    for (const e of this.byType[type]) {
      if (!e.isStop[FI(a)] || !e.isStop[FI(b)] || a < e.lo || a > e.hi || b < e.lo || b > e.hi) continue;
      const q = e.q[a];
      const s = Math.abs(e.x + e.w / 2 - x) * 0.05 + (q ? q[k].length : 0) / e.cars.length;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  pickStairs(kind, f, x) {
    const list = (kind === 'esc' ? this.escAt : this.stairsAt).get(f);
    if (!list) return null;
    let best = null, bd = Infinity;
    for (const s of list) {
      const d = Math.abs(s.x + s.w / 2 - x);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  updatePerson(p, dt) {
    p.tripT += dt;
    if (p.tripT > SIM.TRIP_LIMIT && !p.patrol) { this.rescue(p); return; }
    switch (p.state) {
      case 'walk': {
        if (p.patrol && this.time >= p.patrol.until) { this.endPatrol(p); return; }
        const d = p.tx - p.x, s = SIM.WALK * dt;
        if (d <= s && d >= -s) { p.x = p.tx; this.reached(p); } else p.x += d > 0 ? s : -s;
        break;
      }
      case 'wait':
        p.waitT += dt;
        if (p.waitT > SIM.WAIT_GRACE) { const inc = SIM.WAIT_STRESS * dt; p.stress += inc; p.sWait += inc; }
        break;
      case 'stairs':
        p.stairT += dt;
        if (p.stairT >= p.stairDur) {
          const leg = p.legs[p.li], s = p.legObj, up = leg.to > leg.from;
          p.f = leg.to;
          p.x = up ? s.x + s.w - 0.5 : s.x + 0.5;
          p.li++;
          p.state = 'walk';
          this.aimNext(p);
        }
        break;
      default: break;
    }
  }

  reached(p) {
    if (p.patrol) {
      const pt = p.patrol;
      p.tx = Math.abs(p.x - pt.x0) < 0.6 ? pt.x1 : pt.x0;
      return;
    }
    if (!p.legs) { this.leave(p); return; }
    if (p.li >= p.legs.length) { this.finishTrip(p); return; }
    const leg = p.legs[p.li], o = p.legObj;
    if (!o || o.dead) { this.aimNext(p); return; }
    if (ELEV.has(o.type)) {
      const q = o.q[leg.from] || (o.q[leg.from] = { up: [], down: [] });
      q[dk(leg.to - leg.from)].push(p);
      o.qn[FI(leg.from)]++;
      o.waitN++;
      p.state = 'wait'; p.waitT = 0; p.elev = o;
    } else {
      p.esc = o.type === 'escalator';
      p.state = 'stairs'; p.stairT = 0;
      p.stairDur = p.esc ? SIM.ESC_TIME : SIM.STAIR_TIME;
      const inc = p.esc ? SIM.ESC_STRESS : SIM.STAIR_STRESS;
      p.stress += inc; p.sStair += inc;
    }
  }

  finishTrip(p) {
    const d = p.dest;
    this.stats.trips++; this.stats.stress += p.stress; this.stats.tripTime += p.tripT;
    p.legs = null; p.dest = null; p.legObj = null;
    p.state = 'arrived';
    if (d && d.cb) d.cb(p);
    if (p.state === 'arrived') this.leave(p);
  }

  // 移動を続けられない人を目的地へ送る（リーク防止。ストレスは高く記録される）
  rescue(p) {
    this.detach(p);
    if (p.patrol) { this.endPatrol(p); return; }
    const d = p.dest;
    if (!d) { this.leave(p); return; }
    this.stats.rescues++;
    p.f = d.f; p.x = d.x;
    p.stress = Math.max(p.stress, 80);
    this.finishTrip(p);
  }

  detach(p) {
    if (p.state === 'wait' && p.elev) {
      const e = p.elev, q = e.q[p.f];
      if (q) {
        for (const k of ['up', 'down']) {
          const i = q[k].indexOf(p);
          if (i >= 0) { q[k].splice(i, 1); e.qn[FI(p.f)]--; e.waitN--; break; }
        }
      }
    } else if (p.state === 'ride' && p.car) {
      const c = p.car, i = c.pass.indexOf(p);
      if (i >= 0) {
        c.pass.splice(i, 1);
        const t = FI(legTo(p));
        if (c.drop[t] > 0) c.drop[t]--;
      }
    }
    p.elev = null; p.car = null;
  }

  settle(p, o) {
    this.active.delete(p);
    p.legs = null; p.dest = null; p.patrol = null;
    p.state = 'in'; p.loc = o; o.inCount++;
  }

  // 建物から出る（または消える）
  leave(p, keep = !TRANSIENT.has(p.kind)) {
    this.detach(p);
    if (p.task) this.releaseTask(p);
    if (p.state === 'in' && p.loc) p.loc.inCount--;
    this.active.delete(p);
    p.loc = null; p.legs = null; p.dest = null; p.patrol = null;
    p.state = keep ? 'out' : 'gone';
  }
  purge(p, keep = false) { this.leave(p, keep); }

  startPatrol(p, minutes, cb, x0, x1) {
    if (x0 === undefined) {
      const row = this.grid[p.f];
      let a = -1, b = -1;
      for (let x = 0; x < W; x++) if (row[x] !== 0) { if (a < 0) a = x; b = x; }
      x0 = a < 0 ? p.x : a + 0.5; x1 = b < 0 ? p.x : b + 0.5;
    }
    p.legs = null; p.dest = null; p.tripT = 0;
    p.patrol = { until: this.time + minutes, cb, x0, x1 };
    p.tx = Math.abs(p.x - x0) > Math.abs(p.x - x1) ? x0 : x1;
    p.state = 'walk';
    this.active.add(p);
  }
  endPatrol(p) {
    const cb = p.patrol.cb;
    p.patrol = null;
    p.state = 'arrived';
    cb(p);
    if (p.state === 'arrived') this.goHome(p);
  }

  drawPos(p) {
    if (p.state === 'walk' || p.state === 'wait') return { x: p.x, f: p.f };
    if (p.state === 'stairs' && p.legs && p.legObj) {
      const leg = p.legs[p.li], s = p.legObj, up = leg.to > leg.from;
      const t = Math.min(1, p.stairT / p.stairDur);
      const xa = up ? s.x + 0.5 : s.x + s.w - 0.5, xb = up ? s.x + s.w - 0.5 : s.x + 0.5;
      return { x: xa + (xb - xa) * t, f: leg.from + (leg.to - leg.from) * t };
    }
    return null;
  }

  // ---- 行動 ----
  exitTrip(p, cb) {
    const ent = this.pickExitFrom(p.f);
    if (!ent) return false;
    return this.startTrip(p, ent.f, ent.x0 + 0.5 + this.rand(Math.max(0, ent.x1 - ent.x0 - 1)), cb);
  }

  enterBuilding(p) {
    const h = p.home;
    if (p.state !== 'out' || !h || h.dead) return;
    if ((TENANT.has(h.type) || HOTEL.has(h.type)) && !h.occupied) return;
    const ent = this.pickEntranceTo(h.f);
    if (!ent || this.dist(ent.f, h.f) === Infinity) { this.recordEvalValue(h, 100); return; }
    this.spawnAt(p, ent);
    if (!this.startTrip(p, h.f, this.spotIn(h), (pp) => this.arriveHome(pp))) {
      this.recordEvalValue(h, 100);
      this.leave(p);
    }
  }

  arriveHome(p) {
    const h = p.home;
    if (!h || h.dead) return; // finishTrip が leave する
    this.recordEval(h, p);
    this.settle(p, h);
    if (HOTEL.has(h.type) && !p.checked) { p.checked = true; h.checkedIn++; }
  }

  leaveBuilding(p, onExit = null, tries = 0) {
    if (p.state === 'gone' || p.state === 'out') { if (onExit) onExit(p); return; }
    if (p.state !== 'in') {
      if (tries < 30) this.later(10, () => this.leaveBuilding(p, onExit, tries + 1));
      else { this.leave(p); if (onExit) onExit(p); }
      return;
    }
    const home = TRANSIENT.has(p.kind) ? null : p.home;
    const ok = this.exitTrip(p, (pp) => {
      if (home) this.recordEval(home, pp);
      this.leave(pp);
      if (onExit) onExit(pp);
    });
    if (!ok) {
      if (home) this.recordEvalValue(home, 90);
      this.leave(p);
      if (onExit) onExit(p);
    }
  }

  goBack(p) {
    const h = p.home;
    const homeOk = h && !h.dead && !TRANSIENT.has(p.kind) && (!(TENANT.has(h.type) || HOTEL.has(h.type)) || h.occupied);
    if (homeOk && this.startTrip(p, h.f, this.spotIn(h), (pp) => this.arriveHome(pp))) return;
    if (!this.exitTrip(p, (pp) => this.leave(pp))) this.leave(p);
  }

  goHome(p) {
    const h = p.home;
    if (!h || h.dead) { this.leave(p, false); return; }
    if (p.state === 'in' && p.loc === h) return;
    if (!this.startTrip(p, h.f, this.spotIn(h), (pp) => this.settle(pp, h))) {
      this.detach(p);
      if (p.state === 'in' && p.loc) p.loc.inCount--;
      p.f = h.f; p.x = this.spotIn(h);
      this.settle(p, h);
    }
  }

  outing(p, types) {
    if (p.state !== 'in') return;
    const r = this.routeFrom(p.f);
    let best = null, bc = Infinity;
    for (const t of types) {
      for (const o of this.byType[t]) {
        if (o.burning || !this.isOpen(o)) continue;
        const d = r.dist[FI(o.f)];
        if (d === Infinity) continue;
        const c = d + this.rand(6) + Math.abs(o.x - p.x) * 0.02;
        if (c < bc) { bc = c; best = o; }
      }
    }
    if (!best) return;
    const o = best;
    this.startTrip(p, o.f, this.spotIn(o), (pp) => this.atShop(pp, o));
  }

  visit(o) {
    if (o.dead || !this.isOpen(o) || o.burning) return;
    const ent = this.pickVisitorEntrance(o.f);
    if (!ent) return;
    const p = this.newPerson('visitor', null);
    this.spawnAt(p, ent);
    if (!this.startTrip(p, o.f, this.spotIn(o), (pp) => this.atShop(pp, o))) this.leave(p);
  }

  atShop(p, o) {
    if (o.dead) { this.goBack(p); return; }
    this.settle(p, o);
    if (this.isOpen(o)) {
      const pr = TYPES[o.type].price;
      this.earn(pr);
      this.dayLog.shop += pr;
      o.salesToday += pr; o.custToday++;
      this.recordEval(o, p);
    }
    const [a, b] = STAY[o.type] || [20, 20];
    this.later(a + this.rand(b), () => this.afterVisit(p));
  }

  afterVisit(p) {
    if (p.state !== 'in') return;
    this.goBack(p);
  }

  // ================= エレベーター =================
  updateCar(e, c, dt) {
    if (c.state === 'doors') {
      c.timer -= dt;
      if (c.timer > 0) return;
      c.state = 'idle';
    }
    if (c.state === 'idle' && !this.carDecide(e, c)) return;
    let rem = e.speed * dt;
    while (rem > 1e-9) {
      const next = c.dir > 0 ? Math.floor(c.pos + 1e-6) + 1 : Math.ceil(c.pos - 1e-6) - 1;
      if (next > e.sHi || next < e.sLo) {
        c.pos = Math.max(e.sLo, Math.min(e.sHi, Math.round(c.pos)));
        c.state = 'idle'; c.dir = -c.dir;
        return;
      }
      const d = Math.abs(next - c.pos);
      if (d > rem) { c.pos += c.dir * rem; return; }
      c.pos = next; rem -= d;
      if (this.shouldStop(e, c, next)) { this.serve(e, c, next, c.dir); return; }
    }
  }

  passBeyond(c, f, dir) {
    const d = c.drop;
    if (dir > 0) { for (let i = FI(f) + 1; i < NF; i++) if (d[i]) return true; } else { for (let i = FI(f) - 1; i >= 0; i--) if (d[i]) return true; }
    return false;
  }
  callBeyond(e, f, dir) {
    if (!e.waitN) return false;
    const qn = e.qn;
    if (dir > 0) { for (let i = FI(f) + 1, end = FI(e.sHi); i <= end; i++) if (qn[i]) return true; } else { for (let i = FI(f) - 1, end = FI(e.sLo); i >= end; i--) if (qn[i]) return true; }
    return false;
  }

  carDecide(e, c) {
    const f = Math.round(c.pos);
    c.pos = f;
    if (c.pass.length) {
      if (!c.dir) c.dir = Math.sign(legTo(c.pass[0]) - f) || 1;
      if (!this.passBeyond(c, f, c.dir)) c.dir = -c.dir;
      if (c.target !== null && (c.target - f) * c.dir <= 0) c.target = null;
      const q = e.q[f];
      if (q && q[dk(c.dir)].length && c.pass.length < e.cap) { this.serve(e, c, f, c.dir); return false; }
      c.state = 'moving';
      return true;
    }
    if (!e.waitN) { c.dir = 0; c.target = null; return false; }
    if (e.qn[FI(f)] > 0) {
      const q = e.q[f];
      const d = c.dir && q[dk(c.dir)].length ? c.dir : (q.up.length ? 1 : -1);
      this.serve(e, c, f, d);
      return false;
    }
    if (c.target !== null && c.target !== f && e.qn[FI(c.target)] > 0) {
      c.dir = Math.sign(c.target - f); c.state = 'moving';
      return true;
    }
    c.target = null;
    let best = null, bd = Infinity;
    for (const g of e.stops) {
      if (!e.qn[FI(g)]) continue;
      const d = Math.abs(g - f);
      if (d >= bd) continue;
      let taken = false;
      for (const o of e.cars) if (o !== c && o.target === g) { taken = true; break; }
      if (!taken) { bd = d; best = g; }
    }
    if (best === null) { c.dir = 0; return false; }
    c.target = best; c.dir = Math.sign(best - f); c.state = 'moving';
    return true;
  }

  shouldStop(e, c, g) {
    const i = FI(g);
    if (!e.isStop[i]) return false;
    if (g <= e.sLo || g >= e.sHi) return true;
    if (c.drop[i]) return true;
    if (c.target === g) return true;
    if (!e.qn[i]) return false;
    const q = e.q[g];
    if (q[dk(c.dir)].length && c.pass.length < e.cap) return true;
    if (!c.pass.length && q[dk(-c.dir)].length && !this.callBeyond(e, g, c.dir)) return true;
    return false;
  }

  serve(e, c, g, dir) {
    if (c.target === g) c.target = null;
    let moved = 0;
    const i = FI(g);
    if (c.drop[i]) {
      const pass = c.pass, stay = [];
      c.pass = stay;
      c.drop[i] = 0;
      for (const p of pass) {
        if (legTo(p) === g) {
          p.f = g; p.x = e.x + e.w / 2; p.car = null; p.elev = null;
          p.li++; p.state = 'walk';
          this.aimNext(p);
          moved++;
        } else stay.push(p);
      }
    }
    if (g >= e.sHi) dir = -1; else if (g <= e.sLo) dir = 1;
    const q = e.q[g];
    if (q && e.qn[i]) {
      if (!c.pass.length && !q[dk(dir)].length && q[dk(-dir)].length && !this.callBeyond(e, g, dir)) dir = -dir;
      const line = q[dk(dir)];
      let n = 0;
      while (n < line.length && c.pass.length < e.cap) {
        const p = line[n++];
        e.wSum[e.wb] += p.waitT; e.wN[e.wb]++;
        p.state = 'ride'; p.car = c;
        c.pass.push(p);
        c.drop[FI(legTo(p))]++;
        moved++;
      }
      if (n) { line.splice(0, n); e.qn[i] -= n; e.waitN -= n; }
    }
    c.dir = dir;
    c.state = 'doors';
    c.timer = SIM.DOOR + moved * SIM.BOARD;
  }

  // ================= 時間 =================
  step(minutes) {
    if (this._reemit.length) {
      const l = this._reemit; this._reemit = [];
      for (const pr of l) this.emit('prompt', pr);
    }
    let dt = +minutes || 0;
    while (dt > 1e-9) {
      const h = Math.min(dt, SIM.TICK);
      dt -= h;
      this.tick(h);
    }
  }

  tick(h) {
    const t0 = this.time;
    this.time = t0 + h;
    if (Math.floor(this.time / DAY) !== Math.floor(t0 / DAY)) this.newDay();
    if (Math.floor(this.time / 60) !== Math.floor(t0 / 60)) this.hourly(this.hour);
    if (Math.floor(this.time / 5) !== Math.floor(t0 / 5)) this.every5();
    const ev = this.events;
    while (ev.peekT() <= this.time) ev.pop().fn();
    for (const e of this.elevs) for (const c of e.cars) this.updateCar(e, c, h);
    for (const p of this.active) this.updatePerson(p, h);
    if (this.fire) this.fireTick(h);
    if (this.bomb && !this.bomb.found && this.time >= this.bomb.deadline) this.explodeBomb();
    if (this._xmas || this.santa) this.updateSanta();
  }

  newDay() {
    this.endDay();
    this.planDay(this.day, this.time);
    this.dailyEvents();
    this._xmas = this.isXmasEve();
  }

  endDay() {
    // 維持費
    let cost = 0, tiles = 0;
    for (const e of this.elevs) { cost += e.cars.length * SIM.CAR_MAINT[e.type]; e.peakWaitYesterday = e.peakWait; e.peakWaitRecent = Math.max(e.peakWait, (e.peakWaitRecent || 0) * 0.6); e.peakWait = 0; }
    for (const t in SIM.MAINT) cost += this.byType[t].length * SIM.MAINT[t];
    for (let f = MIN_F; f <= MAX_F; f++) { const row = this.grid[f]; for (let x = 0; x < W; x++) if (row[x] !== 0) tiles++; }
    cost += tiles * SIM.FLOOR_MAINT;
    for (const o of this.byType.lobby) cost += o.w * SIM.LOBBY_MAINT;
    if (cost) this.spend(cost);
    // 評価の集計と退去
    const left = [];
    for (const o of this.facs) {
      if (o.evalN) o.eval = o.evalSum / o.evalN;
      else if (!o.occupied || !TENANT.has(o.type)) o.eval *= 0.7;
      o.evalSum = 0; o.evalN = 0;
      o.cWait *= 0.5; o.cStair *= 0.5;
      o.salesYesterday = o.salesToday; o.custYesterday = o.custToday;
      o.salesToday = 0; o.custToday = 0;
      if (o.burnt > 0 && !o.burning) o.burnt = Math.max(0, o.burnt - 0.2);
      if (TENANT.has(o.type) && o.occupied) {
        if (this.evalLevel(o) === 'bad') {
          if (++o.badDays >= 2) { this.vacate(o, true); left.push(o); }
        } else o.badDays = 0;
      }
    }
    if (left.length) {
      const names = left.slice(0, 4).map((o) => `${floorName(o.f)}の${TYPES[o.type].name}`).join('、');
      this.msg(`評価が悪いため ${names}${left.length > 4 ? ` ほか${left.length - 4}件` : ''} が退去しました`, 'bad', left[0].f, left[0].x + left[0].w / 2);
    }
    this.yesterday = { ...this.ledger, maintenance: cost };
    this.dailySummary(this.dayLog, cost);
    this.dayLog = this.newDayLog();
    this.ledger = { income: 0, expense: 0 };
    this.recalcPop();
  }

  // 0時に前日のお金と入居の動きをまとめて1件だけ通知する
  dailySummary(L, maint) {
    const y = this.yesterday;
    const inc = [];
    if (L.rent) inc.push(`賃料 ${fmtMoney(L.rent)}`);
    if (L.sale) inc.push(`販売 ${fmtMoney(L.sale)}`);
    if (L.hotel) inc.push(`宿泊 ${fmtMoney(L.hotel)}`);
    if (L.shop) inc.push(`店舗 ${fmtMoney(L.shop)}`);
    const moves = [];
    if (L.inOffice) moves.push(`オフィス${L.inOffice}件`);
    if (L.inCondo) moves.push(`マンション${L.inCondo}件`);
    let text = `昨日の収支 ${fmtMoney(y.income - y.expense)}（収入 ${fmtMoney(y.income)}${inc.length ? `: ${inc.join('・')}` : ''} / 支出 ${fmtMoney(y.expense)}: 維持費 ${fmtMoney(maint)}）`;
    if (moves.length) text += `。新しい入居: ${moves.join('・')}`;
    if (L.out) text += `。退去 ${L.out}件${L.buyback ? `（買い戻し ${fmtMoney(L.buyback)}）` : ''}`;
    if (!y.income && !y.expense && !moves.length && !L.out) return;
    this.msg(text, y.income - y.expense < 0 ? 'bad' : 'money');
    if (this.money < 0) this.msg(`資金がマイナスです（${fmtMoney(this.money)}）。収入が入るまで建設できません`, 'bad');
  }

  hourly(h) {
    if (h === 6) this.tenancy(1);
    if (h === 14) this.tenancy(0.5);
    if (h === 12 && !this.isWeekend()) this.collectRent();
    if (h === 16) this.hotelBookings();
    this.spawnVisitors(h);
    this.hourlyEvents(h);
  }

  every5() {
    this.staffDispatch();
    for (const e of this.elevs) this.updateAvgWait(e);
    if (this.effects.length) this.effects = this.effects.filter((e) => e.t0 + e.dur > this.time);
    if (this.pending.size) this.checkPrompts();
  }

  // 直近1時間（5分×12区間）の平均待ち時間。乗った人＋いま待っている人
  updateAvgWait(e) {
    let sum = 0, n = 0;
    for (let i = 0; i < 12; i++) { sum += e.wSum[i]; n += e.wN[i]; }
    if (e.waitN) {
      for (const k in e.q) for (const d of ['up', 'down']) for (const p of e.q[k][d]) { sum += p.waitT; n++; }
    }
    e.avgWait = n ? sum / n : 0;
    if (e.avgWait > e.peakWait) e.peakWait = e.avgWait;
    e.wb = (e.wb + 1) % 12;
    e.wSum[e.wb] = 0; e.wN[e.wb] = 0;
  }

  collectRent() {
    let n = 0;
    for (const o of this.byType.office) if (o.occupied) n++;
    if (!n) return;
    const v = n * TYPES.office.rent;
    this.earn(v);
    this.dayLog.rent += v;
    this.sound('cash');
  }

  vacate(o, counted) {
    if (counted) { this.dayLog.out++; o.vacantUntil = this.time + SIM.BAD_COOLDOWN; }
    if (o.type === 'condo' && o.occupied && SIM.BUYBACK) {
      const v = Math.round(TYPES.condo.sale * SIM.BUYBACK);
      this.spend(v);
      this.dayLog.buyback += v;
    }
    for (const p of o.members.slice()) this.purge(p, false);
    o.members = []; o.occupied = false; o.badDays = 0;
    o.evalSum = 0; o.evalN = 0;
  }

  tenancy(scale) {
    if (!this.entrances.length) return;
    const moved = { office: 0, condo: 0 };
    let sale = 0, first = null;
    for (const t of ['office', 'condo']) {
      for (const o of this.byType[t]) {
        if (o.occupied || o.burning) continue;
        const d = this.entranceDist(o.f);
        if (d === Infinity) continue;
        let f = d <= 11 ? 1 : d <= 20 ? 0.6 : 0.3;
        if (o.noisy) f *= 0.4;
        if (o.eval >= 45) f *= 0.3;
        if (o.vacantUntil > this.time) continue; // 悪評で退去した直後は入居が決まらない
        f *= this.serviceFactor(o.f);
        const p = (t === 'office' ? 0.5 : 0.4) * scale * f;
        if (this.r() < p) {
          this.moveIn(o);
          moved[t]++;
          if (t === 'condo') sale += TYPES.condo.sale;
          first = first || o;
        }
      }
    }
    this.dayLog.inOffice += moved.office;
    this.dayLog.inCondo += moved.condo;
    if (moved.office || moved.condo) {
      // 最初の入居だけはその場で知らせる（以降は 0 時のまとめ）
      if (!this.flags.firstTenant) {
        this.flags.firstTenant = true;
        this.msg(`はじめての入居者が決まりました！ 収支は毎日0時にまとめてお知らせします`, 'good', first.f, first.x + first.w / 2);
      }
      this.sound(sale ? 'cash' : 'ding');
    }
    this.recalcPop();
  }

  // その階に止まるエレベーターの、前日の最大待ち時間に応じた入居のしやすさ
  serviceFactor(f) {
    let w = -1;
    for (const e of this.elevs) if (e.isStop[FI(f)] && f >= e.lo && f <= e.hi) w = w < 0 ? (e.peakWaitRecent || 0) : Math.min(w, e.peakWaitRecent || 0);
    if (w < 0) return 1; // 階段だけ
    return w < 5 ? 1 : w < 15 ? 0.5 : w < 30 ? 0.2 : 0.05;
  }

  moveIn(o) {
    const T = TYPES[o.type];
    o.occupied = true; o.badDays = 0; o.evalSum = 0; o.evalN = 0; o.eval = Math.min(o.eval, 30);
    o.members = [];
    const kind = o.type === 'office' ? 'worker' : 'resident';
    for (let i = 0; i < T.cap; i++) o.members.push(this.newPerson(kind, o));
    if (o.type === 'condo') {
      this.earn(T.sale);
      this.dayLog.sale += T.sale;
      for (const p of o.members) this.later(30 + this.rand(300), () => this.enterBuilding(p));
    } else this.planOffice(o, this.day, this.time);
  }

  planDay(day, from) {
    for (const o of this.byType.office) this.planOffice(o, day, from);
    for (const o of this.byType.condo) this.planCondo(o, day, from);
  }

  planOffice(o, day, from) {
    if (!o.occupied || day % 7 >= 5) return;
    const b = day * DAY;
    for (const p of o.members) {
      const tIn = b + 420 + this.rand(120), tOut = b + 1020 + this.rand(120);
      if (tIn >= from) this.at(tIn, () => this.enterBuilding(p));
      else if (tOut > from + 60 && p.state === 'out') this.at(from + this.rand(30), () => this.enterBuilding(p));
      if (this.r() < 0.6) {
        const t = b + 690 + this.rand(60);
        if (t >= from) this.at(t, () => this.outing(p, LUNCH));
      }
      if (tOut >= from) this.at(tOut, () => this.leaveBuilding(p));
    }
  }

  planCondo(o, day, from) {
    if (!o.occupied) return;
    const b = day * DAY, weekday = day % 7 < 5;
    for (const p of o.members) {
      if (weekday && this.r() < 0.7) {
        const tOut = b + 420 + this.rand(120), tBack = b + 1020 + this.rand(180);
        if (tOut >= from) this.at(tOut, () => this.leaveBuilding(p));
        if (tBack >= from) this.at(tBack, () => this.enterBuilding(p));
        if (this.r() < 0.25) { const t = b + 1230 + this.rand(60); if (t >= from) this.at(t, () => this.outing(p, DINNER)); }
      } else if (this.r() < 0.6) {
        const t = b + 600 + this.rand(480);
        if (t >= from) this.at(t, () => this.outing(p, LEISURE));
      }
    }
  }

  hotelBookings() {
    if (!this.entrances.length) return;
    const d = this.day;
    const demand = Math.min(1, 0.45 + 0.1 * this.star);
    const vipComing = this.vip && this.vip.stage === 'announced';
    for (const o of this.hotels) {
      if (o.occupied || o.dirty || o.infested || o.burning || o.vipHold) continue;
      if (vipComing && o.type === 'hotelSuite') continue; // VIP のために空けておく
      if (this.entranceDist(o.f) === Infinity) continue;
      if (this.r() >= 0.75 * demand * this.evalFactor(o)) continue;
      o.occupied = true; o.checkedIn = 0; o.members = [];
      const T = TYPES[o.type];
      const n = T.cap > 1 && this.r() < 0.3 ? 1 : T.cap;
      for (let i = 0; i < n; i++) {
        const p = this.newPerson('guest', o);
        o.members.push(p);
        this.later(this.rand(240), () => this.enterBuilding(p));
        if (this.r() < 0.35) this.at(d * DAY + 1140 + this.rand(120), () => this.outing(p, DINNER));
        this.at((d + 1) * DAY + 420 + this.rand(180), () => this.checkout(p));
      }
    }
    this.recalcPop();
  }

  checkout(p) { this.leaveBuilding(p, () => this.guestGone(p)); }

  guestGone(p) {
    const o = p.home;
    if (!o || o.dead) return;
    const i = o.members.indexOf(p);
    if (i >= 0) o.members.splice(i, 1);
    if (!o.members.length && o.occupied) {
      o.occupied = false;
      if (o.checkedIn) {
        const pr = TYPES[o.type].price;
        this.earn(pr);
        o.salesToday += pr;
        this.dayLog.hotel += pr;
        o.dirty = true; o.dirtySince = this.time;
      }
      this.recalcPop();
    }
  }

  spawnVisitors(h) {
    if (!this.entrances.length) return;
    const base = 0.4 + this.pop / 250;
    for (const t of COMMERCE) {
      for (const o of this.byType[t]) {
        if (o.burning || !this.isOpen(o, h)) continue;
        if (t === 'partyHall' && h !== 12 && h !== 18) continue;
        if (this.entranceDist(o.f) === Infinity) continue;
        const lam = base * VISIT_RATE[t] * this.evalFactor(o);
        const n = Math.min(VISIT_CAP[t], Math.floor(lam * (0.5 + this.r())));
        for (let i = 0; i < n; i++) this.later(this.rand(55), () => this.visit(o));
      }
    }
  }

  // ================= スタッフ =================
  createStaff(o) {
    const kind = STAFF_KIND[o.type], n = SIM.STAFF[o.type] || 0;
    for (let i = 0; i < n; i++) {
      const p = this.newPerson(kind, o);
      p.f = o.f; p.x = this.spotIn(o);
      this.settle(p, o);
      o.members.push(p);
    }
  }

  releaseTask(p) {
    const t = p.task;
    p.task = null;
    if (!t) return;
    if (t.kind === 'clean' && t.room && t.room.cleaner === p.id) t.room.cleaner = null;
    if (t.kind === 'search' && this.bomb) this.bomb.assigned.delete(t.f);
    if (t.kind === 'fire' && t.obj) t.obj.fighters = Math.max(0, (t.obj.fighters || 0) - 1);
  }

  // ================= 保存 =================
  serialize() {
    const rows = {};
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = this.grid[f];
      let any = false, s = '';
      for (let x = 0; x < W; x++) { const c = row[x] !== 0; any = any || c; s += c ? '1' : '0'; }
      if (any) rows[f] = s;
    }
    const objs = [];
    for (const o of this.objs.values()) {
      const s = { id: o.id, type: o.type, f: o.f, x: o.x, w: o.w, h: o.h };
      if (ELEV.has(o.type)) { s.lo = o.lo; s.hi = o.hi; s.cars = o.cars.map((c) => Math.round(c.pos)); }
      if (this.hasEval(o)) { s.eval = +o.eval.toFixed(2); s.badDays = o.badDays; }
      if (TENANT.has(o.type) || HOTEL.has(o.type)) s.occupied = !!o.occupied;
      if (HOTEL.has(o.type)) {
        Object.assign(s, { dirty: !!o.dirty, dirtySince: o.dirtySince, infested: !!o.infested, guests: o.members.length, checkedIn: o.checkedIn });
      }
      if (o.burnt) s.burnt = +o.burnt.toFixed(3);
      if (o.complaintUntil > this.time) { s.complaint = o.complaint; s.complaintUntil = o.complaintUntil; }
      if (o.salesToday) { s.salesToday = o.salesToday; s.custToday = o.custToday; }
      objs.push(s);
    }
    return {
      v: SAVE_VERSION, seed: this.seed, time: this.time, money: this.money, star: this.star, tower: this.tower,
      nextId: this.nextId, ledger: { ...this.ledger }, yesterday: this.yesterday ? { ...this.yesterday } : null,
      dayLog: { ...this.dayLog }, rows, objs, flags: { ...this.flags },
      bomb: this.bomb ? { f: this.bomb.f, x: this.bomb.x, deadline: this.bomb.deadline, searched: [...this.bomb.searched], found: this.bomb.found } : null,
      fire: this.fire ? { start: this.fire.start, nextSpread: this.fire.nextSpread, heli: this.fire.heli, burned: this.fire.burned, saved: this.fire.saved, burning: [...this.fire.burning].map((o) => o.id) } : null,
      vip: this.vip ? { stage: this.vip.stage, arrive: this.vip.arrive } : null,
      prompts: [...this.pending.values()].map((p) => ({ id: p.id, kind: p.kind, title: p.title, text: p.text, choices: p.choices, data: p.data, deadline: p.deadline })),
      promptSeq: this.promptSeq,
    };
  }

  restore(d) {
    if (!d || typeof d !== 'object' || typeof d.v !== 'number') throw new Error('セーブデータが壊れています');
    if (d.v > SAVE_VERSION) throw new Error('新しいバージョンのセーブデータです');
    const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    this.seed = num(d.seed, this.seed) >>> 0;
    this.reset();
    this.rng = makeRng((this.seed ^ Math.floor(num(d.time, 0) * 7)) >>> 0);
    this.time = Math.max(0, num(d.time, 360));
    this.money = num(d.money, START_MONEY);
    this.star = Math.max(1, Math.min(5, num(d.star, 1) | 0));
    this.tower = !!d.tower;
    if (d.ledger) this.ledger = { income: num(d.ledger.income, 0), expense: num(d.ledger.expense, 0) };
    this.yesterday = d.yesterday && typeof d.yesterday === 'object' ? { ...d.yesterday } : null;
    if (d.dayLog && typeof d.dayLog === 'object') for (const k in this.dayLog) this.dayLog[k] = num(d.dayLog[k], 0);
    if (d.flags && typeof d.flags === 'object') Object.assign(this.flags, d.flags);
    // 空きフロア
    for (const k in d.rows || {}) {
      const f = +k, s = d.rows[k];
      if (!this.grid[f] || typeof s !== 'string') continue;
      for (let x = 0; x < W && x < s.length; x++) if (s[x] === '1') this.grid[f][x] = -1;
    }
    // 施設
    const fits = (type, f0, f1, x, w) => {
      if (x < 0 || x + w > W || f0 < MIN_F || f1 > MAX_F) return false;
      for (let f = f0; f <= f1; f++) {
        for (let xi = x; xi < x + w; xi++) {
          const c = this.grid[f][xi];
          if (c <= 0) continue;
          if (TRANSPORT.has(type) && this.isLobbyCell(c)) continue;
          if (type === 'lobby' && this.isTransportCell(c)) continue;
          return false;
        }
      }
      return true;
    };
    for (const s of Array.isArray(d.objs) ? d.objs : []) {
      try {
        const T = TYPES[s.type];
        if (!T || typeof s.id !== 'number' || this.objs.has(s.id)) continue;
        if (ELEV.has(s.type)) {
          if (!fits(s.type, s.lo, s.hi, s.x, T.w)) continue;
          const e = this._placeElevator(s.type, s.x, s.lo, s.hi, s.id, Array.isArray(s.cars) ? s.cars.slice(0, T.maxCars) : null);
          if (!e.stops.length) this.removeObj(e);
          continue;
        }
        const h = T.h || 1, w = s.type === 'lobby' || s.type === 'floor' ? s.w : T.w;
        if (s.type === 'floor' || !fits(s.type, s.f, s.f + h - 1, s.x, w)) continue;
        const o = this.makeObj(s.type, s.f, s.x, w, h, s.id);
        if (o.type === 'lobby') this.byType.lobby.push(o);
        for (let r = 0; r < h; r++) {
          for (let xi = o.x; xi < o.x + w; xi++) if (o.type !== 'lobby' || this.grid[o.f + r][xi] <= 0) this.grid[o.f + r][xi] = o.id;
        }
        o.eval = num(s.eval, 0); o.badDays = num(s.badDays, 0);
        o.burnt = num(s.burnt, 0);
        if (s.complaintUntil) { o.complaintUntil = num(s.complaintUntil, 0); o.complaint = String(s.complaint || ''); }
        o.salesToday = num(s.salesToday, 0); o.custToday = num(s.custToday, 0);
        if (TENANT.has(o.type) || HOTEL.has(o.type)) o.occupied = !!s.occupied;
        if (HOTEL.has(o.type)) {
          o.dirty = !!s.dirty; o.infested = !!s.infested;
          o.dirtySince = s.dirtySince == null ? (o.dirty ? this.time : null) : num(s.dirtySince, this.time);
          o.checkedIn = num(s.checkedIn, 0);
          o._guests = Math.max(1, Math.min(TYPES[o.type].cap, num(s.guests, TYPES[o.type].cap)));
        }
        if (STAFF_KIND[o.type]) this.createStaff(o);
      } catch (e) { /* 壊れた項目は読み飛ばす */ }
    }
    this.nextId = Math.max(this.nextId, num(d.nextId, 1));
    this.reindex();
    this.repopulate();
    // 事件
    if (d.bomb && typeof d.bomb === 'object') {
      this.bomb = {
        f: num(d.bomb.f, 0), x: num(d.bomb.x, 0), deadline: num(d.bomb.deadline, this.time + 60),
        searched: new Set(Array.isArray(d.bomb.searched) ? d.bomb.searched : []), found: !!d.bomb.found,
        assigned: new Set(), floors: this.builtFloors(),
      };
      if (this.bomb.found) this.later(10, () => { this.bomb = null; });
    }
    if (d.fire && typeof d.fire === 'object') {
      const burning = new Set();
      for (const id of d.fire.burning || []) { const o = this.objs.get(id); if (o) { o.burning = true; burning.add(o); } }
      if (burning.size) {
        const o0 = [...burning][0];
        this.fire = { start: num(d.fire.start, this.time), nextSpread: num(d.fire.nextSpread, this.time + 10), heli: d.fire.heli ?? null, burning,
          burned: num(d.fire.burned, 0), saved: num(d.fire.saved, 0), f: o0.f, x: o0.x + o0.w / 2 };
        this.updateFires();
      }
    }
    if (d.vip && d.vip.stage === 'announced' && num(d.vip.arrive, 0) > this.time) {
      this.vip = { stage: 'announced', arrive: d.vip.arrive };
      this.at(d.vip.arrive, () => this.vipArrive());
    } else if (d.vip && !this.flags.vipOk) {
      // 滞在中の VIP は再現しない。翌日以降にもう一度予告する
      this.flags.vipNext = this.day + 1;
    }
    this.promptSeq = Math.max(1, num(d.promptSeq, 1));
    for (const p of Array.isArray(d.prompts) ? d.prompts : []) {
      if (!p || !p.id || !p.kind || !Array.isArray(p.choices) || !p.choices.length) continue;
      if (!p.choices.every((c) => c && typeof c.label === 'string' && 'value' in c)) continue;
      const pr = { id: p.id, kind: p.kind, title: p.title, text: p.text, choices: p.choices, data: p.data || {}, deadline: num(p.deadline, this.time + 60) };
      this.pending.set(pr.id, pr);
      this._reemit.push({ id: pr.id, kind: pr.kind, title: pr.title, text: pr.text, choices: pr.choices });
    }
    const F = this.flags;
    if (typeof F.bombAt === 'number' && F.bombAt > this.time) { const t = F.bombAt; this.at(t, () => { if (F.bombAt === t) this.startBombThreat(); }); } else F.bombAt = null;
    if (typeof F.fireAt === 'number' && F.fireAt > this.time) { const t = F.fireAt; this.at(t, () => { if (F.fireAt === t) this.startFire(); }); } else F.fireAt = null;
    this._xmas = this.isXmasEve();
    this.recalcPop();
    this.planDay(this.day, this.time);
    this.revision++;
    return this;
  }

  // ロード時: 時刻に応じて人を配置し直す
  repopulate() {
    const day = this.day, h = this.time / 60 % 24, weekday = day % 7 < 5, b = day * DAY;
    for (const o of this.byType.office) {
      if (!o.occupied) continue;
      o.members = [];
      for (let i = 0; i < TYPES.office.cap; i++) {
        const p = this.newPerson('worker', o);
        o.members.push(p);
        if (weekday && h >= 9 && h < 17) { p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); }
      }
    }
    for (const o of this.byType.condo) {
      if (!o.occupied) continue;
      o.members = [];
      for (let i = 0; i < TYPES.condo.cap; i++) {
        const p = this.newPerson('resident', o);
        o.members.push(p);
        if (weekday && h >= 9 && h < 17 && this.r() < 0.7) {
          this.at(b + 1020 + this.rand(180), () => this.enterBuilding(p));
        } else { p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); }
      }
    }
    for (const o of this.hotels) {
      if (!o.occupied) continue;
      const n = o._guests || TYPES[o.type].cap;
      delete o._guests;
      o.members = [];
      const coDay = h < 12 ? day : day + 1;
      for (let i = 0; i < n; i++) {
        const p = this.newPerson('guest', o);
        o.members.push(p);
        if (h >= 16 || h < 7 || o.checkedIn) {
          p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); p.checked = true;
        } else {
          this.later(this.rand(120), () => this.enterBuilding(p));
        }
        let t = coDay * DAY + 420 + this.rand(180);
        if (t < this.time) t = this.time + this.rand(60);
        this.at(t, () => this.checkout(p));
      }
      if (!o.checkedIn && o.members.some((p) => p.checked)) o.checkedIn = o.members.filter((p) => p.checked).length;
    }
  }

  builtFloors() {
    const fl = [];
    for (let f = MIN_F; f <= MAX_F; f++) {
      const list = this.byFloor.get(f);
      if (list && list.length) fl.push(f);
    }
    return fl;
  }

  // デバッグ・テスト用: 事件を強制発生
  trigger(kind, opt) {
    switch (kind) {
      case 'bomb': return this.startBombThreat();
      case 'fire': return this.startFire(opt);
      case 'vip': return this.vipAnnounce(true);
      case 'wedding': return this.weddingStart(true);
      case 'roach': return opt ? (this.infest(opt), true) : false;
      case 'complaint': this.complaints(true); return true;
      default: return false;
    }
  }
}

Object.assign(Tower.prototype, EventsMixin, PanelMixin);
export default Tower;
