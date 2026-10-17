// UI 開発用の最小モック Tower（SPEC の Sim API に沿った簡易版）。本番では使わない。
// index.html?mock で読み込まれる。
import { TYPES, W, MIN_F, MAX_F, DAY, STAR_POP, LOBBY_FLOORS, START_MONEY, floorName, fmtMoney } from '../js/sim/constants.js';

export class Tower {
  constructor() {
    this.time = 6 * 60;
    this.money = START_MONEY;
    this.pop = 0;
    this.star = 1;
    this.tower = false;
    this.ledger = { income: 0, expense: 0 };
    this.yesterday = null;
    this.grid = {};
    for (let f = MIN_F; f <= MAX_F; f++) this.grid[f] = new Int32Array(W);
    this.objs = new Map();
    this.nextId = 1;
    this.active = new Set();
    this.fires = [];
    this.bomb = null;
    this.effects = [];
    this.santa = null;
    this._h = {};
    this._nextPrompt = null;
  }
  get day() { return Math.floor(this.time / DAY); }
  get hour() { return Math.floor((this.time % DAY) / 60); }
  get minute() { return Math.floor(this.time % 60); }
  get weekday() { return this.day % 7; }

  on(n, fn) { (this._h[n] ||= []).push(fn); }
  emit(n, d) { for (const fn of this._h[n] || []) fn(d); }

  step(min) {
    const d0 = this.day;
    const h0 = this.hour;
    this.time += min;
    if (this.day !== d0) {
      this.yesterday = this.ledger;
      this.ledger = { income: 0, expense: 0 };
      this.emit('message', { text: `${this.day + 1}日目の朝です`, kind: 'info' });
    }
    if (this.hour !== h0 && this.hour === 12) {
      let rent = 0;
      for (const o of this.objs.values()) if (o.type === 'office') rent += TYPES.office.rent;
      if (rent) {
        this.money += rent; this.ledger.income += rent;
        this.emit('sound', { name: 'cash' });
        this.emit('message', { text: `賃料 ${fmtMoney(rent)} を受け取りました`, kind: 'money' });
      }
    }
    // 人口: 施設の cap 合計
    let pop = 0;
    for (const o of this.objs.values()) pop += (TYPES[o.type]?.cap || 0) * (o.type === 'elevator' ? 0 : 1) * 10;
    this.pop = pop;
    const want = STAR_POP.findLastIndex((p, i) => i >= 1 && pop >= p);
    if (want > this.star) {
      this.star = want;
      this.emit('star', { star: want });
      this.emit('sound', { name: 'fanfare' });
    }
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

  check(tool, p) {
    if (tool === 'bulldoze') {
      const g = this._span(tool, p);
      const ghost = { x: g.x, w: g.w, f: g.f, h: 1 };
      const row = this.grid[p.f];
      if (!row) return { ok: false, reason: '範囲外', cost: 0, ghost };
      for (let x = g.x; x < g.x + g.w; x++) if (row[x]) return { ok: true, reason: '', cost: 0, ghost };
      return { ok: false, reason: '撤去するものがありません', cost: 0, ghost };
    }
    const t = TYPES[tool];
    const g = this._span(tool, p);
    const ghost = t.drag === 'v' ? { x: g.x, w: g.w, lo: g.lo, hi: g.hi } : { x: g.x, w: g.w, f: g.f, h: g.h };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (this.star < t.star) return fail(`★${t.star}で解放`);
    if (g.x < 0 || g.x + g.w > W || g.f < MIN_F || g.f + g.h - 1 > MAX_F) return fail('範囲外です');
    if (t.only === 'lobbyFloor' && !LOBBY_FLOORS.includes(g.f)) return fail('ロビーは1Fと15F毎の階のみ');
    if (t.only === 'aboveGround' && g.f < 0) return fail('地上にのみ建てられます');
    if (t.only === 'basement' && g.f + g.h - 1 >= 0) return fail('地下にのみ建てられます');
    if (t.only === 'top' && g.f !== MAX_F) return fail('100Fにのみ建てられます');
    if (t.maxSpan && g.h > t.maxSpan) return fail(`最大${t.maxSpan}フロアまで`);
    let cost = t.cost || 0;
    if (t.drag === 'h') cost = t.costPerTile * g.w;
    for (let f = g.f; f < g.f + g.h; f++) {
      for (let x = g.x; x < g.x + g.w; x++) {
        const v = this.grid[f][x];
        if (v > 0) return fail('ほかの施設と重なっています');
        if (v === 0 && t.drag !== 'h') cost += 500;
        if (v === -1 && t.drag === 'h') cost -= t.costPerTile * (tool === 'floor' ? 1 : 0);
      }
    }
    const sf = g.f > 0 ? g.f - 1 : g.f < 0 ? g.f + g.h : null;
    if (sf !== null && sf !== g.f && g.f > 0) {
      for (let x = g.x; x < g.x + g.w; x++) if (!this.grid[sf][x]) return fail('下の階に支えがありません');
    }
    if (cost <= 0 && tool === 'floor') return fail('すでにフロアがあります');
    if (cost > this.money) return fail('資金が足りません');
    return { ok: true, reason: '', cost, ghost };
  }

  build(tool, p) {
    const r = this.check(tool, p);
    if (!r.ok) { this.emit('sound', { name: 'error' }); return r; }
    const g = this._span(tool, p);
    this.money -= r.cost; this.ledger.expense += r.cost;
    if (tool === 'bulldoze') {
      const ids = new Set();
      for (let x = g.x; x < g.x + g.w; x++) { const v = this.grid[p.f][x]; if (v > 0) ids.add(v); else if (v === -1) this.grid[p.f][x] = 0; }
      for (const id of ids) this._remove(this.objs.get(id));
      this.emit('sound', { name: 'bulldoze' });
      return r;
    }
    if (tool === 'floor') {
      for (let x = g.x; x < g.x + g.w; x++) if (!this.grid[g.f][x]) this.grid[g.f][x] = -1;
    } else {
      const id = this.nextId++;
      const o = { id, type: tool, f: g.f, x: g.x, w: g.w, h: g.h, occupied: true, inCount: 0 };
      if (TYPES[tool].drag === 'v') Object.assign(o, { lo: g.lo, hi: g.hi, cars: [{ pos: g.lo, dir: 0, state: 'idle', pass: [] }], q: {} });
      this.objs.set(id, o);
      for (let f = g.f; f < g.f + g.h; f++) for (let x = g.x; x < g.x + g.w; x++) this.grid[f][x] = id;
    }
    this.emit('sound', { name: 'build' });
    return r;
  }

  _remove(o) {
    if (!o) return;
    this.objs.delete(o.id);
    for (let f = o.f; f < o.f + o.h; f++) for (let x = o.x; x < o.x + o.w; x++) this.grid[f][x] = -1;
  }

  objAt(f, x) {
    const v = this.grid[f]?.[x];
    return v > 0 ? this.objs.get(v) : null;
  }
  evalLevel(o) { return ['good', 'fair', 'bad'][o.id % 3]; }
  isOpen(o) { const t = TYPES[o.type]; return !t.open || (this.hour >= t.open[0] && this.hour < t.open[1]); }

  describe(o) {
    const t = TYPES[o.type];
    const stats = [['場所', `${floorName(o.f)}`], ['幅', `${o.w}マス`]];
    const actions = [];
    if (o.cars) {
      stats.push(['範囲', `${floorName(o.lo)}〜${floorName(o.hi)}`], ['カゴ', `${o.cars.length}台`]);
      actions.push({ id: 'addCar', label: 'カゴを増やす', cost: t.carCost, enabled: o.cars.length < t.maxCars });
      actions.push({ id: 'removeCar', label: 'カゴを減らす', cost: 0, enabled: o.cars.length > 1 });
    }
    actions.push({ id: 'remove', label: '撤去する', cost: 0, enabled: true, danger: true });
    return { title: t.name, subtitle: `${floorName(o.f)} / ${this.isOpen(o) ? '営業中' : '営業時間外'}`, stats, level: o.cars ? null : this.evalLevel(o), actions };
  }
  act(o, id) {
    if (id === 'remove') { this._remove(o); this.emit('sound', { name: 'bulldoze' }); return { ok: true }; }
    if (id === 'addCar') {
      const c = TYPES[o.type].carCost;
      if (this.money < c) return { ok: false, reason: '資金が足りません' };
      this.money -= c; this.ledger.expense += c;
      o.cars.push({ pos: o.lo, dir: 0, state: 'idle', pass: [] });
      this.emit('sound', { name: 'build' });
      return { ok: true };
    }
    if (id === 'removeCar') { o.cars.pop(); return { ok: true }; }
    return { ok: false, reason: '未対応' };
  }
  answer(id, value) {
    this.emit('message', { text: `回答: ${id} = ${value}`, kind: 'event' });
  }
  starProgress() {
    if (this.star >= 5) return { star: this.star, next: this.tower ? null : 'TOWER', reqs: [{ label: '100Fの大聖堂で結婚式', done: this.tower }] };
    const next = this.star + 1;
    const reqs = [{ label: `人口 ${STAR_POP[next].toLocaleString()}人（現在 ${this.pop.toLocaleString()}）`, done: this.pop >= STAR_POP[next] }];
    if (next === 3) reqs.push({ label: '警備室', done: [...this.objs.values()].some((o) => o.type === 'security') });
    return { star: this.star, next, reqs };
  }
  serialize() {
    const grid = {};
    for (const f in this.grid) grid[f] = Array.from(this.grid[f]);
    return { time: this.time, money: this.money, star: this.star, tower: this.tower, nextId: this.nextId, objs: [...this.objs.values()], grid, ledger: this.ledger, yesterday: this.yesterday };
  }
  restore(o) {
    if (!o || typeof o.time !== 'number') throw new Error('bad save');
    Object.assign(this, { time: o.time, money: o.money, star: o.star, tower: o.tower, nextId: o.nextId, ledger: o.ledger, yesterday: o.yesterday });
    this.objs = new Map(o.objs.map((x) => [x.id, x]));
    for (const f in o.grid) this.grid[f] = Int32Array.from(o.grid[f]);
    this.step(0);
  }
  // テスト用
  _debugPrompt() {
    this.emit('prompt', { id: 'p1', kind: 'bomb', title: '爆破予告', text: 'テロリストから電話です。「身代金 $300,000 を払わなければビルを爆破する」', choices: [{ label: '払う ($300,000)', value: 'pay' }, { label: '拒否する', value: 'refuse' }] });
    this.emit('sound', { name: 'alarm' });
  }
}
