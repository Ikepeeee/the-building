'use strict';
// The Building: シミュレーション本体（DOM 非依存）
(function (root) {
  const W = 120;            // 横のマス数
  const MIN_F = -5;         // 最下層 (B5F)
  const MAX_F = 99;         // 最上層 (100F)
  const DAY = 1440;         // 1日 = 1440 分
  const CAP = 21;           // エレベーター定員
  const ELEV_SPEED = 6;     // 階/分
  const DOOR = 0.5;         // ドア開閉 (分)
  const WALK = 2.5;         // マス/分
  const STAIR_TIME = 1.5;   // 階段1階分 (分)
  const MAX_CARS = 8;
  const FLOOR_COST = 500;
  const STAR_POP = [0, 0, 300, 1000, 3000, 6000];
  const STAR_TOP = [0, 24, 39, 59, 98, 99];
  const WEEK = ['月', '火', '水', '木', '金', '土', '日'];

  const TYPES = {
    floor:      { name: 'フロア', cost: 500, star: 1, drag: true },
    lobby:      { name: 'ロビー', cost: 2000, star: 1, drag: true },
    stairs:     { name: '階段', w: 8, cost: 5000, star: 1 },
    elevator:   { name: 'エレベーター', w: 4, cost: 100000, perFloor: 3000, carCost: 50000, star: 1 },
    office:     { name: 'オフィス', w: 9, cost: 40000, star: 1, cap: 6, rent: 4000, tenant: true },
    condo:      { name: 'マンション', w: 16, cost: 80000, star: 1, cap: 3, sale: 150000, tenant: true, noBasement: true },
    hotel:      { name: 'ホテル', w: 6, cost: 30000, star: 2, price: 1500, noBasement: true },
    fastfood:   { name: 'ファストフード', w: 16, cost: 100000, star: 1, price: 60, open: [10, 21], shop: true },
    restaurant: { name: 'レストラン', w: 24, cost: 200000, star: 3, price: 200, open: [17, 24], shop: true },
    shop:       { name: 'ショップ', w: 12, cost: 100000, star: 3, price: 120, open: [10, 21], shop: true },
  };

  const rand = (n) => Math.random() * n;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const dkey = (d) => (d > 0 ? 'up' : 'down');
  const floorName = (f) => (f >= 0 ? `${f + 1}F` : `B${-f}F`);
  const legTo = (p) => p.legs[p.li].to;

  class Heap {
    constructor() { this.a = []; }
    push(t, fn) {
      const a = this.a; a.push({ t, fn });
      let i = a.length - 1;
      while (i > 0) {
        const j = (i - 1) >> 1;
        if (a[j].t <= a[i].t) break;
        [a[i], a[j]] = [a[j], a[i]]; i = j;
      }
    }
    peek() { return this.a[0]; }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && a[l].t < a[m].t) m = l;
          if (r < a.length && a[r].t < a[m].t) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }

  class Tower {
    constructor() { this.onMessage = null; this.reset(); }

    reset() {
      this.money = 2000000;
      this.time = 6 * 60;
      this.star = 1;
      this.nextId = 1;
      this.towerDone = false;
      this.grid = {};
      for (let f = MIN_F; f <= MAX_F; f++) this.grid[f] = new Int32Array(W);
      this.objs = new Map();
      this.active = new Set();
      this.events = new Heap();
      this.pop = 0;
      this.ledger = { income: 0, expense: 0 };
      this.yesterday = null;
      this.reindex();
    }

    // ---------- 基本 ----------
    msg(text, kind = 'info') { if (this.onMessage) this.onMessage(text, kind); }
    get day() { return Math.floor(this.time / DAY); }
    get hour() { return Math.floor(this.time / 60) % 24; }
    isWeekday(d = this.day) { return d % 7 < 5; }
    topFloor() { return STAR_TOP[this.star]; }
    cell(f, x) { const r = this.grid[f]; return r && x >= 0 && x < W ? r[x] : 0; }
    supported(f, x) {
      if (f === 0) return true;
      return f > 0 ? this.cell(f - 1, x) !== 0 : this.cell(f + 1, x) !== 0;
    }
    earn(v) { this.money += v; this.ledger.income += v; }
    spend(v) { this.money -= v; this.ledger.expense += v; }
    at(t, from, fn) { if (t >= from) this.events.push(t, fn); }
    later(mins, fn) { this.events.push(this.time + mins, fn); }
    isOpen(o, h = this.hour) { const [a, b] = TYPES[o.type].open; return h >= a && h < b; }
    evalOf(o) { return o.evalN ? o.evalSum / o.evalN : o.eval; }
    evalFactor(o) { const e = this.evalOf(o); return e < 20 ? 1 : e < 45 ? 0.6 : 0.25; }
    recordEval(o, s) { if (!o || o.dead) return; o.evalSum += s; o.evalN++; }

    reindex() {
      this.elevs = []; this.stairsAt = new Map(); this.facs = []; this.lobbyXs = [];
      for (const o of this.objs.values()) {
        if (o.type === 'elevator') this.elevs.push(o);
        else if (o.type === 'stairs') {
          if (!this.stairsAt.has(o.f)) this.stairsAt.set(o.f, []);
          this.stairsAt.get(o.f).push(o);
        } else if (o.type !== 'lobby') this.facs.push(o);
      }
      for (let x = 0; x < W; x++) {
        const o = this.objs.get(this.grid[0][x]);
        if (o && o.type === 'lobby') this.lobbyXs.push(x);
      }
      this.routeCache = new Map();
    }

    // ---------- 建設 ----------
    checkRect(type, f, x, w) {
      const T = TYPES[type];
      const r = { ok: false, cost: 0, reason: '', type, f, x, w };
      const fail = (s) => { r.reason = s; return r; };
      if (T.star > this.star) return fail(`★${T.star}で解放されます`);
      if (w <= 0 || x < 0 || x + w > W) return fail('建設範囲の外です');
      if (f < MIN_F) return fail('これ以上深くは掘れません');
      if (f > this.topFloor()) return fail(`現在の★では${floorName(this.topFloor())}までです`);
      if (type === 'lobby' && f !== 0) return fail('ロビーは1Fにのみ設置できます');
      if (T.noBasement && f < 0) return fail('地下には設置できません');
      if (type === 'stairs' && f + 1 > this.topFloor()) return fail('上の階が建設できません');
      let fresh = 0;
      for (let xi = x; xi < x + w; xi++) {
        const c = this.cell(f, xi);
        if (c > 0) {
          if (type === 'floor') continue;
          return fail('他の施設と重なっています');
        }
        if (c === 0) {
          if (!this.supported(f, xi)) return fail(f < 0 ? '上の階に支えがありません' : '下の階に支えがありません');
          fresh++;
        }
        if (type === 'stairs' && this.cell(f + 1, xi) === 0) return fail('上の階にフロアが必要です');
      }
      if (type === 'floor') {
        if (!fresh) return fail('すでにフロアがあります');
        r.cost = fresh * FLOOR_COST;
      } else if (type === 'lobby') r.cost = T.cost * w;
      else r.cost = T.cost + fresh * FLOOR_COST;
      if (r.cost > this.money) return fail('資金が足りません');
      r.ok = true;
      return r;
    }

    place(type, f, x, w) {
      const r = this.checkRect(type, f, x, w);
      if (!r.ok) return r;
      this.spend(r.cost);
      if (type === 'floor') {
        for (let xi = x; xi < x + w; xi++) if (this.grid[f][xi] === 0) this.grid[f][xi] = -1;
      } else {
        const o = this.makeObj(type, f, x, w);
        for (let xi = x; xi < x + w; xi++) this.grid[f][xi] = o.id;
      }
      this.reindex();
      this.checkTower();
      return r;
    }

    makeObj(type, f, x, w) {
      const T = TYPES[type];
      const o = {
        id: this.nextId++, type, f, x, w, dead: false,
        occupied: !!T.shop, eval: 0, evalSum: 0, evalN: 0, badDays: 0,
        members: [], inCount: 0, paid: false, sales: 0,
      };
      this.objs.set(o.id, o);
      return o;
    }

    checkElevator(x, fa, fb, self = 0) {
      const T = TYPES.elevator;
      const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
      const r = { ok: false, cost: 0, reason: '', type: 'elevator', x, w: T.w, lo, hi };
      const fail = (s) => { r.reason = s; return r; };
      if (x < 0 || x + T.w > W) return fail('建設範囲の外です');
      if (lo < MIN_F) return fail('これ以上深くは掘れません');
      if (hi > this.topFloor()) return fail(`現在の★では${floorName(this.topFloor())}までです`);
      if (hi - lo < 1) return fail('上下にドラッグして2フロア以上にしてください');
      for (let f = lo; f <= hi; f++) {
        for (let xi = x; xi < x + T.w; xi++) {
          const c = this.cell(f, xi);
          if (c > 0 && c !== self) return fail('他の施設と重なっています');
        }
      }
      for (let xi = x; xi < x + T.w; xi++) {
        if (lo > 0 && this.cell(lo - 1, xi) === 0) return fail('下の階に支えがありません');
        if (hi < 0 && this.cell(hi + 1, xi) === 0) return fail('上の階に支えがありません');
      }
      r.cost = self ? T.perFloor * 2 : T.cost + T.perFloor * (hi - lo + 1);
      if (r.cost > this.money) return fail('資金が足りません');
      r.ok = true;
      return r;
    }

    placeElevator(x, fa, fb) {
      const r = this.checkElevator(x, fa, fb);
      if (!r.ok) return r;
      this.spend(r.cost);
      const o = this.makeObj('elevator', r.lo, x, r.w);
      o.lo = r.lo; o.hi = r.hi; o.q = {}; o.cars = [this.newCar(r.lo)];
      for (let f = r.lo; f <= r.hi; f++) for (let xi = x; xi < x + r.w; xi++) this.grid[f][xi] = o.id;
      this.reindex();
      this.checkTower();
      return r;
    }

    newCar(f) { return { pos: f, dir: 0, state: 'idle', timer: 0, pass: [], target: null }; }

    extendElevator(e, dir) {
      const lo = dir < 0 ? e.lo - 1 : e.lo, hi = dir > 0 ? e.hi + 1 : e.hi;
      const r = this.checkElevator(e.x, lo, hi, e.id);
      if (!r.ok) return r;
      this.spend(r.cost);
      const f = dir > 0 ? hi : lo;
      for (let xi = e.x; xi < e.x + e.w; xi++) this.grid[f][xi] = e.id;
      e.lo = lo; e.hi = hi; e.f = lo;
      this.reindex();
      this.checkTower();
      return r;
    }

    addCar(e) {
      const T = TYPES.elevator;
      if (e.cars.length >= MAX_CARS) return { ok: false, reason: `カゴは最大${MAX_CARS}台です` };
      if (this.money < T.carCost) return { ok: false, reason: '資金が足りません' };
      this.spend(T.carCost);
      e.cars.push(this.newCar(e.lo));
      return { ok: true, cost: T.carCost };
    }

    removeCar(e) {
      if (e.cars.length <= 1) return { ok: false, reason: 'カゴは最低1台必要です' };
      let ci = 0;
      e.cars.forEach((c, i) => { if (c.pass.length < e.cars[ci].pass.length) ci = i; });
      const c = e.cars.splice(ci, 1)[0];
      for (const p of c.pass) this.dropOff(e, p, Math.round(c.pos));
      return { ok: true };
    }

    remove(f, x) {
      const c = this.cell(f, x);
      if (c === 0) return { ok: false, reason: '何もありません' };
      if (c === -1) {
        if (f >= 0 && this.cell(f + 1, x) !== 0) return { ok: false, reason: '上の階を先に撤去してください' };
        if (f <= 0 && this.cell(f - 1, x) !== 0) return { ok: false, reason: '下の階を先に撤去してください' };
        this.grid[f][x] = 0;
        this.reindex();
        return { ok: true };
      }
      this.removeObj(this.objs.get(c));
      return { ok: true };
    }

    removeObj(o) {
      o.dead = true;
      if (o.type === 'elevator') {
        for (let f = o.lo; f <= o.hi; f++) for (let xi = o.x; xi < o.x + o.w; xi++) this.grid[f][xi] = -1;
      } else {
        for (let xi = o.x; xi < o.x + o.w; xi++) this.grid[o.f][xi] = -1;
      }
      for (const p of o.members.slice()) this.purge(p);
      o.members = [];
      this.objs.delete(o.id);
      this.reindex();
      if (o.type === 'elevator') {
        for (const c of o.cars) for (const p of c.pass) this.dropOff(o, p, Math.round(c.pos));
        for (const f in o.q) for (const k of ['up', 'down']) for (const p of o.q[f][k]) this.dropOff(o, p, +f);
      }
      this.recalcPop();
    }

    dropOff(e, p, f) {
      p.f = Math.max(e.lo, Math.min(e.hi, f));
      p.x = e.x + e.w + 0.3;
      p.car = null; p.elev = null; p.state = 'walk';
      this.reroute(p);
    }

    checkTower() {
      if (this.towerDone || this.star < 5) return;
      if (this.grid[MAX_F].some((c) => c !== 0)) {
        this.towerDone = true;
        this.msg('🏆 100Fに到達！ あなたのビルは「タワー」に認定されました！', 'star');
      }
    }

    recalcPop() {
      let pop = 0;
      for (const o of this.facs) {
        if (o.type === 'office' && o.occupied) pop += TYPES.office.cap;
        else if (o.type === 'condo' && o.occupied) pop += TYPES.condo.cap;
        else if (o.type === 'hotel') pop += o.members.length;
      }
      this.pop = pop;
      while (this.star < 5 && pop >= STAR_POP[this.star + 1]) {
        this.star++;
        const unlocked = Object.values(TYPES).filter((t) => t.star === this.star).map((t) => t.name);
        this.msg(`★${this.star} に昇格！ ${floorName(this.topFloor())}まで建設可能${unlocked.length ? '・' + unlocked.join('/') + 'が解放' : ''}`, 'star');
        this.checkTower();
      }
    }

    // ---------- 経路 ----------
    route(a, b) {
      if (a === b) return [];
      const key = a * 1000 + b;
      if (this.routeCache.has(key)) return this.routeCache.get(key);
      const N = MAX_F - MIN_F + 1;
      const dist = new Float64Array(N).fill(Infinity);
      const prev = new Array(N);
      const done = new Uint8Array(N);
      dist[a - MIN_F] = 0;
      const relax = (u, v, cost, leg) => {
        const i = v - MIN_F;
        if (dist[u] + cost < dist[i]) { dist[i] = dist[u] + cost; prev[i] = leg; }
      };
      for (;;) {
        let u = -1, best = Infinity;
        for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0 || u === b - MIN_F) break;
        done[u] = 1;
        const fu = u + MIN_F;
        for (const e of this.elevs) {
          if (fu < e.lo || fu > e.hi) continue;
          for (let v = e.lo; v <= e.hi; v++) {
            if (v !== fu) relax(u, v, 4 + 0.15 * Math.abs(v - fu), { kind: 'elev', from: fu, to: v });
          }
        }
        if (this.stairsAt.has(fu)) relax(u, fu + 1, 2, { kind: 'stairs', from: fu, to: fu + 1 });
        if (this.stairsAt.has(fu - 1)) relax(u, fu - 1, 2, { kind: 'stairs', from: fu, to: fu - 1 });
      }
      let legs = null;
      if (dist[b - MIN_F] < Infinity) {
        legs = [];
        for (let f = b; f !== a;) { const leg = prev[f - MIN_F]; legs.unshift(leg); f = leg.from; }
      }
      this.routeCache.set(key, legs);
      return legs;
    }

    pickElevator(a, b, x) {
      let best = null, bs = Infinity;
      const lo = Math.min(a, b), hi = Math.max(a, b), k = dkey(b - a);
      for (const e of this.elevs) {
        if (e.lo > lo || e.hi < hi) continue;
        const q = e.q[a];
        const s = Math.abs(e.x - x) * 0.1 + (q ? q[k].length : 0) / e.cars.length;
        if (s < bs) { bs = s; best = e; }
      }
      return best;
    }

    pickStairs(f, x) {
      let best = null, bd = Infinity;
      for (const s of this.stairsAt.get(f) || []) {
        const d = Math.abs(s.x + s.w / 2 - x);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }

    // ---------- 人の移動 ----------
    newPerson(kind, home) {
      return { id: this.nextId++, kind, home, f: 0, x: 0, stress: 0, state: 'out',
        legs: null, li: 0, tx: 0, dest: null, loc: null, elev: null, car: null, legObj: null, stairT: 0, waitT: 0 };
    }

    spawnAtLobby(p) {
      if (!this.lobbyXs.length) return false;
      p.f = 0; p.x = pick(this.lobbyXs) + 0.5; p.state = 'walk';
      this.active.add(p);
      return true;
    }

    startTrip(p, f, x, cb) {
      const legs = this.route(p.f, f);
      if (!legs) return false;
      if (p.state === 'in' && p.loc) p.loc.inCount--;
      p.loc = null;
      p.stress = 0;
      p.legs = legs; p.li = 0; p.dest = { f, x, cb };
      p.state = 'walk';
      this.active.add(p);
      this.aimNext(p);
      return true;
    }

    reroute(p, depth = 0) {
      const legs = p.dest && this.route(p.f, p.dest.f);
      if (!legs || depth > 3) { this.purge(p, p.kind !== 'visitor'); return; }
      p.legs = legs; p.li = 0; p.state = 'walk';
      this.active.add(p);
      this.aimNext(p, depth + 1);
    }

    aimNext(p, depth = 0) {
      if (p.li >= p.legs.length) { p.legObj = null; p.tx = p.dest.x; return; }
      const leg = p.legs[p.li];
      if (leg.kind === 'elev') {
        const e = this.pickElevator(leg.from, leg.to, p.x);
        if (!e) return this.reroute(p, depth);
        p.legObj = e; p.tx = e.x - 0.4;
      } else {
        const s = this.pickStairs(Math.min(leg.from, leg.to), p.x);
        if (!s) return this.reroute(p, depth);
        p.legObj = s; p.tx = leg.to > leg.from ? s.x + 0.5 : s.x + s.w - 0.5;
      }
    }

    updatePerson(p, dt) {
      switch (p.state) {
        case 'walk': {
          const d = p.tx - p.x, step = WALK * dt;
          p.stress += 0.03 * dt;
          if (Math.abs(d) <= step) { p.x = p.tx; this.reached(p); } else p.x += Math.sign(d) * step;
          break;
        }
        case 'wait':
          p.waitT += dt;
          if (p.waitT > 3) p.stress += 0.6 * dt;
          break;
        case 'stairs': {
          p.stairT += dt;
          if (p.stairT >= STAIR_TIME) {
            const leg = p.legs[p.li], s = p.legObj;
            p.f = leg.to;
            p.x = leg.to > leg.from ? s.x + s.w - 0.5 : s.x + 0.5;
            p.li++; p.state = 'walk';
            this.aimNext(p);
          }
          break;
        }
      }
      if (p.stress > 100) p.stress = 100;
    }

    reached(p) {
      if (p.li >= p.legs.length) {
        const cb = p.dest.cb;
        p.legs = null; p.dest = null; p.state = 'arrived';
        cb(p);
        if (p.state === 'arrived') this.exit(p);
        return;
      }
      const leg = p.legs[p.li], o = p.legObj;
      if (!o || o.dead) { this.aimNext(p); return; }
      if (leg.kind === 'elev') {
        const q = o.q[leg.from] || (o.q[leg.from] = { up: [], down: [] });
        q[dkey(leg.to - leg.from)].push(p);
        p.state = 'wait'; p.waitT = 0; p.elev = o;
      } else {
        p.state = 'stairs'; p.stairT = 0; p.stress += 3;
      }
    }

    settle(p, o) {
      this.active.delete(p);
      p.state = 'in'; p.loc = o; o.inCount++;
    }

    exit(p) {
      this.active.delete(p);
      p.loc = null;
      p.state = p.kind === 'visitor' ? 'gone' : 'out';
    }

    purge(p, keep = false) {
      if (p.state === 'wait' && p.elev) {
        const q = p.elev.q[p.f];
        if (q) for (const k of ['up', 'down']) { const i = q[k].indexOf(p); if (i >= 0) q[k].splice(i, 1); }
      }
      if (p.state === 'ride' && p.car) { const i = p.car.pass.indexOf(p); if (i >= 0) p.car.pass.splice(i, 1); }
      if (p.state === 'in' && p.loc) p.loc.inCount--;
      this.active.delete(p);
      p.loc = null; p.elev = null; p.car = null;
      p.state = keep ? 'out' : 'gone';
      if (!keep && p.kind === 'guest') this.releaseGuest(p);
    }

    // ---------- エレベーター ----------
    hasCall(e, g) { const q = e.q[g]; return q && (q.up.length || q.down.length); }

    beyond(e, c, f, dir) {
      for (const p of c.pass) if ((legTo(p) - f) * dir > 0) return true;
      if (dir > 0) { for (let g = f + 1; g <= e.hi; g++) if (this.hasCall(e, g)) return true; }
      else { for (let g = f - 1; g >= e.lo; g--) if (this.hasCall(e, g)) return true; }
      return false;
    }

    updateCar(e, c, dt) {
      if (c.state === 'doors') { c.timer -= dt; if (c.timer > 0) return; c.state = 'idle'; }
      if (c.state === 'idle') {
        const f = Math.round(c.pos); c.pos = f;
        if (c.pass.length) {
          if (!c.dir) c.dir = Math.sign(legTo(c.pass[0]) - f) || 1;
          if (!this.beyond(e, c, f, c.dir)) c.dir = -c.dir;
        } else {
          const q = e.q[f];
          if (q && (q.up.length || q.down.length)) {
            const d = c.dir && q[dkey(c.dir)].length ? c.dir : (q.up.length ? 1 : -1);
            this.serve(e, c, f, d);
            return;
          }
          if (!(c.dir && this.beyond(e, c, f, c.dir))) {
            let best = null, bd = Infinity;
            for (let g = e.lo; g <= e.hi; g++) {
              if (!this.hasCall(e, g) || e.cars.some((o) => o !== c && o.target === g)) continue;
              const d = Math.abs(g - f);
              if (d < bd) { bd = d; best = g; }
            }
            if (best === null) { c.dir = 0; return; }
            c.target = best; c.dir = Math.sign(best - f);
          }
        }
        c.state = 'moving';
      }
      if (c.state === 'moving') {
        let rem = ELEV_SPEED * dt;
        while (rem > 0) {
          const next = c.dir > 0 ? Math.floor(c.pos + 1e-6) + 1 : Math.ceil(c.pos - 1e-6) - 1;
          const dist = Math.abs(next - c.pos);
          if (dist > rem) { c.pos += c.dir * rem; break; }
          c.pos = next; rem -= dist;
          if (this.shouldStop(e, c, next)) { this.serve(e, c, next, c.dir); break; }
        }
      }
    }

    shouldStop(e, c, g) {
      if (g <= e.lo || g >= e.hi) return true;
      if (c.target === g) return true;
      for (const p of c.pass) if (legTo(p) === g) return true;
      const q = e.q[g];
      if (!q) return false;
      if (q[dkey(c.dir)].length && c.pass.length < CAP) return true;
      if (q[dkey(-c.dir)].length && !c.pass.length && !this.beyond(e, c, g, c.dir)) return true;
      return false;
    }

    serve(e, c, g, dir) {
      if (c.target === g) c.target = null;
      let moved = 0;
      const stay = [];
      for (const p of c.pass) {
        if (legTo(p) === g) {
          p.f = g; p.x = e.x + e.w + 0.3; p.car = null; p.elev = null;
          p.li++; p.state = 'walk';
          this.aimNext(p);
          moved++;
        } else stay.push(p);
      }
      c.pass = stay;
      if (g >= e.hi) dir = -1;
      if (g <= e.lo) dir = 1;
      const q = e.q[g];
      if (q) {
        if (!q[dkey(dir)].length && !c.pass.length && !this.beyond(e, c, g, dir) && q[dkey(-dir)].length) dir = -dir;
        const line = q[dkey(dir)];
        while (line.length && c.pass.length < CAP) {
          const p = line.shift();
          p.state = 'ride'; p.car = c; c.pass.push(p);
          moved++;
        }
      }
      c.dir = dir; c.state = 'doors'; c.timer = DOOR + moved * 0.03;
    }

    // ---------- 時間 ----------
    step(dt) {
      while (dt > 1e-9) { const h = Math.min(dt, 0.25); dt -= h; this.tick(h); }
    }

    tick(h) {
      const prevDay = this.day, prevHour = Math.floor(this.time / 60);
      this.time += h;
      if (this.day !== prevDay) { this.endDay(); this.planDay(this.day, this.day * DAY); }
      if (Math.floor(this.time / 60) !== prevHour) this.hourly(this.hour);
      while (this.events.peek() && this.events.peek().t <= this.time) this.events.pop().fn();
      for (const e of this.elevs) for (const c of e.cars) this.updateCar(e, c, h);
      for (const p of this.active) this.updatePerson(p, h);
    }

    hourly(h) {
      if (h === 6) this.tenancy();
      if (h === 12 && this.isWeekday()) {
        let n = 0;
        for (const o of this.facs) if (o.type === 'office' && o.occupied) { this.earn(TYPES.office.rent); n++; }
        if (n) this.msg(`オフィス賃料 $${(n * TYPES.office.rent).toLocaleString()} を受け取りました`, 'money');
      }
      if (h === 16) this.hotelBookings();
      this.spawnVisitors(h);
    }

    endDay() {
      let cars = 0;
      for (const e of this.elevs) cars += e.cars.length;
      if (cars) this.spend(cars * 600);
      const left = [];
      for (const o of this.facs) {
        if (o.evalN) o.eval = o.evalSum / o.evalN;
        o.evalSum = 0; o.evalN = 0;
        if ((o.type === 'office' || o.type === 'condo') && o.occupied) {
          if (o.eval >= 45) {
            if (++o.badDays >= 2) { this.vacate(o); left.push(o); }
          } else o.badDays = 0;
        }
      }
      if (left.length) this.msg(`評価が悪く ${left.map((o) => floorName(o.f) + 'の' + TYPES[o.type].name).join('、')} が退去しました`, 'bad');
      this.yesterday = { ...this.ledger };
      this.ledger = { income: 0, expense: 0 };
      this.recalcPop();
    }

    vacate(o) {
      for (const p of o.members.slice()) this.purge(p);
      o.members = []; o.occupied = false; o.badDays = 0;
    }

    tenancy() {
      if (!this.lobbyXs.length) return;
      const moved = { office: 0, condo: 0 };
      for (const o of this.facs) {
        if (o.occupied || (o.type !== 'office' && o.type !== 'condo')) continue;
        if (!this.route(0, o.f)) continue;
        const p = (o.type === 'office' ? 0.45 : 0.3) * (o.eval >= 45 ? 0.3 : 1);
        if (Math.random() < p) { this.moveIn(o); moved[o.type]++; }
      }
      const parts = [];
      if (moved.office) parts.push(`オフィス${moved.office}件`);
      if (moved.condo) parts.push(`マンション${moved.condo}件`);
      if (parts.length) this.msg(`${parts.join('・')}に新しい入居者が決まりました`, 'good');
      this.recalcPop();
    }

    moveIn(o) {
      const T = TYPES[o.type];
      o.occupied = true; o.badDays = 0; o.evalSum = 0; o.evalN = 0; o.eval = 0;
      o.members = [];
      for (let i = 0; i < T.cap; i++) o.members.push(this.newPerson(o.type === 'office' ? 'worker' : 'resident', o));
      if (o.type === 'condo') {
        this.earn(T.sale);
        for (const p of o.members) this.later(60 + rand(400), () => this.enterBuilding(p));
      } else this.planOffice(o, this.day, this.time);
    }

    hotelBookings() {
      if (!this.lobbyXs.length) return;
      const d = this.day;
      for (const o of this.facs) {
        if (o.type !== 'hotel' || o.occupied || !this.route(0, o.f)) continue;
        if (Math.random() >= 0.65 * this.evalFactor(o)) continue;
        o.occupied = true; o.paid = false; o.members = [];
        const n = Math.random() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const p = this.newPerson('guest', o);
          o.members.push(p);
          this.later(rand(240), () => this.enterBuilding(p));
          if (Math.random() < 0.35) this.at(d * DAY + 19 * 60 + rand(120), 0, () => this.outing(p, ['restaurant', 'fastfood']));
          this.at((d + 1) * DAY + 420 + rand(180), 0, () => this.checkout(p));
        }
      }
      this.recalcPop();
    }

    checkout(p) {
      if (p.state === 'gone') return;
      if (p.state === 'out') { this.releaseGuest(p); return; }
      this.leaveBuilding(p, () => this.releaseGuest(p));
    }

    releaseGuest(p) {
      const o = p.home;
      if (!o) return;
      o.members = o.members.filter((m) => m !== p);
      if (!o.members.length && o.occupied) { o.occupied = false; o.paid = false; this.recalcPop(); }
    }

    spawnVisitors(h) {
      if (!this.lobbyXs.length) return;
      const base = 0.6 + this.pop / 150;
      for (const o of this.facs) {
        if (!TYPES[o.type].shop || !this.isOpen(o, h) || !this.route(0, o.f)) continue;
        const n = Math.min(15, Math.round(Math.random() * base * 2 * this.evalFactor(o)));
        for (let i = 0; i < n; i++) this.later(rand(55), () => this.visit(o));
      }
    }

    planDay(day, from) {
      for (const o of this.facs) {
        if (o.type === 'office') this.planOffice(o, day, from);
        else if (o.type === 'condo') this.planCondo(o, day, from);
      }
    }

    planOffice(o, day, from) {
      if (!o.occupied || !this.isWeekday(day)) return;
      const b = day * DAY;
      for (const p of o.members) {
        this.at(b + 420 + rand(120), from, () => this.enterBuilding(p));
        if (Math.random() < 0.6) this.at(b + 700 + rand(50), from, () => this.outing(p, ['fastfood', 'restaurant']));
        this.at(b + 1020 + rand(100), from, () => this.leaveBuilding(p));
      }
    }

    planCondo(o, day, from) {
      if (!o.occupied) return;
      const b = day * DAY, types = ['shop', 'restaurant', 'fastfood'];
      for (const p of o.members) {
        if (this.isWeekday(day) && Math.random() < 0.7) {
          this.at(b + 420 + rand(120), from, () => this.leaveBuilding(p));
          this.at(b + 1020 + rand(180), from, () => this.enterBuilding(p));
          if (Math.random() < 0.25) this.at(b + 1200 + rand(90), from, () => this.outing(p, types));
        } else if (Math.random() < 0.7) {
          this.at(b + 600 + rand(480), from, () => this.outing(p, types));
        }
      }
    }

    // ---------- 行動 ----------
    enterBuilding(p) {
      const h = p.home;
      if (p.state !== 'out' || !h || h.dead || !h.occupied) return;
      if (!this.spawnAtLobby(p)) { this.recordEval(h, 100); return; }
      const ok = this.startTrip(p, h.f, h.x + 1 + rand(h.w - 2), () => {
        this.recordEval(h, p.stress);
        this.settle(p, h);
        if (h.type === 'hotel' && !h.paid) { this.earn(TYPES.hotel.price); h.paid = true; }
      });
      if (!ok) { this.recordEval(h, 100); this.exit(p); }
    }

    leaveBuilding(p, onExit = null, tries = 0) {
      if (p.state === 'gone' || p.state === 'out') { if (onExit) onExit(); return; }
      if (p.state !== 'in') {
        if (tries < 40) this.later(10, () => this.leaveBuilding(p, onExit, tries + 1));
        else { this.purge(p, p.kind !== 'visitor'); if (onExit) onExit(); }
        return;
      }
      const home = p.kind === 'visitor' ? null : p.home;
      const ok = this.lobbyXs.length && this.startTrip(p, 0, pick(this.lobbyXs) + 0.5, () => {
        this.recordEval(home, p.stress);
        this.exit(p);
        if (onExit) onExit();
      });
      if (!ok) {
        this.recordEval(home, 90);
        if (p.kind === 'visitor' || onExit) { this.purge(p, p.kind !== 'visitor'); if (onExit) onExit(); }
      }
    }

    outing(p, types) {
      if (p.state !== 'in') return;
      const cands = this.facs
        .filter((o) => types.includes(o.type) && this.isOpen(o) && this.route(p.f, o.f))
        .sort((a, b) => Math.abs(a.f - p.f) - Math.abs(b.f - p.f))
        .slice(0, 3);
      if (!cands.length) return;
      const o = pick(cands);
      this.startTrip(p, o.f, o.x + 1 + rand(o.w - 2), () => this.atShop(p, o));
    }

    visit(o) {
      if (o.dead) return;
      const p = this.newPerson('visitor', null);
      if (!this.spawnAtLobby(p)) return;
      if (!this.startTrip(p, o.f, o.x + 1 + rand(o.w - 2), () => this.atShop(p, o))) this.exit(p);
    }

    atShop(p, o) {
      if (o.dead) { this.afterVisit(p); return; }
      this.settle(p, o);
      if (!this.isOpen(o)) { this.afterVisit(p); return; }
      this.earn(TYPES[o.type].price);
      o.sales += TYPES[o.type].price;
      this.recordEval(o, p.stress);
      this.later(20 + rand(40), () => this.afterVisit(p));
    }

    afterVisit(p) {
      if (p.state === 'gone') return;
      if (p.kind === 'visitor') { this.leaveBuilding(p); return; }
      const h = p.home;
      if (p.state !== 'in') return;
      if (!h || h.dead || !h.occupied) { this.leaveBuilding(p); return; }
      const ok = this.startTrip(p, h.f, h.x + 1 + rand(h.w - 2), () => {
        this.recordEval(h, p.stress);
        this.settle(p, h);
      });
      if (!ok) this.leaveBuilding(p);
    }

    // ---------- 保存 ----------
    serialize() {
      const cells = {};
      for (let f = MIN_F; f <= MAX_F; f++) {
        const row = this.grid[f];
        if (row.some((c) => c !== 0)) cells[f] = Array.from(row, (c) => (c ? '1' : '0')).join('');
      }
      const objs = [...this.objs.values()].map((o) => {
        const s = { id: o.id, type: o.type, f: o.f, x: o.x, w: o.w };
        if (o.type === 'elevator') { s.lo = o.lo; s.hi = o.hi; s.cars = o.cars.length; }
        if (o.type === 'office' || o.type === 'condo') { s.occupied = o.occupied; s.eval = o.eval; s.badDays = o.badDays; }
        if (TYPES[o.type].shop) s.eval = o.eval;
        return s;
      });
      return { v: 1, money: this.money, time: this.time, star: this.star, nextId: this.nextId, towerDone: this.towerDone, cells, objs };
    }

    restore(d) {
      this.reset();
      this.money = d.money; this.time = d.time; this.star = d.star; this.nextId = d.nextId; this.towerDone = !!d.towerDone;
      for (const f in d.cells) {
        const s = d.cells[f];
        for (let x = 0; x < W; x++) if (s[x] === '1') this.grid[f][x] = -1;
      }
      for (const s of d.objs) {
        const o = this.makeObj(s.type, s.f, s.x, s.w);
        this.objs.delete(o.id);
        o.id = s.id;
        this.objs.set(o.id, o);
        if (s.eval) o.eval = s.eval;
        if (o.type === 'elevator') {
          o.lo = s.lo; o.hi = s.hi; o.q = {};
          o.cars = Array.from({ length: s.cars }, () => this.newCar(s.lo));
          for (let f = o.lo; f <= o.hi; f++) for (let x = o.x; x < o.x + o.w; x++) this.grid[f][x] = o.id;
        } else {
          for (let x = o.x; x < o.x + o.w; x++) this.grid[o.f][x] = o.id;
        }
        if (s.occupied) {
          o.occupied = true; o.badDays = s.badDays || 0;
          const T = TYPES[o.type];
          for (let i = 0; i < T.cap; i++) o.members.push(this.newPerson(o.type === 'office' ? 'worker' : 'resident', o));
        }
      }
      this.reindex();
      const h = this.hour, workHours = this.isWeekday() && h >= 9 && h < 17;
      for (const o of this.facs) {
        if (!o.occupied) continue;
        if (o.type === 'condo' || (o.type === 'office' && workHours)) for (const p of o.members) { p.f = o.f; p.x = o.x + 1 + rand(o.w - 2); this.settle(p, o); }
        if (o.type === 'office' && workHours) for (const p of o.members) this.at(this.day * DAY + 1020 + rand(100), this.time, () => this.leaveBuilding(p));
      }
      this.recalcPop();
      this.planDay(this.day, this.time);
    }
  }

  root.TowerSim = { Tower, TYPES, W, MIN_F, MAX_F, DAY, CAP, STAIR_TIME, STAR_POP, STAR_TOP, WEEK, floorName };
})(typeof window !== 'undefined' ? window : globalThis);
