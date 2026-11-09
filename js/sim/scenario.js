// シナリオの仕組み（Tower.prototype に混ぜ込む）。SPEC §16
// フリープレイ（scenarioDef が null）のときは、どのフックも何もしない／倍率 1 を返す。
import { DAY, W, TYPES, floorName, fmtMoney } from './constants.js';
import { HOTEL, VIEWING, burnable } from './rules.js';
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
    this.scn.story.intro = this.day;
    this.queueBeat('intro', 'intro');
  },

  queueScenario(ev) { this._scnQueue.push(ev); },

  // 節目の会話を1行ずつ通知する（旧形式 {speaker, title, text} の1行も受け付ける）
  queueBeat(key, kind, extra = {}, prefix = '') {
    const s = this.scenarioDef.story[key];
    if (!s) return;
    const lines = s.lines || (Array.isArray(s) ? s : [s]);
    lines.forEach((l, i) => this.queueScenario({ kind, title: s.title || l.title, speaker: l.speaker, text: (i === 0 && prefix ? prefix : '') + l.text, beat: key, ...(i === lines.length - 1 ? extra : {}) }));
  },

  storyOnce(key) {
    const def = this.scenarioDef;
    if (!def || !this.scn || key in this.scn.story) return;
    if (!def.story[key]) return;
    this.scn.story[key] = this.day;
    this.queueBeat(key, 'story');
  },

  // ★が上がったとき（checkStar から）
  onStarUp(star) { if (this.scenarioDef) this.storyOnce(`star${star}`); },

  // 物語の次の節目（UI の「次にやること」用）
  nextBeat() {
    const def = this.scenarioDef;
    if (!def || !def.storyOrder || !this.scn) return null;
    const last = def.storyOrder[def.storyOrder.length - 1];
    if (last.key in this.scn.story) return null; // 物語は最後まで済んだ
    // 季節の節目（花火大会など）は、その季節でなければ飛ばす
    const m = this.date.month;
    const b = def.storyOrder.find((x) => !(x.key in this.scn.story) && (!x.months || x.months.includes(m)));
    return b ? { key: b.key, label: b.label, hint: b.hint } : null;
  },

  // シナリオ独自の★の条件。6 は伝説のリゾート
  scenarioStarReqs(n) {
    const def = this.scenarioDef, R = def.stars[n];
    if (!R) return [];
    const out = [];
    if (R.visitors) out.push({ label: `1日の来訪者 ${R.visitors.toLocaleString('en-US')}人（直近3日の平均 ${Math.round(this.visitorsPerDay).toLocaleString('en-US')}人）`, done: this.visitorsPerDay >= R.visitors });
    for (const t of R.types || []) out.push({ label: t === 'seaChapel' ? `${floorName(TYPES.seaChapel.minF)}以上の${TYPES[t].name}` : TYPES[t].name, done: (this.byType[t] || []).length > 0 });
    for (const a of R.anyOf || []) out.push({ label: a.label, done: a.types.some((t) => (this.byType[t] || []).length > 0) });
    for (const c of R.counts || []) {
      const n = (this.byType[c.type] || []).length;
      out.push({ label: `${TYPES[c.type].name} ${c.n}室（現在 ${n}室）`, done: n >= c.n });
    }
    if (R.vip) out.push({ label: 'VIPの高評価', done: this.flags.vipOk, vip: true });
    if (R.review) {
      const v = GOAL_METRICS.hotelReviewAll(this);
      out.push({ label: `ホテルの平均レビュー★${R.review.toFixed(1)}（現在 ${v === null ? '—' : '★' + v.toFixed(1)}）`, done: v !== null && v >= R.review });
    }
    if (R.wedding) out.push({ label: '夕日の結婚式', done: this.legend });
    return out;
  },

  // ---- 施設ごとの時間・価格の倍率（海辺の専用施設） ----
  // スカイラウンジは高い階ほど伸びる（20F で ×1、50F で ×1.6）
  heightMul(o) { return o.type === 'skyLounge' ? 1 + Math.max(0, o.f - 19) * 0.02 : 1; },
  timeMul(o, h = this.hour) {
    switch (o.type) {
      case 'skyLounge': return this.heightMul(o) * (h >= 17 ? 2 : 0.7); // 夜景の夜が山、昼は展望の客
      case 'nightPool': { const m = this.date.month; return (m >= 11 || m <= 3) ? 0.2 : 1; } // 冬は大きく減る
      default: return 1;
    }
  },
  priceMul(o, h = this.hour) {
    let m = 1;
    if (o.type === 'skyLounge') m *= this.heightMul(o) * (h >= 17 ? 1.3 : 1);
    if (o.type === 'nightPool' && h >= 18) m *= 1.6; // ナイトプール
    if (this.festivalLive() && VIEWING.has(o.type)) m *= this.scenarioDef.festival.sales;
    return m;
  },
  partyKey(type, h = this.hour) { return type === 'nightPool' ? (h >= 18 ? 'nightPoolNight' : 'nightPoolDay') : type; },

  // ---- イルカショー ----
  updateShows() {
    const D = this.scenarioDef && this.scenarioDef.dolphin, list = this.byType.dolphinShow;
    if (!D || !list || !list.length) return;
    const m = this.time % DAY;
    let phase = 'idle', t = 0;
    if (!this.isTyphoon()) {
      for (const st of D.times) if (m >= st && m < st + D.minutes) { phase = 'show'; t = (m - st) / D.minutes; }
    }
    for (const o of list) {
      if (!o.show || o.show.phase !== phase || phase === 'show') o.show = { phase, t };
    }
  },
  // その時間に始まるショーへ、前の30分で観客が集まる
  dolphinCrowd(h) {
    const D = this.scenarioDef && this.scenarioDef.dolphin;
    if (!D || this.isTyphoon()) return;
    for (const o of this.byType.dolphinShow || []) {
      if (o.burning || this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
      for (const st of D.times) {
        const lead = st - 30;
        if (lead < h * 60 || lead >= h * 60 + 60) continue;
        const rain = this.weather && this.weather.kind === 'rain' ? D.rain : 1;
        const n = Math.floor(D.crowd * rain * this.evalFactor(o) * (0.6 + this.r() * 0.8));
        for (let i = 0; i < n; i++) this.at(this.day * DAY + lead + this.rand(30), () => this.visit(o));
      }
    }
  },
  hasDolphinNeighbor(o) {
    for (const d of this.byType.dolphinShow || []) if (d.f === o.f && (d.x === o.x + o.w || d.x + d.w === o.x)) return true;
    return false;
  },

  // ---- 花火大会 ----
  festivalLive() { return !!this.festival && this.festival.state === 'live'; },
  festivalAnnounce() {
    const F = this.scenarioDef.festival;
    const day = this.day + F.notice;
    const start = day * DAY + F.start;
    this.festival = { kind: 'fireworks', day, start, end: start + F.minutes, state: 'announced', postponed: false };
    // 町長の告知はその夏の最初の回だけ会話で。2回目からはお知らせだけ
    const season = Math.floor((this.day + this.dateOffset) / 365);
    if (this.scn.fwSeason !== season) {
      this.scn.fwSeason = season;
      this.queueScenario({ kind: 'story', title: '花火大会のお知らせ', speaker: '町長', text: '今度の土曜の夜は、浜の花火大会だ！ 夕方からたくさん人が来るぞ。\n屋上や浜の屋外の店、スカイラウンジは、いい観覧席になる。' });
    }
    this.msg(`${F.notice}日後の土曜 19:30 から花火大会です`, 'event');
  },
  festivalCheck(h) {
    const fe = this.festival;
    if (!fe || fe.state !== 'announced' || this.day !== fe.day || h !== 17) return;
    if (!this.weather) return;
    // 雨・台風: 翌日に順延、それも駄目なら中止
    if (!fe.postponed) {
      fe.postponed = true; fe.day++; fe.start += DAY; fe.end += DAY;
      this.msg('天気が悪いため、花火大会は明日に順延します', 'event');
    } else {
      fe.state = 'done'; fe.cancelled = true;
      this.msg('天気が悪いため、今年のこの花火大会は中止になりました', 'event');
    }
  },
  festivalCrowd(h) {
    const fe = this.festival, F = this.scenarioDef.festival;
    if (!fe || fe.state === 'done' || this.day !== fe.day || h < 18 || h > 20 || this.weather) return;
    const spots = [];
    for (const t of VIEWING) for (const o of this.byType[t] || []) if (!o.burning && this.isOpen(o, h) && this.entranceDist(o.f, o.x + o.w / 2) < Infinity) spots.push(o);
    const mul = 2 + Math.min(1, spots.length / 8); // 観覧の場所が多いほど増える（×2〜3）
    const beach = (this.byType.restaurant || []).concat(this.byType.fastfood || [], this.byType.shop || []).filter((o) => o.f <= 1 && this.isOpen(o, h));
    for (const o of spots.concat(beach)) {
      if (HOTEL.has(o.type)) continue; // コテージは宿泊（予約が増える）
      const n = Math.floor(F.crowd * mul * (0.5 + this.r()));
      for (let i = 0; i < n; i++) this.later(this.rand(55), () => this.visit(o));
    }
  },
  festivalTick() {
    const fe = this.festival;
    if (!fe || fe.state === 'done') return;
    if (fe.state === 'announced' && this.time >= fe.start && this.day === fe.day) {
      fe.state = 'live';
      this.effect('fireworks', this.topBuiltFloor() + 6, W / 2, fe.end - fe.start);
      this.sound('fireworks');
    } else if (fe.state === 'live' && this.time >= fe.end) {
      fe.state = 'done';
      if (this.star >= 3) this.storyOnce('fireworks');
    }
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
    // 目玉施設（水族館・海の家・温泉など）は人口に関係なく観光客を呼ぶ
    this.dolphinCrowd(h);
    this.festivalCrowd(h);
    for (const [t, A] of Object.entries(def.attractions || {})) {
      for (const o of this.byType[t] || []) {
        if (o.burning || !this.isOpen(o, h)) continue;
        if (this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
        const boost = t === 'aquarium' && def.dolphin && this.hasDolphinNeighbor(o) ? def.dolphin.aquariumBoost : 1;
        const lam = A.rate * boost * this.timeMul(o, h) * (A.season ? this.seasonMul() : 1) * this.weatherVisitorMul() * this.evalFactor(o) * this.outdoorMul(o);
        const n = Math.floor(lam * (0.5 + this.r()));
        for (let i = 0; i < n; i++) this.later(this.rand(55), () => this.visit(o));
      }
    }
    const B = def.beach, mul = this.seasonMul() * this.weatherVisitorMul();
    for (const t of B.types) {
      for (const o of this.byType[t] || []) {
        if (!B.floors.includes(o.f) || o.burning || !this.isOpen(o, h)) continue;
        if (this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
        const lam = B.rate * mul * this.demandMul(t) * this.evalFactor(o) * this.outdoorMul(o);
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
    const FE = def.festival;
    if (FE && FE.months.includes(m) && this.weekday === (FE.weekday - FE.notice + 7) % 7 && (!this.festival || this.festival.state === 'done')) this.festivalAnnounce();
    if (sc.state !== 'playing') return;
    const elapsed = this.day - sc.startDay;
    if (elapsed === Math.floor(def.deadlineDays / 2)) this.storyOnce('halfway');
    // 失敗: 期限切れ、または資金の大幅なマイナスが続く
    if (this.money < def.fail.money) this.scn.poorDays++; else this.scn.poorDays = 0;
    if (this.day > sc.deadlineDay) this.failScenario('期限の120日が過ぎました');
    else if (this.scn.poorDays >= def.fail.days) this.failScenario(`資金が ${fmtMoney(def.fail.money)} を下回ったまま${def.fail.days}日が過ぎました`);
  },

  scenarioHourly(h = this.hour) {
    const def = this.scenarioDef, sc = this.scenario;
    if (!def || !sc) return;
    if (this.festival) this.festivalCheck(h);
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
    if (this.hotels.some((o) => o.type !== 'cottage')) this.storyOnce('firstHotel');
    if ((this.byType.umiNoIe || []).length) this.storyOnce('firstUmiNoIe');
    if ((this.byType.onsen || []).length) this.storyOnce('firstOnsen');
    if ((this.byType.aquarium || []).length) this.storyOnce('firstAquarium');
    if ((this.byType.terraceCafe || []).length || (this.byType.beerGarden || []).length) this.storyOnce('firstOutdoor');
    if ((this.byType.amusement || []).length) this.storyOnce('firstAmusement');
    if ((this.byType.seaChapel || []).length) this.storyOnce('chapelBuilt');
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
    this.scn.story.clear = this.day;
    this.queueBeat('clear', 'clear', { grade }, `（${elapsed}日で目標達成・成績 ${'★'.repeat(grade)}）\n`);
    this.sound('fanfare');
  },

  failScenario(reason) {
    const sc = this.scenario;
    if (sc.state !== 'playing') return;
    sc.state = 'failed';
    sc.grade = 0;
    sc.failReason = reason;
    this.scn.story.fail = this.day;
    this.queueBeat('fail', 'fail', {}, `${reason}。\n`);
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
      nextBeat: this.nextBeat(),
    };
  },

  // ---- 保存 ----
  serializeScenario() {
    if (!this.scenario) return null;
    return { ...this.scenario, scn: { ...this.scn, story: { ...this.scn.story } }, festival: this.festival ? { ...this.festival } : null };
  },
};
