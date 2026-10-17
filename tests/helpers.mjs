// テスト用ヘルパー: 自動プレイヤーと大規模ビルの自動建設
import { Tower } from '../js/sim/tower.js';
import { TYPES, DAY, W, LOBBY_FLOORS } from '../js/sim/constants.js';

export { Tower, TYPES, DAY, W, LOBBY_FLOORS };

export function mustBuild(sim, tool, p) {
  const r = sim.build(tool, p);
  if (!r.ok) throw new Error(`build ${tool} ${JSON.stringify(p)} failed: ${r.reason}`);
  return r;
}

// 指定時刻（その日の h 時）まで進める
export function stepTo(sim, day, hour = 0) {
  const t = day * DAY + hour * 60;
  if (t > sim.time) sim.step(t - sim.time);
}

// 1F ロビー + 1基のエレベーター + 空きフロア n 階
export function smallTower(sim, floors = 10, x0 = 40, x1 = 100) {
  mustBuild(sim, 'lobby', { f: 0, x: x0, x2: x1 });
  for (let f = 1; f <= floors; f++) mustBuild(sim, 'floor', { f, x: x0, x2: x1 });
  mustBuild(sim, 'elevator', { f: 0, f2: floors, x: 60 });
  return sim.objAt(1, 60);
}

// ---------------------------------------------------------------
// 自動プレイヤー: 「真面目にプレイする」簡単な戦略
//   - 1F ロビー、エレベーター2基（30階ごとに乗り換え）
//   - オフィス中心、マンションで資金を回す、★2 で警備室・ホテル・ハウスキーピング、
//     ★3 で医療センター・リサイクルセンター・スイート
// ---------------------------------------------------------------
export class AutoPlayer {
  constructor(sim) {
    this.s = sim;
    this.X0 = 30; this.X1 = 119;
    this.top = 2;
    this.log = [];
    // 段（tier）ごとにシャフト位置を交互にずらして、乗り換え階で重ならないようにする
    this.shaftX = [[52, 90], [56, 94]];
    this.segs = [[30, 52], [60, 90], [98, 120]];
    this.special = {};
  }

  money() { return this.s.money; }

  setup() {
    const s = this.s;
    mustBuild(s, 'lobby', { f: 0, x: this.X0, x2: this.X1 });
    for (let f = 1; f <= 2; f++) this.buildFloor(f);
    mustBuild(s, 'elevator', { f: 0, f2: 2, x: this.shaftX[0][0] });
  }

  elevatorsFor(tier) {
    return this.shaftX[tier % 2].map((x) => this.s.objAt(tier * 29 + 1, x)).filter(Boolean);
  }

  roomPlan(f) {
    const s = this.s;
    if (s.star >= 2 && !this.special.security) return 'service';
    if (s.star >= 2 && f % 7 === 5 && (this.special.hotelFloors || 0) < 4) return 'hotel';
    if (f % 9 === 0) return 'commerce';
    if (this.money() < 350000 || f % 4 === 2) return 'condo';
    return 'office';
  }

  place(tool, f, seg) {
    const T = TYPES[tool];
    const [a, b] = seg;
    let n = 0;
    for (let x = a; x + T.w <= b; x += T.w) {
      if (this.s.build(tool, { f, x }).ok) n++;
    }
    return n;
  }

  buildFloor(f) {
    const s = this.s;
    const r = s.build('floor', { f, x: this.X0, x2: this.X1 });
    if (!r.ok && r.reason !== 'すでにフロアがあります') return false;
    const plan = f <= 2 ? (f === 1 ? 'office' : 'condo') : this.roomPlan(f);
    const [s1, s2, s3] = this.segs;
    switch (plan) {
      case 'office': this.place('office', f, s1); this.place('office', f, s2); this.place('office', f, s3); break;
      case 'condo': this.place('condo', f, s1); this.place('condo', f, s2); this.place('condo', f, s3); break;
      case 'commerce':
        this.place('fastfood', f, s2);
        if (s.star >= 2) { this.place('shop', f, s1); this.place('shop', f, s3); } else { this.place('office', f, s1); this.place('office', f, s3); }
        break;
      case 'service':
        if (s.build('security', { f, x: s1[0] }).ok) this.special.security = f;
        s.build('housekeeping', { f, x: s2[0] });
        s.build('housekeeping', { f, x: s3[0] });
        break;
      case 'hotel':
        this.place('hotelSingle', f, s1); this.place('hotelTwin', f, s2); this.place('hotelSingle', f, s3);
        this.special.hotelFloors = (this.special.hotelFloors || 0) + 1;
        break;
    }
    this.log.push(`d${s.day} ${f + 1}F ${plan}`);
    return true;
  }

  // エレベーターを新しい最上階まで延長（30フロアを超えたら次の段を作る）
  reach(f) {
    const s = this.s;
    const tier = Math.floor((f - 1) / 29);
    const lo = tier * 29;
    for (let i = 0; i < 2; i++) {
      const x = this.shaftX[tier % 2][i];
      const e = s.objAt(lo + 1, x);
      if (i === 1 && !e && f - lo < 8) continue; // 2基目は高くなってから
      if (!e) {
        const r = s.build('elevator', { f: lo, f2: f, x });
        if (!r.ok) return false;
      } else {
        while (e.hi < f) { if (!s.act(e, 'extendUp').ok) return false; }
      }
    }
    return true;
  }

  // 毎日1回呼ぶ
  act() {
    const s = this.s;
    let built = 0;
    const reserve = 80000;
    // 上へ伸ばす（空室が多いうちは控える）
    const vacant = s.byType.office.filter((o) => !o.occupied).length + s.byType.condo.filter((o) => !o.occupied).length;
    while (built < 3 && vacant < 30 && this.money() > reserve + 300000 && this.top < 85) {
      const f = this.top + 1;
      if (!this.buildFloor(f)) break;
      this.top = f;
      if (!this.reach(f)) break;
      built++;
    }
    // カゴの追加（担当フロア数と人口に応じて）
    // 待ち時間を見てカゴを足す（1日1台まで）
    for (const e of s.elevs) {
      const want = Math.max(1, Math.ceil((e.hi - e.lo) / 10));
      if ((e.cars.length < want || e.peakWaitYesterday > 2.5) && e.cars.length < TYPES[e.type].maxCars && this.money() > reserve + TYPES[e.type].carCost) s.act(e, 'addCar');
    }
    // ★3: 医療センターとリサイクルセンター、スイート
    if (s.star >= 3) {
      if (!s.byType.medical.length && this.money() > 900000) {
        s.build('floor', { f: this.top + 1, x: this.X0, x2: this.X1 });
        this.top++; this.reach(this.top);
        s.build('medical', { f: this.top, x: 60 });
      }
      if (!s.byType.recycling.length && this.money() > 700000) {
        s.build('floor', { f: -1, x: this.X0, x2: this.X1 });
        s.build('floor', { f: -2, x: this.X0, x2: this.X1 });
        s.build('recycling', { f: -2, x: 30 });
      }
      if (!s.byType.hotelSuite.length && this.money() > 300000) {
        const f = this.top + 1;
        s.build('floor', { f, x: this.X0, x2: this.X1 });
        this.top = f; this.reach(f);
        this.place('hotelSuite', f, this.segs[1]);
      }
    }
    // ゴキブリは駆除
    for (const o of s.hotels) if (o.infested && this.money() > 100000) s.act(o, 'exterminate');
  }
}

export function autoPlay(sim, days, opts = {}) {
  const ap = opts.player || new AutoPlayer(sim);
  if (!opts.player) ap.setup();
  const onDay = opts.onDay || (() => {});
  const start = sim.day;
  for (let d = start; d < start + days; d++) {
    stepTo(sim, d + 1, 1);
    ap.act();
    onDay(sim, ap);
  }
  return ap;
}

// ---------------------------------------------------------------
// 性能テスト用: 100 フロア・人口 6000 超のビルを一気に建てる
// ---------------------------------------------------------------
export function buildMegaTower(sim, topF = 98) {
  sim.money = 1e12;
  sim.star = 5;
  const X0 = 0, X1 = W - 1;
  const localX = [[40, 106], [46, 112]];
  const expressX = [72, 78];
  // 地下: B1〜B3 フロア、地下鉄・リサイクル
  for (let f = 0; f >= -3; f--) mustBuild(sim, 'floor', { f, x: X0, x2: X1 });
  for (let f = 1; f <= topF; f++) mustBuild(sim, 'floor', { f, x: X0, x2: X1 });
  for (const f of LOBBY_FLOORS) if (f <= topF) mustBuild(sim, 'lobby', { f, x: 40, x2: 117 });
  if (topF < 99) mustBuild(sim, 'floor', { f: 99, x: 60, x2: 100 });
  // 急行: B3〜90F（ロビー階と地下に停止）2基
  for (const x of expressX) {
    mustBuild(sim, 'express', { f: -3, f2: 89, x });
    const e = sim.objAt(0, x);
    while (e.cars.length < 8) sim.act(e, 'addCar');
  }
  // 各段の通常エレベーター（スカイロビー間）
  const tiers = [];
  for (let i = 0; i < LOBBY_FLOORS.length; i++) {
    const lo = LOBBY_FLOORS[i], hi = i + 1 < LOBBY_FLOORS.length ? LOBBY_FLOORS[i + 1] : 99;
    tiers.push([lo, hi]);
  }
  tiers.forEach(([lo, hi], i) => {
    for (const x of localX[i % 2]) {
      mustBuild(sim, 'elevator', { f: lo, f2: hi, x });
      const e = sim.objAt(lo + 1, x);
      while (e.cars.length < 6) sim.act(e, 'addCar');
    }
  });
  // 施設: 各フロアの空きフロアの連続区間に詰める
  const fillRow = (tool, f) => {
    const w = TYPES[tool].w, row = sim.grid[f];
    let x = 0;
    while (x < W) {
      if (row[x] !== -1) { x++; continue; }
      let e = x;
      while (e < W && row[e] === -1) e++;
      for (let xi = x; xi + w <= e; xi += w) sim.build(tool, { f, x: xi });
      x = e;
    }
  };
  for (let f = 1; f <= topF; f++) {
    if (LOBBY_FLOORS.includes(f)) {
      sim.build('fastfood', { f, x: 0 }); sim.build('shop', { f, x: 16 }); sim.build('restaurant', { f, x: 118 });
      continue;
    }
    const k = f % 10;
    let tool = 'office';
    if (k === 3 && f < 50) tool = 'condo';
    else if (k === 5 && f < 60) tool = 'hotelSingle';
    else if (k === 9 && f < 60) tool = 'hotelTwin';
    if (f === 2 || f === 4 || f === 6) tool = 'office';
    fillRow(tool, f);
  }
  for (const f of [2, 4, 6]) {
    const o = sim.objAt(f, 1); if (o) sim.removeObj(o);
    const o2 = sim.objAt(f, 10); if (o2) sim.removeObj(o2);
  }
  sim.build('security', { f: 2, x: 0 });
  sim.build('housekeeping', { f: 4, x: 0 });
  sim.build('housekeeping', { f: 6, x: 0 });
  sim.build('medical', { f: -1, x: 0 });
  sim.build('recycling', { f: -3, x: 0 });
  sim.build('metro', { f: -3, x: 84 });
  sim.build('cathedral', { f: 99, x: 65 });
  // 全テナント入居
  for (const o of [...sim.byType.office, ...sim.byType.condo]) if (!o.occupied) sim.moveIn(o);
  sim.recalcPop();
}

// ---------------------------------------------------------------
// 素朴なプレイヤー: エレベーター1基・カゴ1台のまま 30F までオフィスとマンションを詰め込む
// ---------------------------------------------------------------
export class NaivePlayer {
  constructor(sim) { this.s = sim; this.top = 0; this.X0 = 30; this.X1 = 119; }
  setup() {
    const s = this.s;
    mustBuild(s, 'lobby', { f: 0, x: this.X0, x2: this.X1 });
    mustBuild(s, 'floor', { f: 1, x: this.X0, x2: this.X1 });
    mustBuild(s, 'elevator', { f: 0, f2: 1, x: 70 });
    this.top = 1;
    this.fill(1);
  }
  fill(f) {
    const s = this.s;
    for (let x = this.X0; x + 16 <= 70; x += 16) s.build(f % 2 ? 'office' : 'condo', { f, x });
    for (let x = 74; x + 9 <= this.X1 + 1; x += 9) s.build(f % 2 ? 'condo' : 'office', { f, x });
  }
  act() {
    const s = this.s;
    const e = s.objAt(0, 70);
    while (this.top < 29 && s.money > 120000) {
      const f = this.top + 1;
      if (!s.build('floor', { f, x: this.X0, x2: this.X1 }).ok) break;
      if (!s.act(e, 'extendUp').ok) break;
      this.top = f;
      this.fill(f);
    }
    // 空いた区画も埋め直す
    for (let f = 1; f <= this.top && s.money > 100000; f++) this.fill(f);
  }
}

// 事件の難易度測定用: 30フロアのオフィスビル（警備室は secFloors に置く）
export function securityTower(seed, secFloors, floors = 30) {
  const s = new Tower({ seed });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 30, x2: 119 });
  for (let f = 1; f < floors; f++) mustBuild(s, 'floor', { f, x: 30, x2: 119 });
  for (const x of [56, 90]) {
    mustBuild(s, 'elevator', { f: 0, f2: floors - 1, x });
    const e = s.objAt(1, x);
    while (e.cars.length < 6) s.act(e, 'addCar');
  }
  for (let f = 1; f < floors; f++) {
    if (secFloors.includes(f)) { s.build('security', { f, x: 30 }); s.build('office', { f, x: 60 }); continue; }
    for (const [a, b] of [[30, 56], [60, 90], [94, 120]]) for (let x = a; x + 9 <= b; x += 9) s.build('office', { f, x });
  }
  for (const o of s.byType.office) s.moveIn(o);
  stepTo(s, 0, 10);
  return s;
}

export function bombTrial(seed, secFloors) {
  const s = securityTower(seed, secFloors);
  let id = null;
  s.on('prompt', (p) => { id = p.id; });
  s.trigger('bomb');
  s.answer(id, 'refuse');
  let found = false;
  s.on('message', (m) => { if (/発見し、解除/.test(m.text)) found = true; });
  s.step(185);
  return found;
}

export function fireTrial(seed, secFloors) {
  const s = securityTower(seed, secFloors);
  let id = null, burned = 0;
  s.on('prompt', (p) => { id = p.id; });
  s.on('message', (m) => { const k = m.text.match(/施設(\d+)件が焼失/); if (k) burned = +k[1]; });
  const cands = s.byType.office.filter((o) => o.f >= 3 && o.f <= 27);
  s.trigger('fire', cands[Math.floor(cands.length * ((seed * 0.618) % 1))]);
  s.answer(id, 'wait');
  s.step(400);
  return burned;
}
