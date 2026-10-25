// node tests/sim.test.mjs
// シミュレーション（js/sim/）の自動テスト。依存ライブラリなし。
import assert from 'node:assert/strict';
import { Tower, TYPES, DAY, W, LOBBY_FLOORS, AutoPlayer, autoPlay, buildMegaTower, mustBuild, stepTo, smallTower, bombTrial, fireTrial, securityTower, elevatorStress, buildWideTower } from './helpers.mjs';
import { VARIANTS } from '../js/sim/constants.js';
import { SCENARIOS } from '../js/sim/scenarios.js';
import { runStrategy } from './balance.mjs';
import { runSeaside } from './scenario.mjs';
import { SIM } from '../js/sim/rules.js';
import { MIN_F, MAX_F, START_MONEY } from '../js/sim/constants.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ACTIVE_STATES = new Set(['walk', 'wait', 'ride', 'stairs']);
const OW = TYPES.office.w;

// 内部の整合性チェック（エレベーターの待ち列・カゴ・在室人数・active）
function checkInvariants(s) {
  for (const e of s.elevs) {
    let n = 0;
    for (const k in e.q) {
      for (const d of ['up', 'down']) {
        for (const p of e.q[k][d]) {
          assert.equal(p.state, 'wait', 'queue person must be waiting');
          assert.ok(s.active.has(p), 'waiting person must be active');
        }
        n += e.q[k][d].length;
      }
    }
    assert.equal(n, e.waitN, 'waitN mismatch');
    for (const c of e.cars) {
      assert.ok(c.pass.length <= e.cap, 'car over capacity');
      assert.ok(c.pos >= e.lo - 1e-6 && c.pos <= e.hi + 1e-6, 'car out of shaft');
      let drops = 0;
      for (let i = 0; i < c.drop.length; i++) drops += c.drop[i];
      assert.equal(drops, c.pass.length, 'drop counts mismatch');
      for (const p of c.pass) { assert.equal(p.state, 'ride'); assert.equal(p.car, c); }
    }
  }
  for (const p of s.active) assert.ok(ACTIVE_STATES.has(p.state), `bad active state ${p.state}`);
  for (const o of s.objs.values()) assert.ok(o.inCount >= 0, `negative inCount on ${o.type}`);
}

function collect(s) {
  const ev = { message: [], prompt: [], star: [], tower: [], sound: [] };
  for (const k in ev) s.on(k, (d) => ev[k].push(d));
  return ev;
}

// ====================================================================
// 建設ルール
// ====================================================================
test('建設: 支え・フロア代・地下', () => {
  const s = new Tower({ seed: 1 });
  assert.equal(s.check('floor', { f: 1, x: 10, x2: 20 }).ok, false, '支えなしの2F');
  let r = s.build('floor', { f: 0, x: 10, x2: 19 });
  assert.ok(r.ok); assert.equal(r.cost, 10 * 500);
  assert.equal(s.money, START_MONEY - 5000);
  assert.equal(s.grid[0][10], -1);
  assert.ok(s.build('floor', { f: 1, x: 10, x2: 30 }).ok, '支えのある部分だけ張る');
  assert.equal(s.grid[1][15], -1);
  assert.equal(s.grid[1][25], 0);
  assert.equal(s.check('floor', { f: -2, x: 10, x2: 12 }).ok, false, 'B2 は B1 がないと不可');
  assert.ok(s.build('floor', { f: -1, x: 10, x2: 12 }).ok);
  assert.ok(s.build('floor', { f: -2, x: 10, x2: 12 }).ok);
  // 空マスへの施設はフロア代込み
  const c = s.check('office', { f: 0, x: 30 });
  assert.ok(c.ok); assert.equal(c.cost, TYPES.office.cost + OW * 500);
  assert.deepEqual(c.ghost, { x: 30, w: OW, f: 0, h: 1 });
  assert.equal(s.check('office', { f: 2, x: 40 }).ok, false, '3F の下に何もない');
  assert.ok(s.check('office', { f: 1, x: 10 }).ok);
  assert.equal(s.check('office', { f: 0, x: W - 3 }).ok, false, '範囲外');
});

test('建設: only 制約・★ロック・資金', () => {
  const s = new Tower({ seed: 1 });
  for (let f = 0; f <= 3; f++) mustBuild(s, 'floor', { f, x: 0, x2: 60 });
  assert.match(s.check('lobby', { f: 3, x: 0, x2: 10 }).reason, /ロビー/);
  assert.match(s.check('lobby', { f: 0, x: 0, x2: 2 }).reason, /幅4/);
  assert.ok(s.check('lobby', { f: 0, x: 0, x2: 3 }).ok);
  assert.match(s.check('condo', { f: -1, x: 0 }).reason, /地上/);
  assert.match(s.check('hotelSingle', { f: 1, x: 0 }).reason, /★2/);
  s.star = 5;
  assert.match(s.check('garbage', { f: 0, x: 0 }).reason, /地下/);
  assert.match(s.check('metro', { f: -2, x: 0 }).reason, /地下/, '3フロア分すべて地下');
  mustBuild(s, 'floor', { f: -1, x: 0, x2: 60 });
  assert.ok(s.check('garbage', { f: -2, x: 0 }).ok, 'h=2 の地下施設は上の段で支え判定');
  assert.match(s.check('cathedral', { f: 3, x: 0 }).reason, /100F/);
  s.money = 1000;
  assert.match(s.check('office', { f: 1, x: 0 }).reason, /資金/);
  const ev = collect(s);
  assert.equal(s.build('office', { f: 1, x: 0 }).ok, false);
  assert.ok(ev.sound.some((x) => x.name === 'error'));
});

test('建設: h>1 施設と階段', () => {
  const s = new Tower({ seed: 1 });
  s.star = 3;
  for (let f = 0; f <= 3; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  const r = mustBuild(s, 'cinema', { f: 1, x: 0 });
  assert.deepEqual(r.ghost, { x: 0, w: TYPES.cinema.w, f: 1, h: 2 });
  const o = s.objAt(1, 5);
  assert.equal(o.type, 'cinema');
  assert.equal(s.objAt(2, 30), o, '上の段にも同じ id');
  assert.equal(s.grid[3][5], -1);
  // 空中でも一番下の段が支えられていれば OK（上の段は空マス可）
  mustBuild(s, 'floor', { f: 4, x: 40, x2: 80 });
  assert.ok(s.check('partyHall', { f: 4, x: 40 }).ok);
  // 階段は f+1 にもフロアが必要
  assert.match(s.check('stairs', { f: 3, x: 0 }).reason, /上の階/);
  assert.ok(s.build('stairs', { f: 2, x: 40 }).ok);
  // 撤去で空きフロアに戻る
  s.act(o, 'remove');
  assert.equal(s.grid[1][5], -1);
  assert.equal(s.grid[2][5], -1);
});

test('建設: エレベーター（スパン・急行の停止階・移動手段の層・機械室とピット・延長）', () => {
  const s = new Tower({ seed: 1 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 100 });
  for (let f = 1; f <= 40; f++) mustBuild(s, 'floor', { f, x: 0, x2: 100 });
  assert.match(s.check('elevator', { f: 0, f2: 30, x: 10 }).reason, /30/);
  assert.match(s.check('elevator', { f: 3, f2: 3, x: 10 }).reason, /2フロア/);
  const r = mustBuild(s, 'elevator', { f: 0, f2: 29, x: 10 });
  assert.deepEqual(r.ghost, { x: 10, w: 4, lo: 0, hi: 29 });
  const e = s.transportAt(5, 11);
  assert.equal(e.type, 'elevator');
  assert.equal(s.objAt(0, 10).type, 'lobby', 'grid には施設だけ');
  assert.equal(s.tgrid[0][10], e.id);
  assert.equal(s.tgrid[30][10], e.id, '機械室 hi+1');
  assert.equal(s.tgrid[-1][10], e.id, 'ピット lo-1（地中）');
  assert.equal(s.grid[-1][10], 0, 'ピットは構造を要らない');
  assert.equal(e.cars.length, 1);
  assert.equal(e.f, 0); assert.equal(e.h, 30);
  // 施設と重ねて置ける / 移動手段どうしは重ねられない / 機械室にも重ねられない
  mustBuild(s, 'office', { f: 5, x: 40 });
  assert.ok(s.check('elevator', { f: 0, f2: 10, x: 42 }).ok, 'オフィスに重ねられる');
  assert.match(s.check('elevator', { f: 0, f2: 10, x: 12 }).reason, /移動手段/);
  assert.match(s.check('stairs', { f: 30, x: 8 }).reason, /移動手段/, '機械室と重なる');
  // 急行: ロビー階と地下のみ
  // 停止階が無くても建てられる（使われないだけ）
  assert.ok(s.check('express', { f: 1, f2: 10, x: 30 }).ok);
  mustBuild(s, 'express', { f: 0, f2: 40, x: 30 });
  const x = s.transportAt(1, 31);
  assert.deepEqual(x.stops, [0, 14, 29]);
  // 延長とカゴ
  assert.equal(s.act(e, 'extendUp').ok, false, '30フロア制限');
  // 延長先の階にフロアが無くても、支えがあればシャフトの幅だけ自動で作る
  const m41 = s.money;
  assert.equal(s.grid[41][30], 0);
  assert.ok(s.act(x, 'extendUp').ok);
  assert.equal(x.hi, 41);
  assert.equal(s.grid[41][30], -1, 'フロアを作った');
  assert.equal(s.grid[41][29], 0, 'シャフトの幅だけ');
  assert.equal(m41 - s.money, SIM.EXTEND_COST.express + TYPES.express.w * TYPES.floor.costPerTile);
  assert.equal(s.tgrid[42][30], x.id, '機械室も移動');
  assert.equal(s.tgrid[41][30], x.id);
  assert.match(s.check('elevator', { f: 30, f2: 45, x: 60 }).reason, /フロアがありません/, '設置も同じルール');
  assert.ok(s.act(e, 'addCar').ok);
  assert.equal(e.cars.length, 2);
  assert.ok(s.act(e, 'removeCar').ok);
  assert.equal(s.act(e, 'removeCar').ok, false);
  // 撤去しても下のロビーはそのまま
  const lobbyId = s.grid[0][0];
  s.act(e, 'remove');
  assert.equal(s.grid[0][10], lobbyId);
  assert.equal(s.tgrid[0][10], 0);
  assert.equal(s.tgrid[30][10], 0);
  assert.equal(s.transportAt(5, 10), null);
});

test('撤去: 支えている空きフロアは消せない', () => {
  const s = new Tower({ seed: 1 });
  for (let f = 0; f <= 2; f++) mustBuild(s, 'floor', { f, x: 0, x2: 9 });
  assert.equal(s.build('bulldoze', { f: 1, x: 0, x2: 9 }).ok, false);
  assert.ok(s.build('bulldoze', { f: 2, x: 0, x2: 9 }).ok);
  assert.ok(s.build('bulldoze', { f: 1, x: 0, x2: 9 }).ok);
  assert.equal(s.grid[1][3], 0);
  mustBuild(s, 'office', { f: 0, x: 0 });
  const r = s.check('bulldoze', { f: 0, x: 4 });
  assert.deepEqual(r.ghost, { x: 0, w: OW, f: 0, h: 1 }, '施設をクリックしたらゴーストは施設全体');
  assert.ok(s.build('bulldoze', { f: 0, x: 4 }).ok);
  assert.equal(s.grid[0][4], -1);
});

// ====================================================================
// 経路とエレベーター
// ====================================================================
test('経路: 階段・エレベーター・急行の乗り換え', () => {
  const s = new Tower({ seed: 1 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 100 });
  for (let f = 1; f <= 40; f++) mustBuild(s, 'floor', { f, x: 0, x2: 100 });
  mustBuild(s, 'stairs', { f: 0, x: 80 });
  mustBuild(s, 'escalator', { f: 1, x: 80 });
  assert.deepEqual(s.route(0, 2).map((l) => l.kind), ['stairs', 'esc']);
  assert.equal(s.route(0, 5), null);
  mustBuild(s, 'elevator', { f: 0, f2: 14, x: 10 });
  mustBuild(s, 'elevator', { f: 14, f2: 40, x: 20 });
  assert.deepEqual(s.route(0, 1).map((l) => l.kind), ['stairs'], '1階分は階段');
  assert.deepEqual(s.route(0, 10).map((l) => l.kind), ['elev']);
  assert.deepEqual(s.route(0, 35).map((l) => [l.from, l.to]), [[0, 14], [14, 35]]);
  mustBuild(s, 'express', { f: 0, f2: 29, x: 30 });
  const r = s.route(0, 35);
  assert.equal(r[0].kind, 'express');
  assert.deepEqual(r.map((l) => l.to), [29, 35]);
});

test('エレベーター: 人が実際に目的階に届く（多数・双方向）', () => {
  const s = new Tower({ seed: 2 });
  s.money = 1e9;
  smallTower(s, 20);
  const e = s.transportAt(1, 61);
  s.act(e, 'addCar');
  const arrived = [];
  const people = [];
  for (let i = 0; i < 120; i++) {
    const p = s.newPerson('visitor', null);
    s.spawnAt(p, s.entrances[0]);
    const f = 1 + (i % 20);
    assert.ok(s.startTrip(p, f, 45, (pp) => { arrived.push([pp, f, pp.f]); s.settle(pp, s.objAt(0, 41)); }));
    people.push(p);
  }
  let t = 0;
  while (arrived.length < 120 && t < 300) { s.step(1); t++; checkInvariants(s); }
  assert.equal(arrived.length, 120, `全員到着 (${arrived.length}/120, ${t}分)`);
  for (const [, f, pf] of arrived) assert.equal(pf, f);
  assert.equal(s.stats.rescues, 0, '救済なし');
  // 下り
  arrived.length = 0;
  for (const p of people) { assert.ok(s.startTrip(p, 0, 50, (pp) => { arrived.push([pp, 0, pp.f]); s.leave(pp); })); }
  t = 0;
  while (arrived.length < 120 && t < 300) { s.step(1); t++; }
  assert.equal(arrived.length, 120);
  assert.equal(s.active.size, 0);
  assert.equal(e.waitN, 0);
  for (const c of e.cars) assert.equal(c.pass.length, 0);
});

test('エレベーター: 急行→各停の乗り換え、地下鉄からの出入り', () => {
  const s = new Tower({ seed: 3 });
  s.money = 1e9; s.star = 5;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 120 });
  for (let f = 1; f <= 40; f++) mustBuild(s, 'floor', { f, x: 0, x2: 120 });
  for (let f = -1; f >= -3; f--) mustBuild(s, 'floor', { f, x: 0, x2: 120 });
  mustBuild(s, 'express', { f: -3, f2: 29, x: 30 });
  mustBuild(s, 'elevator', { f: 29, f2: 40, x: 50 });
  mustBuild(s, 'metro', { f: -3, x: 60 });
  assert.equal(s.entrances.length, 2);
  assert.equal(s.entrances.find((e) => e.metro).f, -1);
  const done = [];
  for (let i = 0; i < 30; i++) {
    const p = s.newPerson('visitor', null);
    s.spawnAt(p, s.entrances[i % 2]);
    s.startTrip(p, 35, 10, (pp) => { done.push(pp.f); s.leave(pp); });
  }
  let t = 0;
  while (done.length < 30 && t < 240) { s.step(1); t++; checkInvariants(s); }
  assert.equal(done.length, 30);
  assert.ok(done.every((f) => f === 35));
  assert.equal(s.stats.rescues, 0);
});

test('階段・エスカレーター: 移動と drawPos の中間値', () => {
  const s = new Tower({ seed: 4 });
  s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 40 });
  for (let f = 1; f <= 3; f++) mustBuild(s, 'floor', { f, x: 0, x2: 40 });
  mustBuild(s, 'stairs', { f: 0, x: 10 });
  mustBuild(s, 'escalator', { f: 1, x: 20 });
  const p = s.newPerson('visitor', null);
  s.spawnAt(p, s.entrances[0]);
  let ok = false, sawMid = false;
  s.startTrip(p, 2, 5, () => { ok = true; });
  for (let i = 0; i < 400 && !ok; i++) {
    s.step(0.25);
    if (p.state === 'stairs') { const d = s.drawPos(p); if (d.f % 1 !== 0) sawMid = true; }
    if (p.state === 'ride') assert.equal(s.drawPos(p), null);
  }
  assert.ok(ok, '2Fへ到着');
  assert.ok(sawMid, '階段の途中のフロア値が中間値');
  assert.ok(p.stress >= SIM.STAIR_STRESS, '階段でストレス');
});

// ====================================================================
// 長期シミュレーション・バランス
// ====================================================================
test('長期: 自動プレイヤーで 70 日（例外なし・リークなし・資金・★の進行）', () => {
  const s = new Tower({ seed: 7, construction: true });
  const ev = collect(s);
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.choices[p.choices.length - 1].value));
  let minMoney = Infinity, maxNight = 0;
  const starDay = {};
  s.on('star', (e) => { starDay[e.star] = s.day; });
  const ap = new AutoPlayer(s);
  ap.setup();
  for (let d = 0; d < 70; d++) {
    stepTo(s, d + 1, 1);
    ap.act();
    stepTo(s, d + 1, 3);
    checkInvariants(s);
    maxNight = Math.max(maxNight, s.active.size);
    for (const p of s.active) assert.ok(p.tripT <= SIM.TRIP_LIMIT + 1, 'リーク: 長時間 active');
    minMoney = Math.min(minMoney, s.money);
  }
  const trips = s.stats.trips;
  console.log(`    ★2: ${starDay[2]}日目, ★3: ${starDay[3]}日目, 人口 ${s.pop}, 資金 $${Math.round(s.money).toLocaleString()}, 最低資金 $${Math.round(minMoney).toLocaleString()}, ` +
    `移動 ${trips.toLocaleString()}回, 救済 ${s.stats.rescues}, 平均ストレス ${(s.stats.stress / trips).toFixed(1)}, 深夜の active 最大 ${maxNight}, 事件 prompt ${ev.prompt.length}`);
  assert.ok(starDay[2] !== undefined && starDay[2] <= 30, '★2 に30日以内');
  assert.ok(starDay[3] !== undefined && starDay[3] <= 60, '★3 に60日以内');
  assert.ok(minMoney > -200000, '資金が大きくマイナスにならない');
  assert.ok(s.money > 0);
  assert.ok(maxNight <= 15, '深夜に移動中の人がほぼいない');
  assert.ok(s.stats.rescues <= trips * 0.001, '救済はごく稀');
  assert.ok(ev.message.some((m) => m.kind === 'money'));
  assert.ok(ev.sound.some((m) => m.name === 'cash'));
});

test('評価: エレベーターが足りないと評価が下がり、苦情・退去が起きる', () => {
  const s = new Tower({ seed: 8 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 149 });
  for (let f = 1; f <= 29; f++) mustBuild(s, 'floor', { f, x: 0, x2: 149 });
  mustBuild(s, 'elevator', { f: 0, f2: 29, x: 70 });
  for (let f = 1; f <= 29; f++) for (let x = 0; x + OW <= 70; x += OW) s.build('office', { f, x });
  for (const o of s.byType.office) s.moveIn(o);
  const ev = collect(s);
  stepTo(s, 1, 12);
  const lv = { good: 0, fair: 0, bad: 0 };
  for (const o of s.byType.office) lv[s.evalLevel(o)]++;
  assert.ok(lv.bad > 0, `bad が出る ${JSON.stringify(lv)}`);
  stepTo(s, 4, 12);
  assert.ok(ev.message.some((m) => m.kind === 'complaint' && /エレベーター/.test(m.text)), '原因別の苦情');
  assert.ok(ev.message.some((m) => m.kind === 'bad' && /退去/.test(m.text)), '退去');
  assert.ok(s.byType.office.some((o) => o.complaintUntil > 0 && o.complaint));
  checkInvariants(s);
});

// ====================================================================
// ホテル・清掃・ゴキブリ・騒音
// ====================================================================
function hotelTower(seed, withHK) {
  const s = new Tower({ seed });
  s.money = 1e8; s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 80 });
  for (let f = 1; f <= 5; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  mustBuild(s, 'elevator', { f: 0, f2: 5, x: 40 });
  for (let f = 1; f <= 4; f++) for (let x = 0; x + 4 <= 40; x += 4) s.build('hotelSingle', { f, x });
  if (withHK) mustBuild(s, 'housekeeping', { f: 5, x: 0 });
  return s;
}

test('ホテル: 予約→チェックイン→チェックアウト（宿泊料）→清掃', () => {
  const s = hotelTower(10, true);
  const ev = collect(s);
  const m0 = s.money;
  stepTo(s, 0, 21);
  const rooms = s.hotels;
  const booked = rooms.filter((o) => o.occupied);
  assert.ok(booked.length > 10, '予約が入る');
  assert.ok(booked.some((o) => o.inCount > 0), 'チェックイン済み');
  assert.ok(s.pop > 0, '宿泊客は人口に数える');
  // チェックアウト後は要清掃になる（清掃が速いと11時には終わっているので途中で確かめる）
  let sawDirty = false, sawMaid = false;
  while (s.time < DAY + 11 * 60) {
    s.step(0.25);
    if (rooms.some((o) => o.dirty || o.cleaner)) sawDirty = true;
    if ([...s.active].some((p) => p.kind === 'maid')) sawMaid = true;
  }
  assert.ok(rooms.every((o) => !o.occupied), '全室チェックアウト');
  assert.ok(s.money > m0, '宿泊料');
  assert.ok(s.dayLog.hotel > 0);
  assert.ok(!ev.message.some((m) => m.kind === 'money'), 'お金の通知は0時のまとめだけ');
  assert.ok(sawDirty, '要清掃');
  // メイドが実際に移動して清掃する
  for (let i = 0; i < 60 * 8; i++) { s.step(1); if ([...s.active].some((p) => p.kind === 'maid')) sawMaid = true; }
  assert.ok(sawMaid, 'メイドが移動する');
  assert.equal(rooms.filter((o) => o.dirty).length, 0, '清掃完了');
  stepTo(s, 2, 0); s.step(1);
  assert.ok(ev.message.some((m) => m.kind === 'money' && /宿泊 \$/.test(m.text)), '0時のまとめに宿泊料');
  assert.ok(s.effects.length >= 0);
  checkInvariants(s);
});

test('ゴキブリ: 清掃されないと2日で発生→拡散→駆除', () => {
  const s = hotelTower(11, false);
  const ev = collect(s);
  stepTo(s, 1, 12);
  const dirty = s.hotels.filter((o) => o.dirty);
  assert.ok(dirty.length > 0);
  assert.ok(s.hotels.every((o) => !o.infested));
  stepTo(s, 4, 1);
  const inf = s.hotels.filter((o) => o.infested);
  assert.ok(inf.length > 0, '発生');
  assert.ok(ev.sound.some((x) => x.name === 'roach'));
  assert.ok(ev.message.some((m) => /ゴキブリ/.test(m.text) && m.f !== undefined));
  const n1 = inf.length;
  stepTo(s, 7, 1);
  const n2 = s.hotels.filter((o) => o.infested).length;
  assert.ok(n2 >= n1, '拡散（減らない）');
  // 発生中は予約が入らない
  stepTo(s, 7, 17);
  for (const o of s.hotels) if (o.infested) assert.equal(o.occupied, false);
  const o = s.hotels.find((h) => h.infested);
  const d = s.describe(o);
  const a = d.actions.find((x) => x.id === 'exterminate');
  assert.ok(a.enabled); assert.equal(a.cost, 10000);
  const m = s.money;
  assert.ok(s.act(o, 'exterminate').ok);
  assert.equal(o.infested, false);
  assert.equal(s.money, m - 10000);
  assert.equal(s.act(o, 'exterminate').ok, false);
});

test('騒音: マンションの近くの飲食店は苦情の原因', () => {
  const s = new Tower({ seed: 12 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 60 });
  mustBuild(s, 'stairs', { f: 0, x: 50 });
  mustBuild(s, 'condo', { f: 1, x: 0 });
  mustBuild(s, 'condo', { f: 1, x: 36 });
  mustBuild(s, 'fastfood', { f: 1, x: 18 });
  const a = s.objAt(1, 0), b = s.objAt(1, 36);
  assert.equal(a.noisy, true, '2マス離れ');
  assert.equal(b.noisy, true, '2マス離れ');
  s.act(s.objAt(1, 20), 'remove');
  assert.equal(a.noisy, false);
  mustBuild(s, 'fastfood', { f: 1, x: 20 });
  assert.equal(a.noisy, true, '4マス以内');
  s.moveIn(a);
  const ev = collect(s);
  s.complaints(true);
  assert.ok(a.complaintUntil > s.time);
  assert.match(a.complaint, /2Fの住人: .*うるさ/);
  assert.ok(ev.message.some((m) => m.kind === 'complaint' && m.f === 1));
  assert.ok(ev.sound.some((x) => x.name === 'complaint'));
  assert.ok(s.evalScore(a) >= 20, '騒音で評価悪化');
});

// ====================================================================
// 事件
// ====================================================================
function incidentTower(seed, security) {
  const s = new Tower({ seed });
  s.money = 1e8; s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 100 });
  for (let f = 1; f <= 12; f++) mustBuild(s, 'floor', { f, x: 0, x2: 100 });
  mustBuild(s, 'elevator', { f: 0, f2: 12, x: 50 });
  s.act(s.transportAt(1, 50), 'addCar');
  for (let f = 1; f <= 12; f++) {
    for (let x = 0; x + OW <= 50; x += OW) s.build('office', { f, x });
    for (let x = 54; x + OW <= 100; x += OW) s.build('office', { f, x });
  }
  if (security) {
    for (const f of [3, 9]) { s.act(s.objAt(f, 54), 'remove'); s.act(s.objAt(f, 54 + OW), 'remove'); mustBuild(s, 'security', { f, x: 54 }); }
  }
  for (const o of s.byType.office) s.moveIn(o);
  stepTo(s, 0, 10);
  return s;
}

test('爆破予告: 身代金を払う', () => {
  const s = incidentTower(20, false);
  const ev = collect(s);
  assert.ok(s.trigger('bomb'));
  assert.equal(ev.prompt.length, 1);
  const p = ev.prompt[0];
  assert.equal(p.kind, 'bomb');
  assert.ok(ev.sound.some((x) => x.name === 'alarm'));
  const m = s.money;
  s.answer(p.id, 'pay');
  assert.ok(s.money <= m - 100000);
  assert.equal(s.bomb, null);
});

test('爆破予告: 拒否→警備員が捜索して発見・解除', () => {
  const s = incidentTower(21, true);
  const ev = collect(s);
  s.trigger('bomb');
  s.answer(ev.prompt[0].id, 'refuse');
  assert.ok(s.bomb && !s.bomb.found);
  assert.ok(s.bomb.deadline === s.time + 180);
  let guardsMoving = false;
  for (let i = 0; i < 180 && s.bomb && !s.bomb.found; i++) {
    s.step(1);
    if ([...s.active].some((p) => p.kind === 'guard')) guardsMoving = true;
    checkInvariants(s);
  }
  assert.ok(guardsMoving, '警備員が実際に移動する');
  assert.ok(ev.message.some((m) => /発見し、解除/.test(m.text)), '解除');
  assert.ok(!ev.sound.some((x) => x.name === 'boom'));
  stepTo(s, 0, 18);
  assert.equal(s.bomb, null);
  const sec = s.byType.security[0];
  stepTo(s, 0, 20);
  assert.ok(sec.members.every((g) => g.state === 'in' && g.loc === sec && !g.task), '警備員は帰還');
});

test('爆破予告: 警備室なし→爆発（±1フロア・±20マス、エレベーターは残る）', () => {
  const s = incidentTower(22, false);
  const ev = collect(s);
  s.trigger('bomb');
  s.answer(ev.prompt[0].id, 'refuse');
  const { f, x } = s.bomb;
  const before = s.byType.office.length;
  s.step(181);
  assert.equal(s.bomb, null);
  assert.ok(ev.sound.some((x2) => x2.name === 'boom'));
  assert.ok(s.effects.some((e) => e.kind === 'explosion'));
  assert.ok(s.byType.office.length < before, '施設が消えた');
  for (let ff = f - 1; ff <= f + 1; ff++) {
    for (const o of s.byFloor.get(ff) || []) assert.ok(o.x + o.w - 1 < x - 20 || o.x > x + 20, '爆心付近に施設が残っていない');
  }
  assert.equal(s.elevs.length, 1, 'エレベーターは残る');
  s.step(60 * 6);
  checkInvariants(s);
});

test('火災: 警備員が消火する', () => {
  const s = incidentTower(23, true);
  const ev = collect(s);
  const target = s.objAt(8, 10);
  assert.ok(s.trigger('fire', target));
  assert.equal(ev.prompt[0].kind, 'fire');
  s.answer(ev.prompt[0].id, 'wait');
  assert.ok(s.fires.length >= 1);
  assert.deepEqual(s.fires[0], { f: 8, x0: target.x, x1: target.x + target.w });
  let t = 0;
  while (s.fire && t < 400) { s.step(1); t++; }
  assert.equal(s.fire, null);
  assert.equal(s.fires.length, 0);
  assert.ok(ev.message.some((m) => /警備員が\d+件を消火/.test(m.text)));
  assert.ok(!target.dead, '焼失前に消火');
  assert.ok(target.burnt > 0 && target.burnt < 1);
  checkInvariants(s);
});

test('火災: ヘリで消火 $50万', () => {
  const s = incidentTower(24, false);
  const ev = collect(s);
  s.trigger('fire', s.objAt(5, 10));
  const m = s.money;
  s.answer(ev.prompt[0].id, 'heli');
  assert.equal(s.money, m - 500000);
  s.step(20);
  assert.equal(s.fire, null);
  assert.ok(ev.message.some((x) => /ヘリ/.test(x.text)));
});

test('火災: 警備室なし→延焼・焼失、いずれ鎮火', () => {
  const s = incidentTower(25, false);
  const ev = collect(s);
  s.trigger('fire', s.objAt(5, 20));
  s.answer(ev.prompt[0].id, 'wait');
  let maxBurning = 0;
  let t = 0;
  while (s.fire && t < 600) { s.step(1); t++; maxBurning = Math.max(maxBurning, s.fire ? s.fire.burning.size : 0); }
  assert.equal(s.fire, null, '鎮火');
  assert.ok(maxBurning > 1, '延焼');
  assert.ok(ev.message.some((m) => /焼失/.test(m.text)), '焼失');
  assert.ok(ev.sound.some((x) => x.name === 'fire'));
  checkInvariants(s);
});

test('事件の自然発生: ★2 以降、数週間に1回程度', () => {
  const s = incidentTower(26, true);
  const ev = collect(s);
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : 'wait'));
  s.flags.nextBomb = 5; s.flags.nextFire = 5;
  stepTo(s, 120, 0);
  const n = ev.prompt.filter((p) => p.kind === 'bomb' || p.kind === 'fire').length;
  console.log(`    120日で事件 ${n} 回`);
  assert.ok(n >= 2 && n <= 10, `頻度 ${n}`);
  const s1 = new Tower({ seed: 3 });
  const ev1 = collect(s1);
  smallTower(s1, 3);
  stepTo(s1, 60, 0);
  assert.equal(ev1.prompt.length, 0, '★1 では起きない');
});

test('VIP: 清潔なスイートへ快適に到着 → ★4（条件がそろえば★5まで）', () => {
  const s = new Tower({ seed: 30 });
  buildMegaTower(s);
  s.star = 3;
  s.act(s.objAt(8, 0), 'remove'); s.act(s.objAt(8, OW), 'remove');
  mustBuild(s, 'hotelSuite', { f: 8, x: 0 });
  const ev = collect(s);
  s.on('prompt', (p) => s.answer(p.id, 'ok'));
  stepTo(s, 4, 0);
  assert.ok(ev.prompt.some((p) => p.kind === 'vip'), 'VIP の予告');
  assert.ok(s.flags.vipOk, `VIP 成功 ${ev.message.filter((m) => /VIP/.test(m.text)).map((m) => m.text).join(' / ')}`);
  assert.ok(ev.star.some((x) => x.star === 4));
  if (s.pop >= 6000) assert.equal(s.star, 5, '人口6000・地下鉄もあるので★5');
});

test('VIP: 要清掃のスイートでは失敗し、7日後に再挑戦', () => {
  const s = new Tower({ seed: 31 });
  s.money = 1e8; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 60 });
  mustBuild(s, 'stairs', { f: 0, x: 40 });
  mustBuild(s, 'hotelSuite', { f: 1, x: 0 });
  const suite = s.objAt(1, 0);
  suite.dirty = true; suite.dirtySince = s.time;
  const ev = collect(s);
  assert.ok(s.trigger('vip'));
  let vipSeen = false;
  for (let i = 0; i < 60 * 30 && (s.vip || !ev.message.some((m) => /VIPの評価/.test(m.text))); i++) {
    s.step(1);
    if ([...s.active].some((p) => p.kind === 'vip')) vipSeen = true;
  }
  assert.ok(vipSeen, 'VIP が歩く');
  assert.equal(s.flags.vipOk, false);
  assert.ok(ev.message.some((m) => /清掃されていなかった/.test(m.text)));
  assert.equal(s.flags.vipNext, s.day + 7);
  assert.equal(s.star, 3);
});

test('結婚式: ★5・100F の大聖堂 → TOWER 達成', () => {
  const s = new Tower({ seed: 40 });
  buildMegaTower(s);
  s.flags.vipOk = true;
  const ev = collect(s);
  s.on('prompt', (p) => s.answer(p.id, 'ok'));
  stepTo(s, 5, 11);
  s.step(1);
  assert.ok(ev.prompt.some((p) => p.kind === 'wedding'), '土曜11時に開始');
  const kinds = new Set([...s.active].map((p) => p.kind));
  assert.ok(kinds.has('bride') || kinds.has('groom') || s.wedding.people.some((p) => p.kind === 'bride'));
  stepTo(s, 5, 15);
  assert.equal(s.tower, true, ev.message.filter((m) => /結婚式/.test(m.text)).map((m) => m.text).join('/'));
  assert.equal(ev.tower.length, 1);
  assert.ok(ev.sound.some((x) => x.name === 'bells'));
  assert.deepEqual(s.starProgress(), { star: 5, next: null, reqs: [] });
  stepTo(s, 6, 15);
  assert.equal(ev.tower.length, 1, '一度だけ');
});

test('結婚式: 大聖堂まで経路がなければ延期', () => {
  const s = new Tower({ seed: 41 });
  s.money = 1e9; s.star = 5;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  for (let f = 1; f <= 99; f++) mustBuild(s, 'floor', { f, x: 0, x2: 40 });
  mustBuild(s, 'cathedral', { f: 99, x: 0 });
  const ev = collect(s);
  stepTo(s, 5, 12);
  assert.ok(ev.message.some((m) => /延期/.test(m.text)));
  assert.equal(s.tower, false);
});

// ====================================================================
// ★評価・パネル
// ====================================================================
test('★: starProgress と条件', () => {
  const s = new Tower({ seed: 50 });
  let sp = s.starProgress();
  assert.equal(sp.star, 1); assert.equal(sp.next, 2);
  assert.equal(sp.reqs.length, 1); assert.equal(sp.reqs[0].done, false);
  s.star = 2; s.pop = 1500;
  sp = s.starProgress();
  assert.deepEqual(sp.reqs.map((r) => r.done), [true, false]);
  assert.equal(sp.reqs[1].label, '警備室');
  s.star = 3;
  assert.deepEqual(s.starProgress().reqs.map((r) => r.label).slice(1), ['医療センター', 'ごみ・リサイクルセンター（ごみが溢れていない）', 'VIPの高評価']);
  s.star = 5;
  assert.equal(s.starProgress().next, 'TOWER');
});

test('パネル: describe / act', () => {
  const s = new Tower({ seed: 51 });
  smallTower(s, 5);
  const e = s.transportAt(1, 61);
  let d = s.describe(e);
  assert.equal(d.title, 'エレベーター');
  assert.equal(d.subtitle, '1F〜6F');
  for (const id of ['addCar', 'removeCar', 'extendUp', 'extendDown', 'remove']) assert.ok(d.actions.find((a) => a.id === id), id);
  assert.equal(d.actions.find((a) => a.id === 'removeCar').enabled, false);
  assert.ok(d.actions.find((a) => a.id === 'remove').danger);
  assert.equal(d.actions.find((a) => a.id === 'extendDown').enabled, true, 'B1F のフロアも一緒に作れる');
  assert.equal(d.actions.find((a) => a.id === 'extendUp').enabled, true, '7F のフロアも一緒に作れる');
  assert.ok(d.stats.some(([k]) => k === '平均待ち時間'));
  mustBuild(s, 'office', { f: 2, x: 40 });
  const o = s.objAt(2, 40);
  d = s.describe(o);
  assert.match(d.subtitle, /3F・空室/);
  assert.ok(Array.isArray(d.stats) && d.stats.every((x) => x.length === 2));
  assert.equal(s.act(o, 'addCar').ok, false);
  assert.equal(s.act(o, 'nope').ok, false);
  assert.ok(s.act(o, 'remove').ok);
  assert.equal(s.act(o, 'remove').ok, false);
  // 人も describe できる
  const p = s.newPerson('visitor', null);
  assert.equal(s.describe(p).title, p.name); assert.match(s.describe(p).subtitle, /歳/);
  for (const t of Object.keys(TYPES)) {
    if (t === 'floor') continue;
    const fake = s.makeObj(t, 0, 0, TYPES[t].w || 4, TYPES[t].h || 1);
    if (t === 'elevator' || t === 'express') continue;
    assert.ok(s.describe(fake).title, t);
    s.objs.delete(fake.id);
  }
});

// ====================================================================
// 保存
// ====================================================================
test('保存: serialize → JSON → restore の往復', () => {
  const s = new Tower({ seed: 60 });
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.choices[p.choices.length - 1].value));
  autoPlay(s, 30);
  stepTo(s, 31, 10); // 平日の10時（勤務中）
  const h = s.hotels[0];
  if (h) { h.dirty = true; h.dirtySince = s.time - 100; h.infested = true; }
  s.flags.vipNext = 99;
  const data = JSON.parse(JSON.stringify(s.serialize()));
  assert.equal(data.v, 3);
  const r = new Tower();
  r.restore(data);
  for (let f = MIN_F; f <= MAX_F; f++) { assert.deepEqual(Array.from(r.grid[f]), Array.from(s.grid[f]), `grid ${f}`); assert.deepEqual(Array.from(r.tgrid[f]), Array.from(s.tgrid[f]), `tgrid ${f}`); }
  assert.equal(r.objs.size, s.objs.size);
  for (const k of ['time', 'money', 'star', 'tower', 'pop']) assert.equal(r[k], s[k], k);
  assert.deepEqual(r.flags, s.flags);
  for (const o of s.objs.values()) {
    const o2 = r.objs.get(o.id);
    assert.equal(o2.type, o.type);
    assert.equal(o2.occupied, o.occupied, `occupied ${o.type}`);
    if (o.cars) assert.equal(o2.cars.length, o.cars.length);
    if (o.dirty !== undefined) { assert.equal(o2.dirty, o.dirty); assert.equal(o2.infested, o.infested); }
  }
  // 勤務時間中なのでオフィスに人がいる
  const occ = r.byType.office.filter((o) => o.occupied);
  assert.ok(occ.length > 0 && occ.every((o) => o.inCount === 6), 'オフィスで勤務中');
  assert.equal(r.active.size, 0);
  // そのまま動かし続けられる
  const ev = collect(r);
  r.step(DAY * 3);
  checkInvariants(r);
  assert.ok(ev.message.length > 0);
  // 2回目の往復で同じ JSON
  const d2 = JSON.stringify(r.serialize());
  const r2 = new Tower(); r2.restore(JSON.parse(d2));
  assert.equal(JSON.stringify(r2.serialize()).length > 0, true);
  assert.deepEqual(r2.serialize().objs, JSON.parse(d2).objs);
});

test('保存: 事件中（爆弾・火災・プロンプト待ち）の保存と復元', () => {
  const s = incidentTower(61, true);
  s.trigger('bomb');
  const data1 = JSON.parse(JSON.stringify(s.serialize()));
  assert.equal(data1.prompts.length, 1);
  const r1 = new Tower(); r1.restore(data1);
  const ev1 = collect(r1);
  r1.step(0.25);
  assert.equal(ev1.prompt.length, 1, 'プロンプトを再通知');
  r1.answer(ev1.prompt[0].id, 'refuse');
  assert.ok(r1.bomb);
  const data2 = JSON.parse(JSON.stringify(r1.serialize()));
  const r2 = new Tower(); r2.restore(data2);
  assert.ok(r2.bomb && r2.bomb.searched instanceof Set);
  r2.step(200);
  assert.equal(r2.bomb, null);
  // 火災
  const s3 = incidentTower(62, false);
  s3.trigger('fire', s3.objAt(4, 10));
  s3.answer([...s3.pending.keys()][0], 'wait');
  s3.step(30);
  const r3 = new Tower(); r3.restore(JSON.parse(JSON.stringify(s3.serialize())));
  assert.ok(r3.fire && r3.fires.length >= 1);
  r3.step(600);
  assert.equal(r3.fire, null);
  checkInvariants(r3);
});

test('保存: 壊れたデータは例外、部分的な破損は読み飛ばす', () => {
  const r = new Tower();
  assert.throws(() => r.restore(null));
  assert.throws(() => r.restore({ foo: 1 }));
  const s = new Tower({ seed: 63 });
  smallTower(s, 3);
  const d = s.serialize();
  d.objs.push({ id: 9999, type: 'nonsense', f: 0, x: 0 });
  d.objs.push({ id: 9998, type: 'office', f: 1, x: W - 2 });
  r.restore(d);
  assert.equal(r.objs.size, s.objs.size);
});

test('ファズ: 稼働中にランダムな建設・撤去・カゴ操作を繰り返しても例外なし', () => {
  for (const seed of [80, 81, 82]) {
    const s = new Tower({ seed });
    s.money = 1e10; s.star = 5;
    s.on('prompt', (p) => s.answer(p.id, p.choices[(seed + p.id.length) % p.choices.length].value));
    const ap = new AutoPlayer(s);
    ap.setup();
    for (let d = 0; d < 6; d++) { stepTo(s, d + 1, 1); ap.act(); }
    let rnd = seed * 9301;
    const R = (n) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return Math.floor((rnd / 2147483648) * n); };
    const tools = Object.keys(TYPES).concat(['bulldoze', 'bulldoze', 'bulldoze']);
    for (let i = 0; i < 1500; i++) {
      const tool = tools[R(tools.length)];
      const f = R(30) - 3, x = R(W);
      s.build(tool, { f, x, x2: x + R(20) - 10, f2: f + R(20) - 5 });
      if (i % 7 === 0 && s.elevs.length) {
        const e = s.elevs[R(s.elevs.length)];
        s.act(e, ['addCar', 'removeCar', 'extendUp', 'extendDown'][R(4)]);
      }
      if (i % 50 === 0) s.trigger(['bomb', 'fire', 'complaint', 'vip', 'wedding'][R(5)]);
      if (i % 97 === 0) { const o = [...s.objs.values()][R(s.objs.size)]; if (o) s.act(o, 'remove'); }
      s.step(R(40) + 1);
      if (i % 25 === 0) checkInvariants(s);
    }
    s.step(DAY * 2);
    checkInvariants(s);
    for (const p of s.active) assert.ok(p.tripT <= SIM.TRIP_LIMIT + 1);
    const r = new Tower(); r.restore(JSON.parse(JSON.stringify(s.serialize())));
    r.step(DAY);
    checkInvariants(r);
  }
});

// ====================================================================
// 修正ラウンド2
// ====================================================================
test('経済: 素朴なプレイ（1基1台で30F）は資金が尽きかけ、真面目なプレイは★2に10〜18日', () => {
  const naive = [1, 2, 3].map((seed) => runStrategy('naive', seed, 20));
  const smart = [1, 2, 3].map((seed) => runStrategy('smart', seed, 20));
  for (const r of naive) console.log(`    素朴 seed${r.seed}: 最低 $${r.minK}k (${r.minDay}日目), 10日目 $${r.money[10]}k, 20日目 $${r.money[20]}k, 人口 ${r.pop}`);
  for (const r of smart) console.log(`    真面目 seed${r.seed}: 最低 $${r.minK}k, ★2 ${r.star2}日目, 20日目 $${r.money[20]}k, 人口 ${r.pop}`);
  for (const r of naive) { assert.ok(r.minK < 100, '素朴なプレイは $10万 を割る'); assert.ok(r.money[20] < 500, '20日たっても資金が増えない'); }
  for (const r of smart) { assert.ok(r.star2 !== null && r.star2 >= 8 && r.star2 <= 18, `★2 ${r.star2}`); assert.ok(r.minK > -50, '真面目なプレイは破産しない'); }
});

test('経済: 悪い評価で退去したマンションは買い戻し、混雑したエレベーターの階には入居しにくい', () => {
  const s = new Tower({ seed: 90 });
  smallTower(s, 3);
  mustBuild(s, 'condo', { f: 1, x: 40 });
  const o = s.objAt(1, 40);
  s.moveIn(o);
  const m = s.money;
  s.vacate(o, true);
  assert.equal(s.money, m - TYPES.condo.sale);
  assert.equal(s.dayLog.buyback, TYPES.condo.sale);
  assert.ok(o.vacantUntil > s.time);
  const e = s.transportAt(1, 61);
  assert.equal(s.serviceFactor(1), 1);
  e.peakWaitRecent = 40;
  assert.ok(s.serviceFactor(1) < 0.1);
});

test('事件の難易度: 30フロアで警備室1室なら爆弾発見は五分五分、分散して3室ならほぼ確実', () => {
  const N = 16;
  let one = 0, three = 0, none = 0;
  for (let i = 1; i <= N; i++) { if (bombTrial(i, [15])) one++; if (bombTrial(i, [5, 15, 25])) three++; if (bombTrial(i, [])) none++; }
  console.log(`    爆弾発見: 1室 ${one}/${N}, 3室 ${three}/${N}, なし ${none}/${N}`);
  assert.ok(one >= N * 0.2 && one <= N * 0.8, `1室 ${one}`);
  assert.ok(three >= N * 0.85, `3室 ${three}`);
  assert.equal(none, 0);
  let b1 = 0, b0 = 0;
  for (let i = 1; i <= 8; i++) { b1 += fireTrial(i, [15]); b0 += fireTrial(i, []); }
  console.log(`    火災の焼失（8回合計）: 1室 ${b1}件, なし ${b0}件`);
  assert.ok(b0 > b1 && b0 >= 8 * 5, '警備室がないと大きく燃える');
});

test('警備: 1室から出動するのは3人まで、担当範囲は上下15フロア', () => {
  const s = securityTower(91, [2], 30);
  let id; s.on('prompt', (p) => { id = p.id; });
  s.trigger('bomb'); s.answer(id, 'refuse');
  s.step(1);
  const sec = s.byType.security[0];
  assert.equal(sec.members.filter((g) => g.task).length, SIM.SQUAD);
  s.step(170);
  if (s.bomb) for (const f of s.bomb.searched) assert.ok(Math.abs(f - 2) <= SIM.GUARD_RANGE, `範囲外 ${f}`);
  assert.ok(s.searchTime(5) > s.searchTime(29) || s.searchTime(5) >= SIM.SEARCH_BASE);
});

test('通知: 火災はまとめて1件、苦情は1回のチェックで1件、お金は0時のまとめ', () => {
  const s = incidentTower(92, false);
  const ev = collect(s);
  s.trigger('fire', s.objAt(5, 20));
  s.answer(ev.prompt[0].id, 'wait');
  s.step(600);
  const fireMsgs = ev.message.filter((m) => /焼失/.test(m.text));
  assert.equal(fireMsgs.length, 1, '焼失の通知は1件');
  assert.match(fireMsgs[0].text, /火災で施設\d+件が焼失しました/);
  // 苦情
  for (const o of s.byType.office) { o.eval = 90; o.cWait = 50; }
  ev.message.length = 0;
  s.complaints(true);
  const c = ev.message.filter((m) => m.kind === 'complaint');
  assert.equal(c.length, 1);
  assert.match(c[0].text, /ほか\d+件の苦情/);
  assert.ok(s.byType.office.filter((o) => o.complaintUntil > s.time).length > 1, '吹き出しは全件');
  // お金
  ev.message.length = 0;
  stepTo(s, 2, 23);
  assert.equal(ev.message.filter((m) => m.kind === 'money').length, 1, '1日1回のまとめ');
  assert.ok(ev.message.some((m) => /昨日の収支/.test(m.text) && /賃料/.test(m.text)));
  assert.ok(!ev.message.some((m) => /入居者が決まりました/.test(m.text)));
});

test('到達不能フラグ: unreachable と describe の警告', () => {
  const s = new Tower({ seed: 93 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 40 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 40 });
  mustBuild(s, 'office', { f: 1, x: 0 });
  mustBuild(s, 'office', { f: 0, x: 41 });
  mustBuild(s, 'office', { f: 0, x: 60 });
  const o = s.objAt(1, 0);
  assert.equal(o.unreachable, true);
  assert.equal(s.objAt(0, 41).unreachable, false, 'ロビーと続いている');
  assert.equal(s.objAt(0, 60).unreachable, true, 'フロアの切れ目の向こうには行けない');
  const d = s.describe(o);
  assert.equal(d.warning, 'ロビーから行けません');
  assert.ok(d.stats.some(([, v]) => v === 'ロビーから行けません'));
  const rev = s.revision;
  mustBuild(s, 'stairs', { f: 0, x: 20 });
  assert.ok(s.revision > rev);
  assert.equal(o.unreachable, false);
  assert.equal(s.describe(o).warning, undefined);
  const s2 = new Tower({ seed: 94 });
  mustBuild(s2, 'floor', { f: 0, x: 0, x2: 20 });
  mustBuild(s2, 'office', { f: 0, x: 0 });
  assert.equal(s2.objAt(0, 0).unreachable, true, 'ロビーがない');
});

test('エレベーター: avgWait（直近1時間の平均待ち）', () => {
  const s = new Tower({ seed: 95 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 149 });
  for (let f = 1; f <= 20; f++) mustBuild(s, 'floor', { f, x: 0, x2: 149 });
  mustBuild(s, 'elevator', { f: 0, f2: 20, x: 70 });
  for (let f = 1; f <= 20; f++) for (let x = 0; x + OW <= 70; x += OW) s.build('office', { f, x });
  for (const o of s.byType.office) s.moveIn(o);
  const e = s.transportAt(1, 70);
  assert.equal(e.avgWait, 0);
  stepTo(s, 1, 9);
  assert.ok(e.avgWait > 3, `朝の混雑 ${e.avgWait}`);
  assert.match(s.describe(e).stats.find(([k]) => k === '平均待ち時間')[1], /分/);
  stepTo(s, 2, 3);
  assert.equal(e.avgWait, 0, '1時間たてば0に戻る');
  assert.ok(e.peakWaitYesterday > 3);
});

test('保存: 当日予定の爆弾・火災も保存され、壊れた prompt は捨てる', () => {
  const s = incidentTower(96, true);
  s.flags.nextBomb = 0;
  s.rng = () => 0.01; // 必ず予定が入る
  stepTo(s, 1, 0); s.step(1);
  assert.ok(typeof s.flags.bombAt === 'number' && s.flags.bombAt > s.time);
  const data = JSON.parse(JSON.stringify(s.serialize()));
  data.prompts = [{ id: 'px', kind: 'bomb', title: 't', text: 't', choices: [] }];
  const r = new Tower({ seed: 1 });
  r.restore(data);
  assert.equal(r.pending.size, 0, '選択肢が空の prompt は捨てる');
  const ev = collect(r);
  r.step(DAY - 60);
  assert.ok(ev.prompt.some((p) => p.kind === 'bomb'), '予定どおり爆破予告');
  assert.equal(r.flags.bombAt, null);
});

test('カレンダーとサンタ: 0日目は4月1日、12/24 18時からサンタが飛ぶ', () => {
  const s = new Tower({ seed: 97 });
  assert.deepEqual(s.date, { month: 4, day: 1 });
  smallTower(s, 5);
  s.time = 266 * DAY + 23 * 60; // 12/23 23:00
  assert.deepEqual(s.date, { month: 12, day: 23 });
  const ev = collect(s);
  s.step(60);
  assert.deepEqual(s.date, { month: 12, day: 24 });
  assert.equal(s.santa, null);
  stepTo(s, 267, 18); s.step(1);
  assert.ok(s.santa, 'サンタ登場');
  assert.ok(s.santa.f > 5);
  const x0 = s.santa.x;
  s.step(120);
  assert.ok(s.santa.x > x0, '横に飛ぶ');
  assert.equal(ev.message.filter((m) => /メリークリスマス/.test(m.text)).length, 1);
  stepTo(s, 268, 1);
  assert.equal(s.santa, null);
  s.time = 365 * DAY;
  assert.deepEqual(s.date, { month: 4, day: 1 });
});

// ====================================================================
// v2
// ====================================================================
test('v2 §1: 横幅150の古いセーブ（移動手段が grid に入っている、旧い幅の施設）を読み込める', () => {
  const row = (a, b) => { let t = ''; for (let x = 0; x < 150; x++) t += x >= a && x <= b ? '1' : '0'; return t; };
  const rows = { 0: row(0, 99) };
  for (let f = 1; f <= 5; f++) rows[f] = row(0, 99);
  const old = {
    v: 2, seed: 5, time: 2 * DAY + 600, money: 1234567, star: 2, tower: false, nextId: 20, rows,
    objs: [
      { id: 1, type: 'lobby', f: 0, x: 0, w: 100, h: 1 },
      { id: 2, type: 'elevator', f: 0, x: 50, w: 4, h: 6, lo: 0, hi: 5, cars: [0, 3] },
      { id: 3, type: 'office', f: 1, x: 0, w: 9, h: 1, occupied: true, eval: 5 },
      { id: 4, type: 'office', f: 1, x: 9, w: 9, h: 1, occupied: true },   // 新しい幅10だと id3 と重なる → 1マス右にずらす
      { id: 8, type: 'office', f: 2, x: 0, w: 9, h: 1 }, { id: 9, type: 'office', f: 2, x: 9, w: 9, h: 1 }, { id: 10, type: 'office', f: 2, x: 9 + 9, w: 9, h: 1 }, // 3つ目は入らない
      { id: 5, type: 'office', f: 2, x: 20, w: 9, h: 1, occupied: false },
      { id: 6, type: 'stairs', f: 2, x: 80, w: 8, h: 1 },
      { id: 7, type: 'condo', f: 3, x: 0, w: 16, h: 1, occupied: true },
    ],
    flags: { vipOk: false },
  };
  const s = new Tower();
  s.restore(JSON.parse(JSON.stringify(old)));
  assert.equal(s.grid[0].length, W);
  assert.equal(s.grid[0][120], 0, '右側は空');
  assert.equal(s.objAt(0, 50).type, 'lobby', 'grid にはロビー（移動手段の id は入らない）');
  const e = s.transportAt(3, 51);
  assert.equal(e.type, 'elevator'); assert.equal(e.cars.length, 2);
  assert.equal(s.tgrid[6][50], e.id, '機械室');
  assert.equal(s.objAt(1, 0).w, TYPES.office.w, '新しい幅で置き直す');
  assert.equal(s.objs.get(4).x, 10, '幅が変わってもずらして残す（撤去されない）');
  assert.equal(s.objAt(1, 9), s.objAt(1, 0));
  assert.equal(s.objAt(1, 12).id, 4);
  assert.ok(s.objs.has(8) && s.objs.has(9));
  assert.equal(s.transportAt(2, 82).type, 'stairs');
  assert.ok(s.objAt(1, 0).brand, '古いセーブにも社名を付ける');
  s.step(DAY);
  checkInvariants(s);
});

test('v2 §2: 移動手段の層（施設との重ね置き・撤去の優先・構造の要否）', () => {
  const s = new Tower({ seed: 100 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  for (let f = 1; f <= 3; f++) mustBuild(s, 'floor', { f, x: 0, x2: 60 });
  mustBuild(s, 'office', { f: 1, x: 0 });
  mustBuild(s, 'stairs', { f: 1, x: 2 });
  assert.equal(s.objAt(1, 3).type, 'office');
  assert.equal(s.transportAt(1, 3).type, 'stairs');
  assert.match(s.check('escalator', { f: 1, x: 5 }).reason, /移動手段/);
  assert.match(s.check('stairs', { f: 3, x: 0 }).reason, /上の階/);
  assert.match(s.check('elevator', { f: 0, f2: 5, x: 30 }).reason, /フロアがありません/, '構造のないマスは不可');
  // 撤去は移動手段が先
  assert.ok(s.build('bulldoze', { f: 1, x: 3 }).ok);
  assert.equal(s.transportAt(1, 3), null);
  assert.equal(s.objAt(1, 3).type, 'office');
  // シャフトの通るフロアは撤去できない
  mustBuild(s, 'elevator', { f: 1, f2: 3, x: 40 });
  assert.match(s.check('bulldoze', { f: 3, x: 41 }).reason || '', /^$/, '移動手段の撤去が優先される');
  s.act(s.objAt(1, 0), 'remove');
  assert.equal(s.floorRemovable(3, 41), '移動手段を先に撤去してください');
});

test('v2 §4: resizeElevator（check/build・ghost・費用・縮めると乗客を降ろす）', () => {
  const s = new Tower({ seed: 101 });
  s.money = 1e9;
  smallTower(s, 20);
  const e = s.transportAt(1, 61);
  let r = s.check('resizeElevator', { id: e.id, lo: 0, hi: 15 });
  assert.ok(r.ok); assert.deepEqual(r.ghost, { x: 60, w: 4, lo: 0, hi: 15 }); assert.equal(r.cost, 0);
  r = s.check('resizeElevator', { id: e.id, lo: 0, hi: 25 });
  assert.ok(r.ok, 'フロアが無い階へも、下から順に作れば支えがある');
  assert.equal(r.cost, 5 * SIM.EXTEND_COST.elevator + 5 * 4 * TYPES.floor.costPerTile);
  for (let f = 21; f <= 25; f++) mustBuild(s, 'floor', { f, x: 40, x2: 100 });
  r = s.check('resizeElevator', { id: e.id, lo: 0, hi: 25 });
  assert.ok(r.ok); assert.equal(r.cost, 5 * SIM.EXTEND_COST.elevator, 'フロアがあればフロア代はかからない');
  // 支えの無い階へは伸ばせない（地下は上から吊るす。通常は起きないので grid を直接作って確かめる）
  for (const f of [-2, -3]) s.grid[f].fill(-1, 200, 221);
  s.revision++;
  mustBuild(s, 'elevator', { f: -3, f2: -2, x: 210 });
  const be = s.transportAt(-2, 211);
  assert.match(s.check('resizeElevator', { id: be.id, lo: -3, hi: -1 }).reason, /支えもありません/);
  // 乗客がいるまま縮める
  const ps = [];
  for (let i = 0; i < 10; i++) { const p = s.newPerson('visitor', null); s.spawnAt(p, s.entrances[0]); s.startTrip(p, 18, 50, (pp) => s.leave(pp)); ps.push(p); }
  for (let i = 0; i < 40 && !ps.some((p) => p.state === 'ride'); i++) s.step(0.5);
  assert.ok(s.build('resizeElevator', { id: e.id, lo: 0, hi: 10 }).ok);
  assert.equal(e.hi, 10);
  assert.equal(s.tgrid[11][60], e.id, '機械室は新しい hi+1');
  assert.equal(s.tgrid[15][60], 0);
  for (const c of e.cars) for (const p of c.pass) assert.ok(p.legs[p.li].to <= 10);
  s.step(120);
  checkInvariants(s);
});

test('v2 §4: カゴの加速・減速と、ちょうど階に止まること（急行は速い）', () => {
  const make = (type, cfg) => {
    const s = new Tower({ seed: 102 });
    s.money = 1e9; s.star = 3;
    mustBuild(s, 'lobby', { f: 0, x: 0, x2: 80 });
    for (let f = 1; f <= 29; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
    mustBuild(s, type, { f: 0, f2: 29, x: 30 });
    const e = s.transportAt(5, 31);
    if (cfg) assert.ok(s.setElevatorConfig(e, cfg).ok);
    return { s, e };
  };
  const ride = ({ s, e }) => {
    const p = s.newPerson('visitor', null);
    p.f = 0; p.x = e.x - 0.5; p.state = 'walk'; s.active.add(p);
    let done = false;
    s.startTrip(p, 29, e.x - 1, (pp) => { done = true; s.leave(pp); });
    const vs = [];
    let t = 0;
    while (!done && t < 60) {
      s.step(0.01); t += 0.01;
      const c = e.cars[0];
      vs.push(c.v);
      if (c.state === 'doors') assert.equal(c.pos, Math.round(c.pos), 'ドアが開くのは階ちょうど');
      assert.ok(c.v <= e.vmax + 1e-9);
    }
    assert.ok(done);
    return { t, vs, vmax: Math.max(...vs) };
  };
  const a = ride(make('elevator')), b = ride(make('express'));
  assert.ok(a.vs.some((v) => v > 0 && v < a.vmax * 0.7), `加速・減速の途中がある ${a.vs.map((v) => v.toFixed(1))}`);
  assert.ok(b.vmax > a.vmax * 2, `急行のほうが速い ${b.vmax} vs ${a.vmax}`);
  assert.ok(b.t < a.t, `急行のほうが早く着く ${b.t} < ${a.t}`);
  // 高速モーター: 速くて維持費2倍
  const m = make('elevator');
  const m1 = m.s.carMaint(m.e);
  assert.ok(m.s.setElevatorConfig(m.e, { speed: 2 }).ok);
  assert.equal(m.s.carMaint(m.e), m1 * 2);
  assert.ok(ride(m).t < a.t, '高速モーターで早く着く');
  // ドア時間
  assert.ok(m.s.setElevatorConfig(m.e, { door: 'long' }).ok);
  assert.equal(m.e.doorTime, 0.2);
  // 実在の速さ（1フロア=4m）: 通常 105m/分、急行 600m/分、高速モーターの急行 1000m/分
  assert.equal(a.vmax, 105 / 4);
  assert.equal(b.vmax, 600 / 4);
  // 1倍速（1フレーム 0.1分）で滑らか、8倍速（1フレーム 0.8分）でも行き過ぎずに階ちょうどで止まる
  for (const frame of [0.1, 0.8]) {
    const x = make('express', { speed: 2 });
    assert.equal(x.e.vmax, 1000 / 4);
    const p = x.s.newPerson('visitor', null);
    p.f = 0; p.x = x.e.x - 0.5; p.state = 'walk'; x.s.active.add(p);
    let arrived = null;
    x.s.startTrip(p, 29, x.e.x - 1, (pp) => { arrived = pp.f; x.s.leave(pp); });
    let prev = x.e.cars[0].pos;
    for (let t = 0; t < 30 && arrived === null; t += frame) {
      x.s.step(frame);
      const c = x.e.cars[0];
      assert.ok(Math.abs(c.pos - prev) <= x.e.vmax * frame + 1e-6, '1フレームの移動は最高速以内');
      assert.ok(c.pos >= x.e.sLo - 1e-9 && c.pos <= x.e.sHi + 1e-9, '行き過ぎない');
      prev = c.pos;
    }
    assert.equal(arrived, 29);
  }
  assert.equal(m.s.setElevatorConfig(m.e, { door: 'slow' }).ok, false);
});

test('v2 §4: 設定 skip・standby・rush が実際に効く', () => {
  const s = new Tower({ seed: 103 });
  s.money = 1e9;
  smallTower(s, 20);
  const e = s.transportAt(1, 61);
  s.act(e, 'addCar'); s.act(e, 'addCar');
  // skip: 通過階は経路にも使われない
  assert.ok(s.setElevatorConfig(e, { skip: [10] }).ok);
  assert.equal(e.isStop[10 + 10], 0);
  assert.equal(s.route(0, 10), null, '止まらない階へは行けない');
  assert.ok(s.route(0, 11));
  assert.ok(s.setElevatorConfig(e, { skip: Array.from({ length: 20 }, (_, i) => i) }).ok, '停止階1つにもできる');
  assert.equal(e.usable, false);
  assert.equal(s.route(0, 15), null, '使われない');
  assert.match(s.describe(e).warning, /停止階が2つ未満/);
  assert.ok(s.setElevatorConfig(e, { skip: [] }).ok);
  assert.match(s.setElevatorConfig(e, { skip: [40] }).reason, /範囲外/);
  // standby: lobby → 空きカゴは1Fへ
  assert.ok(s.setElevatorConfig(e, { skip: [], standby: 'lobby' }).ok);
  for (const c of e.cars) c.pos = 15;
  s.step(20);
  assert.ok(e.cars.every((c) => c.pos === 0), `ロビー待機 ${e.cars.map((c) => c.pos)}`);
  // spread: 分散
  assert.ok(s.setElevatorConfig(e, { standby: 'spread' }).ok);
  s.step(20);
  assert.equal(new Set(e.cars.map((c) => c.pos)).size, e.cars.length, `分散 ${e.cars.map((c) => c.pos)}`);
  // rush: 平日の朝はロビーへ
  assert.ok(s.setElevatorConfig(e, { standby: 'none', rush: true }).ok);
  for (const c of e.cars) c.pos = 12;
  stepTo(s, 1, 7); s.step(20);
  assert.ok(e.cars.every((c) => c.pos === 0), 'ラッシュ運転（朝）');
  stepTo(s, 1, 17); s.step(30);
  assert.ok(e.cars.every((c) => c.pos >= 10), `ラッシュ運転（夕方）${e.cars.map((c) => c.pos)}`);
  assert.ok(s.describe(e).actions.some((a) => a.id === 'cfg:rush'));
  assert.ok(s.act(e, 'cfg:door').ok);
});

test('v2 §11: 急行の停止階は既定でロビー階と地下、任意の階を足せる', () => {
  const s = new Tower({ seed: 104 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 80 });
  for (const f of [-1, -2]) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  for (let f = 1; f <= 35; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  mustBuild(s, 'express', { f: -2, f2: 35, x: 30 });
  const e = s.transportAt(3, 31);
  assert.deepEqual(e.stops, [-2, -1, 0, 14, 29]);
  assert.equal(e.config.skip.length, 38 - 5);
  assert.equal(s.route(0, 20), null);
  const skip = e.config.skip.filter((f) => f !== 20);
  assert.ok(s.setElevatorConfig(e, { skip }).ok);
  assert.deepEqual(s.route(0, 20).map((l) => [l.kind, l.to]), [['express', 20]], '足した階に止まる');
  assert.ok(s.setElevatorConfig(e, { skip: [...Array(38).keys()].map((i) => i - 2).filter((f) => f !== 0) }).ok, '停止階1つでもエラーにしない');
  assert.equal(e.usable, false);
  assert.ok(s.setElevatorConfig(e, { skip }).ok);
  // 伸ばした階は既定どおり通過
  mustBuild(s, 'floor', { f: 36, x: 0, x2: 80 });
  assert.ok(s.act(e, 'extendUp').ok);
  assert.ok(e.config.skip.includes(36));
});

test('v2 §4: 固まる不具合の再現テスト（設定・伸縮・カゴ増減・乗り換えを混ぜた多数のシード）', () => {
  let bad = 0, trips = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = elevatorStress(seed, 400, { burst: seed % 2 === 0 });
    trips += r.trips;
    if (r.problems.length) { bad++; console.log(`    seed ${seed}: ${r.problems.slice(0, 2).join(' | ')}`); }
    checkInvariants(r.sim);
  }
  console.log(`    10シード × 400分、到着 ${trips.toLocaleString()}回`);
  assert.equal(bad, 0, '待ちがあるのに止まったままのカゴ・止まらない乗客がない');
});

test('v2 §5: 店名・社名（入居のたびに引き直し）と describe', () => {
  const s = new Tower({ seed: 105 });
  smallTower(s, 3);
  mustBuild(s, 'fastfood', { f: 1, x: 40 });
  const ff = s.objAt(1, 40);
  assert.ok(ff.brand.length > 0);
  assert.ok(ff.variant >= 0 && ff.variant < VARIANTS.fastfood.length);
  assert.equal(s.describe(ff).title, ff.brand);
  mustBuild(s, 'office', { f: 2, x: 40 });
  const of = s.objAt(2, 40);
  assert.equal(of.brand, '', '空室には社名がない');
  const seen = new Set();
  for (let i = 0; i < 12; i++) { s.moveIn(of); seen.add(of.brand); assert.ok(of.brand); s.vacate(of); assert.equal(of.brand, ''); }
  assert.ok(seen.size > 3, '入居のたびに変わる');
  s.moveIn(of);
  assert.match(s.describe(of).subtitle, /オフィス/);
  mustBuild(s, 'condo', { f: 3, x: 40 });
  s.moveIn(s.objAt(3, 40));
  assert.match(s.objAt(3, 40).brand, /家$/);
});

test('v2 §6: 爆発・火災で壊れた施設は残り、何にも使われず、撤去だけできる', () => {
  const s = incidentTower(106, false);
  const ev = collect(s);
  s.trigger('bomb');
  s.answer(ev.prompt[0].id, 'refuse');
  s.step(181);
  const ruins = [...s.objs.values()].filter((o) => o.destroyed === 'bomb');
  assert.ok(ruins.length > 0);
  const o = ruins[0];
  assert.equal(o.occupied, false);
  assert.ok(!s.byType[o.type].includes(o), '索引から外れる');
  assert.equal(s.objAt(o.f, o.x), o, 'マスには残る');
  assert.equal(s.evalLevel(o), null, '評価の対象外');
  const d = s.describe(o);
  assert.match(d.subtitle, /破壊/); assert.deepEqual(d.actions.map((a) => a.id), ['remove']);
  s.step(DAY * 2);
  assert.equal(o.occupied, false, '入居しない');
  assert.equal(o.inCount, 0);
  assert.ok(s.build('bulldoze', { f: o.f, x: o.x }).ok);
  assert.equal(s.objs.has(o.id), false);
  assert.equal(s.grid[o.f][o.x], -1);
  // 火災
  const s2 = incidentTower(107, false);
  s2.trigger('fire', s2.objAt(6, 0));
  s2.answer([...s2.pending.keys()][0], 'wait');
  s2.step(400);
  assert.ok([...s2.objs.values()].some((x) => x.destroyed === 'fire'));
  const r = JSON.parse(JSON.stringify(s2.serialize()));
  const s3 = new Tower(); s3.restore(r);
  assert.ok([...s3.objs.values()].some((x) => x.destroyed === 'fire'), '保存される');
});

test('v2 §7: 評価の内訳 reasons', () => {
  const s = new Tower({ seed: 108 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 149 });
  for (let f = 1; f <= 20; f++) mustBuild(s, 'floor', { f, x: 0, x2: 149 });
  mustBuild(s, 'elevator', { f: 0, f2: 20, x: 70 });
  for (let f = 1; f <= 20; f++) for (let x = 0; x + OW <= 70; x += OW) s.build('office', { f, x });
  for (const o of s.byType.office) s.moveIn(o);
  stepTo(s, 1, 12);
  const o = s.objAt(15, 0);
  const d = s.describe(o);
  assert.ok(Array.isArray(d.reasons) && d.reasons.length);
  for (const r of d.reasons) assert.ok(['good', 'fair', 'bad'].includes(r.level) && r.label);
  assert.ok(d.reasons.some((r) => /エレベーター待ち 平均/.test(r.label) && r.level !== 'good'), JSON.stringify(d.reasons));
  assert.ok(d.reasons.some((r) => /ごみ/.test(r.label)), 'ごみ収集室がない');
  assert.ok(d.stats.some(([k]) => k === '平均待ち'));
});

test('v2 §8: 消防ヘリが飛来 → 散水 → 去る（消火は到着後、保存しても続く）', () => {
  const s = incidentTower(109, false);
  const ev = collect(s);
  s.trigger('fire', s.objAt(6, 0));
  s.answer(ev.prompt[0].id, 'heli');
  assert.ok(s.heli && s.heli.phase === 'in');
  assert.ok(s.heli.x < 0 || s.heli.x > W, '画面外から');
  assert.ok(ev.sound.some((x) => x.name === 'heli'));
  const phases = new Set();
  let saved = null;
  for (let i = 0; i < 400 && s.heli; i++) {
    s.step(0.25);
    if (s.heli) phases.add(s.heli.phase);
    if (s.heli && s.heli.phase === 'in') assert.ok(s.fire, '着く前には消えない');
    if (!saved && s.heli && s.heli.phase === 'in') saved = JSON.parse(JSON.stringify(s.serialize()));
  }
  assert.deepEqual([...phases], ['in', 'spray', 'out']);
  assert.equal(s.fire, null);
  assert.ok(ev.message.some((m) => /ヘリが火を消し止め/.test(m.text)));
  const r = new Tower(); r.restore(saved);
  assert.ok(r.heli && r.heli.phase === 'in');
  r.step(60);
  assert.equal(r.fire, null, '復元後もヘリが消火する');
});

test('v2 §9: blueprint → buildBatch（アトミック）', () => {
  const s = new Tower({ seed: 110 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 300 });
  for (let f = 1; f <= 4; f++) mustBuild(s, 'floor', { f, x: 0, x2: 60 });
  mustBuild(s, 'office', { f: 1, x: 0 }); mustBuild(s, 'fastfood', { f: 2, x: 10 }); mustBuild(s, 'cinema', { f: 3, x: 0 });
  mustBuild(s, 'elevator', { f: 0, f2: 4, x: 50 });
  s.act(s.transportAt(1, 50), 'addCar');
  s.setElevatorConfig(s.transportAt(1, 50), { door: 'short' });
  mustBuild(s, 'stairs', { f: 1, x: 40 });
  const bp = s.blueprint({ f1: 1, x1: 0, f2: 4, x2: 60 });
  assert.equal(bp.w, 61); assert.equal(bp.h, 4);
  const tools = bp.ops.map((o) => o.tool);
  assert.ok(tools.indexOf('floor') < tools.indexOf('office'));
  assert.ok(tools.lastIndexOf('stairs') > tools.indexOf('cinema'), '移動手段は最後');
  assert.ok(!tools.includes('elevator'), '範囲からはみ出すエレベーターは含めない');
  const bp2 = s.blueprint({ f1: 0, x1: 0, f2: 4, x2: 60 });
  const eop = bp2.ops.find((o) => o.tool === 'elevator');
  assert.equal(eop.p.cars, 2); assert.equal(eop.p.config.door, 'short');
  // 貼り付け: 1F の 100 マス右に、同じ高さで
  const before = { money: s.money, n: s.objs.size, rev: s.revision };
  assert.ok(s.checkBatch(bp2.ops, { f: 0, x: 100 }).ok, 'ロビーの上（既存のフロア）にも貼れる');
  const ck = s.checkBatch(bp2.ops, { f: 0, x: 5 });
  assert.equal(ck.ghosts.length, bp2.ops.length);
  assert.equal(s.money, before.money, 'check は何も変えない');
  assert.equal(s.objs.size, before.n);
  assert.ok(!ck.ok, '元の施設と重なる'); assert.ok(ck.failedIndex >= 0); assert.equal(ck.ghosts[ck.failedIndex].ok, false);
  // 2F 以上を空中に貼るのは支えがなくて失敗 → 何も変わらない
  const bad = s.buildBatch(bp.ops, { f: 1, x: 350 });
  assert.equal(bad.ok, false);
  assert.equal(s.money, before.money); assert.equal(s.objs.size, before.n);
  assert.equal(s.grid[1][360], 0); assert.equal(s.tgrid[1][390], 0);
  assert.equal(s.revision, before.rev, '失敗しても索引は変わらない');
  // 下に支えを作ってから
  mustBuild(s, 'floor', { f: 0, x: 301, x2: 400 });
  const m0 = s.money;
  const ok = s.buildBatch(bp.ops, { f: 1, x: 320 });
  assert.ok(ok.ok, ok.reason);
  assert.ok(ok.cost > 0);
  assert.equal(s.objAt(1, 320).type, 'office');
  assert.equal(s.objAt(3, 320).type, 'cinema');
  assert.equal(s.transportAt(1, 360).type, 'stairs');
  assert.ok(s.objAt(2, 330).brand, '店名は新しく付く');
  assert.equal(s.money, m0 - ok.cost);
});

test('v2 §12: 工事期間（使えない → 完成で built、保存しても続く）', () => {
  const s = new Tower({ seed: 111, construction: true });
  const ev = collect(s);
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 60 });
  const lobby = s.objAt(0, 0);
  assert.ok(lobby.constructUntil > s.time && lobby.constructStart === s.time);
  assert.equal(s.grid[1][5], -1, 'フロアは工事なし');
  mustBuild(s, 'elevator', { f: 0, f2: 1, x: 40 });
  mustBuild(s, 'office', { f: 1, x: 0 });
  const o = s.objAt(1, 0), e = s.transportAt(1, 40);
  assert.ok(o.constructUntil - o.constructStart >= 30 && e.constructUntil - e.constructStart <= 240);
  assert.equal(s.entrances.length, 0, '工事中のロビーは出入口にならない');
  assert.equal(s.route(0, 1), null, '工事中のエレベーターは使えない');
  assert.match(s.describe(o).subtitle, /工事中/);
  assert.ok(s.describe(o).construction.progress >= 0);
  s.tenancy(100);
  assert.equal(o.occupied, false, '工事中は入居しない');
  const data = JSON.parse(JSON.stringify(s.serialize()));
  s.step(250);
  assert.ok(ev.sound.some((x) => x.name === 'built'));
  assert.equal(o.constructUntil, 0);
  assert.ok(s.route(0, 1));
  assert.equal(s.entrances.length, 1);
  const r = new Tower({ construction: true }); r.restore(data);
  assert.ok(r.objAt(1, 0).constructUntil > r.time, '工事中のまま読み込む');
  const ev2 = collect(r);
  r.step(250);
  assert.equal(r.objAt(1, 0).constructUntil, 0, '続きが終わる');
  assert.ok(ev2.sound.some((x) => x.name === 'built'));
});

test('§13: ごみ集積所（地下・ビル全体で共有・収集車 4:30〜5:30・袋に比例した料金・無い/満杯で評価と苦情）', () => {
  const s = new Tower({ seed: 112 });
  s.money = 1e9; s.star = 3;
  smallTower(s, 12);
  for (let f = 1; f <= 12; f++) for (let x = 40; x + OW <= 60; x += OW) s.build('office', { f, x });
  s.star = 2; // 駐車場の需要は付けない
  for (const o of s.byType.office) s.moveIn(o);
  s.star = 3;
  s.step(70);
  const far = s.objAt(12, 40), near = s.objAt(2, 40);
  assert.equal(s.garbageProblem(), 'none');
  assert.ok(far.garbageBad && near.garbageBad, '集積所がない → ビル全体');
  assert.ok(s.describe(far).reasons.some((r) => /ごみ集積所がない/.test(r.label)));
  s.complaints(true);
  assert.match(far.complaint, /ごみ/);
  assert.match(s.check('garbage', { f: 3, x: 64 }).reason, /地下/);
  for (const f of [-1, -2]) mustBuild(s, 'floor', { f, x: 40, x2: 120 });
  mustBuild(s, 'garbage', { f: -2, x: 40 });
  mustBuild(s, 'garbage', { f: -2, x: 64 });
  const [g1, g2] = s.byType.garbage;
  assert.equal(g1.h, 2);
  assert.equal(s.garbageCap, 2 * TYPES.garbage.capacity);
  s.step(60);
  assert.equal(far.garbageBad, false, '距離に関係なくビル全体を受け持つ');
  stepTo(s, 1, 4);
  assert.ok(g1.bags > 0 && Math.abs(g1.bags - g2.bags) < 1e-9, '各室に割り振る');
  assert.ok(Math.abs(g1.bags + g2.bags - s.garbageBags) < 1e-6);
  assert.equal(g1.truck, null);
  const bags = Math.round(s.garbageBags), m = s.money;
  stepTo(s, 1, 4); s.step(35);  // 4:35
  assert.equal(g1.truck.phase, 'in');
  s.step(15);                   // 4:50
  assert.equal(g1.truck.phase, 'load');
  assert.ok(g1.bags < bags / 2, '積み込み中に減る');
  assert.ok(g1.truck.t > 0 && g1.truck.t < 1);
  s.step(30);                   // 5:20
  assert.equal(g1.truck.phase, 'out');
  assert.equal(s.garbageBags, 0);
  assert.ok(Math.abs((m - s.money) - bags * SIM.GARBAGE.fee) <= SIM.GARBAGE.fee * 2, '袋に比例した料金');
  s.step(15);
  assert.equal(g1.truck, null, '5:30 以降は null');
  // 満杯
  s.garbageBags = s.garbageCap;
  s.hourlyGarbage();
  assert.equal(s.garbageProblem(), 'full');
  assert.equal(near.garbageBad, true);
  assert.match(s.describe(g1).warning || '', /満杯/);
  assert.ok(s.describe(far).reasons.some((r) => /満杯/.test(r.label)));
  // 保存
  const r = new Tower(); r.restore(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(r.garbageBags, s.garbageBags);
  assert.equal(r.byType.garbage.length, 2);
});

test('§13: 古い1フロアのごみ収集室は地下に移す（置けなければ読み飛ばす）', () => {
  const rows = { 0: '1'.repeat(150), '-1': '1'.repeat(150), '-2': '1'.repeat(150), 1: '1'.repeat(150) };
  const d = { v: 3, seed: 1, time: 700, money: 1e6, star: 2, rows, nextId: 10,
    objs: [{ id: 1, type: 'lobby', f: 0, x: 0, w: 60, h: 1 }, { id: 2, type: 'garbage', f: 1, x: 10, w: 8, h: 1, bags: 30 }, { id: 3, type: 'garbage', f: 1, x: 30, w: 8, h: 1 }] };
  const s = new Tower(); s.restore(d);
  const gs = s.byType.garbage;
  assert.equal(gs.length, 2);
  for (const g of gs) { assert.ok(g.f < 0 && g.f + g.h - 1 < 0, '地下に移った'); assert.equal(g.w, TYPES.garbage.w); }
  assert.equal(Math.round(s.garbageBags), 30);
  const s2 = new Tower(); s2.restore({ ...d, rows: { 0: '1'.repeat(150), 1: '1'.repeat(150) } });
  assert.equal(s2.byType.garbage.length, 0, '地下が無ければ読み飛ばす');
});

test('§13: 駐車場（★3以上で需要・先に入居した順に割り当て・不足で評価と苦情）', () => {
  const s = new Tower({ seed: 114 });
  s.money = 1e9; s.star = 2;
  smallTower(s, 10);
  for (let f = 1; f <= 10; f++) for (let x = 40; x + OW <= 100; x += OW) s.build('office', { f, x });
  const offices = s.byType.office;
  for (const o of offices.slice(0, 10)) s.moveIn(o);
  assert.ok(offices.slice(0, 10).every((o) => o.needsParking === 0), '★2 では車なし');
  s.star = 3;
  for (const o of offices.slice(10)) s.moveIn(o);
  const cars = offices.reduce((a, o) => a + o.needsParking, 0);
  const share = offices.slice(10).filter((o) => o.needsParking > 0).length / offices.slice(10).length;
  assert.ok(share > 0.1 && share < 0.55, `約3割 ${share}`);
  s.updateParking();
  assert.equal(s.parkingShort, cars);
  const needy = offices.filter((o) => o.needsParking > 0);
  assert.ok(needy.every((o) => o.parkingShort === o.needsParking));
  assert.ok(s.describe(needy[0]).reasons.some((r) => /駐車場がない/.test(r.label)));
  assert.ok(s.evalScore(needy[0]) >= SIM.PARKING.penalty);
  s.complaints(true);
  assert.match(needy[0].complaint, /車/);
  assert.match(s.check('parking', { f: 2, x: 40 }).reason, /地下/);
  mustBuild(s, 'floor', { f: -1, x: 40, x2: 100 });
  mustBuild(s, 'parking', { f: -1, x: 40 });
  s.updateParking();
  const lot = s.byType.parking[0];
  assert.equal(lot.used, Math.min(TYPES.parking.spaces, cars));
  assert.equal(s.parkingShort, Math.max(0, cars - TYPES.parking.spaces));
  // 先に入居した順
  const sorted = [...needy].sort((a, b) => a.moveSeq - b.moveSeq);
  let left = TYPES.parking.spaces;
  for (const o of sorted) { const got = Math.min(left, o.needsParking); left -= got; assert.equal(o.parkingShort, o.needsParking - got); }
  assert.match(s.describe(lot).stats.find(([k]) => k === '駐車場')[1], /使用 \d+ \/ 12台/);
  // スイートは全室
  s.star = 3;
  for (let f = 11; f <= 11; f++) mustBuild(s, 'floor', { f, x: 40, x2: 100 });
  mustBuild(s, 'hotelSuite', { f: 11, x: 70 });
  const suite = s.byType.hotelSuite[0];
  stepTo(s, 0, 17);
  if (suite.occupied) assert.equal(suite.needsParking, 1);
  // 保存
  const r = new Tower(); r.restore(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(r.parkingShort, s.parkingShort);
});

test('コピー: すでにフロアがある場所・何もない場所・一部重なる場所に貼り付けられる', () => {
  const s = new Tower({ seed: 115 });
  s.money = 1e9;
  mustBuild(s, 'floor', { f: 0, x: 0, x2: 400 });
  for (let f = 1; f <= 3; f++) mustBuild(s, 'floor', { f, x: 0, x2: 40 });
  mustBuild(s, 'office', { f: 1, x: 0 }); mustBuild(s, 'office', { f: 2, x: 10 }); mustBuild(s, 'condo', { f: 3, x: 20 });
  mustBuild(s, 'stairs', { f: 1, x: 30 });
  const bp = s.blueprint({ f1: 1, x1: 0, f2: 3, x2: 40 });
  // 1) すでにフロアだけがある場所
  for (let f = 1; f <= 3; f++) mustBuild(s, 'floor', { f, x: 100, x2: 140 });
  const m = s.money;
  const a = s.buildBatch(bp.ops, { f: 1, x: 100 });
  assert.ok(a.ok, a.reason);
  assert.equal(s.objAt(1, 100).type, 'office');
  assert.equal(s.objAt(3, 120).type, 'condo');
  assert.equal(s.transportAt(1, 130).type, 'stairs');
  assert.equal(a.cost, TYPES.office.cost * 2 + TYPES.condo.cost + TYPES.stairs.cost, 'フロア代はかからない');
  assert.equal(s.money, m - a.cost);
  assert.ok(a.ghosts.every((g) => g.ok));
  // 2) 何もない場所（1F の上）
  const b = s.buildBatch(bp.ops, { f: 1, x: 200 });
  assert.ok(b.ok, b.reason);
  assert.ok(b.cost > a.cost, 'フロア代が加わる');
  // 3) 一部だけフロアがある場所
  mustBuild(s, 'floor', { f: 1, x: 300, x2: 315 });
  const c = s.buildBatch(bp.ops, { f: 1, x: 300 });
  assert.ok(c.ok, c.reason);
  assert.equal(s.objAt(2, 310).type, 'office');
  // 4) 施設と重なる場所は失敗し、何も変わらない
  const before = s.objs.size, mb = s.money;
  const d = s.checkBatch(bp.ops, { f: 1, x: 105 });
  assert.equal(d.ok, false);
  assert.match(d.reason, /重なって/);
  assert.equal(s.objs.size, before); assert.equal(s.money, mb);
  // 単独の floor ツールは従来どおり
  assert.match(s.check('floor', { f: 1, x: 100, x2: 110 }).reason, /すでにフロア/);
});

test('性能: step の予算（1フレームの上限）と持ち越し・lastStepMs', () => {
  const s = new Tower({ seed: 116 });
  buildWideTower(s, 60);
  stepTo(s, 1, 8); // 朝の混雑
  const tStart = s.time;
  const ms = s.step(20, 2);
  assert.ok(s.lastStepMs === ms && ms < 2 + 5, `予算どおりに止まる ${ms.toFixed(2)}ms`);
  assert.ok(s.backlog > 0, '残りは持ち越す');
  for (let i = 0; i < 2000 && s.backlog > 0; i++) s.step(0, 2);
  assert.equal(s.backlog, 0);
  assert.ok(Math.abs(s.time - (tStart + 20)) < 1e-9, '持ち越した分も含めて全部進む');
  // 持ち越しは上限まで（追いつけない分は捨てる）
  s.step(1000, 1);
  assert.ok(s.backlog <= SIM.MAX_BACKLOG);
  // 予算なしなら全部進む
  const t1 = s.time; s.backlog = 0;
  s.step(30);
  assert.equal(s.time, t1 + 30);
  // 1フレーム（8倍速 60fps = 0.8分）が 4ms を超えないこと（予算 4ms）
  let worst = 0;
  for (let i = 0; i < 300; i++) { s.step(0.8, 4); worst = Math.max(worst, s.lastStepMs); }
  console.log(`    480×60 人口 ${s.pop}: 1フレーム最悪 ${worst.toFixed(2)}ms`);
  assert.ok(worst < 8);
});

test('歩行は事象駆動: drawPos は毎フレーム正しい位置を返す', () => {
  const s = new Tower({ seed: 117 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 300 });
  const p = s.newPerson('visitor', null);
  p.f = 0; p.x = 10; p.state = 'walk'; s.active.add(p);
  let done = false;
  s.startTrip(p, 0, 210, () => { done = true; s.leave(p); });
  const xs = [];
  for (let i = 0; i < 400 && !done; i++) { s.step(0.25); if (!done) xs.push(s.drawPos(p).x); }
  assert.ok(done);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - SIM.WALK * 0.25) < 1e-6 || xs[i] === 210, '一定の速さで進む');
  assert.ok(Math.abs(xs.length * 0.25 - 200 / SIM.WALK) <= 0.5, '着く時刻');
  assert.ok(p.stress > 0, `長く歩くとストレス ${p.stress}`);
});

// ====================================================================
// §14
// ====================================================================
test('§14 徒歩: 40マス/分（80m/分）で、横幅480を12分で歩く', () => {
  assert.equal(SIM.WALK, 40);
  const s = new Tower({ seed: 120 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: W - 1 });
  const p = s.newPerson('visitor', null);
  p.f = 0; p.x = 0.5; p.state = 'walk'; s.active.add(p);
  let t = null;
  s.startTrip(p, 0, W - 0.5, () => { t = s.time; s.leave(p); });
  const t0 = s.time;
  s.step(20);
  assert.ok(t !== null && Math.abs(t - t0 - (W - 1) / 40) <= 0.25, `${t - t0}分`);
});

test('§14 フロアの区画: 切れ目は歩けない・移動手段がつなぐ区画どうしだけ行ける', () => {
  const s = new Tower({ seed: 121 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 120 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 40 });
  mustBuild(s, 'floor', { f: 1, x: 60, x2: 120 }); // 41〜59 は切れ目
  mustBuild(s, 'stairs', { f: 0, x: 10 });
  mustBuild(s, 'office', { f: 1, x: 80 });
  const right = s.objAt(1, 80);
  assert.notEqual(s.nodeOf(1, 20), s.nodeOf(1, 80), '別の区画');
  assert.equal(s.route(1, 1, 20, 85), null, '同じ階でも切れ目の向こうへは行けない');
  assert.equal(right.unreachable, true);
  // 右の区画にも階段を付けると、1F を経由して行ける
  mustBuild(s, 'stairs', { f: 0, x: 100 });
  assert.equal(right.unreachable, false);
  const legs = s.route(1, 1, 20, 85);
  assert.deepEqual(legs.map((l) => [l.kind, l.from, l.to]), [['stairs', 1, 0], ['stairs', 0, 1]]);
  // 歩いている人は区画の外に出ない
  const p = s.newPerson('visitor', null);
  p.f = 1; p.x = 20; p.state = 'walk'; s.active.add(p);
  let done = false;
  assert.ok(s.startTrip(p, 1, 85, () => { done = true; s.leave(p); }));
  for (let i = 0; i < 400 && !done; i++) {
    s.step(0.25);
    if (!done && p.state === 'walk') {
      const d = s.drawPos(p);
      if (Math.abs(d.f - Math.round(d.f)) < 1e-9) assert.ok(s.nodeOf(Math.round(d.f), d.x) >= 0, `宙を歩かない x=${d.x.toFixed(2)} f=${d.f}`);
    }
  }
  assert.ok(done);
  // フロアをつなぐと直接行ける
  mustBuild(s, 'floor', { f: 1, x: 41, x2: 59 });
  assert.deepEqual(s.route(1, 1, 20, 85), []);
});

test('§14 退去で施設が消えない（長期・大量の退去・買い戻し・チェックアウト）', () => {
  const s = new Tower({ seed: 122 });
  s.money = 1e9; s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 149 });
  for (let f = 1; f <= 25; f++) mustBuild(s, 'floor', { f, x: 0, x2: 149 });
  mustBuild(s, 'elevator', { f: 0, f2: 25, x: 70 }); // カゴ1台: 評価が悪く、退去が続く
  for (let f = 1; f <= 25; f++) {
    for (let x = 0; x + OW <= 70; x += OW) s.build(f % 3 === 0 ? 'hotelSingle' : 'office', { f, x });
    for (let x = 74; x + 16 <= 150; x += 16) s.build('condo', { f, x });
  }
  for (const o of [...s.byType.office, ...s.byType.condo]) s.moveIn(o);
  const ids = new Set(s.objs.keys());
  const cells = (o) => { let n = 0; for (let f = o.f; f < o.f + o.h; f++) for (let x = o.x; x < o.x + o.w; x++) if (s.grid[f][x] === o.id) n++; return n; };
  let outs = 0;
  s.on('message', (m) => { if (/退去/.test(m.text)) outs++; });
  stepTo(s, 21, 0);
  assert.ok(outs > 0, '退去が起きている');
  assert.deepEqual(new Set(s.objs.keys()), ids, '施設の数と id は変わらない');
  for (const id of ids) { const o = s.objs.get(id); assert.ok(!o.dead && !o.destroyed); if (!o.cars) assert.equal(cells(o), o.w * o.h, `${o.type} のマスが残る`); }
});

test('§14 人のプロフィール・personAt・describePerson', () => {
  const s = new Tower({ seed: 123 });
  smallTower(s, 5);
  mustBuild(s, 'office', { f: 3, x: 40 });
  const o = s.objAt(3, 40);
  s.moveIn(o);
  const w = o.members[0];
  assert.ok(w.name && w.age >= 22 && w.age <= 62);
  assert.ok(w.job.includes(o.brand), '勤め先の社名');
  const n0 = w.name;
  assert.equal(s.describePerson(w).title, n0);
  assert.equal(w.name, n0, '同じ人は同じ名前');
  // personAt: 歩いている人
  const p = s.newPerson('visitor', null);
  s.spawnAt(p, s.entrances[0], 70);
  s.startTrip(p, 4, 80, () => s.leave(p));
  const d = s.drawPos(p);
  assert.equal(s.personAt(d.f, d.x + 0.5), p);
  assert.equal(s.personAt(d.f + 3, d.x), null);
  const info = s.describePerson(p);
  for (const k of ['title', 'subtitle', 'stats', 'mood']) assert.ok(k in info, k);
  assert.ok(info.stats.some(([k]) => k === '今日の予定'));
  assert.ok(info.stats.some(([k, v]) => k === '行き先' && /5F/.test(v)));
  assert.ok(['good', 'fair', 'bad'].includes(info.mood));
  // マンションの家族は同じ名字
  mustBuild(s, 'condo', { f: 4, x: 40 });
  const c = s.objAt(4, 40); s.moveIn(c);
  const fam = c.members.map((m) => m.name.split(' ')[0]);
  assert.equal(new Set(fam).size, 1);
  assert.equal(fam[0] + '家', c.brand);
});

test('§14 ホテルのレビュー（チェックアウトごと・最新20件・保存・describe）', () => {
  const s = hotelTower(124, true);
  stepTo(s, 6, 12);
  const rooms = s.hotels.filter((o) => (o.reviews || []).length);
  assert.ok(rooms.length > 5, 'レビューがつく');
  const o = rooms[0];
  for (const r of o.reviews) { assert.ok(r.stars >= 1 && r.stars <= 5); assert.ok(r.text && r.name); assert.ok(r.day >= 1); }
  const d = s.describe(o);
  assert.ok(d.stats.some(([k, v]) => k === 'レビュー' && /★\d\.\d/.test(v)));
  assert.deepEqual(d.reviews[0], o.reviews[o.reviews.length - 1], '新しい順');
  // 原因に合わせた文面: ゴキブリ
  o.infested = true; o.stayStress = 0; o.stayWait = 0; o.stayName = 'テスト 太郎';
  s.addReview(o);
  const last = o.reviews[o.reviews.length - 1];
  assert.ok(last.stars <= 3); assert.match(last.text, /ゴキブリ|虫/);
  for (let i = 0; i < 30; i++) { o.stayName = 'x'; s.addReview(o); }
  assert.equal(o.reviews.length, 20, '最新20件まで');
  const r = new Tower(); r.restore(JSON.parse(JSON.stringify(s.serialize())));
  assert.deepEqual(r.objs.get(o.id).reviews, o.reviews, '保存される');
});

test('§14 blueprintOf: 選んだ施設と、支えに必要な最小限のフロア', () => {
  const s = new Tower({ seed: 125 });
  s.money = 1e9;
  mustBuild(s, 'floor', { f: 0, x: 0, x2: 300 });
  for (let f = 1; f <= 4; f++) mustBuild(s, 'floor', { f, x: 0, x2: 60 });
  mustBuild(s, 'office', { f: 1, x: 0 }); mustBuild(s, 'office', { f: 1, x: 20 });
  mustBuild(s, 'condo', { f: 3, x: 0 });
  mustBuild(s, 'stairs', { f: 1, x: 40 });
  const a = s.objAt(1, 0), c = s.objAt(3, 0), st = s.transportAt(1, 40);
  const bp = s.blueprintOf([a.id, c.id, st.id]);
  const tools = bp.ops.map((o) => o.tool);
  assert.ok(tools.includes('office') && tools.includes('condo') && tools.includes('stairs'));
  assert.equal(tools.filter((t) => t === 'office').length, 1, '選んでいない施設は含めない');
  assert.equal(bp.h, 3); // 1F〜3F（間の2Fは支えとして入る）
  const floor2 = bp.ops.filter((o) => o.tool === 'floor' && o.p.f === 1);
  assert.ok(floor2.length, '間の階のフロア');
  assert.ok(floor2.every((o) => o.p.x2 - o.p.x + 1 <= 16 + 8), '最小限の幅');
  const ok = s.buildBatch(bp.ops, { f: 1, x: 200 });
  assert.ok(ok.ok, ok.reason);
  assert.equal(s.objAt(1, 200).type, 'office');
  assert.equal(s.objAt(3, 200).type, 'condo');
  assert.equal(s.blueprintOf([]).ops.length, 0);
  // origin: 手順の (0,0) の絶対位置。同じ場所に貼ると元と重なる＝元の x にそろう
  assert.deepEqual(bp.origin, { f: 1, x: 0 });
  const bp2 = s.blueprintOf([c.id]);
  assert.deepEqual(bp2.origin, { f: 3, x: 0 }, '1つだけなら、その施設が左下');
  assert.equal(bp2.ops.find((o) => o.tool === 'condo').p.f, 0);
  const bp3 = s.blueprintOf([s.objAt(1, 20).id, c.id]);
  assert.deepEqual(bp3.origin, { f: 1, x: 0 }, '支えのフロアが左・下に伸びた分も含む');
  assert.deepEqual(s.blueprint({ f1: 1, x1: 5, f2: 3, x2: 30 }).origin, { f: 1, x: 5 });
});

test('§14 ごみ・リサイクルセンター: 旧 recycling と旧 w16 の garbage を読み込む・★4 の条件', () => {
  const rows = { 0: '1'.repeat(150), '-1': '1'.repeat(150), '-2': '1'.repeat(150) };
  const d = { v: 3, seed: 1, time: 700, money: 1e6, star: 3, rows, nextId: 10,
    objs: [{ id: 1, type: 'lobby', f: 0, x: 0, w: 60, h: 1 }, { id: 2, type: 'recycling', f: -2, x: 0, w: 24, h: 2 }, { id: 3, type: 'garbage', f: -2, x: 40, w: 16, h: 2, bags: 5 }] };
  const s = new Tower(); s.restore(d);
  const g = s.byType.garbage;
  assert.equal(g.length, 2);
  assert.ok(g.some((o) => o.id === 2 && o.x === 0 && o.w === TYPES.garbage.w), 'recycling → 同じ場所の garbage');
  assert.ok(g.some((o) => o.id === 3 && o.w === TYPES.garbage.w), '旧 garbage を新しい幅で');
  assert.equal(TYPES.recycling, undefined);
  assert.equal(s.check('recycling', { f: -2, x: 100 }).ok, false);
  s.star = 3;
  const req = () => s.starReqs(4).find((r) => /ごみ/.test(r.label));
  assert.equal(req().done, true);
  s.garbageBags = s.garbageCap;
  assert.equal(req().done, false, '溢れていると満たさない');
});

test('停止階が2つ未満のエレベーターも建てて伸ばせる（使われない・警告）', () => {
  const s = new Tower({ seed: 130 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 80 });
  for (let f = 1; f <= 20; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  // 2F〜10F: ロビー階も地下も無いので急行の停止階は0
  mustBuild(s, 'express', { f: 1, f2: 9, x: 30 });
  const e = s.transportAt(5, 31);
  assert.equal(e.stops.length, 0); assert.equal(e.usable, false);
  assert.equal(s.describe(e).warning, '停止階が2つ未満のため使われません');
  assert.equal(s.route(1, 9), null);
  // 延長もできる。1F まで伸ばすと停止階1つ、15F まで伸ばすと2つになって使われる
  assert.ok(s.act(e, 'extendDown').ok);
  assert.deepEqual(e.stops, [0]); assert.equal(e.usable, false);
  assert.ok(s.build('resizeElevator', { id: e.id, lo: 0, hi: 14 }).ok);
  assert.deepEqual(e.stops, [0, 14]); assert.equal(e.usable, true);
  assert.equal(s.describe(e).warning, undefined);
  assert.deepEqual(s.route(0, 14).map((l) => l.kind), ['express']);
  s.step(60);
  checkInvariants(s);
});

test('エスカレーター: 近い階はエスカレーター、遠い階はエレベーター（見込み時間で選ぶ）', () => {
  const s = new Tower({ seed: 131 });
  s.money = 1e9; s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 149 });
  for (let f = 1; f <= 12; f++) mustBuild(s, 'floor', { f, x: 0, x2: 149 });
  mustBuild(s, 'elevator', { f: 0, f2: 12, x: 70 });
  mustBuild(s, 'escalator', { f: 0, x: 80 });
  mustBuild(s, 'escalator', { f: 1, x: 80 });
  for (const f of [1, 2]) for (let x = 0; x + 12 <= 64; x += 12) s.build('shop', { f, x });
  for (let x = 0; x + OW <= 64; x += OW) s.build('office', { f: 10, x });
  // 経路のコストの時点で、1〜2階分はエスカレーター
  assert.deepEqual(s.route(0, 2).map((l) => l.kind), ['esc', 'esc']);
  assert.deepEqual(s.route(0, 10).map((l) => l.kind), ['elev']);
  const used = { short: { esc: 0, elev: 0 }, long: { esc: 0, elev: 0 } };
  const P = Object.getPrototypeOf(Object.getPrototypeOf(s));
  const orig = P.reached;
  s.reached = function (p) {
    const r = orig.call(this, p);
    if (p.dest && (p.state === 'stairs' || p.state === 'wait')) {
      const k = p.dest.f >= 9 ? 'long' : 'short';
      if (p.state === 'stairs' && p.esc) used[k].esc++;
      if (p.state === 'wait') used[k].elev++;
    }
    return r;
  };
  for (let i = 0; i < 60; i++) {
    const p = s.newPerson('visitor', null);
    s.spawnAt(p, s.entrances[0], i % 2 ? 72 : 82);
    const long = i % 3 === 0;
    s.startTrip(p, long ? 10 : 1 + (i % 2), long ? 20 : 30, (pp) => s.leave(pp));
  }
  stepTo(s, 0, 12);
  console.log(`    近い階: エスカレーター ${used.short.esc}・エレベーター ${used.short.elev} / 遠い階: エスカレーター ${used.long.esc}・エレベーター ${used.long.elev}`);
  assert.ok(used.short.esc > used.short.elev, '近い階は多くがエスカレーター（エレベーターの真ん前にいる人は乗ることもある）');
  assert.ok(used.long.elev > 0 && used.long.esc === 0, '遠い階はエレベーター');
  // エレベーターのすぐ前にいて、待ちが無いなら、1階分でもエレベーターを選ぶことがある（見込み時間の比較）
  const e = s.transportAt(1, 71);
  const tE = s.expectElevator(e, 0, 2, 70), ch = s.stairChain(0, 2, 70);
  assert.ok(ch && tE < ch.t, '真ん前で待ちが無ければエレベーターが早い');
  // 行列が長いとエスカレーターに回る
  e.q[0] = { up: Array.from({ length: 40 }, () => ({})), down: [] };
  assert.ok(s.expectElevator(e, 0, 2, 70) > ch.t, '行列が長ければエスカレーター');
  e.q[0] = { up: [], down: [] };
});

test('医療センター: 病人が受診し、満床・不足なら評価の内訳と助言', () => {
  const s = new Tower({ seed: 132 });
  s.money = 1e9; s.star = 3;
  smallTower(s, 12);
  for (let f = 1; f <= 11; f++) for (let x = 40; x + OW <= 100; x += OW) s.build('office', { f, x });
  for (const o of s.byType.office) s.moveIn(o);
  const old = SIM.MEDICAL.daily;
  SIM.MEDICAL.daily = 0.25; // テストでは病人を多めに
  try {
    const ev = collect(s);
    // 医療センターが無い
    stepTo(s, 1, 14);
    assert.ok(s.sickToday > 0, '病人が出る');
    const short = s.byType.office.filter((o) => s.medShortRecent(o));
    assert.ok(short.length > 0);
    assert.ok(s.describe(short[0]).reasons.some((r) => r.label === '医療センターが足りない'));
    assert.ok(ev.message.some((m) => /医療センターがありません/.test(m.text)));
    // 1つ建てる（8床）。満床になり、混雑の助言が出る
    mustBuild(s, 'medical', { f: 12, x: 40 });
    const c = s.objAt(12, 40);
    assert.equal(c.beds, 8);
    let sawSick = false, maxPat = 0;
    s._medMsgAt = -1e9;
    for (let t = 0; t < 60 * 30; t++) {
      s.step(1);
      maxPat = Math.max(maxPat, c.patients);
      assert.ok(c.patients <= c.beds, '定員を超えない');
      if ([...s.active].some((p) => p.sick && p.medAt === c)) sawSick = true;
    }
    assert.ok(sawSick, '病人が医療センターへ向かう');
    assert.ok(c.custToday > 0 || c.custYesterday > 0, '受診');
    assert.equal(maxPat, c.beds, '満床になる');
    assert.ok(ev.message.some((m) => /混雑しています/.test(m.text) && m.f === 12), '混雑の助言（場所つき）');
    const d = s.describe(c);
    assert.ok(d.stats.some(([k, v]) => k === '利用' && /\/ 8床/.test(v)));
    assert.ok(d.stats.some(([k]) => k === '今日の受診'));
    // 数時間で退院
    SIM.MEDICAL.daily = 0;
    stepTo(s, s.day + 2, 6);
    assert.equal(c.patients, 0, '退院して空く');
    assert.ok(!c.members.length);
    checkInvariants(s);
  } finally { SIM.MEDICAL.daily = old; }
});

test('事件を繰り返しても重くならない・増え続けない（480×60）', () => {
  const s = new Tower({ seed: 133 });
  buildWideTower(s, 60);
  s.star = 5; s.money = 1e12;
  for (let f = 60; f <= 99; f++) mustBuild(s, 'floor', { f, x: 0, x2: 40 });
  mustBuild(s, 'cathedral', { f: 99, x: 0 });
  mustBuild(s, 'elevator', { f: 59, f2: 88, x: 2 });
  mustBuild(s, 'elevator', { f: 88, f2: 99, x: 8 });
  let msgs = 0, prompts = 0;
  s.on('message', () => msgs++);
  s.on('prompt', (p) => { prompts++; s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.kind === 'fire' ? (prompts % 2 ? 'heli' : 'wait') : 'ok'); });
  stepTo(s, 1, 8);
  let worstStep = 0, maxHeap = 0, maxEffects = 0;
  const msgsPerDay = [];
  for (let d = 0; d < 4; d++) {
    const m0 = msgs;
    for (let i = 0; i < 24; i++) {
      for (const k of ['bomb', 'fire', 'complaint', 'vip', 'wedding']) s.trigger(k);
      const h = s.hotels[i % Math.max(1, s.hotels.length)]; if (h) s.trigger('roach', h);
      const t = performance.now();
      s.step(60);
      worstStep = Math.max(worstStep, performance.now() - t);
      maxHeap = Math.max(maxHeap, s.events.size + s.walkQ.size);
      maxEffects = Math.max(maxEffects, s.effects.length);
      assert.ok(s.pending.size <= 3, '答えていないプロンプトが溜まらない');
    }
    msgsPerDay.push(msgs - m0);
  }
  console.log(`    1時間分の最悪 ${worstStep.toFixed(0)}ms, 予定の最大 ${maxHeap}, 演出の最大 ${maxEffects}, 1日の通知 ${msgsPerDay.join('/')}`);
  assert.ok(maxEffects <= SIM.MAX_EFFECTS);
  assert.ok(maxHeap < 200000);
  assert.ok(Math.max(...msgsPerDay) < 400, '通知が洪水にならない');
  assert.ok(worstStep < 2000, '1時間分の計算が重くなりすぎない');
  checkInvariants(s);
});

test('巡回: フロアの切れ目をまたぐ巡回範囲でも固まらない（爆弾捜索の無限ループの回帰）', () => {
  const s = new Tower({ seed: 5 });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 199 });
  // 5F は 0〜59 と 120〜199 の2区画（60〜119 は切れ目）
  for (let f = 1; f <= 4; f++) mustBuild(s, 'floor', { f, x: 0, x2: 199 });
  mustBuild(s, 'floor', { f: 5, x: 0, x2: 59 });
  mustBuild(s, 'floor', { f: 5, x: 120, x2: 199 });
  const p = s.newPerson('guard', null);
  p.f = 5; p.x = 30; p.state = 'walk'; s.active.add(p);
  let done = false;
  // 範囲を指定しない巡回は階全体（切れ目をまたぐ）になる
  s.startPatrol(p, 60, () => { done = true; });
  const t0 = Date.now();
  for (let i = 0; i < 90 * 4; i++) s.step(0.25);
  assert.ok(Date.now() - t0 < 2000, '時間が進む（無限ループしない）');
  assert.ok(done, '巡回が時間どおりに終わる');
  // 区画の外に出ていない
  assert.ok(p.x <= 59.5 || p.state !== 'walk', '切れ目を宙歩きしない');
});

test('§15 連絡通路: 離れた2棟を5Fでつなぐ・宙に浮く橋は不可・橋の上に施設や上の階は不可', () => {
  const s = new Tower({ seed: 140 });
  s.money = 1e9; s.star = 2;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 40 });
  mustBuild(s, 'floor', { f: 0, x: 80, x2: 120 });
  for (let f = 1; f <= 6; f++) { mustBuild(s, 'floor', { f, x: 0, x2: 40 }); mustBuild(s, 'floor', { f, x: 80, x2: 120 }); }
  mustBuild(s, 'elevator', { f: 0, f2: 6, x: 20 });   // 左の棟だけにエレベーター
  mustBuild(s, 'office', { f: 4, x: 100 });           // 右の棟の5F
  const o = s.objAt(4, 100);
  assert.equal(o.unreachable, true, '橋が無いと行けない');
  assert.match(s.check('bridge', { f: 4, x: 50, x2: 60 }).reason, /接していません/, '宙に浮いた橋は不可');
  assert.match(s.check('bridge', { f: 0, x: 41, x2: 79 }).reason, /2F以上/);
  assert.equal(s.check('bridge', { f: 4, x: 41, x2: 79 }).cost, 39 * TYPES.bridge.costPerTile);
  mustBuild(s, 'bridge', { f: 4, x: 41, x2: 79 });
  const br = s.objAt(4, 60);
  assert.equal(br.type, 'bridge'); assert.equal(br.w, 39);
  assert.equal(s.grid[3][60], 0, '下に支えは要らない');
  assert.equal(o.unreachable, false, '橋を渡って行ける');
  assert.equal(s.nodeOf(4, 10), s.nodeOf(4, 110), '2棟の5Fが同じ区画になる');
  // 人が実際に橋を渡る
  const p = s.newPerson('visitor', null);
  s.spawnAt(p, s.entrances[0], 20);
  let done = false, onBridge = false;
  assert.ok(s.startTrip(p, 4, 105, () => { done = true; s.leave(p); }));
  for (let i = 0; i < 2000 && !done; i++) { s.step(0.02); const d = s.drawPos(p); if (d && d.f === 4 && d.x > 41 && d.x < 79) onBridge = true; }
  assert.ok(done && onBridge, '橋の上を歩いて着く');
  // 橋の上には施設・移動手段を置けず、上の階も支えない
  assert.match(s.check('office', { f: 4, x: 50 }).reason, /連絡通路/);
  assert.match(s.check('stairs', { f: 4, x: 50 }).reason, /連絡通路|上の階/);
  assert.equal(s.check('stairs', { f: 3, x: 36 }).ok, false);
  assert.match(s.check('elevator', { f: 3, f2: 5, x: 60 }).reason, /連絡通路|フロアがありません/);
  assert.match(s.check('floor', { f: 5, x: 50, x2: 60 }).reason, /支え/, '橋の上の階は支えられない');
  // 保存・コピー
  const r = new Tower(); r.restore(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(r.objAt(4, 60).type, 'bridge'); assert.equal(r.objAt(4, 60).w, 39);
  assert.equal(r.objAt(4, 100).unreachable, false);
  const bp = s.blueprint({ f1: 0, x1: 0, f2: 6, x2: 120 });
  const bops = bp.ops.filter((op) => op.tool === 'bridge');
  assert.equal(bops.length, 1);
  assert.ok(bp.ops.indexOf(bops[0]) > bp.ops.findIndex((op) => op.tool === 'office'), '橋は両側の棟のあと');
  assert.ok(!bp.ops.some((op) => op.tool === 'floor' && op.p.f === 4 && op.p.x <= 50 && op.p.x2 >= 50), '橋の下にフロアは作らない');
  mustBuild(s, 'floor', { f: 0, x: 200, x2: 330 });
  const ok = s.buildBatch(bp.ops, { f: 0, x: 200 });
  assert.ok(ok.ok, ok.reason);
  assert.equal(s.objAt(4, 260).type, 'bridge');
  const bpo = s.blueprintOf([br.id, o.id]);
  assert.ok(bpo.ops.some((op) => op.tool === 'bridge'));
  // 撤去すると何も残らない
  s.act(br, 'remove');
  assert.equal(s.grid[4][60], 0);
  assert.equal(o.unreachable, true);
});

// ====================================================================
// §16 シナリオ
// ====================================================================
test('§16 フリープレイは今まで通り（シナリオなし）', () => {
  const s = new Tower({ seed: 150 });
  assert.equal(s.scenario, null); assert.equal(s.theme, 'default'); assert.equal(s.weather, null);
  assert.equal(s.minFloor, MIN_F); assert.equal(s.money, START_MONEY); assert.equal(s.star, 1);
  assert.deepEqual(s.date, { month: 4, day: 1 });
  assert.equal(s.scenarioProgress(), null);
  assert.equal(s.demandMul('office'), 1); assert.equal(s.seasonMul(), 1); assert.equal(s.weatherVisitorMul(), 1);
  const ev = []; s.on('scenario', (e) => ev.push(e));
  smallTower(s, 3);
  mustBuild(s, 'floor', { f: -1, x: 40, x2: 60 }); mustBuild(s, 'floor', { f: -2, x: 40, x2: 60 });
  assert.ok(s.check('floor', { f: -3, x: 40, x2: 60 }).ok, 'フリープレイは B10F まで');
  s.step(DAY * 2);
  assert.equal(ev.length, 0);
  const d = JSON.parse(JSON.stringify(s.serialize()));
  assert.equal(d.scenario, null);
  const r = new Tower(); r.restore(d);
  assert.equal(r.scenario, null); assert.equal(r.theme, 'default');
});

test('§16 海辺のリゾート: 開始時の状態と最初の会話', () => {
  assert.ok(SCENARIOS.some((x) => x.id === 'seaside' && x.name && x.theme === 'seaside'));
  const s = new Tower({ seed: 151, scenario: 'seaside' });
  assert.equal(s.theme, 'seaside');
  assert.equal(s.money, 1500000);
  assert.equal(s.star, 2, '★2 から始まる');
  assert.deepEqual(s.date, { month: 7, day: 1 });
  assert.equal(s.minFloor, -2);
  assert.deepEqual(s.scenario, { id: 'seaside', name: '海辺のリゾート', startDay: 0, deadlineDay: 120, state: 'playing', grade: 0 });
  const g = s.scenarioProgress();
  assert.deepEqual(g.goals.map((x) => x.target), [40, 4.0, 1500]);
  assert.equal(g.daysLeft, 120);
  assert.deepEqual(g.gradeRule.map((r) => r.days), [60, 90, 120]);
  const ev = []; s.on('scenario', (e) => ev.push(e));
  s.step(1);
  assert.equal(ev.length, 2);
  assert.ok(ev.every((e) => e.kind === 'intro' && e.text && e.title));
  assert.deepEqual(ev.map((e) => e.speaker), ['町長', '民宿のおかみさん']);
  // ホテルとレストランは最初から
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 60 });
  mustBuild(s, 'floor', { f: 1, x: 0, x2: 60 });
  assert.ok(s.check('hotelSingle', { f: 1, x: 0 }).ok);
  assert.ok(s.check('restaurant', { f: 0, x: 61 }).ok);
  // 需要と季節
  assert.ok(s.demandMul('hotelTwin') > 1 && s.demandMul('office') < 1);
  assert.equal(s.seasonMul(), 2, '7月は観光シーズン');
  // 地下は B2F まで
  mustBuild(s, 'floor', { f: -1, x: 0, x2: 30 }); mustBuild(s, 'floor', { f: -2, x: 0, x2: 30 });
  assert.match(s.check('floor', { f: -3, x: 0, x2: 30 }).reason, /地下水位/);
  assert.match(s.check('elevator', { f: -3, f2: 2, x: 10 }).reason, /地下水位|フロアがありません/);
  mustBuild(s, 'elevator', { f: -2, f2: 1, x: 20 });
  assert.match(s.act(s.transportAt(0, 21), 'extendDown').reason, /地下水位/);
});

test('§16 目標・成績・クリア（★3/★2/★1）と、クリア後も続けられる', () => {
  const s = new Tower({ seed: 152, scenario: 'seaside' });
  buildWideTower(s, 8);
  s.star = 3;
  for (let f = 8; f <= 9; f++) mustBuild(s, 'floor', { f, x: 0, x2: 200 });
  for (let x = 0; x + 4 <= 200; x += 4) s.build('hotelSingle', { f: 9, x });
  assert.ok(s.hotels.length >= 40);
  const ev = []; s.on('scenario', (e) => ev.push(e));
  s.step(60);
  assert.equal(s.scenario.state, 'playing', 'レビューがまだ無い');
  assert.equal(s.scenarioProgress().goals[1].value, null);
  for (let i = 0; i < 12; i++) s.hotels[i].reviews = [{ stars: 5, text: 'よかった', day: s.day, name: 'テスト' }];
  s.scenario.startDay = s.day - 75; // 75日目にクリアしたことにする → ★2
  s.step(60);
  assert.equal(s.scenario.state, 'cleared');
  assert.equal(s.scenario.grade, 2);
  const c = ev.find((e) => e.kind === 'clear');
  assert.ok(c && c.grade === 2 && c.speaker === '町長');
  s.step(DAY);
  assert.equal(s.scenario.state, 'cleared', 'そのまま続けられる');
  // 成績の区切り
  for (const [days, grade] of [[30, 3], [60, 3], [61, 2], [90, 2], [91, 1], [120, 1]]) {
    const t = new Tower({ seed: 1, scenario: 'seaside' });
    t.scenario.startDay = t.day - days; t.clearScenario();
    assert.equal(t.scenario.grade, grade, `${days}日`);
  }
});

test('§16 失敗: 資金 −$50万が7日続く・期限切れ（失敗しても続けられる）', () => {
  const s = new Tower({ seed: 153, scenario: 'seaside' });
  smallTower(s, 2);
  const ev = []; s.on('scenario', (e) => ev.push(e));
  s.money = -600000;
  stepTo(s, 6, 1);
  assert.equal(s.scenario.state, 'playing', '6日ではまだ');
  stepTo(s, 8, 1);
  assert.equal(s.scenario.state, 'failed');
  assert.match(ev.find((e) => e.kind === 'fail').text, /下回った/);
  s.money = 1e9;
  s.step(DAY);
  assert.equal(s.scenario.state, 'failed', '続けても成績は付かない');
  const t = new Tower({ seed: 154, scenario: 'seaside' });
  t.scenario.deadlineDay = 3;
  stepTo(t, 5, 1);
  assert.equal(t.scenario.state, 'failed');
  assert.match(t.scenario.failReason, /期限/);
  assert.equal(t.scenarioProgress().daysLeft, 0);
});

test('§16 台風: 予告 → 上陸（来客停止・キャンセル・最上階の被害、警備室で軽減）→ 去る', () => {
  const s = new Tower({ seed: 156, scenario: 'seaside' });
  s.money = 1e9;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 48 });
  mustBuild(s, 'floor', { f: 0, x: 49, x2: 80 });
  for (let f = 1; f <= 6; f++) mustBuild(s, 'floor', { f, x: 0, x2: 80 });
  mustBuild(s, 'elevator', { f: 0, f2: 6, x: 40 });
  for (let f = 1; f <= 6; f++) for (let x = 0; x + 4 <= 40; x += 4) s.build('hotelSingle', { f, x });
  mustBuild(s, 'housekeeping', { f: 1, x: 50 });
  mustBuild(s, 'fastfood', { f: 0, x: 50 });
  stepTo(s, 0, 17); // 予約が入る
  const booked = s.hotels.filter((o) => o.occupied && !o.checkedIn).length;
  const ev = []; s.on('scenario', (e) => ev.push(e));
  const pr = []; s.on('prompt', (p) => { pr.push(p); s.answer(p.id, 'ok'); });
  const msg = []; s.on('message', (m) => msg.push(m));
  assert.ok(s.announceTyphoon());
  assert.equal(pr[0].kind, 'typhoon');
  stepTo(s, 1, 6); s.step(1);
  assert.equal(s.weather.kind, 'typhoon');
  assert.ok(s.weather.intensity >= 0 && s.weather.intensity <= 1 && s.weather.until > s.time);
  assert.ok(msg.some((m) => /上陸/.test(m.text)));
  if (booked) assert.ok(msg.some((m) => /キャンセル/.test(m.text)) || s.hotels.filter((o) => o.occupied && !o.checkedIn).length < booked);
  const visitorsBefore = [...s.active].filter((p) => p.kind === 'visitor').length;
  s.step(120);
  assert.ok([...s.active].filter((p) => p.kind === 'visitor').length <= visitorsBefore, '外からの来客が止まる');
  assert.equal(s.weatherVisitorMul(), 0);
  stepTo(s, 3, 6);
  assert.equal(s.weather, null, '去る');
  assert.ok(ev.some((e) => e.title === '台風一過'));
  // 被害は警備室で減る（修理費の比較）
  const dmg = (sec) => {
    const t = new Tower({ seed: 157, scenario: 'seaside' });
    t.money = 1e9;
    mustBuild(t, 'lobby', { f: 0, x: 0, x2: 200 });
    for (let f = 1; f <= 3; f++) { mustBuild(t, 'floor', { f, x: 0, x2: 200 }); for (let x = 0; x + 10 <= 200; x += 10) t.build('office', { f, x }); }
    if (sec) {
      for (const x of [0, 10, 100, 110]) t.act(t.objAt(1, x), 'remove');
      mustBuild(t, 'security', { f: 1, x: 0 }); mustBuild(t, 'security', { f: 1, x: 100 });
    }
    t.scenarioDef.weather.typhoon.damage = 0.5;
    const m = t.money; t.typhoonDamage(); t.scenarioDef.weather.typhoon.damage = 0.15;
    return m - t.money;
  };
  const a = dmg(false), b = dmg(true);
  console.log(`    台風の修理費: 警備室なし ${a}、警備室2室 ${b}`);
  assert.ok(a > 0 && b < a, '警備室があると修理費が減る');
});

test('§16 シナリオの途中で保存・読み込み（会話は繰り返さない、台風の予告も続く）', () => {
  const s = new Tower({ seed: 158, scenario: 'seaside' });
  smallTower(s, 3);
  s.step(1);
  s.storyOnce('firstHotel');
  s.announceTyphoon();
  s.answer([...s.pending.keys()][0], 'ok');
  s.money = 777777;
  const data = JSON.parse(JSON.stringify(s.serialize()));
  assert.equal(data.scenario.id, 'seaside');
  const r = new Tower(); r.restore(data);
  assert.equal(r.theme, 'seaside'); assert.equal(r.minFloor, -2);
  assert.equal(r.money, 777777, '初期資金で上書きしない');
  assert.deepEqual(r.date, s.date);
  assert.deepEqual(r.scenario, s.scenario);
  const ev = []; r.on('scenario', (e) => ev.push(e));
  r.step(1);
  assert.equal(ev.filter((e) => e.kind === 'intro').length, 0, '開始の会話は繰り返さない');
  r.storyOnce('firstHotel');
  r.step(1);
  assert.equal(ev.length, 0, '済んだ会話は出ない');
  stepTo(r, r.day + 1, 7);
  assert.equal(r.weather && r.weather.kind, 'typhoon', '予告済みの台風は読み込み後も来る');
  const d2 = JSON.parse(JSON.stringify(r.serialize()));
  const r2 = new Tower(); r2.restore(d2);
  assert.equal(r2.weather.kind, 'typhoon', '台風の最中も保存できる');
});

test('§16 バランス: 上手なプレイは60〜90日、普通のプレイは100日前後でクリア', () => {
  const a = runSeaside('competent', 1), b = runSeaside('average', 1);
  console.log(`    上手: ${a.clearDay}日（★${a.grade}）、普通: ${b.clearDay}日（★${b.grade}）、上手の物語 ${a.story.map((x) => x[2]).join('・')}`);
  assert.equal(a.state, 'cleared'); assert.ok(a.clearDay >= 55 && a.clearDay <= 90, `上手 ${a.clearDay}`);
  assert.equal(b.state, 'cleared'); assert.ok(b.clearDay > a.clearDay && b.clearDay <= 120, `普通 ${b.clearDay}`);
  assert.ok(a.story.some((x) => x[1] === 'clear'));
});

test('性能: 横幅480・30フロア・人口6000超の横長ビルで 1 ゲーム日', () => {
  const s = new Tower({ seed: 113 });
  s.money = 1e12; s.star = 3;
  mustBuild(s, 'floor', { f: 0, x: 0, x2: W - 1 });
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: W - 1 });
  for (let f = 1; f <= 29; f++) mustBuild(s, 'floor', { f, x: 0, x2: W - 1 });
  const banks = [];
  for (let x = 36; x < W; x += 80) banks.push(x);
  for (const x of banks) for (const dx of [0, 6]) {
    mustBuild(s, 'elevator', { f: 0, f2: 29, x: x + dx });
    const e = s.transportAt(1, x + dx);
    while (e.cars.length < 8) s.act(e, 'addCar');
  }
  for (let f = 1; f <= 29; f++) {
    for (let x = 0; x + OW <= W; x += OW) s.build(f % 6 === 3 ? 'condo' : 'office', { f, x });
  }
  for (const f of [-1, -2]) mustBuild(s, 'floor', { f, x: 0, x2: W - 1 });
  for (let x = 0; x + TYPES.garbage.w <= 168; x += TYPES.garbage.w) mustBuild(s, 'garbage', { f: -2, x });
  s.star = 2;
  for (const o of [...s.byType.office, ...s.byType.condo]) s.moveIn(o);
  s.star = 3;
  s.recalcPop();
  stepTo(s, 1, 0);
  const t0 = performance.now();
  let maxActive = 0;
  for (let i = 0; i < DAY / 10; i++) { s.step(10); maxActive = Math.max(maxActive, s.active.size); }
  const ms = performance.now() - t0;
  console.log(`    人口 ${s.pop}, エレベーター ${s.elevs.length}基, 1日 ${ms.toFixed(0)}ms（8倍速の実時間30秒の ${(ms / 300).toFixed(2)}%）, 同時移動 最大 ${maxActive}人, 救済 ${s.stats.rescues}`);
  assert.ok(s.pop >= 6000, `人口 ${s.pop}`);
  assert.ok(ms < 4000);
  checkInvariants(s);
});

// ====================================================================
// 性能
// ====================================================================
test('性能: 100フロア・人口6000・エレベーター16基で 1 ゲーム日', () => {
  const s = new Tower({ seed: 70 });
  let t0 = performance.now();
  buildMegaTower(s);
  const tb = performance.now() - t0;
  stepTo(s, 1, 0);
  const cars = s.elevs.reduce((a, e) => a + e.cars.length, 0);
  t0 = performance.now();
  let maxActive = 0;
  for (let i = 0; i < DAY / 10; i++) { s.step(10); maxActive = Math.max(maxActive, s.active.size); }
  const ms = performance.now() - t0;
  const budget = (DAY / (6 * 8)) * 1000; // 8倍速で1日 = 30秒
  console.log(`    建設 ${tb.toFixed(0)}ms, 人口 ${s.pop}, エレベーター ${s.elevs.length}基/${cars}台, 1日 ${ms.toFixed(0)}ms` +
    `（8倍速の実時間 ${budget / 1000}秒の ${(ms / budget * 100).toFixed(2)}%）, 同時移動 最大 ${maxActive}人, 救済 ${s.stats.rescues}`);
  assert.ok(s.pop >= 6000, `人口 ${s.pop}`);
  assert.ok(ms < 3000, '1日 3秒未満');
  checkInvariants(s);
});

// ====================================================================
let failed = 0;
const only = process.argv[2];
for (const t of tests) {
  if (only && !t.name.includes(only)) continue;
  const t0 = performance.now();
  try {
    await t.fn();
    console.log(`✓ ${t.name} (${(performance.now() - t0).toFixed(0)}ms)`);
  } catch (e) {
    failed++;
    console.log(`✗ ${t.name}`);
    console.log(e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
  }
}
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功 (${tests.length} 件)`);
process.exit(failed ? 1 : 0);
