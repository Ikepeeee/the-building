// UI 開発用の最小モック Tower（SPEC の Sim API ＋ v2 追加仕様に沿った簡易版）。本番では使わない。
// index.html?mock または ?mock=sim で読み込まれる。
import { TYPES, W, MIN_F, MAX_F, DAY, STAR_POP, LOBBY_FLOORS, START_MONEY, TRANSPORT_TYPES, floorName, fmtMoney } from '../js/sim/constants.js';

const isT = (t) => TRANSPORT_TYPES.includes(t);

export class Tower {
  constructor(opts = {}) {
    this.scenario = opts.scenario === 'seaside' ? { id: 'seaside', name: '海辺のリゾート', startDay: 0, deadlineDay: 120, state: 'playing', grade: 0 } : null;
    this.theme = this.scenario ? 'seaside' : 'default';
    this.minFloor = this.scenario ? -2 : -10;
    this.weather = null;
    this._introDone = !this.scenario;
    this.time = 6 * 60;
    this.money = START_MONEY;
    this.pop = 0;
    this.star = 1;
    this.tower = false;
    this.ledger = { income: 0, expense: 0 };
    this.yesterday = null;
    this.grid = {};
    this.tgrid = {};
    for (let f = MIN_F; f <= MAX_F; f++) { this.grid[f] = new Int32Array(W); this.tgrid[f] = new Int32Array(W); }
    this.objs = new Map();
    this.nextId = 1;
    this.active = new Set();
    this.fires = [];
    this.bomb = null;
    this.effects = [];
    this.santa = null;
    this.heli = null;
    this._h = {};
    // 歩く人（プロフィール確認用）
    const names = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 美咲'];
    for (let i = 0; i < 4; i++) this.active.add({ id: i + 1, kind: 'worker', state: 'walk', stress: i * 20, f: 0, x: 210 + i * 12, vx: (i % 2 ? 1 : -1) * 2, name: names[i], age: 25 + i * 9, job: 'モック商事 営業部' });
  }
  get day() { return Math.floor(this.time / DAY); }
  get hour() { return Math.floor((this.time % DAY) / 60); }
  get minute() { return Math.floor(this.time % 60); }
  get weekday() { return this.day % 7; }

  on(n, fn) { (this._h[n] ||= []).push(fn); }
  emit(n, d) { for (const fn of this._h[n] || []) fn(d); }

  scenarioProgress() {
    if (!this.scenario) return null;
    const rooms = [...this.objs.values()].filter((o) => /^hotel/.test(o.type)).length;
    const goals = [
      { label: 'ホテルの客室', value: rooms, target: 40, done: rooms >= 40 },
      { label: '平均レビュー（直近30日）', value: 3.6, target: 4.0, done: false },
      { label: '人口（宿泊客を含む）', value: this.pop, target: 1500, done: this.pop >= 1500 },
    ];
    return { name: this.scenario.name, goals, daysLeft: this.scenario.deadlineDay - this.day, state: this.scenario.state, grade: this.scenario.grade, gradeRule: '60日以内★3・90日以内★2・120日以内★1' };
  }

  step(min) {
    if (!this._introDone) { this._introDone = true; this.emit('scenario', { kind: 'intro', title: 'ようこそ、潮見町へ', speaker: '町長', text: 'よく来てくださった！ この浜にもう一度、人を呼べるリゾートホテルを建ててほしいのです。' }); }
    const d0 = this.day, h0 = this.hour;
    this.time += min;
    if (this.day !== d0) { this.yesterday = this.ledger; this.ledger = { income: 0, expense: 0 }; }
    if (this.hour !== h0 && this.hour === 12) {
      let rent = 0;
      for (const o of this.objs.values()) if (o.type === 'office') rent += TYPES.office.rent;
      if (rent) { this.money += rent; this.ledger.income += rent; this.emit('sound', { name: 'cash' }); }
    }
    // カゴを上下に往復させる（v を持つ）
    for (const o of this.objs.values()) {
      if (!o.cars) continue;
      o.cars.forEach((c, i) => {
        c.t = (c.t || i * 3) + min;
        const span = o.hi - o.lo || 1;
        const per = span * 0.6 + 4;
        const ph = (c.t % (per * 2)) / per;
        const prev = c.pos;
        const u = ph < 1 ? ph : 2 - ph;
        const e = u < 0.1 ? 0 : u > 0.9 ? 1 : (u - 0.1) / 0.8;
        c.pos = o.lo + span * (e * e * (3 - 2 * e));
        c.v = min > 0 ? (c.pos - prev) / min : 0;
        c.state = Math.abs(c.v) > 0.01 ? 'moving' : 'doors';
        c.dir = Math.sign(c.v);
      });
    }
    for (const p of this.active) { p.x += p.vx * min; if (p.x < 200 || p.x > 280) p.vx = -p.vx; }
    if (this.heli) {
      const h = this.heli;
      h.x += (h.phase === 'out' ? 1 : -1) * min * 2;
      if (h.phase === 'in' && h.x <= h.targetX) h.phase = 'spray';
      else if (h.phase === 'spray' && (h.t = (h.t || 0) + min) > 20) h.phase = 'out';
      else if (h.phase === 'out' && h.x > W + 40) this.heli = null;
    }
    for (const o of this.objs.values()) if (o.constructUntil && this.time >= o.constructUntil && !o._built) { o._built = true; this.emit('sound', { name: 'built' }); }
    let pop = 0;
    for (const o of this.objs.values()) if (!isT(o.type)) pop += (TYPES[o.type]?.cap || 0) * 10;
    this.pop = pop;
    for (const o of this.objs.values()) o.inCount = this.hour >= 8 && this.hour < 19 ? (TYPES[o.type]?.cap || 4) : 0;
    const want = STAR_POP.findLastIndex((p, i) => i >= 1 && pop >= p);
    if (want > this.star) { this.star = want; this.emit('star', { star: want }); }
  }

  _span(tool, p) {
    const t = TYPES[tool];
    if (tool === 'bulldoze' || t.drag === 'h') {
      const a = Math.max(0, Math.min(p.x, p.x2 ?? p.x)), b = Math.min(W - 1, Math.max(p.x, p.x2 ?? p.x));
      return { x: a, w: b - a + 1, f: p.f, h: 1 };
    }
    if (t.drag === 'v') {
      const lo = Math.min(p.f, p.f2 ?? p.f), hi = Math.max(p.f, p.f2 ?? p.f);
      return { x: p.x, w: t.w, lo, hi, f: lo, h: hi - lo + 1 };
    }
    return { x: p.x, w: t.w, f: p.f, h: t.h || 1 };
  }

  _checkSpan(tool, g, ignoreId = 0) {
    const t = TYPES[tool];
    if (this.star < t.star) return `★${t.star}で解放`;
    if (g.x < 0 || g.x + g.w > W || g.f < MIN_F || g.f + g.h - 1 > MAX_F) return '範囲外です';
    if (t.only === 'lobbyFloor' && !LOBBY_FLOORS.includes(g.f)) return 'ロビーは1Fと15F毎の階のみ';
    if (t.only === 'aboveGround' && g.f < 0) return '地上にのみ建てられます';
    if (t.only === 'basement' && g.f + g.h - 1 >= 0) return '地下にのみ建てられます';
    if (t.only === 'top' && g.f !== MAX_F) return '100Fにのみ建てられます';
    if (t.maxSpan && g.h > t.maxSpan) return `最大${t.maxSpan}フロアまで`;
    for (let f = g.f; f < g.f + g.h; f++) for (let x = g.x; x < g.x + g.w; x++) {
      if (isT(tool)) {
        const v = this.tgrid[f][x];
        if (v && v !== ignoreId) return 'ほかの移動手段と重なっています';
        if (!this.grid[f][x]) return 'フロアがありません';
      } else if (this.grid[f][x] > 0) return 'ほかの施設と重なっています';
    }
    return '';
  }

  check(tool, p) {
    if (tool === 'resizeElevator') {
      const e = this.objs.get(p.id);
      if (!e || !e.cars) return { ok: false, reason: 'エレベーターがありません', cost: 0, ghost: null };
      const lo = Math.min(p.lo, p.hi), hi = Math.max(p.lo, p.hi);
      const ghost = { x: e.x, w: e.w, lo, hi };
      const why = this._checkSpan(e.type, { x: e.x, w: e.w, f: lo, h: hi - lo + 1 }, e.id);
      const cost = Math.max(0, (hi - lo) - (e.hi - e.lo)) * 10000;
      if (why) return { ok: false, reason: why, cost, ghost };
      if (cost > this.money) return { ok: false, reason: '資金が足りません', cost, ghost };
      return { ok: true, reason: '', cost, ghost };
    }
    if (tool === 'bulldoze') {
      const g = this._span(tool, p);
      const ghost = { x: g.x, w: g.w, f: g.f, h: 1 };
      for (let x = g.x; x < g.x + g.w; x++) if (this.grid[p.f]?.[x] || this.tgrid[p.f]?.[x]) return { ok: true, reason: '', cost: 0, ghost };
      return { ok: false, reason: '撤去するものがありません', cost: 0, ghost };
    }
    const t = TYPES[tool];
    if (!t) return { ok: false, reason: '不明', cost: 0, ghost: null };
    const g = this._span(tool, p);
    const ghost = t.drag === 'v' ? { x: g.x, w: g.w, lo: g.lo, hi: g.hi } : { x: g.x, w: g.w, f: g.f, h: g.h };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    let cost = t.drag === 'h' ? t.costPerTile * g.w : t.cost || 0;
    if (tool === 'floor') { let n = 0; for (let x = g.x; x < g.x + g.w; x++) if (!this.grid[g.f]?.[x]) n++; if (!n) return fail('すでにフロアがあります'); cost = n * 500; }
    const why = tool === 'floor' ? (g.f < MIN_F || g.f > MAX_F ? '範囲外です' : '') : this._checkSpan(tool, g);
    if (why) return fail(why);
    if (g.f > 0) for (let x = g.x; x < g.x + g.w; x++) if (!this.grid[g.f - 1][x]) return fail('下の階に支えがありません');
    if (cost > this.money) return fail('資金が足りません');
    return { ok: true, reason: '', cost, ghost };
  }

  build(tool, p) {
    const r = this.check(tool, p);
    if (!r.ok) { this.emit('sound', { name: 'error' }); return r; }
    this._apply(tool, p, r);
    this.emit('sound', { name: tool === 'bulldoze' ? 'bulldoze' : 'build' });
    return r;
  }

  _apply(tool, p, r) {
    this.money -= r.cost; this.ledger.expense += r.cost;
    if (tool === 'resizeElevator') {
      const e = this.objs.get(p.id);
      this._clearT(e);
      e.lo = Math.min(p.lo, p.hi); e.hi = Math.max(p.lo, p.hi); e.f = e.lo; e.h = e.hi - e.lo + 1;
      this._markT(e);
      for (const c of e.cars) c.pos = Math.min(e.hi, Math.max(e.lo, c.pos));
      return;
    }
    const g = this._span(tool, p);
    if (tool === 'bulldoze') {
      const ids = new Set();
      for (let x = g.x; x < g.x + g.w; x++) { const tv = this.tgrid[p.f][x]; if (tv) ids.add(tv); }
      if (!ids.size) for (let x = g.x; x < g.x + g.w; x++) { const v = this.grid[p.f][x]; if (v > 0) ids.add(v); else if (v === -1) this.grid[p.f][x] = 0; }
      for (const id of ids) this._remove(this.objs.get(id));
      return;
    }
    if (tool === 'floor') { for (let x = g.x; x < g.x + g.w; x++) if (!this.grid[g.f][x]) this.grid[g.f][x] = -1; return; }
    const id = this.nextId++;
    const o = { id, type: tool, f: g.f, x: g.x, w: g.w, h: g.h, occupied: true, inCount: 0, constructStart: this.time, constructUntil: this.time + 30 + g.w * 3, brand: tool === 'office' ? `モック商事${id}` : undefined, variant: 0 };
    if (TYPES[tool].drag === 'v') Object.assign(o, { lo: g.lo, hi: g.hi, cars: [{ pos: g.lo, dir: 0, v: 0, state: 'idle', pass: [] }], q: {}, config: { skip: [], standby: 'none', rush: false, speed: 1, door: 'normal' } });
    this.objs.set(id, o);
    if (isT(tool)) this._markT(o);
    else for (let f = g.f; f < g.f + g.h; f++) for (let x = g.x; x < g.x + g.w; x++) this.grid[f][x] = id;
  }

  _markT(o, v = o.id) {
    const lo = o.lo ?? o.f, hi = o.hi ?? o.f;
    const extra = o.cars ? 1 : 0;
    for (let f = lo - extra; f <= hi + extra; f++) { const row = this.tgrid[f]; if (row) for (let x = o.x; x < o.x + o.w; x++) row[x] = v; }
  }
  _clearT(o) { this._markT(o, 0); }

  _remove(o) {
    if (!o) return;
    this.objs.delete(o.id);
    if (isT(o.type)) { this._clearT(o); return; }
    for (let f = o.f; f < o.f + o.h; f++) for (let x = o.x; x < o.x + o.w; x++) this.grid[f][x] = -1;
  }

  personAt(f, x, r = 1) {
    let best = null, bd = r;
    for (const p of this.active) { if (Math.round(p.f) !== f) continue; const d = Math.abs(p.x - x); if (d <= bd) { bd = d; best = p; } }
    return best;
  }
  drawPos(p) { return { x: p.x, f: p.f }; }
  describePerson(p) {
    return { title: p.name, subtitle: `${p.age}歳・${p.job}`, stats: [['いま', '1Fを歩いている'], ['行き先', '3F オフィス'], ['ストレス', `${Math.round(p.stress)}`], ['今日の予定', '9時出社・12時昼食・18時退社']], mood: p.stress < 30 ? 'good' : p.stress < 60 ? 'fair' : 'bad' };
  }
  blueprintOf(ids) {
    let x1 = 1e9, x2 = -1e9, f1 = 1e9, f2 = -1e9;
    for (const id of ids) { const o = this.objs.get(id); if (!o) continue; const lo = o.lo ?? o.f, hi = o.hi ?? o.f + o.h - 1; x1 = Math.min(x1, o.x); x2 = Math.max(x2, o.x + o.w - 1); f1 = Math.min(f1, lo); f2 = Math.max(f2, hi); }
    const bp = this.blueprint({ f1, x1, f2, x2 });
    const want = new Set(ids);
    // 選ばれていない施設は除く（フロアは残す）
    bp.ops = bp.ops.filter((op) => op.tool === 'floor' || [...this.objs.values()].some((o) => want.has(o.id) && o.type === op.tool && (o.lo ?? o.f) - f1 === op.p.f && o.x - x1 === op.p.x));
    bp.origin = { f: f1, x: x1 };
    return bp;
  }
  objAt(f, x) { const v = this.grid[f]?.[x]; return v > 0 ? this.objs.get(v) : null; }
  transportAt(f, x) { const v = this.tgrid[f]?.[x]; return v > 0 ? this.objs.get(v) : null; }
  evalLevel(o) { return ['good', 'fair', 'bad'][o.id % 3]; }
  isOpen(o) { const t = TYPES[o.type]; return !t.open || (this.hour >= t.open[0] && this.hour < t.open[1]); }

  describe(o) {
    const t = TYPES[o.type];
    const stats = [['場所', `${floorName(o.f)}`], ['幅', `${o.w}マス`]];
    const actions = [];
    if (o.cars) {
      stats.push(['範囲', `${floorName(o.lo)}〜${floorName(o.hi)}`], ['カゴ', `${o.cars.length}台`], ['平均待ち', `${(o.id % 7) + 0.5}分`]);
      actions.push({ id: 'addCar', label: 'カゴを増やす', cost: t.carCost, enabled: o.cars.length < t.maxCars });
      actions.push({ id: 'removeCar', label: 'カゴを減らす', cost: 0, enabled: o.cars.length > 1 });
    }
    actions.push({ id: 'remove', label: '撤去する', cost: 0, enabled: true, danger: true });
    const reasons = o.cars ? [] : [{ label: 'エレベーター待ちが長い（平均 6分）', level: 'bad' }, { label: '移動距離は短い', level: 'good' }, { label: '近くがややうるさい', level: 'fair' }];
    const reviews = t.cat === 'hotel' ? [
      { stars: 5, text: '眺めが最高でした', day: 3, name: '田中様' }, { stars: 2, text: 'エレベーターが全然来ない', day: 2, name: '伊藤様' },
      { stars: 4, text: '清潔で快適', day: 1, name: '渡辺様' }, { stars: 3, text: '隣の店が少しうるさい', day: 0, name: '中村様' }] : undefined;
    return { title: o.brand || t.name, subtitle: `${t.name}・${floorName(o.f)}`, stats, level: o.cars ? null : this.evalLevel(o), actions, reasons, reviews };
  }
  act(o, id) {
    if (id === 'remove') { this._remove(o); this.emit('sound', { name: 'bulldoze' }); return { ok: true }; }
    if (id === 'addCar') {
      const c = TYPES[o.type].carCost;
      if (this.money < c) return { ok: false, reason: '資金が足りません' };
      if (o.cars.length >= TYPES[o.type].maxCars) return { ok: false, reason: 'これ以上増やせません' };
      this.money -= c; this.ledger.expense += c;
      o.cars.push({ pos: o.lo, dir: 0, v: 0, state: 'idle', pass: [] });
      return { ok: true };
    }
    if (id === 'removeCar') { if (o.cars.length <= 1) return { ok: false, reason: '最低1台必要です' }; o.cars.pop(); return { ok: true }; }
    return { ok: false, reason: '未対応' };
  }
  setElevatorConfig(e, patch) {
    if (!e || !e.config) return { ok: false, reason: 'エレベーターではありません' };
    if (patch.skip && e.type === 'express' && patch.skip.some((f) => f >= 0 && !LOBBY_FLOORS.includes(f))) return { ok: false, reason: '急行はロビー階と地下階のみ' };
    Object.assign(e.config, patch);
    return { ok: true };
  }

  // ---- 一括コピー ----
  blueprint({ f1, x1, f2, x2 }) {
    const fa = Math.min(f1, f2), fb = Math.max(f1, f2), xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    const ops = [];
    const order = [];
    for (let f = Math.max(0, fa); f <= fb; f++) order.push(f);
    for (let f = Math.min(-1, fb); f >= fa; f--) order.push(f);
    const seen = new Set();
    for (const f of order) {
      const row = this.grid[f];
      if (!row) continue;
      let s = -1;
      for (let x = xa; x <= xb + 1; x++) {
        const on = x <= xb && row[x] !== 0;
        if (on && s < 0) s = x;
        if (!on && s >= 0) { ops.push({ tool: 'floor', p: { f: f - fa, x: s - xa, x2: x - 1 - xa } }); s = -1; }
      }
      for (let x = xa; x <= xb; x++) {
        const o = this.objAt(f, x);
        if (o && !seen.has(o.id) && o.f === f && o.x >= xa && o.x + o.w - 1 <= xb && o.f + o.h - 1 <= fb) { seen.add(o.id); ops.push({ tool: o.type, p: { f: o.f - fa, x: o.x - xa } }); }
      }
    }
    for (const o of this.objs.values()) {
      if (!isT(o.type) || seen.has(o.id)) continue;
      const lo = o.lo ?? o.f, hi = o.hi ?? o.f;
      if (o.x >= xa && o.x + o.w - 1 <= xb && lo >= fa && hi <= fb) {
        seen.add(o.id);
        ops.push(o.cars ? { tool: o.type, p: { f: lo - fa, x: o.x - xa, f2: hi - fa } } : { tool: o.type, p: { f: o.f - fa, x: o.x - xa } });
      }
    }
    return { w: xb - xa + 1, h: fb - fa + 1, ops };
  }
  checkBatch(ops) {
    let cost = 0, reason = '', failedIndex = -1;
    const ghosts = [];
    const claimed = new Set();
    ops.forEach((op, i) => {
      const t = TYPES[op.tool];
      const g = this._span(op.tool, op.p);
      const gh = t.drag === 'v' ? { x: g.x, w: g.w, lo: g.lo, hi: g.hi, type: op.tool } : { x: g.x, w: g.w, f: g.f, h: g.h, type: op.tool === 'floor' ? undefined : op.tool };
      let bad = '';
      if (g.x < 0 || g.x + g.w > W || g.f < MIN_F || g.f + g.h - 1 > MAX_F) bad = '範囲外です';
      else if (op.tool !== 'floor') {
        for (let f = g.f; f < g.f + g.h && !bad; f++) for (let x = g.x; x < g.x + g.w; x++) {
          const k = `${isT(op.tool) ? 't' : 'g'}${f},${x}`;
          if ((isT(op.tool) ? this.tgrid : this.grid)[f][x] > 0 || claimed.has(k)) { bad = 'ほかの施設と重なっています'; break; }
          claimed.add(k);
        }
      }
      cost += t.drag === 'h' ? t.costPerTile * g.w : (t.cost || 0);
      gh.ok = !bad;
      if (bad && failedIndex < 0) { failedIndex = i; reason = bad; }
      ghosts.push(gh);
    });
    if (failedIndex < 0 && cost > this.money) { reason = '資金が足りません'; failedIndex = 0; }
    return { ok: failedIndex < 0, cost, reason, failedIndex, ghosts };
  }
  buildBatch(ops) {
    const r = this.checkBatch(ops);
    if (!r.ok) { this.emit('sound', { name: 'error' }); return r; }
    for (const op of ops) {
      const c = this.check(op.tool, op.p);
      this._apply(op.tool, op.p, { cost: c.cost || 0 });
    }
    this.emit('sound', { name: 'build' });
    return r;
  }

  answer(id, value) {
    if (value === 'heli') this.heli = { x: W + 20, f: 12, phase: 'in', targetX: W / 2, targetF: 5 };
  }
  starProgress() {
    if (this.star >= 5) return { star: this.star, next: 'TOWER', reqs: [{ label: '100Fの大聖堂で結婚式', done: this.tower }] };
    const next = this.star + 1;
    return { star: this.star, next, reqs: [{ label: `人口 ${STAR_POP[next].toLocaleString()}人（現在 ${this.pop.toLocaleString()}）`, done: this.pop >= STAR_POP[next] }] };
  }
  serialize() {
    const grid = {}, tgrid = {};
    for (const f in this.grid) { grid[f] = Array.from(this.grid[f]); tgrid[f] = Array.from(this.tgrid[f]); }
    return { scenario: this.scenario, weather: this.weather, time: this.time, money: this.money, star: this.star, tower: this.tower, nextId: this.nextId, objs: [...this.objs.values()], grid, tgrid, ledger: this.ledger, yesterday: this.yesterday };
  }
  restore(o) {
    if (!o || typeof o.time !== 'number') throw new Error('bad save');
    Object.assign(this, { time: o.time, money: o.money, star: o.star, tower: o.tower, nextId: o.nextId, ledger: o.ledger, yesterday: o.yesterday });
    if (o.scenario) { this.scenario = o.scenario; this.theme = 'seaside'; this.minFloor = -2; this._introDone = true; }
    this.weather = o.weather || null;
    this.objs = new Map(o.objs.map((x) => [x.id, x]));
    for (const f in o.grid) this.grid[f] = Int32Array.from(o.grid[f]);
    for (const f in o.tgrid || {}) this.tgrid[f] = Int32Array.from(o.tgrid[f]);
  }
}
