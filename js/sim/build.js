// 建設: 施設の層（grid）と移動手段の層（tgrid）、撤去、破壊、一括コピー（Tower.prototype に混ぜ込む）
import { W, MIN_F, MAX_F, TYPES, VARIANTS, floorName, fmtMoney } from './constants.js';
import { LOBBY_SET, TRANSPORT, ELEV, HOTEL, COMMERCE, TENANT, STAFF_KIND, SIM } from './rules.js';
import { pickBrand } from './brands.js';
import { defaultElevConfig } from './elevator.js';

const BATCH_TOOLS = new Set(Object.keys(TYPES));

export const BuildMixin = {
  // ================= マス =================
  cell(f, x) { const row = this.grid[f]; return row && x >= 0 && x < W ? row[x] : 0; },
  tcell(f, x) { const row = this.tgrid[f]; return row && x >= 0 && x < W ? row[x] : 0; },
  supported(f, x) {
    if (f === 0) return true;
    const c = f > 0 ? this.cell(f - 1, x) : this.cell(f + 1, x);
    return c !== 0 && !this.isBridgeCell(c); // 連絡通路は上の階を支えない
  },
  isBridgeCell(c) { if (c <= 0) return false; const o = this.objs.get(c); return !!o && o.type === 'bridge'; },
  objAt(f, x) { const c = this.cell(f, Math.floor(x)); return c > 0 ? this.objs.get(c) || null : null; },
  transportAt(f, x) { const c = this.tcell(f, Math.floor(x)); return c > 0 ? this.objs.get(c) || null : null; },

  // 移動手段が tgrid で占めるマス（エレベーターは機械室 hi+1 とピット lo-1 を含む）
  transportRows(type, lo, hi) {
    if (ELEV.has(type)) return [Math.max(MIN_F, lo - 1), Math.min(MAX_F, hi + 1)];
    return [lo, lo];
  },
  // 置けないなら理由を返す。self はそのエレベーター自身（伸縮時）
  checkTransportCells(type, x, w, lo, hi, self = 0, freshCells = null) {
    if (x < 0 || x + w > W) return '建設範囲の外です';
    const [r0, r1] = this.transportRows(type, lo, hi);
    for (let f = r0; f <= r1; f++) {
      for (let xi = x; xi < x + w; xi++) {
        const t = this.tcell(f, xi);
        if (t !== 0 && t !== self) return '他の移動手段と重なっています';
      }
    }
    const fresh = freshCells ? new Set(freshCells.map(([f, xx]) => f * 1000 + xx)) : null;
    for (let f = lo; f <= hi; f++) {
      for (let xi = x; xi < x + w; xi++) {
        const c = this.cell(f, xi);
        if (c === 0 && !(fresh && fresh.has(f * 1000 + xi))) return `${floorName(f)}にフロアがありません`;
        if (this.isBridgeCell(c)) return '連絡通路には移動手段を置けません';
      }
    }
    return null;
  },
  writeTransportCells(o) {
    const lo = ELEV.has(o.type) ? o.lo : o.f, hi = ELEV.has(o.type) ? o.hi : o.f;
    const [r0, r1] = this.transportRows(o.type, lo, hi);
    for (let f = r0; f <= r1; f++) for (let xi = o.x; xi < o.x + o.w; xi++) if (this.tgrid[f][xi] === 0) this.tgrid[f][xi] = o.id;
  },
  clearTransportCells(o) {
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = this.tgrid[f];
      for (let xi = o.x; xi < o.x + o.w; xi++) if (row[xi] === o.id) row[xi] = 0;
    }
  },

  // ================= 建設 =================
  check(tool, p) {
    const r = this._plan(tool, p || {});
    return { ok: r.ok, reason: r.reason, cost: r.cost, ghost: r.ghost };
  },

  build(tool, p) {
    const r = this._plan(tool, p || {});
    if (!r.ok) { this.sound('error'); return { ok: false, reason: r.reason, cost: r.cost, ghost: r.ghost }; }
    if (r.cost) this.spend(r.cost);
    const o = r.apply();
    if (o && o.id && tool !== 'bulldoze' && tool !== 'resizeElevator') this.startConstruction(o, r.cost);
    this.sound(tool === 'bulldoze' ? 'bulldoze' : 'build');
    if (!this._batch) this.checkStar();
    return { ok: true, reason: '', cost: r.cost, ghost: r.ghost, obj: o && o.id ? o : undefined };
  },

  _plan(tool, p) {
    if (tool === 'bulldoze') return this._planBulldoze(p);
    if (tool === 'resizeElevator') {
      const e = this.objs.get(p.id);
      if (!e || !ELEV.has(e.type)) return { ok: false, reason: 'エレベーターがありません', cost: 0, ghost: null };
      const r = this.planResize(e, p.lo ?? e.lo, p.hi ?? e.hi);
      if (r.ok && r.cost > this.money) return { ...r, ok: false, reason: `資金が足りません（${fmtMoney(r.cost)}）` };
      return r;
    }
    const T = TYPES[tool];
    if (!T) return { ok: false, reason: '不明なツールです', cost: 0, ghost: null };
    let r;
    if (T.drag === 'v') r = this._planElevator(tool, T, p);
    else if (T.drag === 'h') r = this._planHoriz(tool, T, p);
    else if (TRANSPORT.has(tool)) r = this._planStairs(tool, T, p);
    else r = this._planFacility(tool, T, p);
    if (r.ok && T.star > this.star) return { ...r, ok: false, reason: `★${T.star}で解放されます` };
    if (r.ok && r.cost > this.money) return { ...r, ok: false, reason: `資金が足りません（${fmtMoney(r.cost)}）` };
    return r;
  },

  _planHoriz(tool, T, p) {
    const f = p.f | 0;
    const xa = Math.floor(p.x), xb = Math.floor(p.x2 ?? p.x);
    const x1 = Math.max(0, Math.min(xa, xb)), x2 = Math.min(W - 1, Math.max(xa, xb));
    const w = x2 - x1 + 1;
    const ghost = { x: x1, w, f, h: 1 };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (f < MIN_F || f > MAX_F || w < 1) return fail('建設範囲の外です');
    if (tool === 'bridge') {
      // 支えは要らないが、少なくとも片方の端が同じ階の構造に接していること
      if (f < 1) return fail('連絡通路は2F以上に架けます');
      for (let x = x1; x <= x2; x++) {
        if (this.cell(f, x) !== 0) return fail('すでに構造があるところには架けられません');
        if (this.tcell(f, x) !== 0) return fail('移動手段と重なっています');
      }
      if (this.cell(f, x1 - 1) === 0 && this.cell(f, x2 + 1) === 0) return fail('どちらの端も建物に接していません');
      const cost = T.costPerTile * w;
      return { ok: true, reason: '', cost, ghost, apply: () => this._place('bridge', f, x1, w, 1) };
    }
    if (tool === 'lobby') {
      if (!LOBBY_SET.has(f)) return fail('ロビーは1Fと15F・30F…90Fにのみ置けます');
      if (w < (T.minW || 1)) return fail(`ロビーは幅${T.minW}マス以上必要です`);
      let fresh = 0;
      for (let x = x1; x <= x2; x++) {
        const c = this.cell(f, x);
        if (c > 0) return fail('他の施設と重なっています');
        if (c === 0) {
          if (!this.supported(f, x)) return fail(f < 0 ? '上の階に支えがありません' : '下の階に支えがありません');
          fresh++;
        }
      }
      const cost = T.costPerTile * w + fresh * TYPES.floor.costPerTile;
      return { ok: true, reason: '', cost, ghost, apply: () => this._place('lobby', f, x1, w, 1) };
    }
    const cells = [];
    let unsupported = 0;
    for (let x = x1; x <= x2; x++) {
      if (this.cell(f, x) !== 0) continue;
      if (this.supported(f, x)) cells.push(x); else unsupported++;
    }
    if (!cells.length) {
      // 一括コピーでは、すでにフロアがあるマスは飛ばすだけ（費用 0・何もしない）
      if (p.tolerant && !unsupported) return { ok: true, reason: '', cost: 0, ghost, apply: () => null };
      return fail(unsupported ? (f < 0 ? '上の階に支えがありません' : '下の階に支えがありません') : 'すでにフロアがあります');
    }
    const cost = cells.length * T.costPerTile;
    return {
      ok: true, reason: '', cost, ghost,
      apply: () => { for (const x of cells) this.grid[f][x] = -1; this.revision++; return null; },
    };
  },

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
    let fresh = 0;
    for (let r = 0; r < h; r++) {
      for (let xi = x; xi < x + w; xi++) {
        const c = this.cell(f + r, xi);
        if (c > 0) return fail(this.isBridgeCell(c) ? '連絡通路の上には施設を置けません' : '他の施設と重なっています');
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
  },

  // 階段・エスカレーター: f と f+1 をつなぐ。tgrid の f 段を占める
  _planStairs(tool, T, p) {
    const w = T.w, f = p.f | 0, x = Math.floor(p.x);
    const ghost = { x, w, f, h: 1 };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (x < 0 || x + w > W || f < MIN_F || f > MAX_F) return fail('建設範囲の外です');
    if (f + 1 > MAX_F) return fail('上の階がありません');
    const r = this.checkTransportCells(tool, x, w, f, f);
    if (r) return fail(r);
    for (let xi = x; xi < x + w; xi++) {
      if (this.cell(f + 1, xi) === 0) return fail('上の階にもフロアが必要です');
      if (this.isBridgeCell(this.cell(f + 1, xi))) return fail('連絡通路には移動手段を置けません');
    }
    return { ok: true, reason: '', cost: T.cost, ghost, apply: () => this._placeTransport(tool, x, f, f) };
  },

  _planElevator(tool, T, p) {
    const fa = p.f | 0, fb = (p.f2 ?? p.f) | 0, x = Math.floor(p.x), w = T.w;
    const lo = Math.max(MIN_F, Math.min(fa, fb)), hi = Math.min(MAX_F, Math.max(fa, fb));
    const ghost = { x, w, lo, hi };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (x < 0 || x + w > W) return fail('建設範囲の外です');
    if (hi - lo + 1 < 2) return fail('上下にドラッグして2フロア以上にしてください');
    if (hi - lo + 1 > T.maxSpan) return fail(`最大${T.maxSpan}フロアまでです`);
    const r = this.checkTransportCells(tool, x, w, lo, hi);
    if (r) return fail(r);
    return { ok: true, reason: '', cost: T.cost, ghost, apply: () => this._placeTransport(tool, x, lo, hi) };
  },

  // 撤去は移動手段 → 施設 → 空きフロアの順に優先する
  _planBulldoze(p) {
    const f = p.f | 0;
    const xa = Math.floor(p.x), xb = Math.floor(p.x2 ?? p.x);
    const x1 = Math.max(0, Math.min(xa, xb)), x2 = Math.min(W - 1, Math.max(xa, xb));
    let ghost = { x: x1, w: x2 - x1 + 1, f, h: 1 };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (f < MIN_F || f > MAX_F) return fail('範囲の外です');
    const pickIds = (layer) => {
      const ids = new Set();
      for (let x = x1; x <= x2; x++) { const c = layer(f, x); if (c > 0) ids.add(c); }
      return [...ids].map((id) => this.objs.get(id)).filter(Boolean);
    };
    let list = pickIds((ff, x) => this.tcell(ff, x));
    if (!list.length) list = pickIds((ff, x) => this.cell(ff, x));
    if (list.length) {
      if (list.length === 1 && x1 === x2) {
        const o = list[0];
        ghost = ELEV.has(o.type) ? { x: o.x, w: o.w, lo: o.lo, hi: o.hi } : { x: o.x, w: o.w, f: o.f, h: o.h };
      }
      return { ok: true, reason: '', cost: 0, ghost, apply: () => { for (const o of list) if (!o.dead) this.removeObj(o); return null; } };
    }
    const cells = [];
    let blocked = 0, why = '';
    for (let x = x1; x <= x2; x++) {
      if (this.cell(f, x) !== -1) continue;
      const r = this.floorRemovable(f, x);
      if (r === true) cells.push(x); else { blocked++; why = r; }
    }
    if (!cells.length) return fail(blocked ? why : '何もありません');
    return {
      ok: true, reason: '', cost: 0, ghost,
      apply: () => {
        for (const x of cells) if (this.floorRemovable(f, x) === true) this.grid[f][x] = 0;
        this.revision++;
        return null;
      },
    };
  },

  // true か、消せない理由
  floorRemovable(f, x) {
    if (this.cell(f, x) !== -1) return '何もありません';
    if ((f >= 0 && this.cell(f + 1, x) !== 0) || (f <= 0 && this.cell(f - 1, x) !== 0)) return '支えている上下の構造を先に撤去してください';
    const t = this.transportAt(f, x);
    if (t && (!ELEV.has(t.type) || (f >= t.lo && f <= t.hi))) return '移動手段を先に撤去してください';
    const below = this.transportAt(f - 1, x);
    if (below && (below.type === 'stairs' || below.type === 'escalator') && below.f === f - 1) return '移動手段を先に撤去してください';
    return true;
  },
  canRemoveFloor(f, x) { return this.floorRemovable(f, x) === true; },

  makeObj(type, f, x, w, h, id) {
    const o = {
      id: id ?? this.nextId++, type, f, x, w, h,
      occupied: !(TENANT.has(type) || HOTEL.has(type)),
      inCount: 0, dead: false, destroyed: null, unreachable: false, constructStart: 0, constructUntil: 0, fill: 0, bags: 0, truck: null, garbageBad: false,
      used: 0, needsParking: 0, parkingShort: 0, moveSeq: 0,
      variant: 0, brand: '',
      eval: 0, evalSum: 0, evalN: 0, badDays: 0, cWait: 0, cStair: 0,
      rs: this.newReasons(),
      members: [], complaintUntil: 0, complaint: '', burnt: 0, burning: false,
      salesToday: 0, custToday: 0, salesYesterday: 0, custYesterday: 0, noisy: false,
    };
    if (HOTEL.has(type)) Object.assign(o, { dirty: false, infested: false, dirtySince: null, cleaner: null, checkedIn: 0, cleanFail: -1e9 });
    if (type === 'medical') Object.assign(o, { patients: 0, beds: SIM.MEDICAL.beds });
    this.objs.set(o.id, o);
    if (o.id >= this.nextId) this.nextId = o.id + 1;
    if (this._batch) this._batch.created.push(o);
    return o;
  },

  // ---- 工事: 建てた施設・移動手段は constructUntil まで使えない ----
  constructionTime(cost) {
    return Math.round(Math.max(30, Math.min(240, 30 + Math.sqrt(Math.max(0, cost) / 1000) * 6)));
  },
  startConstruction(o, cost) {
    if (!this.construction) return;
    o.constructStart = this.time;
    o.constructUntil = this.time + this.constructionTime(cost);
    this.queueConstruction(o);
    this.reindex();
  },
  queueConstruction(o) {
    const t = o.constructUntil;
    this.at(t, () => { if (!o.dead && o.constructUntil === t) this.finishConstruction(o); });
  },
  finishConstruction(o) {
    o.constructStart = 0; o.constructUntil = 0;
    this._needReindex = true; // 同じ tick に完成した分はまとめて索引を作り直す
    this.sound('built');
  },
  isUnderConstruction(o) { return !!o && o.constructUntil > 0; },
  // すべての工事をすぐ終える（デバッグ・テスト用）
  finishAllConstruction() {
    let n = 0;
    for (const o of this.objs.values()) if (o.constructUntil > 0) { o.constructStart = 0; o.constructUntil = 0; n++; }
    if (n) { this.reindex(); this.checkStar(); }
    return n;
  },

  // 個性（VARIANTS の添字と店名・社名）を決める
  rollVariant(o) {
    const v = VARIANTS[o.type];
    if (!v) { o.variant = 0; o.brand = ''; return; }
    o.variant = Math.floor(this.rand(v.length));
    o.brand = pickBrand(o.type, v[o.variant], this.rng);
  },

  _place(type, f, x, w, h) {
    const o = this.makeObj(type, f, x, w, h);
    for (let r = 0; r < h; r++) for (let xi = x; xi < x + w; xi++) this.grid[f + r][xi] = o.id;
    if (COMMERCE.has(type) || HOTEL.has(type)) this.rollVariant(o);
    else if (VARIANTS[type]) { o.variant = Math.floor(this.rand(VARIANTS[type].length)); o.brand = ''; }
    if (STAFF_KIND[type]) this.createStaff(o);
    this.reindex();
    return o;
  },

  _placeTransport(type, x, lo, hi, id, carPos, config) {
    const T = TYPES[type];
    const o = this.makeObj(type, lo, x, T.w, ELEV.has(type) ? hi - lo + 1 : 1, id);
    if (ELEV.has(type)) {
      o.lo = lo; o.hi = hi; o.q = {};
      o.config = { ...defaultElevConfig(type, lo, hi), ...(config || {}) };
      this.initElevator(o);
      o.cars = (carPos && carPos.length ? carPos : [o.sLo]).map((f) => this.newCar(o, f));
    }
    this.writeTransportCells(o);
    this.reindex();
    return o;
  },

  removeObj(o) {
    if (!o || o.dead) return;
    o.dead = true;
    if (TRANSPORT.has(o.type)) this.clearTransportCells(o);
    else {
      const to = o.type === 'bridge' ? 0 : -1; // 連絡通路を撤去すると何も残らない
      for (let f = o.f; f < o.f + o.h; f++) for (let xi = o.x; xi < o.x + o.w; xi++) if (this.grid[f][xi] === o.id) this.grid[f][xi] = to;
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
  },

  // 爆発・火災で壊れた施設。消えずに残り、撤去するまで何にも使えない
  destroyObj(o, kind) {
    if (!o || o.dead || o.destroyed) return;
    for (const p of o.members.slice()) this.purge(p, false);
    o.members = [];
    Object.assign(o, { destroyed: kind, occupied: false, burning: false, brand: '', complaint: '', complaintUntil: 0, evalSum: 0, evalN: 0, badDays: 0 });
    if (kind === 'fire') o.burnt = 1;
    if (HOTEL.has(o.type)) Object.assign(o, { dirty: false, infested: false, cleaner: null });
    if (this.fire && this.fire.burning.has(o)) { this.fire.burning.delete(o); this.updateFires(); }
    // 爆発・延焼では一度に何十件も壊れるので、索引の作り直しは tick の終わりにまとめる
    this._needReindex = true;
    this._popDirty = true;
  },

  dropOff(e, p, f) {
    p.f = f; p.x = e.x + e.w / 2;
    p.car = null; p.elev = null; p.state = 'walk';
    this.reroute(p);
  },

  // ================= 一括コピー =================
  // 範囲内の構造を、建てられる順の手順に変換する（座標は範囲の左下が f=0, x=0）
  blueprint(rect) {
    const fLo = Math.max(MIN_F, Math.min(rect.f1, rect.f2) | 0), fHi = Math.min(MAX_F, Math.max(rect.f1, rect.f2) | 0);
    const xLo = Math.max(0, Math.min(rect.x1, rect.x2) | 0), xHi = Math.min(W - 1, Math.max(rect.x1, rect.x2) | 0);
    const ops = [];
    const inX = (o) => o.x >= xLo && o.x + o.w - 1 <= xHi;
    const order = [];
    for (let f = Math.max(0, fLo); f <= fHi; f++) order.push(f);
    for (let f = Math.min(-1, fHi); f >= fLo; f--) order.push(f);
    const facs = [...this.objs.values()].filter((o) => !TRANSPORT.has(o.type) && !o.destroyed && inX(o) && o.f >= fLo && o.f + o.h - 1 <= fHi);
    for (const f of order) {
      const row = this.grid[f];
      const solid = (x) => row[x] !== 0 && !this.isBridgeCell(row[x]);
      for (let x = xLo; x <= xHi;) {
        if (!solid(x)) { x++; continue; }
        let e = x;
        while (e + 1 <= xHi && solid(e + 1)) e++;
        ops.push({ tool: 'floor', p: { f: f - fLo, x: x - xLo, x2: e - xLo } });
        x = e + 1;
      }
      for (const o of facs) {
        if (o.f !== f || o.type === 'bridge') continue;
        if (o.type === 'lobby') ops.push({ tool: 'lobby', p: { f: f - fLo, x: o.x - xLo, x2: o.x + o.w - 1 - xLo } });
        else ops.push({ tool: o.type, p: { f: f - fLo, x: o.x - xLo } });
      }
    }
    // 連絡通路は両側の棟ができてから（端が接している必要がある）
    for (const o of facs) if (o.type === 'bridge') ops.push({ tool: 'bridge', p: { f: o.f - fLo, x: o.x - xLo, x2: o.x + o.w - 1 - xLo } });
    for (const o of this.objs.values()) {
      if (!TRANSPORT.has(o.type) || !inX(o)) continue;
      if (ELEV.has(o.type)) {
        if (o.lo < fLo || o.hi > fHi) continue;
        ops.push({ tool: o.type, p: { f: o.lo - fLo, f2: o.hi - fLo, x: o.x - xLo, cars: o.cars.length, config: { ...o.config, skip: o.config.skip.map((s) => s - fLo) } } });
      } else if (o.f >= fLo && o.f + 1 <= fHi) ops.push({ tool: o.type, p: { f: o.f - fLo, x: o.x - xLo } });
    }
    return { w: xHi - xLo + 1, h: fHi - fLo + 1, origin: { f: fLo, x: xLo }, ops };
  },

  // 選んだ施設（と移動手段）だけを、支えるのに必要な最小限のフロアと一緒に写す。blueprint と同じ形
  blueprintOf(ids) {
    const list = [...(ids || [])].map((id) => this.objs.get(typeof id === 'object' && id ? id.id : id)).filter((o) => o && !o.dead && !o.destroyed);
    if (!list.length) return { w: 0, h: 0, origin: null, ops: [] };
    const need = new Map(); // f -> Set<x>
    const mark = (f, x) => { if (f < MIN_F || f > MAX_F || x < 0 || x >= W) return; if (!need.has(f)) need.set(f, new Set()); need.get(f).add(x); };
    for (const o of list) {
      const r0 = ELEV.has(o.type) ? o.lo : o.f, r1 = ELEV.has(o.type) ? o.hi : TRANSPORT.has(o.type) ? o.f + 1 : o.f + o.h - 1;
      for (let f = r0; f <= r1; f++) for (let x = o.x; x < o.x + o.w; x++) mark(f, x);
    }
    // 支え: 地上は写す範囲のいちばん下の段から、その列の印までの元の構造を写す（地下は上下逆）
    let bLo = Infinity, bHi = -Infinity;
    for (const f of need.keys()) { bLo = Math.min(bLo, f); bHi = Math.max(bHi, f); }
    const cols = new Map();
    for (const [f, xs] of need) for (const x of xs) { if (!cols.has(x)) cols.set(x, []); cols.get(x).push(f); }
    for (const [x, fs] of cols) {
      const top = Math.max(...fs), bot = Math.min(...fs);
      if (top >= 0) for (let f = Math.max(bLo, 0); f < top; f++) if (this.cell(f, x) !== 0) mark(f, x);
      if (bot < 0) for (let f = bot + 1; f <= Math.min(bHi, -1); f++) if (this.cell(f, x) !== 0) mark(f, x);
    }
    let fLo = Infinity, fHi = -Infinity, xLo = Infinity, xHi = -Infinity;
    for (const [f, xs] of need) for (const x of xs) { fLo = Math.min(fLo, f); fHi = Math.max(fHi, f); xLo = Math.min(xLo, x); xHi = Math.max(xHi, x); }
    const order = [];
    for (let f = Math.max(0, fLo); f <= fHi; f++) order.push(f);
    for (let f = Math.min(-1, fHi); f >= fLo; f--) order.push(f);
    const ops = [];
    const facs = list.filter((o) => !TRANSPORT.has(o.type));
    // 連絡通路の下にはフロアを作らない（橋そのものを架ける）
    for (const o of facs) if (o.type === 'bridge' && need.has(o.f)) for (let x = o.x; x < o.x + o.w; x++) need.get(o.f).delete(x);
    for (const f of order) {
      const xs = need.get(f);
      if (xs) {
        const sorted = [...xs].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length;) {
          let j = i;
          while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
          ops.push({ tool: 'floor', p: { f: f - fLo, x: sorted[i] - xLo, x2: sorted[j] - xLo } });
          i = j + 1;
        }
      }
      for (const o of facs) {
        if (o.f !== f || o.type === 'bridge') continue;
        if (o.type === 'lobby') ops.push({ tool: 'lobby', p: { f: f - fLo, x: o.x - xLo, x2: o.x + o.w - 1 - xLo } });
        else ops.push({ tool: o.type, p: { f: f - fLo, x: o.x - xLo } });
      }
    }
    for (const o of facs) if (o.type === 'bridge') ops.push({ tool: 'bridge', p: { f: o.f - fLo, x: o.x - xLo, x2: o.x + o.w - 1 - xLo } });
    for (const o of list) {
      if (!TRANSPORT.has(o.type)) continue;
      if (ELEV.has(o.type)) ops.push({ tool: o.type, p: { f: o.lo - fLo, f2: o.hi - fLo, x: o.x - xLo, cars: o.cars.length, config: { ...o.config, skip: o.config.skip.map((v) => v - fLo) } } });
      else ops.push({ tool: o.type, p: { f: o.f - fLo, x: o.x - xLo } });
    }
    // origin: 手順の座標の (0,0) が元のビルのどこか（貼り付けのプレビューを元の x にそろえるため）
    return { w: xHi - xLo + 1, h: fHi - fLo + 1, origin: { f: fLo, x: xLo }, ops };
  },

  checkBatch(ops, origin) { return this._runBatch(ops, origin, false); },
  buildBatch(ops, origin) { return this._runBatch(ops, origin, true); },

  _runBatch(ops, origin, commit) {
    const of = (origin && origin.f) | 0, ox = (origin && origin.x) | 0;
    const shift = (p) => {
      const q = { ...p };
      for (const k of ['f', 'f2', 'lo', 'hi']) if (typeof q[k] === 'number') q[k] += of;
      for (const k of ['x', 'x2']) if (typeof q[k] === 'number') q[k] += ox;
      if (q.config && Array.isArray(q.config.skip)) q.config = { ...q.config, skip: q.config.skip.map((s) => s + of) };
      q.tolerant = true;
      return q;
    };
    const res = { ok: true, cost: 0, reason: '', failedIndex: -1, ghosts: [] };
    if (!Array.isArray(ops) || !ops.length) return { ...res, ok: false, reason: '手順がありません' };
    // 状態の控え（失敗時・check 時に戻す）
    const snap = {
      grid: {}, tgrid: {}, money: this.money, income: this.ledger.income, expense: this.ledger.expense,
      nextId: this.nextId, revision: this.revision,
    };
    for (let f = MIN_F; f <= MAX_F; f++) { snap.grid[f] = this.grid[f].slice(); snap.tgrid[f] = this.tgrid[f].slice(); }
    this._batch = { created: [] };
    this._deferIndex = true;
    const money0 = this.money;
    try {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (!op || !BATCH_TOOLS.has(op.tool) || !op.p) {
          res.ghosts.push(null);
          if (res.ok) Object.assign(res, { ok: false, failedIndex: i, reason: '不明な手順です' });
          continue;
        }
        const p = shift(op.p);
        if (!res.ok) { const g = this._plan(op.tool, p).ghost; res.ghosts.push(g ? { ...g, ok: false } : null); continue; }
        const r = this._plan(op.tool, p);
        res.ghosts.push(r.ghost ? { ...r.ghost, ok: r.ok } : null);
        if (!r.ok) { Object.assign(res, { ok: false, failedIndex: i, reason: r.reason }); continue; }
        this.spend(r.cost);
        const o = r.apply();
        if (o && o.id) this.startConstruction(o, r.cost);
        if (o && ELEV.has(o.type)) {
          if (p.config) this.setElevatorConfig(o, p.config);
          for (let k = 1; k < (p.cars | 0); k++) {
            const a = this.addCar(o);
            if (!a.ok) { Object.assign(res, { ok: false, failedIndex: i, reason: a.reason }); break; }
          }
        }
      }
    } catch (err) {
      Object.assign(res, { ok: false, reason: String(err && err.message || err) });
    }
    res.cost = money0 - this.money;
    const keep = commit && res.ok;
    this._deferIndex = false;
    const batch = this._batch;
    this._batch = null;
    if (!keep) {
      for (const o of batch.created) { this.objs.delete(o.id); o.dead = true; }
      for (let f = MIN_F; f <= MAX_F; f++) { this.grid[f].set(snap.grid[f]); this.tgrid[f].set(snap.tgrid[f]); }
      this.money = snap.money; this.ledger.income = snap.income; this.ledger.expense = snap.expense;
      this.nextId = snap.nextId;
      // 一括処理中は索引を更新していないので、控えに戻すだけでよい
      this._indexDirty = false;
      this.revision = snap.revision;
    } else {
      this._indexDirty = false;
      this.reindex();
      this.sound('build');
      this.checkStar();
    }
    return res;
  },
};

