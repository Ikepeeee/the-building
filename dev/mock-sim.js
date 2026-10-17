// レンダラー確認用のモック Tower（SPEC の「読み取り用フィールド」だけを持つショーケース）。本番では使わない。
import { TYPES, W, MIN_F, MAX_F, DAY, LOBBY_FLOORS } from '../js/sim/constants.js';

const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
const pick = (a) => a[(rnd() * a.length) | 0];

export class MockTower {
  constructor(opt = {}) {
    this.hourFixed = opt.hour;
    this.time = (opt.day || 0) * DAY + (opt.hour != null ? opt.hour * 60 : 12 * 60);
    this.money = 12345678; this.pop = 6500; this.star = 5; this.tower = false;
    this.grid = {};
    for (let f = MIN_F; f <= MAX_F; f++) this.grid[f] = new Int32Array(W);
    this.objs = new Map();
    this.active = new Set();
    this.fires = [];
    this.bomb = null;
    this.effects = [];
    this.santa = null;
    this.nextId = 1;
    this.walkers = [];
    this.build(opt);
    this.updateClock();
  }
  updateClock() {
    const t = this.time;
    this.day = Math.floor(t / DAY);
    const m = ((t % DAY) + DAY) % DAY;
    this.hour = Math.floor(m / 60); this.minute = Math.floor(m % 60);
    if (this.hourFixed != null) { this.hour = Math.floor(this.hourFixed); this.minute = Math.round((this.hourFixed % 1) * 60); }
    this.weekday = this.day % 7;
  }
  add(type, f, x, extra = {}) {
    const T = TYPES[type];
    const w = extra.w || T.w || 1, h = T.h || 1;
    const o = { id: this.nextId++, type, f, x, w, h, occupied: true, inCount: 0, ...extra };
    for (let ff = f; ff < f + h; ff++) for (let xx = x; xx < x + w; xx++) this.grid[ff][xx] = o.id;
    this.objs.set(o.id, o);
    return o;
  }
  floor(f, x0, x1) { for (let x = x0; x <= x1; x++) if (!this.grid[f][x]) this.grid[f][x] = -1; }
  elev(type, x, lo, hi, cars) {
    const T = TYPES[type];
    const o = { id: this.nextId++, type, f: lo, x, w: T.w, h: hi - lo + 1, lo, hi, cars: [], q: {} };
    for (let f = lo; f <= hi; f++) for (let xx = x; xx < x + T.w; xx++) this.grid[f][xx] = o.id;
    for (let i = 0; i < cars; i++) {
      const pos = Math.min(hi, lo + 2 + ((i * 5 + Math.floor(rnd() * 3)) % (hi - lo)));
      o.cars.push({ pos, dir: 1, state: 'moving', pass: [], _t: rnd() * 3, _target: pos + 1 });
    }
    this.objs.set(o.id, o);
    return o;
  }
  // 区間 [x0, x1) に施設を順に並べ、余りはフロア
  row(f, x0, x1, list) {
    let x = x0;
    for (const item of list) {
      const [type, extra] = Array.isArray(item) ? item : [item, {}];
      const w = (extra && extra.w) || TYPES[type].w;
      if (x + w > x1) break;
      this.add(type, f, x, extra || {});
      x += w;
    }
    this.floor(f, x0, x1 - 1);
  }
  person(kind, stress = 0, extra = {}) {
    return { id: this.nextId++, kind, state: 'walk', stress, f: 0, x: 0, ...extra };
  }

  build(opt) {
    const L0 = 10, L1 = 64, R0 = 78, R1 = 132;
    // コア（エレベーター）
    const eA = this.elev('elevator', 64, -3, 29, 3);
    const eX = this.elev('express', 68, -5, 98, 3);
    const eB = this.elev('elevator', 74, 0, 29, 2);
    const eC = this.elev('elevator', 74, 30, 59, 2);
    const eD = this.elev('elevator', 64, 44, 73, 2);
    this.elevators = [eA, eX, eB, eC, eD];

    // 地下
    this.add('recycling', -5, 14);
    this.floor(-5, 10, 63); this.floor(-4, 10, 63);
    this.add('recycling', -5, 80); this.floor(-5, 78, 120); this.floor(-4, 78, 120);
    this.add('metro', -3, 18);
    for (const f of [-3, -2, -1]) this.floor(f, 10, 63);
    this.row(-1, R0, R1, ['shop', 'fastfood', 'stairs']);
    this.row(-2, R0, R1, ['stairs', 'security']);
    this.floor(-3, R0, 110);

    // 1F ロビー
    this.add('lobby', 0, L0, { w: L1 - L0 });
    this.add('lobby', 0, R0, { w: R1 - R0 });
    // 2F 商業
    const ff = (n) => ({ inCount: n });
    this.row(1, L0, L1, [['fastfood', ff(7)], ['shop', ff(3)], ['restaurant', ff(6)]]);
    this.row(1, R0, R1, [['restaurant', ff(8)], ['fastfood', ff(2)], ['shop', ff(5)]]);
    // 3-4F 映画館・パーティーホール
    this.add('cinema', 2, L0, ff(9)); this.floor(2, L0, L1 - 1); this.floor(3, L0, L1 - 1);
    this.add('escalator', 2, L0 + 33); this.add('stairs', 3, L0 + 33);
    this.add('partyHall', 2, R0, ff(12)); this.floor(2, R0, R1 - 1); this.floor(3, R0, R1 - 1);
    this.add('escalator', 2, R0 + 28); this.add('stairs', 3, R0 + 28);
    // 5F サービス
    this.row(4, L0, L1, [['security', ff(4)], ['housekeeping', ff(3)], ['stairs'], ['hotelSingle', { dirty: true, occupied: false }], ['hotelSingle', { infested: true, dirty: true, occupied: false }]]);
    this.row(4, R0, R1, [['medical', ff(5)], ['security', ff(0)], ['office', { occupied: false }]]);
    // 6-10F オフィス
    for (let f = 5; f <= 9; f++) {
      const L = [], R = [];
      for (let i = 0; i < 6; i++) {
        const k = (f * 6 + i) % 9;
        L.push(['office', k === 8 ? { occupied: false } : { inCount: k % 7 }]);
        R.push(['office', { inCount: (k + 3) % 7 }]);
      }
      this.row(f, L0, L1, L); this.row(f, R0, R1, R);
    }
    // 11-14F マンション
    for (let f = 10; f <= 13; f++) {
      const L = [], R = [];
      for (let i = 0; i < 3; i++) {
        const k = (f + i) % 5;
        L.push(['condo', k === 4 ? { occupied: false } : { inCount: k }]);
        R.push(['condo', { inCount: (k + 2) % 4 }]);
      }
      L.push(['stairs']); R.push(['hotelSingle', { inCount: 1 }]);
      this.row(f, L0, L1, L); this.row(f, R0, R1, R);
    }
    // 15F スカイロビー
    this.add('lobby', 14, L0, { w: L1 - L0 }); this.add('lobby', 14, R0, { w: R1 - R0 });
    // 16-20F ホテル
    const hs = [{ inCount: 1 }, { occupied: true, inCount: 0 }, { occupied: false }, { dirty: true, occupied: false }, { infested: true, dirty: true, occupied: false }];
    for (let f = 15; f <= 19; f++) {
      const L = [], R = [];
      L.push(['hotelSuite', [{ inCount: 2 }, { inCount: 0 }, { dirty: true, occupied: false }, { occupied: false }, { inCount: 3 }][f % 5]]);
      for (let i = 0; i < 5; i++) L.push(['hotelSingle', hs[(f + i) % 5]]);
      L.push(['hotelTwin', { inCount: (f % 3) }]);
      for (let i = 0; i < 6; i++) R.push(['hotelTwin', [{ inCount: 2 }, { inCount: 1 }, { occupied: true, inCount: 0 }, { occupied: false }, { dirty: true, occupied: false }, { infested: true, dirty: true, occupied: false }][(f + i) % 6]]);
      R.push(['housekeeping', ff(2)]);
      this.row(f, L0, L1, L); this.row(f, R0, R1, R);
    }
    // 21-99F 上層（性能テスト用に満載）
    for (let f = 20; f <= 98; f++) {
      if (LOBBY_FLOORS.includes(f)) { this.add('lobby', f, 20, { w: 44 }); this.add('lobby', f, R0, { w: 44 }); continue; }
      const kind = Math.floor(f / 5) % 3;
      const L = [], R = [];
      const n = (i) => ({ inCount: (f * 7 + i * 3) % 6, occupied: (f + i) % 11 !== 0 });
      if (kind === 0) { for (let i = 0; i < 5; i++) { L.push(['office', n(i)]); R.push(['office', n(i + 2)]); } }
      else if (kind === 1) { for (let i = 0; i < 2; i++) { L.push(['condo', { inCount: (f + i) % 4 }]); R.push(['condo', { inCount: (f + i + 1) % 4 }]); } L.push(['office', n(1)]); R.push(['hotelTwin', { inCount: 1 }]); }
      else { for (let i = 0; i < 7; i++) { L.push(['hotelTwin', hs[(f + i) % 4]]); } R.push(['hotelSuite', { inCount: 2 }]); for (let i = 0; i < 4; i++) R.push(['hotelTwin', { inCount: (f + i) % 3 }]); R.push(['hotelSingle', {}]); }
      if (f % 4 === 1) { L.unshift(['stairs']); }
      this.row(f, 20, 64, L); this.row(f, R0, 122, R);
    }
    // 100F 大聖堂
    this.add('cathedral', 99, 54, { inCount: 8 });

    // 事件
    const burning = this.objAt(7, 12);
    if (burning) burning.burnt = 0.4;
    this.fires.push({ f: 7, x0: 10, x1: 20 });
    const burnt = this.objAt(8, 100); if (burnt) burnt.burnt = 1;
    for (const [f, x] of [[11, 30], [17, 90], [6, 100]]) { const o = this.objAt(f, x); if (o) { o.complaintUntil = 1e12; o.complaint = 'エレベーターが遅すぎる！'; } }
    if (opt.bomb !== false) this.bomb = { f: 24, x: 30, deadline: this.time + 120, searched: new Set([20, 21, 22, 23, 24, 25, 26, 27]), found: !!opt.bombFound };
    this.effects.push({ kind: 'explosion', f: 33, x: 100, t0: this.time - 4, dur: 20, _loop: true });
    this.effects.push({ kind: 'smoke', f: 33, x: 104, t0: this.time, dur: 30, _loop: true });
    this.effects.push({ kind: 'bells', f: 99, x: 70, t0: this.time, dur: 60, _loop: true });
    this.effects.push({ kind: 'fireworks', f: 102, x: 70, t0: this.time, dur: 30, _loop: true });
    this.effects.push({ kind: 'sparkle', f: 15, x: 15, t0: this.time, dur: 30, _loop: true });
    this.santa = opt.santa === false ? null : { x: 20, f: opt.santaF != null ? opt.santaF : 101 };
    for (const [f, x] of [[9, 40], [12, 95], [6, 120]]) { const o = this.objAt(f, x); if (o) o.unreachable = true; }

    // 歩く人
    const kinds = ['worker', 'worker', 'resident', 'guest', 'visitor', 'visitor', 'guard', 'maid', 'vip', 'resident'];
    const floors = [0, 1, 4, 5, 6, 7, 8, 10, 11, 14, 15, 16, -1, -2, 20, 25, 30, 44, 59, 60, 61, 98];
    const N = opt.people || 160;
    for (let i = 0; i < N; i++) {
      const f = i < 40 ? (i % 2 ? 0 : 1) : pick(floors);
      const p = this.person(pick(kinds), (rnd() * 90) | 0, { f, x: L0 + rnd() * (R1 - L0 - 2) });
      p._v = (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 2);
      this.walkers.push(p); this.active.add(p);
    }
    // 結婚式の一行
    const wed = [];
    wed.push(this.person('groom', 5, { f: 0, x: 30 }), this.person('bride', 10, { f: 0, x: 31.2 }));
    for (let i = 0; i < 6; i++) wed.push(this.person('weddingGuest', i * 12, { f: 0, x: 33 + i }));
    for (const p of wed) { p._v = 2; this.walkers.push(p); this.active.add(p); }
    // 階段の人
    const st = this.objAt(3, L0 + 33);
    if (st) { const p = this.person('visitor', 40, { state: 'stairs', f: 3, x: st.x + 1, _stairs: st }); this.active.add(p); this.walkers.push(p); }
    // 待ち行列
    for (const e of this.elevators) {
      for (let f = e.lo; f <= e.hi; f++) {
        if (rnd() < 0.3 || f === 0 || f === 14 || f === 6 || f === 8) {
          const up = [], down = [];
          const nu = f === 0 ? 30 : f === 14 ? 12 : f === 6 ? 20 : (rnd() * 6) | 0, nd = f === 8 ? 10 : (rnd() * 4) | 0;
          for (let i = 0; i < nu; i++) { const p = this.person(pick(kinds), (rnd() * 100) | 0, { state: 'wait', f }); up.push(p); this.active.add(p); }
          for (let i = 0; i < nd; i++) { const p = this.person(pick(kinds), (rnd() * 100) | 0, { state: 'wait', f }); down.push(p); this.active.add(p); }
          if (f > e.hi - 1) up.length = 0;
          e.q[f] = { up, down };
        }
      }
      for (const c of e.cars) { const n = (rnd() * 14) | 0; for (let i = 0; i < n; i++) { const p = this.person('worker', 0, { state: 'ride' }); c.pass.push(p); this.active.add(p); } }
    }
  }

  objAt(f, x) { const row = this.grid[f]; if (!row) return null; const id = row[x]; return id > 0 ? this.objs.get(id) || null : null; }
  evalLevel(o) {
    if (!o || !['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'fastfood', 'restaurant', 'shop', 'cinema', 'partyHall'].includes(o.type)) return null;
    return ['good', 'good', 'fair', 'bad'][o.id % 4];
  }
  isOpen(o) {
    const T = TYPES[o.type];
    if (!T || !T.open) return true;
    const h = this.hour + this.minute / 60;
    return h >= T.open[0] && h < T.open[1];
  }
  drawPos(p) {
    if (p.state === 'stairs' && p._stairs) {
      const t = ((this.time * 0.3 + p.id) % 1);
      return { x: p._stairs.x + 0.5 + t * 7, f: p._stairs.f + t };
    }
    return { x: p.x, f: p.f };
  }

  step(minutes) {
    this.time += minutes;
    this.updateClock();
    for (const p of this.walkers) {
      if (p.state !== 'walk') continue;
      p.x += p._v * minutes;
      if (p.x < 11) { p.x = 11; p._v = Math.abs(p._v); }
      if (p.x > 130) { p.x = 130; p._v = -Math.abs(p._v); }
    }
    for (const e of this.elevators) {
      for (const c of e.cars) {
        if (c.state === 'doors') {
          c._t -= minutes;
          if (c._t <= 0) {
            c.state = 'moving';
            let t = c.pos + c.dir * (1 + ((rnd() * 4) | 0));
            if (t > e.hi) { c.dir = -1; t = e.hi; } if (t < e.lo) { c.dir = 1; t = e.lo; }
            if (e.type === 'express') t = c.dir > 0 ? (LOBBY_FLOORS.find((f) => f > c.pos && f <= e.hi) ?? e.hi) : (LOBBY_FLOORS.slice().reverse().find((f) => f < c.pos) ?? e.lo);
            c._target = t;
          }
        } else {
          const sp = (e.type === 'express' ? 14 : 6) * minutes;
          const d = c._target - c.pos;
          if (Math.abs(d) <= sp) { c.pos = c._target; c.state = 'doors'; c._t = 1.2; if (c.pos >= e.hi) c.dir = -1; if (c.pos <= e.lo) c.dir = 1; }
          else c.pos += Math.sign(d) * sp;
        }
      }
    }
    for (const ef of this.effects) if (ef._loop && this.time - ef.t0 > ef.dur) ef.t0 = this.time;
    if (this.santa) { this.santa.x += minutes * 3; if (this.santa.x > W + 10) this.santa.x = -10; }
  }
}
