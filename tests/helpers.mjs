// テスト用ヘルパー: 自動プレイヤーと大規模ビルの自動建設
import { Tower as SimTower } from '../js/sim/tower.js';
import { defaultSkip } from '../js/sim/elevator.js';
import { TYPES, DAY, W, LOBBY_FLOORS } from '../js/sim/constants.js';

// テストでは既定で工事期間なし（建てた瞬間に完成）。工事を試すときは {construction: true}
export class Tower extends SimTower {
  constructor(opts = {}) { super({ construction: false, ...opts }); }
}
export { SimTower, TYPES, DAY, W, LOBBY_FLOORS };

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
  return sim.transportAt(1, 60);
}

// ---------------------------------------------------------------
// 自動プレイヤー: 「真面目にプレイする」簡単な戦略
//   - 1F ロビー、エレベーター2基（30階ごとに乗り換え）
//   - オフィス中心、マンションで資金を回す、★2 で警備室・ホテル・ハウスキーピング、
//     ★3 で医療センター・スイート（ごみ・リサイクルセンターは最初から）
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

  basement() {
    if (this.bdone) return;
    const s = this.s;
    if (s.money < 150000) return;
    // 必要な分だけ掘る（あとで広げる）
    s.build('floor', { f: -1, x: 30, x2: 30 + TYPES.garbage.w - 1 });
    s.build('floor', { f: -2, x: 30, x2: 30 + TYPES.garbage.w - 1 });
    if (s.build('garbage', { f: -2, x: 30 }).ok) this.bdone = true;
  }

  setup() {
    const s = this.s;
    mustBuild(s, 'lobby', { f: 0, x: this.X0, x2: this.X1 });
    for (let f = 1; f <= 2; f++) this.buildFloor(f);
    mustBuild(s, 'elevator', { f: 0, f2: 2, x: this.shaftX[0][0] });
    this.basement();
  }

  elevatorsFor(tier) {
    return this.shaftX[tier % 2].map((x) => this.s.transportAt(tier * 29 + 1, x)).filter(Boolean);
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
    let [s1, s2, s3] = this.segs;
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
      const e = s.transportAt(lo + 1, x);
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
      if ((e.cars.length < want || e.peakWaitYesterday > 1) && e.cars.length < TYPES[e.type].maxCars && this.money() > reserve + TYPES[e.type].carCost) s.act(e, 'addCar');
    }
    // 地下: ごみ集積所（B2〜B1）を必要に応じて増やす。★3からは駐車場（B3）も
    this.basement();
    if (this.bdone && s.money > 150000 && (s.garbageProblem() || s.garbageBags > s.garbageCap * 0.7)) {
      if (!this.bwide) { s.build('floor', { f: -1, x: this.X0, x2: this.X1 }); s.build('floor', { f: -2, x: this.X0, x2: this.X1 }); this.bwide = true; }
      for (const x of [30, 54, 78]) if (s.build('garbage', { f: -2, x }).ok) break;
    }
    if (s.star >= 3 && s.parkingShort > 0 && s.money > 200000) {
      if (!this.b3) { s.build('floor', { f: -3, x: this.X0, x2: this.X1 }); this.b3 = true; }
      for (const x of [30, 54, 78]) if (s.build('parking', { f: -3, x }).ok) break;
    }
    // ★3: 医療センター、スイート
    if (s.star >= 3) {
      if (!s.byType.medical.length && this.money() > 900000) {
        s.build('floor', { f: this.top + 1, x: this.X0, x2: this.X1 });
        this.top++; this.reach(this.top);
        s.build('medical', { f: this.top, x: 60 });
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
  const X0 = 0, X1 = 149; // 従来の幅150で測る（横長は別テスト）
  const localX = [[40, 106], [46, 112]];
  const expressX = [72, 78, 84];
  // 地下: B1〜B3 フロア、地下鉄・ごみ・リサイクルセンター
  for (let f = 0; f >= -3; f--) mustBuild(sim, 'floor', { f, x: X0, x2: X1 });
  for (let f = 1; f <= topF; f++) mustBuild(sim, 'floor', { f, x: X0, x2: X1 });
  for (const f of LOBBY_FLOORS) if (f <= topF) mustBuild(sim, 'lobby', { f, x: 40, x2: 117 });
  if (topF < 99) mustBuild(sim, 'floor', { f: 99, x: 30, x2: 120 });
  // 急行: B3〜90F（ロビー階と地下に停止）2基
  for (const x of expressX) {
    mustBuild(sim, 'express', { f: -3, f2: 89, x });
    const e = sim.transportAt(0, x);
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
      const e = sim.transportAt(lo + 1, x);
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
    else if (k === 5 && f < 40) tool = 'hotelSingle';
    else if (k === 9 && f < 40) tool = 'hotelTwin';
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
  sim.build('metro', { f: -3, x: 84 });
  // ごみ集積所（地下2フロア分、ビル全体で共有）
  for (const x of [24, 48, 114]) mustBuild(sim, 'garbage', { f: -3, x });
  sim.build('cathedral', { f: 99, x: 65 });
  // 全テナント入居（★2のうちに入居させて、駐車場の需要は付けない）
  sim.star = 2;
  for (const o of [...sim.byType.office, ...sim.byType.condo]) if (!o.occupied) sim.moveIn(o);
  sim.star = 5;
  sim.recalcPop();
}

// ---------------------------------------------------------------
// 素朴なプレイヤー: エレベーター1基・カゴ1台のまま 30F までオフィスとマンションを詰め込む
// ---------------------------------------------------------------
export class NaivePlayer {
  // 横に広いフロア（240マス）を埋めるが、エレベーターは1基1台のまま
  constructor(sim) { this.s = sim; this.top = 0; this.X0 = 30; this.X1 = 269; }
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
    const t1 = f % 2 ? 'office' : 'condo', t2 = f % 2 ? 'condo' : 'office';
    for (let x = this.X0; x + TYPES[t1].w <= 70; x += TYPES[t1].w) s.build(t1, { f, x });
    for (let x = 74; x + TYPES[t2].w <= this.X1 + 1; x += TYPES[t2].w) s.build(t2, { f, x });
  }
  act() {
    const s = this.s;
    const e = s.transportAt(0, 70);
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
    const e = s.transportAt(1, x);
    while (e.cars.length < 6) s.act(e, 'addCar');
  }
  for (let f = 1; f < floors; f++) {
    if (secFloors.includes(f)) { s.build('security', { f, x: 30 }); s.build('office', { f, x: 60 }); continue; }
    const ow = TYPES.office.w;
    for (const [a, b] of [[30, 56], [60, 90], [94, 120]]) for (let x = a; x + ow <= b; x += ow) s.build('office', { f, x });
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

// ---------------------------------------------------------------
// エレベーターのストレステスト: 設定・伸縮・カゴ増減・急行の乗り換えを混ぜて、
// 「待ちがあるのに止まったままのカゴ」を検出する
// ---------------------------------------------------------------
export function elevatorStress(seed, minutes = 600, opts = {}) {
  const s = new Tower({ seed });
  s.money = 1e12; s.star = 5;
  let rnd = seed * 7919 + 1;
  const R = (n) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return Math.floor((rnd / 2147483648) * n); };
  mustBuild(s, 'floor', { f: 0, x: 0, x2: 199 });
  for (let f = -1; f >= -3; f--) mustBuild(s, 'floor', { f, x: 0, x2: 199 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 199 });
  for (let f = 1; f <= 45; f++) mustBuild(s, 'floor', { f, x: 0, x2: 199 });
  mustBuild(s, 'lobby', { f: 14, x: 100, x2: 199 });
  mustBuild(s, 'lobby', { f: 29, x: 100, x2: 199 });
  mustBuild(s, 'express', { f: -3, f2: 44, x: 20 });
  mustBuild(s, 'elevator', { f: 0, f2: 16, x: 40 });
  mustBuild(s, 'elevator', { f: 12, f2: 30, x: 60 });
  mustBuild(s, 'elevator', { f: 27, f2: 45, x: 80 });
  mustBuild(s, 'elevator', { f: -3, f2: 20, x: 120 });
  mustBuild(s, 'stairs', { f: 0, x: 150 });
  const elevs = () => s.elevs;
  const randomConfig = (e) => {
    const patch = { standby: ['none', 'lobby', 'spread'][R(3)], rush: !!R(2), speed: 1 + R(2), door: ['short', 'normal', 'long'][R(3)] };
    if (R(2)) {
      // 急行は既定（ロビー階・地下以外は通過）から少し増減、通常は数階を通過
      const sk = new Set(e.type === 'express' ? defaultSkip(e.type, e.lo, e.hi) : []);
      for (let f = e.lo; f <= e.hi; f++) if (R(6) === 0) { if (sk.has(f)) sk.delete(f); else sk.add(f); }
      patch.skip = [...sk];
    }
    s.setElevatorConfig(e, patch);
  };
  for (const e of elevs()) { randomConfig(e); for (let i = R(4); i > 0; i--) s.act(e, 'addCar'); }
  const problems = [];
  const trip = () => {
    const p = s.newPerson('visitor', null);
    const a = R(49) - 3, b = R(49) - 3;
    if (a === b) return;
    p.f = a; p.x = 10 + R(180); p.state = 'walk'; s.active.add(p);
    if (!s.startTrip(p, b, 10 + R(180), (pp) => s.leave(pp))) s.leave(p);
  };
  for (let t = 0; t < minutes; t++) {
    const burst = opts.burst && (t % 120 < 20) ? 25 : 4;
    for (let i = R(burst); i > 0; i--) trip();
    if (t % 37 === 0) { const e = elevs()[R(elevs().length)]; if (e) randomConfig(e); }
    if (t % 53 === 0) { const e = elevs()[R(elevs().length)]; if (e) s.act(e, R(2) ? 'addCar' : 'removeCar'); }
    if (t % 71 === 0) {
      const e = elevs()[R(elevs().length)];
      if (e) {
        const lo = e.lo + R(5) - 2, hi = e.hi + R(5) - 2;
        s.build('resizeElevator', { id: e.id, lo, hi });
      }
    }
    // 1分を細かく進めて、降りる人がいる階を通り過ぎていないか見る
    for (let k = 0; k < 4; k++) {
      const before = s.elevs.map((e) => e.cars.map((c) => [c, c.pos, c.drop.slice()]));
      s.step(0.25);
      for (const list of before) {
        for (const [c, p0, drop] of list) {
          const p1 = c.pos, lo = Math.min(p0, p1), hi = Math.max(p0, p1);
          for (let f = Math.floor(lo) + 1; f < hi - 1e-6; f++) if (f > lo + 1e-6 && drop[f + 10] && c.drop[f + 10] && c.state === 'moving') problems.push(`t${t} overshoot floor ${f} (${p0.toFixed(2)}→${p1.toFixed(2)})`);
        }
      }
    }
    // 検出
    for (const e of elevs()) {
      for (const c of e.cars) {
        if (!Number.isFinite(c.pos) || !Number.isFinite(c.v)) problems.push(`t${t} e${e.id} NaN`);
        if (c.pos < e.lo - 1e-6 || c.pos > e.hi + 1e-6) problems.push(`t${t} e${e.id} car out of shaft ${c.pos}`);
        if (c.state === 'moving') { c._mv = (c._mv || 0) + 1; if (c._mv > 60) problems.push(`t${t} e${e.id} moving for 60min pos=${c.pos.toFixed(2)} v=${c.v.toFixed(2)}`); } else c._mv = 0;
      }
      if (!e.waitN) continue;
      let oldest = 0, at = null;
      for (const k in e.q) for (const d of ['up', 'down']) for (const p of e.q[k][d]) if (p.waitT > oldest) { oldest = p.waitT; at = `${k}${d}`; }
      const idle = e.cars.filter((c) => c.state === 'idle' && !c.pass.length && c.idleT > 3);
      if (oldest > 20 && idle.length) problems.push(`t${t} e${e.id}(${e.type} ${e.lo}..${e.hi}) call ${at} waited ${oldest.toFixed(0)}min while ${idle.length} car(s) idle`);
      if (oldest > 20 && idle.length && opts.debug && !e._dbg) {
        e._dbg = 1;
        console.log('DEBUG', JSON.stringify({ t, lo: e.lo, hi: e.hi, stops: e.stops, waitN: e.waitN, cfg: e.config,
          qn: Object.keys(e.q).filter((k) => e.q[k].up.length || e.q[k].down.length).map((k) => [k, e.q[k].up.length, e.q[k].down.length, e.isStop[+k + 10], e.qn[+k + 10]]),
          cars: e.cars.map((c) => ({ pos: c.pos, st: c.state, dir: c.dir, tgt: c.target, park: c.parking, pass: c.pass.length, idleT: c.idleT })) }));
      }
    }
    for (const p of s.active) {
      if (p.state === 'ride' && p.rideT > 60) {
        const c = p.car, e = s.elevs.find((x) => x.cars.includes(c));
        problems.push(`t${t} rider stuck ${p.rideT.toFixed(0)}min to ${p.legs[p.li].to} car pos=${c.pos.toFixed(1)} st=${c.state} e=${e && e.lo}..${e && e.hi} stops=${e && e.sLo}..${e && e.sHi}`);
        if (opts.debug) {
          const drops = []; for (let i = 0; i < c.drop.length; i++) if (c.drop[i]) drops.push([i - 10, c.drop[i]]);
          console.log('RIDER', JSON.stringify({ drops, pass: c.pass.map((q) => q.legs[q.li].to), dir: c.dir, tgt: c.target, stopAt: c.stopAt, cap: e.cap, n: c.pass.length, stops: e.stops, waitN: e.waitN, cfg: e.config }));
        }
        break;
      }
    }
    if (problems.length > 5) break;
  }
  return { problems, rescues: s.stats.rescues, trips: s.stats.trips, sim: s };
}

// 性能測定用: 横幅480・60フロアのビル（急行＋2段の各停、80マスごとのバンク）
export function buildWideTower(sim, floors = 60) {
  sim.money = 1e12; sim.star = 3;
  const top = floors - 1;
  for (const f of [0, -1, -2]) mustBuild(sim, 'floor', { f, x: 0, x2: W - 1 });
  for (let f = 1; f <= top; f++) mustBuild(sim, 'floor', { f, x: 0, x2: W - 1 });
  for (const f of LOBBY_FLOORS) if (f <= top) mustBuild(sim, 'lobby', { f, x: 0, x2: W - 1 });
  for (let b = 30; b < W; b += 80) {
    mustBuild(sim, 'express', { f: 0, f2: Math.min(top, 59), x: b });
    for (let i = 0; i < 2; i++) {
      const lo = i * 29, hi = Math.min(top, lo + 29);
      if (hi <= lo) continue;
      mustBuild(sim, 'elevator', { f: lo, f2: hi, x: b + 8 + i * 6 });
    }
  }
  for (const e of sim.elevs) while (e.cars.length < 8) sim.act(e, 'addCar');
  for (let f = 1; f <= top; f++) {
    if (LOBBY_FLOORS.includes(f)) continue;
    for (let x = 0; x + TYPES.office.w <= W; x += TYPES.office.w) sim.build(f % 7 === 3 ? 'condo' : 'office', { f, x });
  }
  for (let x = 0; x + TYPES.garbage.w <= W; x += TYPES.garbage.w) sim.build('garbage', { f: -2, x });
  sim.star = 2;
  for (const o of [...sim.byType.office, ...sim.byType.condo]) sim.moveIn(o);
  sim.star = 3;
  sim.recalcPop();
}
