// シナリオの仕組み（Tower.prototype に混ぜ込む）。SPEC §16
// フリープレイ（scenarioDef が null）のときは、どのフックも何もしない／倍率 1 を返す。
import { DAY, TYPES, floorName, fmtMoney } from './constants.js';
import { HOTEL, burnable } from './rules.js';
import { scenarioById, GOAL_METRICS } from './scenarios.js';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// 4月1日（0日目）から、その月日までの日数
const daysFromApril1 = (month, day) => {
  let n = 0;
  for (let m = 4; m !== month; m = m % 12 + 1) n += MONTH_DAYS[m - 1];
  return n + day - 1;
};

export const ScenarioMixin = {
  applyScenarioStart(id) {
    const def = scenarioById(id);
    if (!def) return;
    this.scenarioDef = def;
    this.theme = def.theme || 'default';
    const st = def.start || {};
    if (typeof st.money === 'number') this.money = st.money;
    if (st.star) {
      this.star = st.star;
      // ★2 で始めるときは、★2 になったときと同じく事件の予定を立てる
      if (this.star >= 2 && this.flags.nextBomb === null) {
        this.flags.nextBomb = this.day + 10 + Math.floor(this.rand(10));
        this.flags.nextFire = this.day + 14 + Math.floor(this.rand(10));
      }
    }
    if (typeof st.minFloor === 'number') this.minFloor = st.minFloor;
    if (st.month) this.dateOffset = daysFromApril1(st.month, st.day || 1);
    this.scenario = { id: def.id, name: def.name, startDay: this.day, deadlineDay: this.day + def.deadlineDays, state: 'playing', grade: 0 };
    this.scn = { story: {}, poorDays: 0, typhoonAt: null, rainUntil: null };
    for (const s of def.story.intro || []) this.queueScenario({ kind: 'intro', ...s });
  },

  queueScenario(ev) { this._scnQueue.push(ev); },

  storyOnce(key) {
    const def = this.scenarioDef;
    if (!def || !this.scn || key in this.scn.story) return;
    const s = def.story[key];
    if (!s) return;
    this.scn.story[key] = this.day;
    this.queueScenario({ kind: 'story', ...s });
  },

  // ---- 需要・季節・天気の倍率（フリープレイでは 1） ----
  demandMul(type) {
    const def = this.scenarioDef;
    if (!def || !def.demand) return 1;
    return (HOTEL.has(type) ? def.demand.hotel : def.demand[type]) ?? 1;
  },
  seasonMul() {
    const def = this.scenarioDef;
    return def && def.season ? def.season[this.date.month] ?? 1 : 1;
  },
  isTyphoon() { return !!this.weather && this.weather.kind === 'typhoon'; },
  weatherVisitorMul() {
    if (!this.weather) return 1;
    if (this.weather.kind === 'typhoon') return 0;
    const w = this.scenarioDef && this.scenarioDef.weather;
    return w && w.rain ? w.rain.visitors : 1;
  },

  // 浜から来る観光客（1F・2F の飲食店とショップ）
  beachVisitors(h) {
    const def = this.scenarioDef;
    if (!def || !def.beach || this.isTyphoon()) return;
    const B = def.beach, mul = this.seasonMul() * this.weatherVisitorMul();
    for (const t of B.types) {
      for (const o of this.byType[t] || []) {
        if (!B.floors.includes(o.f) || o.burning || !this.isOpen(o, h)) continue;
        if (this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
        const lam = B.rate * mul * this.demandMul(t) * this.evalFactor(o);
        const n = Math.floor(lam * (0.5 + this.r()));
        for (let i = 0; i < n; i++) this.later(this.rand(55), () => this.visit(o));
      }
    }
  },

  // ---- 毎日・毎時 ----
  scenarioDaily() {
    const def = this.scenarioDef, sc = this.scenario;
    if (!def || !sc) return;
    const W = def.weather || {}, m = this.date.month;
    // 台風の予告（来る前日の9時）
    if (W.typhoon && !this.weather && this.scn.typhoonAt === null && W.typhoon.months.includes(m) && this.day > sc.startDay + 5 && this.r() < W.typhoon.daily) {
      this.at(this.day * DAY + 9 * 60, () => this.announceTyphoon());
    } else if (W.rain && !this.weather && this.r() < W.rain.daily) {
      const start = this.day * DAY + (6 + this.rand(12)) * 60;
      const hours = W.rain.hours[0] + this.rand(W.rain.hours[1] - W.rain.hours[0]);
      this.at(start, () => { if (!this.weather) this.weather = { kind: 'rain', intensity: 0.4 + this.rand(0.4), until: this.time + hours * 60 }; });
    }
    if (sc.state !== 'playing') return;
    const elapsed = this.day - sc.startDay;
    if (elapsed === Math.floor(def.deadlineDays / 2)) this.storyOnce('halfway');
    // 失敗: 期限切れ、または資金の大幅なマイナスが続く
    if (this.money < def.fail.money) this.scn.poorDays++; else this.scn.poorDays = 0;
    if (this.day > sc.deadlineDay) this.failScenario('期限の120日が過ぎました');
    else if (this.scn.poorDays >= def.fail.days) this.failScenario(`資金が ${fmtMoney(def.fail.money)} を下回ったまま${def.fail.days}日が過ぎました`);
  },

  scenarioHourly() {
    const def = this.scenarioDef, sc = this.scenario;
    if (!def || !sc) return;
    // 天気の移り変わり
    const w = this.weather;
    if (w) {
      if (this.time >= w.until) this.endWeather();
      else if (w.kind === 'typhoon') {
        // 来始めと去り際は弱く、真ん中が最も強い
        const t = (this.time - w.start) / Math.max(1, w.until - w.start);
        w.intensity = Math.max(0.2, Math.min(1, Math.min(t, 1 - t) * 4));
      }
    }
    if (this.hotels.length) this.storyOnce('firstHotel');
    if (sc.state === 'playing' && this.scenarioGoals().every((g) => g.done)) this.clearScenario();
  },

  scenarioGoals() {
    const def = this.scenarioDef;
    if (!def) return [];
    return def.goals.map((g) => {
      const value = GOAL_METRICS[g.metric] ? GOAL_METRICS[g.metric](this) : null;
      return { id: g.id, label: g.label, value, target: g.target, unit: g.unit || '', done: value !== null && value >= g.target };
    });
  },

  clearScenario() {
    const def = this.scenarioDef, sc = this.scenario;
    const elapsed = this.day - sc.startDay;
    let grade = 0;
    for (const r of def.gradeRule) if (elapsed <= r.days) { grade = r.grade; break; }
    sc.state = 'cleared';
    sc.grade = grade;
    sc.clearDay = this.day;
    const s = def.story.clear;
    this.queueScenario({ kind: 'clear', ...s, text: `${s.text}\n（${elapsed}日でクリア・成績 ${'★'.repeat(grade)}）`, grade });
    this.sound('fanfare');
  },

  failScenario(reason) {
    const sc = this.scenario;
    if (sc.state !== 'playing') return;
    sc.state = 'failed';
    sc.grade = 0;
    sc.failReason = reason;
    const s = this.scenarioDef.story.fail;
    this.queueScenario({ kind: 'fail', ...s, text: `${reason}。\n${s.text}` });
  },

  // ---- 台風 ----
  announceTyphoon() {
    if (this.weather && this.weather.kind === 'typhoon') return false;
    const T = this.scenarioDef && this.scenarioDef.weather && this.scenarioDef.weather.typhoon;
    if (!T) return false;
    const at = (this.day + 1) * DAY + 6 * 60;
    this.scn.typhoonAt = at;
    this.ask('typhoon', '台風が接近しています',
      '明日の朝、台風が上陸する見込みです。\n来ている間は外からのお客さんが来ず、ホテルのキャンセルも出ます。最上階付近は被害を受けることがあります（警備室があれば減らせます）。',
      [{ label: 'OK', value: 'ok' }]);
    this.msg('台風が接近しています。明日の朝に上陸する見込みです', 'event');
    this.sound('alarm');
    this.at(at, () => { if (this.scn && this.scn.typhoonAt === at) this.startTyphoon(); });
    return true;
  },
  _answer_typhoon() {},

  startTyphoon() {
    const T = this.scenarioDef.weather.typhoon;
    this.scn.typhoonAt = null;
    const hours = T.hours[0] + this.rand(T.hours[1] - T.hours[0]);
    this.weather = { kind: 'typhoon', intensity: 0.2, until: this.time + hours * 60, start: this.time };
    // チェックイン前の予約はキャンセルされる
    let cancel = 0;
    for (const o of this.hotels) {
      if (!o.occupied || o.checkedIn || o.vipHold || this.r() >= T.cancel) continue;
      for (const p of o.members.slice()) this.purge(p, false);
      o.members = []; o.occupied = false; o.needsParking = 0;
      cancel++;
    }
    this._popDirty = true;
    this.msg(`台風が上陸しました${cancel ? `。ホテルの予約${cancel}件がキャンセルされました` : ''}`, 'event');
    this.sound('alarm');
    // 真ん中で最上階付近に被害
    this.at(this.time + hours * 30, () => this.typhoonDamage());
  },

  typhoonDamage() {
    const T = this.scenarioDef.weather.typhoon;
    const top = this.topBuiltFloor(), sec = (this.byType.security || []).length;
    const factor = 1 / (1 + 0.5 * sec);
    let n = 0, cost = 0;
    for (let f = Math.max(0, top - T.topFloors + 1); f <= top; f++) {
      for (const o of this.byFloor.get(f) || []) {
        if (!burnable(o.type) || o.destroyed || this.r() >= T.damage * factor * 2) continue;
        const c = Math.max(5000, Math.round((TYPES[o.type].cost || 20000) * T.repair * factor));
        n++; cost += c;
        o.burnt = Math.min(0.6, (o.burnt || 0) + 0.3); // 見た目の傷み（毎日少しずつ直る）
      }
    }
    if (!n) return;
    this.spend(cost);
    this.msg(`台風で${floorName(top)}付近の施設${n}件が傷み、修理費 ${fmtMoney(cost)} がかかりました${sec ? '（警備室のおかげで被害は少なめです）' : ''}`, 'bad', top, 240);
  },

  endWeather() {
    const w = this.weather;
    this.weather = null;
    if (w && w.kind === 'typhoon') {
      this.msg('台風が去りました', 'good');
      this.storyOnce('typhoonSurvived');
    }
  },

  scenarioProgress() {
    const def = this.scenarioDef, sc = this.scenario;
    if (!def || !sc) return null;
    return {
      name: def.name, goals: this.scenarioGoals(),
      daysLeft: Math.max(0, sc.deadlineDay - this.day), state: sc.state, grade: sc.grade,
      gradeRule: def.gradeRule.map((r) => ({ ...r })),
    };
  },

  // ---- 保存 ----
  serializeScenario() {
    if (!this.scenario) return null;
    return { ...this.scenario, scn: { ...this.scn, story: { ...this.scn.story } } };
  },
};
