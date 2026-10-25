// レンダラー確認用のモック Tower（SPEC の「読み取り用フィールド」だけを持つショーケース）。本番では使わない。
import { TYPES, W, MIN_F, MAX_F, DAY, LOBBY_FLOORS, VARIANTS, TRANSPORT_TYPES } from '../js/sim/constants.js';

const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
const pick = (a) => a[(rnd() * a.length) | 0];

export class MockTower {
  constructor(opt = {}) {
    this.hourFixed = opt.hour;
    this.time = (opt.day || 0) * DAY + (opt.hour != null ? opt.hour * 60 : 12 * 60);
    this.money = 12345678; this.pop = 6500; this.star = 5; this.tower = false;
    this.grid = {}; this.tgrid = {};
    for (let f = MIN_F; f <= MAX_F; f++) { this.grid[f] = new Int32Array(W); this.tgrid[f] = new Int32Array(W); }
    this.revision = 0;
    this.heli = null; this.heliOn = !!opt.heli; this.heliOff = opt.heliT || 0;
    this.objs = new Map();
    this.active = new Set();
    this.fires = [];
    this.bomb = null;
    this.effects = [];
    this.santa = null;
    this.nextId = 1;
    this.walkers = [];
    this.walkMin = 11; this.walkMax = 130;
    if (opt.big) this.buildBig(opt); else this.build(opt);
    // §16: テーマと天気
    this.theme = opt.theme || 'default';
    this.weather = opt.weather ? { kind: opt.weather, intensity: opt.intensity != null ? opt.intensity : 0.85, until: 1e12 } : null;
    this.minFloor = opt.minFloor != null ? opt.minFloor : (this.theme === 'seaside' ? -2 : MIN_F);
    if (this.minFloor > MIN_F) {
      // 掘れない階のものは取り除く
      for (const [id, o] of [...this.objs]) {
        const lo = o.lo != null ? o.lo : o.f;
        if (o.f < this.minFloor && !(o.lo != null)) this.objs.delete(id);
        else if (o.lo != null && lo < this.minFloor) { o.lo = this.minFloor; o.f = o.lo; for (const c of o.cars) if (c.pos < o.lo) c.pos = o.lo; }
      }
      for (let f = MIN_F; f < this.minFloor; f++) { this.grid[f].fill(0); this.tgrid[f].fill(0); }
      for (const p of this.walkers) if (p.f < this.minFloor) p.f = 0;
    }
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
    const tr = TRANSPORT_TYPES.includes(type);
    for (let ff = f; ff < f + h; ff++) for (let xx = x; xx < x + w; xx++) {
      if (tr) { this.tgrid[ff][xx] = o.id; if (!this.grid[ff][xx]) this.grid[ff][xx] = -1; }
      else this.grid[ff][xx] = o.id;
    }
    this.objs.set(o.id, o);
    return o;
  }
  floor(f, x0, x1) { for (let x = x0; x <= x1; x++) if (!this.grid[f][x]) this.grid[f][x] = -1; }
  elev(type, x, lo, hi, cars) {
    const T = TYPES[type];
    const o = { id: this.nextId++, type, f: lo, x, w: T.w, h: hi - lo + 1, lo, hi, cars: [], q: {} };
    for (let f = lo - 1; f <= hi + 1; f++) for (let xx = x; xx < x + T.w; xx++) {
      if (!this.tgrid[f]) continue;
      this.tgrid[f][xx] = o.id;
      if (f >= lo && f <= hi && !this.grid[f][xx]) this.grid[f][xx] = -1;
    }
    for (let i = 0; i < cars; i++) {
      const pos = Math.min(hi, lo + 2 + ((i * 5 + Math.floor(rnd() * 3)) % (hi - lo)));
      o.cars.push({ pos, dir: 1, state: 'moving', pass: [], v: 0, _t: rnd() * 3, _target: pos + 1 });
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

  // 性能測定用: 横いっぱい（W マス）× F フロアの満載タワー
  buildBig(opt) {
    const F = opt.floors || 60;
    this.elevators = [];
    this.walkMin = 1; this.walkMax = W - 2;
    const cols = [];
    for (let x = 40; x + 14 < W; x += 80) cols.push(x);
    for (const x of cols) {
      for (let lo = 0; lo < F; lo += 30) this.elevators.push(this.elev('elevator', x, lo, Math.min(F - 1, lo + 29), 2));
      this.elevators.push(this.elev('elevator', x + 4, 0, Math.min(F - 1, 29), 2));
      this.elevators.push(this.elev('express', x + 8, 0, F - 1, 2));
    }
    const isCol = (x) => cols.some((c) => x >= c && x < c + 14);
    const types = ['office', 'office', 'office', 'condo', 'hotelTwin', 'hotelSingle', 'fastfood', 'shop', 'restaurant', 'hotelSuite'];
    for (let f = -2; f < F; f++) {
      for (let x = 0; x < W; x++) if (!this.grid[f][x]) this.grid[f][x] = -1;
      if (f < 0) continue;
      if (f === 0 || LOBBY_FLOORS.includes(f)) { let x = 0; while (x < W) { while (x < W && isCol(x)) x++; let x1 = x; while (x1 < W && !isCol(x1)) x1++; if (x1 > x) this.add('lobby', f, x, { w: x1 - x }); x = x1; } continue; }
      let x = 0;
      while (x < W) {
        const t = types[(rnd() * types.length) | 0];
        const w = TYPES[t].w;
        if (x + w > W) break;
        let ok = true; for (let k = x; k < x + w; k++) if (isCol(k)) { ok = false; break; }
        if (!ok) { x++; continue; }
        const o = this.add(t, f, x, { inCount: (rnd() * 6) | 0, occupied: rnd() > 0.1, dirty: t.startsWith('hotel') && rnd() < 0.1 });
        const V = VARIANTS[t]; if (V) { o.variant = (rnd() * V.length) | 0; o.brand = '株式会社サンプル' + (o.id % 50); }
        x += w;
      }
    }
    const kinds = ['worker', 'worker', 'resident', 'guest', 'visitor', 'visitor', 'guard', 'maid'];
    const N = opt.people || 3300;
    for (let i = 0; i < N; i++) {
      const p = this.person(pick(kinds), (rnd() * 90) | 0, { f: (rnd() * F) | 0, x: 1 + rnd() * (W - 3) });
      p._v = (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 2);
      this.walkers.push(p); this.active.add(p);
    }
    for (const e of this.elevators) {
      for (let f = e.lo; f <= e.hi; f++) if (rnd() < 0.2) {
        const up = [], down = [];
        for (let i = 0; i < (rnd() * 6) | 0; i++) { const p = this.person(pick(kinds), (rnd() * 100) | 0, { state: 'wait', f }); up.push(p); this.active.add(p); }
        e.q[f] = { up, down };
      }
    }
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
    this.add('garbage', -5, 14, { fill: 0.5, bags: 300 });
    this.floor(-5, 10, 63); this.floor(-4, 10, 63);
    this.add('garbage', -5, 80, { fill: 0.2, bags: 120 }); this.floor(-5, 78, 120); this.floor(-4, 78, 120);
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

    // v2: テナントの個性ショーケース（x 150〜）
    const S0 = 150, S1 = 440;
    this.add('lobby', 0, S0, { w: S1 - S0 });
    const cyc = (type, n, extra) => { const a = []; for (let i = 0; i < n; i++) a.push([type, { _vi: i % VARIANTS[type].length, ...(extra ? extra(i) : {}) }]); return a; };
    this.row(1, S0, S1, cyc('fastfood', 7, (i) => ({ inCount: 2 + i % 6 })).concat(cyc('shop', 7, (i) => ({ inCount: 1 + i % 4 }))));
    this.row(2, S0, S1, cyc('restaurant', 5, (i) => ({ inCount: 3 + i })).concat(cyc('shop', 7, (i) => ({ inCount: i % 3 }))));
    for (let f = 3; f <= 5; f++) this.row(f, S0, S1, cyc('office', 32, (i) => ({ inCount: (i * 3 + f) % 7, occupied: (i + f) % 13 !== 0 })));
    for (let f = 6; f <= 7; f++) this.row(f, S0, S1, cyc('condo', 18, (i) => ({ inCount: (i + f) % 4 })));
    const hst = [{ inCount: 1 }, { inCount: 2 }, { occupied: true, inCount: 0 }, { dirty: true, occupied: false }, { occupied: false }];
    for (let f = 8; f <= 9; f++) {
      const L = [];
      for (let i = 0; i < 9; i++) L.push(['hotelSuite', { _vi: i % 3, ...hst[(i + f) % 5] }]);
      for (let i = 0; i < 12; i++) L.push(['hotelTwin', { _vi: i % 3, ...hst[(i + f) % 5] }]);
      for (let i = 0; i < 12; i++) L.push(['hotelSingle', { _vi: i % 3, ...hst[(i + f) % 5] }]);
      this.row(f, S0, S1, L);
    }
    for (let f = 10; f <= 11; f++) this.row(f, S0, S1, cyc('office', 32, (i) => ({ inCount: (i + f) % 7 })));
    // §12: 工事中とごみ収集室
    const D = 100000;
    const cons = (o, pr) => { if (o) { o.constructStart = this.time - pr * D; o.constructUntil = this.time + (1 - pr) * D; o.inCount = 0; } return o; };
    // §15: 連絡通路（本館と右の棟のあいだ）
    this.add('bridge', 6, 132, { w: 18 }); this.add('bridge', 10, 132, { w: 18 });
    for (const f of [6, 10]) { const p = this.person('worker', 20, { f, x: 136, _min: 126, _max: 156 }); p._v = 2; this.walkers.push(p); this.active.add(p); }
    // §13: 地下のごみ集積所（2フロア）と駐車場
    const tk = opt.truck;   // 'in' | 'load' | 'out' で全室に収集車
    const gs = [[0, null], [0.35, { phase: 'in', t: 0.55 }], [0.7, { phase: 'load', t: 0.3 }], [1, { phase: 'out', t: 0.45 }], [1.4, null], [0.2, { phase: 'load', t: 0.8 }]];
    for (let i = 0; i < gs.length; i++) {
      const [fill, truck] = gs[i];
      this.add('garbage', -2, S0 + i * 24, { fill, bags: Math.round(fill * 80), truck: tk ? { phase: tk, t: 0.5 } : truck });
    }
    this.floor(-1, S0, S1 - 1); this.floor(-2, S0, S1 - 1);
    for (let i = 0; i < 8; i++) this.add('parking', -3, S0 + i * 24, { used: [0, 3, 6, 9, 12, 12, 1, 7][i] });
    this.floor(-3, S0, S1 - 1);
    this.row(12, S0, S1, [['office', { _c: 0.08 }], ['office', { _c: 0.35 }], ['office', { _c: 0.65 }], ['office', { _c: 0.93 }], ['condo', { _c: 0.5 }], ['shop', { _c: 0.25 }], ['restaurant', { _c: 0.8 }], ['hotelSuite', { _c: 0.45 }]]);
    this.add('cinema', 13, S0, { _c: 0.5 }); this.add('partyHall', 13, S0 + 40, { _c: 0.15 }); this.floor(13, S0, S0 + 80); this.floor(14, S0, S0 + 80);
    this.add('lobby', 15, S0, { w: 60, _c: 0.6 });
    for (const o of this.objs.values()) if (o._c != null) cons(o, o._c);
    cons(this.add('stairs', 12, S0 + 130), 0.5);
    const eK = cons(this.elev('elevator', 430, 0, 12, 2), 0.55);
    this.elevators.push(eK);
    // 移動手段を施設の上に重ねる（v2）
    this.add('stairs', 3, 168); this.add('escalator', 4, 200); this.add('stairs', 10, 300);
    const sE = this.elev('elevator', 240, 0, 11, 2); const sX = this.elev('express', 330, 0, 11, 1);
    this.elevators.push(sE, sX);
    // 破壊されたテナント
    for (const [f, x, k] of [[5, 260, 'bomb'], [5, 269, 'bomb'], [11, 400, 'fire'], [7, 380, 'fire'], [2, 160, 'bomb']]) { const o = this.objAt(f, x); if (o) { o.destroyed = k; o.inCount = 0; } }
    // 医療センターの患者（§sick）
    let mi = 0;
    for (const o of this.objs.values()) if (o.type === 'medical') { o.beds = 3; o.patients = [2, 3, 1, 0][mi++ % 4]; o.inCount = o.patients + 2; }
    // variant と brand
    const BR = {
      office: ['山田商事', 'ネクスト・ソフト', '桜法律事務所', 'スタジオ彩', 'みらい銀行', '青空出版', 'ピクセル工房', '東西トレーディング'],
      condo: ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺'],
      fastfood: ['バーガー王', '麺屋 一番', '回転寿司 波', 'ピザ・ナポリ', '珈琲 こもれび', 'カレーの店 象', 'ドーナツ堂'],
      restaurant: ['ル・ソレイユ', 'トラットリア・ソーレ', '中華 龍門', '割烹 さくら', 'ステーキ ハウス牛'],
      shop: ['ブティック・リラ', '本の森', 'デンキのヤマ', '花屋 はなこ', 'おもちゃ箱', 'スポーツ・ゴー', 'まいにちマート'],
      hotelSingle: [], hotelTwin: [], hotelSuite: [],
    };
    for (const o of this.objs.values()) {
      const V = VARIANTS[o.type];
      if (!V) continue;
      o.variant = o._vi != null ? o._vi : (o.id * 7) % V.length;
      const b = BR[o.type] && BR[o.type][o.variant];
      if (b) o.brand = b;
    }

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
      const mn = p._min ?? this.walkMin, mx = p._max ?? this.walkMax;
      if (p.x < mn) { p.x = mn; p._v = Math.abs(p._v); }
      if (p.x > mx) { p.x = mx; p._v = -Math.abs(p._v); }
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
          // 加速・減速つき
          const vmax = e.type === 'express' ? 14 : 6, acc = 12;
          const brake = Math.sqrt(2 * acc * Math.abs(d));
          const want = Math.sign(d) * Math.min(vmax, brake);
          const prev = c.v || 0;
          c.v = prev + Math.max(-acc * minutes, Math.min(acc * minutes, want - prev));
          if (Math.abs(d) <= 0.02 || (Math.abs(d) < Math.abs(c.v * minutes) + 0.001)) { c.pos = c._target; c.v = 0; c.state = 'doors'; c._t = 1.2; if (c.pos >= e.hi) c.dir = -1; if (c.pos <= e.lo) c.dir = 1; }
          else c.pos += c.v * minutes;
        }
      }
    }
    for (const ef of this.effects) if (ef._loop && this.time - ef.t0 > ef.dur) ef.t0 = this.time;
    if (this.heliOn) {
      const t = ((this.time + this.heliOff) % 60);
      const tx = 15, tf = 7;
      if (t < 15) this.heli = { phase: 'in', x: -30 + (tx + 30) * (t / 15), f: tf + 6 - 2 * (t / 15), targetX: tx, targetF: tf };
      else if (t < 45) this.heli = { phase: 'spray', x: tx - 3 + Math.sin(t) * 0.5, f: tf + 4, targetX: tx, targetF: tf };
      else this.heli = { phase: 'out', x: tx + (t - 45) * 8, f: tf + 4 + (t - 45) * 0.4, targetX: tx, targetF: tf };
    }
    if (this.santa) { this.santa.x += minutes * 3; if (this.santa.x > W + 10) this.santa.x = -10; }
  }
}
