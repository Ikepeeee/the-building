// node tests/sim.test.mjs
// シミュレーション（js/sim/）の自動テスト。依存ライブラリなし。
import assert from 'node:assert/strict';
import { Tower, TYPES, DAY, W, LOBBY_FLOORS, AutoPlayer, autoPlay, buildMegaTower, mustBuild, stepTo, smallTower, bombTrial, fireTrial, securityTower } from './helpers.mjs';
import { runStrategy } from './balance.mjs';
import { SIM } from '../js/sim/rules.js';
import { MIN_F, MAX_F, START_MONEY } from '../js/sim/constants.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ACTIVE_STATES = new Set(['walk', 'wait', 'ride', 'stairs']);

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
  assert.ok(c.ok); assert.equal(c.cost, TYPES.office.cost + 9 * 500);
  assert.deepEqual(c.ghost, { x: 30, w: 9, f: 0, h: 1 });
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
  assert.match(s.check('recycling', { f: 0, x: 0 }).reason, /地下/);
  assert.match(s.check('metro', { f: -2, x: 0 }).reason, /地下/, '3フロア分すべて地下');
  mustBuild(s, 'floor', { f: -1, x: 0, x2: 60 });
  assert.ok(s.check('recycling', { f: -2, x: 0 }).ok, 'h=2 の地下施設は上の段で支え判定');
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
  assert.deepEqual(r.ghost, { x: 0, w: 31, f: 1, h: 2 });
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

test('建設: エレベーター（スパン・急行の停止階・ロビーへの重ね置き・延長）', () => {
  const s = new Tower({ seed: 1 });
  s.money = 1e9; s.star = 3;
  mustBuild(s, 'lobby', { f: 0, x: 0, x2: 100 });
  for (let f = 1; f <= 40; f++) mustBuild(s, 'floor', { f, x: 0, x2: 100 });
  assert.match(s.check('elevator', { f: 0, f2: 30, x: 10 }).reason, /30/);
  assert.match(s.check('elevator', { f: 3, f2: 3, x: 10 }).reason, /2フロア/);
  const r = mustBuild(s, 'elevator', { f: 0, f2: 29, x: 10 });
  assert.deepEqual(r.ghost, { x: 10, w: 4, lo: 0, hi: 29 });
  const e = s.objAt(5, 11);
  assert.equal(e.type, 'elevator');
  assert.equal(s.grid[0][10], e.id, 'ロビーの上に重ねて置ける');
  assert.equal(e.cars.length, 1);
  assert.equal(e.f, 0); assert.equal(e.h, 30);
  // 急行: ロビー階と地下のみ
  assert.match(s.check('express', { f: 1, f2: 10, x: 30 }).reason, /停止階/);
  mustBuild(s, 'express', { f: 0, f2: 40, x: 30 });
  const x = s.objAt(1, 31);
  assert.deepEqual(x.stops, [0, 14, 29]);
  // 延長とカゴ
  assert.equal(s.act(e, 'extendUp').ok, false, '30フロア制限');
  assert.match(s.act(x, 'extendUp').reason, /空中/, '空中には延長できない');
  mustBuild(s, 'floor', { f: 41, x: 0, x2: 20 });
  assert.ok(s.act(x, 'extendUp').ok);
  assert.equal(x.hi, 41);
  assert.match(s.check('elevator', { f: 30, f2: 45, x: 60 }).reason, /空中/, '設置も同じルール');
  assert.ok(s.act(e, 'addCar').ok);
  assert.equal(e.cars.length, 2);
  assert.ok(s.act(e, 'removeCar').ok);
  assert.equal(s.act(e, 'removeCar').ok, false);
  // 撤去するとロビーが戻る
  const lobbyId = s.grid[0][0];
  s.act(e, 'remove');
  assert.equal(s.grid[0][10], lobbyId);
  assert.equal(s.grid[5][10], -1);
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
  assert.deepEqual(r.ghost, { x: 0, w: 9, f: 0, h: 1 }, '施設をクリックしたらゴーストは施設全体');
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
  const e = s.objAt(1, 61);
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
  const s = new Tower({ seed: 7 });
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
  for (let f = 1; f <= 29; f++) for (let x = 0; x + 9 <= 70; x += 9) s.build('office', { f, x });
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
  stepTo(s, 1, 10, 30);
  stepTo(s, 1, 11);
  assert.ok(rooms.every((o) => !o.occupied), '全室チェックアウト');
  assert.ok(s.money > m0, '宿泊料');
  assert.ok(s.dayLog.hotel > 0);
  assert.ok(!ev.message.some((m) => m.kind === 'money'), 'お金の通知は0時のまとめだけ');
  assert.ok(rooms.some((o) => o.dirty || o.cleaner), '要清掃');
  // メイドが実際に移動して清掃する
  let sawMaid = false;
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
  s.act(s.objAt(1, 50), 'addCar');
  for (let f = 1; f <= 12; f++) {
    for (let x = 0; x + 9 <= 50; x += 9) s.build('office', { f, x });
    for (let x = 54; x + 9 <= 100; x += 9) s.build('office', { f, x });
  }
  if (security) { s.act(s.objAt(3, 54), 'remove'); s.act(s.objAt(3, 63), 'remove'); mustBuild(s, 'security', { f: 3, x: 54 }); }
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
  s.act(s.objAt(8, 0), 'remove'); s.act(s.objAt(8, 9), 'remove');
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
  assert.deepEqual(s.starProgress().reqs.map((r) => r.label).slice(1), ['医療センター', 'リサイクルセンター', 'VIPの高評価']);
  s.star = 5;
  assert.equal(s.starProgress().next, 'TOWER');
});

test('パネル: describe / act', () => {
  const s = new Tower({ seed: 51 });
  smallTower(s, 5);
  const e = s.objAt(1, 61);
  let d = s.describe(e);
  assert.equal(d.title, 'エレベーター');
  assert.equal(d.subtitle, '1F〜6F');
  for (const id of ['addCar', 'removeCar', 'extendUp', 'extendDown', 'remove']) assert.ok(d.actions.find((a) => a.id === id), id);
  assert.equal(d.actions.find((a) => a.id === 'removeCar').enabled, false);
  assert.ok(d.actions.find((a) => a.id === 'remove').danger);
  assert.equal(d.actions.find((a) => a.id === 'extendDown').enabled, false, 'B1F にフロアがない');
  assert.equal(d.actions.find((a) => a.id === 'extendUp').enabled, false, '7F にフロアがない');
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
  assert.equal(s.describe(p).title, '来客');
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
  assert.equal(data.v, 2);
  const r = new Tower();
  r.restore(data);
  for (let f = MIN_F; f <= MAX_F; f++) assert.deepEqual(Array.from(r.grid[f]), Array.from(s.grid[f]), `grid ${f}`);
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
  d.objs.push({ id: 9998, type: 'office', f: 1, x: 145 });
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
  const e = s.objAt(1, 61);
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
  mustBuild(s, 'office', { f: 0, x: 45 });
  const o = s.objAt(1, 0);
  assert.equal(o.unreachable, true);
  assert.equal(s.objAt(0, 45).unreachable, false);
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
  for (let f = 1; f <= 20; f++) for (let x = 0; x + 9 <= 70; x += 9) s.build('office', { f, x });
  for (const o of s.byType.office) s.moveIn(o);
  const e = s.objAt(1, 70);
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
