// The Building: シミュレーション本体（DOM 非依存）
// 契約は docs/SPEC.md の「Sim API」を参照。
import { W, MIN_F, MAX_F, DAY, START_MONEY, STAR_POP, TYPES, VARIANTS, floorName, fmtMoney } from './constants.js';
import { Heap, makeRng } from './util.js';
import {
  SAVE_VERSION, NF, FI, LOBBY_SET, TRANSPORT, ELEV, HOTEL, COMMERCE, NOISY, TENANT, TRANSIENT,
  STAFF_KIND, SIM, STAY, VISIT_RATE, VISIT_CAP,
} from './rules.js';
import { EventsMixin } from './events.js';
import { PanelMixin } from './panel.js';
import { BuildMixin } from './build.js';
import { ElevatorMixin, STANDBY } from './elevator.js';
import { RouteMixin } from './route.js';
import { PeopleMixin } from './people.js';
import { GarbageMixin } from './garbage.js';

const K_ELEV = 1, K_EXP = 2, K_STAIR = 3, K_ESC = 4;
const KIND_NAMES = [null, 'elev', 'express', 'stairs', 'esc'];
const dk = (d) => (d > 0 ? 'up' : 'down');
const legTo = (p) => p.legs[p.li].to;
const LUNCH = ['fastfood', 'restaurant'];
const DINNER = ['restaurant', 'fastfood'];
const LEISURE = ['shop', 'restaurant', 'fastfood', 'cinema'];
// 'sound' 通知の最小間隔（ゲーム分）
const SOUND_GAP = { cash: 30, ding: 5, complaint: 30, roach: 30, built: 2 };
const NO_VISIT = new Set(['metro', 'garbage', 'parking']);
const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class Tower {
  constructor(opts = {}) {
    this.listeners = Object.create(null);
    this.seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.frameBudgetMs = opts.frameBudgetMs ?? null; // 既定は予算なし（呼ばれた分を全部進める）
    // 工事期間（false にすると建てた瞬間に完成。テスト用）
    this.construction = opts.construction !== false;
    this.reset();
  }

  reset() {
    this.rng = makeRng(this.seed);
    this.time = 6 * 60;
    this.money = START_MONEY;
    this.star = 1;
    this.tower = false;
    this.pop = 0;
    this.ledger = { income: 0, expense: 0 };
    this.yesterday = null;
    this.grid = {};   // フロアと施設
    this.tgrid = {};  // 移動手段（エレベーターの機械室・ピットを含む）
    for (let f = MIN_F; f <= MAX_F; f++) { this.grid[f] = new Int32Array(W); this.tgrid[f] = new Int32Array(W); }
    this.objs = new Map();
    this.active = new Set();
    this.climbers = new Set(); // 階段・エスカレーターの途中の人（毎 tick 動かす）
    this.walkQ = new Heap();   // 歩いている人の到着時刻
    this.fires = [];
    this.bomb = null;
    this.fire = null;
    this.effects = [];
    this.santa = null;
    this.heli = null;
    this.vip = null;
    this.wedding = null;
    this.nextId = 1;   // 施設 id（grid に入る）
    this.nextPid = 1;  // 人の id（保存しない）
    this.events = new Heap();
    this.flags = { vipOk: false, vipNext: 0, weddingNext: 0, nextBomb: null, nextFire: null, bombAt: null, fireAt: null, firstTenant: false };
    this.pending = new Map();
    this.promptSeq = 1;
    this._reemit = [];
    this._snd = Object.create(null);
    this.dayLog = this.newDayLog();
    this.garbageBags = 0; this.garbageCap = 0; this.truckActive = false;
    this.moveSeqN = 0; this.parkingSpaces = 0; this.parkingUsed = 0; this.parkingShort = 0;
    this.revision = 0;
    this.backlog = 0;        // まだ進めていないゲーム分（step の予算切れで持ち越した分）
    this.lastStepMs = 0;     // 直近の step にかかった時間（ミリ秒）
    // 統計（テスト・デバッグ用）: 到着数、救済数、ストレス合計、移動時間合計
    this.stats = { trips: 0, rescues: 0, stress: 0, tripTime: 0 };
    this.reindex();
  }

  newDayLog() { return { rent: 0, sale: 0, hotel: 0, shop: 0, inOffice: 0, inCondo: 0, out: 0, buyback: 0, garbage: 0, garbageBags: 0 }; }

  // ---- カレンダー: 0日目 = 4月1日、1ゲーム日 = 1日（365日周期）----
  get date() {
    let d = this.day % 365;
    for (let i = 0; i < 12; i++) {
      const m = (i + 3) % 12; // 4月から
      if (d < MONTH_DAYS[m]) return { month: m + 1, day: d + 1 };
      d -= MONTH_DAYS[m];
    }
    return { month: 3, day: 31 };
  }
  isXmasEve() { const d = this.date; return d.month === 12 && d.day === 24; }

  topBuiltFloor() {
    if (this._topRev === this.revision) return this._top;
    let top = 0;
    for (let f = MAX_F; f >= MIN_F; f--) { if (this.grid[f].some((c) => c !== 0)) { top = f; break; } }
    this._top = top; this._topRev = this.revision;
    return top;
  }

  updateSanta() {
    const h = (this.time % DAY) / 60;
    if (h >= 18 && this.isXmasEve()) {
      const t = (h - 18) / 6;
      this.santa = { x: -10 + t * (W + 20), f: this.topBuiltFloor() + 3 + Math.sin(t * Math.PI * 8) * 0.5 };
    } else if (this.santa) this.santa = null;
  }

  // ================= 基本 =================
  on(name, fn) { (this.listeners[name] ||= []).push(fn); return () => this.off(name, fn); }
  off(name, fn) {
    const l = this.listeners[name];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  emit(name, data) {
    const l = this.listeners[name];
    if (!l) return;
    for (const fn of l.slice()) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
  msg(text, kind = 'info', f, x) {
    const m = { text, kind };
    if (f !== undefined && f !== null) { m.f = f; m.x = x ?? W / 2; }
    this.emit('message', m);
  }
  sound(name) {
    if (this._batch) return;
    const gap = SOUND_GAP[name] || 0;
    const last = this._snd[name];
    if (gap && last !== undefined && this.time - last < gap) return;
    this._snd[name] = this.time;
    this.emit('sound', { name });
  }
  effect(kind, f, x, dur = 30) {
    // 上限: 事件が重なっても演出の配列が際限なく増えないように
    if (this.effects.length >= SIM.MAX_EFFECTS) this.effects.shift();
    this.effects.push({ kind, f, x, t0: this.time, dur });
  }

  get day() { return Math.floor(this.time / DAY); }
  get hour() { return Math.floor(this.time / 60) % 24; }
  get minute() { return Math.floor(this.time) % 60; }
  get weekday() { return this.day % 7; }
  isWeekend(d = this.day) { return d % 7 >= 5; }

  r() { return this.rng(); }
  rand(n) { return this.rng() * n; }
  pick(a) { return a[Math.floor(this.rng() * a.length)]; }

  earn(v) { this.money += v; this.ledger.income += v; }
  spend(v) { this.money -= v; this.ledger.expense += v; }
  at(t, fn) { this.events.push(t, fn); }
  later(mins, fn) { this.events.push(this.time + mins, fn); }

  isOpen(o, h = this.hour) {
    const T = TYPES[o.type];
    if (!T || !T.open) return true;
    return h >= T.open[0] && h < T.open[1];
  }

  // ---- 評価 ----
  hasEval(o) { return !!o && (TENANT.has(o.type) || HOTEL.has(o.type) || COMMERCE.has(o.type)); }
  evalScore(o) {
    let s = o.evalN ? (o.eval * 3 + o.evalSum) / (3 + o.evalN) : o.eval;
    if (o.noisy) s += 20;
    if (o.infested) s += 40;
    if (o.garbageBad) s += SIM.GARBAGE.penalty;
    if (o.parkingShort > 0) s += SIM.PARKING.penalty;
    if (o.medShort !== undefined && this.medShortRecent(o)) s += SIM.MEDICAL.penalty;
    return s;
  }
  evalLevel(o) {
    if (!this.hasEval(o)) return null;
    if (TENANT.has(o.type) && !o.occupied && !o.evalN) return null;
    const s = this.evalScore(o);
    return s < 20 ? 'good' : s < 45 ? 'fair' : 'bad';
  }
  evalFactor(o) {
    const l = this.evalLevel(o);
    return l === 'bad' ? 0.25 : l === 'fair' ? 0.6 : 1;
  }
  newReasons() { return { n: 0, stress: 0, wait: 0, stairs: 0, walk: 0, crowd: 0, fail: 0 }; }
  recordEval(o, p) {
    if (!o || o.dead || o.destroyed) return;
    o.evalSum += Math.min(100, p.stress);
    o.evalN++;
    o.cWait += p.sWait;
    o.cStair += p.sStair;
    const r = o.rs;
    r.n++; r.stress += Math.min(100, p.stress); r.wait += p.waitTot || 0; r.stairs += p.sStair; r.walk += p.walkT || 0; r.crowd += p.sCrowd || 0;
  }
  recordEvalValue(o, v) {
    if (!o || o.dead || o.destroyed) return;
    o.evalSum += v; o.evalN++; o.cWait += v / 2;
    o.rs.fail++;
  }

  // ================= インデックス・経路グラフ =================
  reindex() {
    if (this._deferIndex) { this._indexDirty = true; return; }
    const byType = {};
    for (const k in TYPES) byType[k] = [];
    this.byType = byType;
    this.elevs = [];
    this.stairsAt = new Map();
    this.escAt = new Map();
    this.facs = [];
    this.hotels = [];
    this.byFloor = new Map();
    this.ruins = [];
    this.sites = [];
    for (const o of this.objs.values()) {
      if (o.destroyed) { o.unreachable = false; this.ruins.push(o); continue; }
      if (o.constructUntil > 0) { o.unreachable = false; this.sites.push(o); continue; }
      byType[o.type].push(o);
      if (ELEV.has(o.type)) { this.elevs.push(o); continue; }
      if (o.type === 'stairs' || o.type === 'escalator') {
        const m = o.type === 'stairs' ? this.stairsAt : this.escAt;
        if (!m.has(o.f)) m.set(o.f, []);
        m.get(o.f).push(o);
        continue;
      }
      if (o.type !== 'lobby') this.facs.push(o);
      if (HOTEL.has(o.type)) this.hotels.push(o);
      for (let r = 0; r < o.h; r++) {
        const f = o.f + r;
        if (!this.byFloor.has(f)) this.byFloor.set(f, []);
        this.byFloor.get(f).push(o);
      }
    }
    // 騒音: マンション・ホテルの同じ階 4 マス以内に飲食・映画館・パーティーホール
    for (const o of this.facs) {
      if (o.type !== 'condo' && !HOTEL.has(o.type)) continue;
      o.noisy = false;
      for (const n of this.byFloor.get(o.f) || []) {
        if (!NOISY.has(n.type)) continue;
        const gap = Math.max(n.x - (o.x + o.w), o.x - (n.x + n.w));
        if (gap <= 4) { o.noisy = true; break; }
      }
    }
    // 出入口: 1F のロビーと地下鉄駅（最上段）
    this.entrances = [];
    for (const o of byType.lobby) if (o.f === 0) this.entrances.push({ f: 0, x0: o.x, x1: o.x + o.w, obj: o });
    for (const o of byType.metro) this.entrances.push({ f: o.f + o.h - 1, x0: o.x, x1: o.x + o.w, obj: o, metro: true });
    // 経路グラフと到達不能フラグ（人が行かない設備は対象外）は rebuildGraph で作る
    this.revision++;
    this.rebuildGraph();
    for (const o of byType.lobby) o.unreachable = false;
    this.indexGarbage();
  }
  noVisit(o) { return NO_VISIT.has(o.type); }

  // 出入口（x はその階のどの区画かを決める。省略するといちばん広い区画）
  pickEntranceTo(f, x) {
    let best = null, bd = Infinity;
    for (const e of this.entrances) {
      const d = this.dist(e.f, f, e.x0, x) + this.rand(0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  pickExitFrom(f, x) {
    let best = null, bd = Infinity;
    for (const e of this.entrances) {
      const d = this.dist(f, e.f, x, e.x0) + this.rand(0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  entranceDist(f, x) {
    let bd = Infinity;
    for (const e of this.entrances) bd = Math.min(bd, this.dist(e.f, f, e.x0, x));
    return bd;
  }
  pickVisitorEntrance(f, x) {
    const ok = this.entrances.filter((e) => this.dist(e.f, f, e.x0, x) < Infinity);
    if (!ok.length) return null;
    const metro = ok.filter((e) => e.metro), lobby = ok.filter((e) => !e.metro);
    if (metro.length && lobby.length) return this.pick(this.r() < 0.35 ? metro : lobby);
    return this.pick(ok);
  }
  lobbyEntrance() {
    const l = this.entrances.filter((e) => !e.metro);
    return l.length ? this.pick(l) : null;
  }

  // ================= 人口・★ =================
  recalcPop() {
    this._popDirty = false;
    let pop = 0;
    for (const o of this.byType.office) if (o.occupied) pop += TYPES.office.cap;
    for (const o of this.byType.condo) if (o.occupied) pop += TYPES.condo.cap;
    for (const o of this.hotels) if (o.occupied) pop += o.members.length;
    this.pop = pop;
    this.checkStar();
  }

  starReqs(n) {
    const c = (t) => this.byType[t].length > 0;
    const popReq = (k) => ({ label: `人口 ${STAR_POP[k].toLocaleString('en-US')}人（現在 ${this.pop.toLocaleString('en-US')}人）`, done: this.pop >= STAR_POP[k] });
    switch (n) {
      case 2: return [popReq(2)];
      case 3: return [popReq(3), { label: '警備室', done: c('security') }];
      case 4: return [popReq(4), { label: '医療センター', done: c('medical') }, { label: 'ごみ・リサイクルセンター（ごみが溢れていない）', done: this.garbageOk() },
        { label: 'VIPの高評価', done: this.flags.vipOk }];
      case 5: return [popReq(5), { label: '地下鉄駅', done: c('metro') }];
      case 6: return [{ label: '100Fの大聖堂', done: c('cathedral') }, { label: '大聖堂での結婚式', done: this.tower }];
      default: return [];
    }
  }

  checkStar() {
    while (this.star < 5 && this.starReqs(this.star + 1).every((r) => r.done)) {
      this.star++;
      const unlocked = Object.values(TYPES).filter((t) => t.star === this.star).map((t) => t.name);
      this.msg(`★${this.star} に昇格しました！${unlocked.length ? ` ${unlocked.join('・')}が解放されます` : ''}`, 'star');
      this.emit('star', { star: this.star });
      this.sound('fanfare');
      if (this.star === 2) {
        const d = this.day;
        if (this.flags.nextBomb === null) this.flags.nextBomb = d + 10 + Math.floor(this.rand(10));
        if (this.flags.nextFire === null) this.flags.nextFire = d + 14 + Math.floor(this.rand(10));
      }
    }
  }

  starProgress() {
    if (this.tower) return { star: this.star, next: null, reqs: [] };
    if (this.star >= 5) return { star: 5, next: 'TOWER', reqs: this.starReqs(6) };
    return { star: this.star, next: this.star + 1, reqs: this.starReqs(this.star + 1) };
  }

  // ================= 人 =================
  newPerson(kind, home) {
    const p = {
      id: this.nextPid++, kind, home, state: 'out', stress: 0, f: 0, x: 0,
      legs: null, li: 0, tx: 0, dest: null, loc: null, elev: null, car: null, legObj: null,
      stairT: 0, stairDur: 1, esc: false, waitT: 0, tripT: 0, sWait: 0, sStair: 0,
      task: null, patrol: null, checked: false, name: '', age: 0, job: '',
    };
    this.rollProfile(p);
    return p;
  }

  spotIn(o) { return o.x + 0.5 + this.rand(Math.max(0, o.w - 1)); }

  // 入口のどこから入るか。aimX（行き先の x）があれば、その近くの扉から入る。
  // 横に長いロビーでランダムな位置から入ると、反対端まで歩かされて「歩き」の評価が常に悪くなるため。
  doorX(ent, aimX) {
    const lo = ent.x0 + 0.5, hi = ent.x1 - 0.5;
    if (aimX === undefined || aimX === null || !Number.isFinite(aimX)) return lo + this.rand(Math.max(0, hi - lo));
    return Math.max(lo, Math.min(hi, aimX + this.rand(6) - 3));
  }

  // 入口の階から (f, x) へ向かう人が、どの扉から入るのがよいか。
  // 最初に乗る移動手段（行き先に近いもの）の前の扉。乗り継ぎ不要なら行き先の前の扉。
  doorAim(ent, f, x) {
    const legs = this.route(ent.f, f, this.doorX(ent, x), x);
    if (!legs || !legs.length) return x;
    const leg = legs[0];
    if (leg.kind === 'elev' || leg.kind === 'express') {
      const e = this.pickElevator(leg, x);
      return e ? e.x + e.w / 2 : x;
    }
    const st = this.pickStairs(leg.kind, Math.min(leg.from, leg.to), x, leg);
    return st ? st.x + st.w / 2 : x;
  }

  spawnAt(p, ent, aimX) {
    p.f = ent.f; p.x = this.doorX(ent, aimX);
    p.state = 'walk'; p.loc = null;
    this.active.add(p);
  }

  startTrip(p, f, x, cb) {
    if (p.walking) this.syncX(p);
    const legs = this.route(p.f, f, p.x, x);
    if (!legs) return false;
    if (p.state === 'wait' || p.state === 'ride') this.detach(p);
    if (p.state === 'in' && p.loc) p.loc.inCount--;
    p.loc = null;
    p.stress = 0; p.sWait = 0; p.sStair = 0; p.tripT = 0; p.tripStart = this.time; p.patrol = null;
    p.waitTot = 0; p.walkT = 0; p.sCrowd = 0;
    p.legs = legs; p.li = 0; p.dest = { f, x, cb };
    p.state = 'walk';
    this.active.add(p);
    this.aimNext(p);
    return true;
  }

  reroute(p, depth = 0) {
    if (p.walking) this.syncX(p);
    if (!p.dest || depth > 3) { this.rescue(p); return; }
    const legs = this.route(p.f, p.dest.f, p.x, p.dest.x);
    if (!legs) { this.rescue(p); return; }
    p.legs = legs; p.li = 0; p.state = 'walk';
    this.active.add(p);
    this.aimNext(p, depth + 1);
  }

  aimNext(p, depth = 0) {
    if (p.walking) this.syncX(p);
    if (p.li >= p.legs.length) { p.legObj = null; this.walkTo(p, p.dest.x); return; }
    if (p.swapAt !== p.li || p.swapLegs !== p.legs) this.considerSwap(p);
    const leg = p.legs[p.li];
    if (leg.kind === 'elev' || leg.kind === 'express') {
      const e = this.pickElevator(leg, p.x);
      if (!e) { this.reroute(p, depth); return; }
      p.legObj = e;
      this.walkTo(p, p.x < e.x + e.w / 2 ? e.x - 0.5 : e.x + e.w + 0.5);
    } else {
      const s = this.pickStairs(leg.kind, Math.min(leg.from, leg.to), p.x, leg);
      if (!s) { this.reroute(p, depth); return; }
      p.legObj = s;
      this.walkTo(p, leg.to > leg.from ? s.x + 0.5 : s.x + s.w - 0.5);
    }
  }

  // ---- 歩行は事象駆動: 着く時刻を walkQ に積み、位置は drawPos/curX で計算する ----
  walkTo(p, tx) {
    // 区画の外へは出ない（フロアの切れ目を宙歩きしない）
    const sb = this.segBounds(p.f, p.x);
    if (sb) { const a = sb.x0 + 0.3, b = sb.x1 - 0.3; tx = tx < a ? a : tx > b ? b : tx; }
    p.tx = tx;
    p.walkT0 = this.time;
    p.walking = true;
    const tok = (p.walkTok = (p.walkTok | 0) + 1);
    // 移動距離 0 でも最短の所要時間を置く。同じ時刻に「着く→また歩く」が連鎖して
    // 時間が進まないまま無限ループになるのを防ぐ（ブラウザが固まる原因だった）
    const t = this.time + Math.max(0.05, Math.abs(tx - p.x) / SIM.WALK);
    this.walkQ.push(t, () => this.walkArrive(p, tok));
  }
  curX(p) {
    if (!p.walking) return p.x;
    const d = p.tx - p.x, s = SIM.WALK * (this.time - p.walkT0);
    return d <= s && d >= -s ? p.tx : p.x + (d > 0 ? s : -s);
  }
  syncX(p) {
    if (!p.walking) return;
    this.accrueWalk(p);
    p.x = this.curX(p);
    p.walkT0 = this.time;
  }
  // 歩いた時間とストレス（1回の移動で WALK_GRACE 分を超えた分）
  accrueWalk(p) {
    if (p.patrol) return;
    const seg = this.time - p.walkT0;
    if (seg <= 0) return;
    const before = p.walkT || 0;
    p.walkT = before + seg;
    const over = p.walkT - Math.max(before, SIM.WALK_GRACE);
    if (over > 0) p.stress += SIM.WALK_STRESS * over;
  }
  walkArrive(p, tok) {
    if (p.walkTok !== tok || !p.walking || p.state !== 'walk' || !this.active.has(p)) return;
    this.accrueWalk(p);
    p.x = p.tx; p.walkT0 = this.time; p.walking = false;
    this.reached(p);
  }

  // ---- その場の判断: 近くのエスカレーター・階段と、エレベーターの見込み時間を比べて選び直す ----
  expectElevator(e, a, b, x) {
    const q = e.q[a], k = b > a ? 'up' : 'down';
    const queue = q ? q[k].length : 0;
    const wait = 0.6 + (e.avgWait || 0) * 0.5 + (queue / Math.max(1, e.cars.length)) * 0.2;
    const ride = Math.abs(b - a) / e.vmax + e.doorTime + 0.1;
    return Math.abs(e.x + e.w / 2 - x) / SIM.WALK + wait + ride;
  }

  // a 階から b 階へ、階段・エスカレーターを乗り継ぐ道筋と見込み時間。区画が合わなければ null
  stairChain(a, b, x, toN) {
    const dir = b > a ? 1 : -1, legs = [];
    let t = 0, cx = x;
    for (let f = a; f !== b; f += dir) {
      const low = Math.min(f, f + dir), from = this.nodeOf(f, cx);
      let best = null, bd = Infinity, bk = null;
      for (const [kind, m] of [['esc', this.escAt], ['stairs', this.stairsAt]]) {
        for (const s of m.get(low) || []) {
          if (this.nodeOf(f, s.x) !== from) continue;
          const d = Math.abs(s.x + s.w / 2 - cx) / SIM.WALK + (kind === 'esc' ? SIM.ESC_TIME : SIM.STAIR_TIME + SIM.STAIR_PENALTY);
          if (d < bd) { bd = d; best = s; bk = kind; }
        }
      }
      if (!best) return null;
      t += bd;
      const up = dir > 0;
      cx = up ? best.x + best.w - 0.5 : best.x + 0.5;
      legs.push({ kind: bk, from: f, to: f + dir, fromN: from, toN: this.nodeOf(f + dir, cx) });
    }
    if (toN !== undefined && legs.length && legs[legs.length - 1].toN !== toN) return null;
    return { t, legs };
  }

  considerSwap(p) {
    p.swapAt = p.li;
    const legs = p.legs, leg = legs[p.li];
    if (!leg) return;
    if (leg.kind === 'elev' || leg.kind === 'express') {
      if (Math.abs(leg.to - leg.from) > 4) return;
      const e = this.pickElevator(leg, p.x);
      if (!e) return;
      const chain = this.stairChain(leg.from, leg.to, p.x, leg.toN);
      if (!chain || chain.t >= this.expectElevator(e, leg.from, leg.to, p.x)) return;
      p.legs = legs.slice(0, p.li).concat(chain.legs, legs.slice(p.li + 1));
    } else {
      // 同じ向きに続く階段・エスカレーターをまとめ、エレベーター1本のほうが早ければ乗る
      let j = p.li;
      const dir = Math.sign(leg.to - leg.from);
      while (j + 1 < legs.length && (legs[j + 1].kind === 'stairs' || legs[j + 1].kind === 'esc') && Math.sign(legs[j + 1].to - legs[j + 1].from) === dir) j++;
      const a = leg.from, b = legs[j].to;
      if (Math.abs(b - a) < 2) return;
      const chain = this.stairChain(a, b, p.x, legs[j].toN);
      if (!chain) return;
      let best = null, bt = chain.t;
      for (const type of ['elevator', 'express']) {
        const cand = { kind: type === 'express' ? 'express' : 'elev', from: a, to: b, fromN: leg.fromN, toN: legs[j].toN };
        const e = this.pickElevator(cand, p.x);
        if (!e) continue;
        const t = this.expectElevator(e, a, b, p.x);
        if (t < bt) { bt = t; best = cand; }
      }
      if (best) p.legs = legs.slice(0, p.li).concat([best], legs.slice(j + 1));
    }
    p.swapLegs = p.legs;
  }

  pickElevator(leg, x) {
    const type = leg.kind === 'express' ? 'express' : 'elevator';
    const a = leg.from, b = leg.to, k = dk(b - a);
    let best = null, bs = Infinity;
    for (const e of this.byType[type]) {
      if (!this.serves(e, a, b)) continue;
      if (leg.fromN !== undefined && (this.nodeOf(a, e.x) !== leg.fromN || this.nodeOf(b, e.x) !== leg.toN)) continue;
      const q = e.q[a];
      // 歩く時間（分）と、行列による待ちの見込み（分）を同じ単位で比べる
      const s = Math.abs(e.x + e.w / 2 - x) / SIM.WALK + (q ? q[k].length : 0) / e.cars.length * 0.6;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  pickStairs(kind, f, x, leg) {
    const list = (kind === 'esc' ? this.escAt : this.stairsAt).get(f);
    if (!list) return null;
    let best = null, bd = Infinity;
    for (const s of list) {
      // 経路で決めた区画どうしをつなぐものだけ
      if (leg && leg.fromN !== undefined && (this.nodeOf(leg.from, s.x) !== leg.fromN || this.nodeOf(leg.to, s.x) !== leg.toN)) continue;
      const d = Math.abs(s.x + s.w / 2 - x);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // 歩く人・階段の人だけ毎 tick 動かす（待ち・乗車は minutePass でまとめて更新）
  updatePerson(p, dt) {
    if (p.state !== 'stairs') return;
    p.stairT += dt;
    if (p.stairT >= p.stairDur) {
      const leg = p.legs[p.li], s = p.legObj, up = leg.to > leg.from;
      this.climbers.delete(p);
      p.f = leg.to;
      p.x = up ? s.x + s.w - 0.5 : s.x + 0.5;
      p.li++;
      p.state = 'walk';
      this.aimNext(p);
    }
  }

  reached(p) {
    p.walking = false;
    if (p.patrol) {
      // 巡回: いる区画の中に収めた範囲で、遠いほうの端へ向かう
      // （範囲が区画からはみ出していると端に届かず、同じ場所へ歩き続けていた）
      const pt = p.patrol, sb = this.segBounds(p.f, p.x);
      let a = pt.x0, b = pt.x1;
      if (sb) { a = Math.max(a, sb.x0 + 0.3); b = Math.min(b, sb.x1 - 0.3); }
      if (!(b - a >= 1)) { this.later(5, () => { if (p.patrol && !p.walking && this.active.has(p)) this.reached(p); }); return; }
      this.walkTo(p, Math.abs(p.x - a) > Math.abs(p.x - b) ? a : b);
      return;
    }
    if (!p.legs) { this.leave(p); return; }
    if (p.li >= p.legs.length) { this.finishTrip(p); return; }
    const leg = p.legs[p.li], o = p.legObj;
    if (!o || o.dead) { this.aimNext(p); return; }
    if (ELEV.has(o.type)) {
      // 歩いている間に設定・範囲が変わったかもしれない。止まらない階なら選び直す
      if (!this.serves(o, leg.from, leg.to)) { p.legObj = null; this.aimNext(p); return; }
      const q = o.q[leg.from] || (o.q[leg.from] = { up: [], down: [] });
      q[dk(leg.to - leg.from)].push(p);
      o.qn[FI(leg.from)]++;
      o.waitN++;
      p.state = 'wait'; p.waitT = 0; p.waitStart = this.time; p.stressBase = p.stress; p.elev = o;
    } else {
      p.esc = o.type === 'escalator';
      p.state = 'stairs'; p.stairT = 0;
      this.climbers.add(p);
      p.stairDur = p.esc ? SIM.ESC_TIME : SIM.STAIR_TIME;
      const inc = p.esc ? SIM.ESC_STRESS : SIM.STAIR_STRESS;
      p.stress += inc; p.sStair += inc;
    }
  }

  finishTrip(p) {
    const d = p.dest;
    p.tripT = this.time - p.tripStart;
    this.stats.trips++; this.stats.stress += p.stress; this.stats.tripTime += p.tripT;
    p.legs = null; p.dest = null; p.legObj = null;
    p.state = 'arrived';
    if (d && d.cb) d.cb(p);
    if (p.state === 'arrived') this.leave(p);
  }

  // 移動を続けられない人を目的地へ送る（リーク防止。ストレスは高く記録される）
  rescue(p) {
    this.detach(p);
    p.walking = false; this.climbers.delete(p);
    if (p.patrol) { this.endPatrol(p); return; }
    const d = p.dest;
    if (!d) { this.leave(p); return; }
    this.stats.rescues++;
    p.f = d.f; p.x = d.x;
    p.stress = Math.max(p.stress, 80);
    this.finishTrip(p);
  }

  detach(p) {
    if (p.state === 'wait' && p.elev) {
      const e = p.elev, q = e.q[p.f];
      if (q) {
        for (const k of ['up', 'down']) {
          const i = q[k].indexOf(p);
          if (i >= 0) { q[k].splice(i, 1); e.qn[FI(p.f)]--; e.waitN--; break; }
        }
      }
    } else if (p.state === 'ride' && p.car) {
      const c = p.car, i = c.pass.indexOf(p);
      if (i >= 0) {
        c.pass.splice(i, 1);
        const t = FI(legTo(p));
        if (c.drop[t] > 0) c.drop[t]--;
      }
    }
    p.elev = null; p.car = null;
  }

  settle(p, o) {
    this.active.delete(p);
    p.walking = false; this.climbers.delete(p);
    p.legs = null; p.dest = null; p.patrol = null;
    p.state = 'in'; p.loc = o; o.inCount++;
  }

  // 建物から出る（または消える）
  leave(p, keep = !TRANSIENT.has(p.kind)) {
    this.detach(p);
    if (p.task) this.releaseTask(p);
    if (p.state === 'in' && p.loc) p.loc.inCount--;
    this.active.delete(p);
    p.walking = false; this.climbers.delete(p);
    p.loc = null; p.legs = null; p.dest = null; p.patrol = null;
    p.state = keep ? 'out' : 'gone';
  }
  purge(p, keep = false) { this.leave(p, keep); }

  startPatrol(p, minutes, cb, x0, x1) {
    if (x0 === undefined) {
      const row = this.grid[p.f];
      let a = -1, b = -1;
      for (let x = 0; x < W; x++) if (row[x] !== 0) { if (a < 0) a = x; b = x; }
      x0 = a < 0 ? p.x : a + 0.5; x1 = b < 0 ? p.x : b + 0.5;
    }
    if (p.walking) this.syncX(p);
    p.legs = null; p.dest = null; p.tripT = 0; p.tripStart = this.time;
    const pt = { until: this.time + minutes, cb, x0, x1 };
    p.patrol = pt;
    p.state = 'walk';
    this.active.add(p);
    this.walkTo(p, Math.abs(p.x - x0) > Math.abs(p.x - x1) ? x0 : x1);
    this.at(pt.until, () => { if (p.patrol === pt && p.state === 'walk') this.endPatrol(p); });
  }
  endPatrol(p) {
    this.syncX(p);
    p.walking = false;
    const cb = p.patrol.cb;
    p.patrol = null;
    p.state = 'arrived';
    cb(p);
    if (p.state === 'arrived') this.goHome(p);
  }

  drawPos(p) {
    if (p.state === 'walk') return { x: this.curX(p), f: p.f };
    if (p.state === 'wait') return { x: p.x, f: p.f };
    if (p.state === 'stairs' && p.legs && p.legObj) {
      const leg = p.legs[p.li], s = p.legObj, up = leg.to > leg.from;
      const t = Math.min(1, p.stairT / p.stairDur);
      const xa = up ? s.x + 0.5 : s.x + s.w - 0.5, xb = up ? s.x + s.w - 0.5 : s.x + 0.5;
      return { x: xa + (xb - xa) * t, f: leg.from + (leg.to - leg.from) * t };
    }
    return null;
  }

  // ---- 行動 ----
  exitTrip(p, cb) {
    if (p.walking) this.syncX(p);
    const ent = this.pickExitFrom(p.f, p.x);
    if (!ent) return false;
    if (p.walking) this.syncX(p);
    return this.startTrip(p, ent.f, this.doorX(ent, p.x), cb);
  }

  enterBuilding(p) {
    const h = p.home;
    if (p.state !== 'out' || !h || h.dead) return;
    if ((TENANT.has(h.type) || HOTEL.has(h.type)) && !h.occupied) return;
    const hx = h.x + h.w / 2;
    const ent = this.pickEntranceTo(h.f, hx);
    if (!ent || this.dist(ent.f, h.f, ent.x0, hx) === Infinity) { this.recordEvalValue(h, 100); return; }
    this.spawnAt(p, ent, this.doorAim(ent, h.f, h.x + h.w / 2));
    if (!this.startTrip(p, h.f, this.spotIn(h), (pp) => this.arriveHome(pp))) {
      this.recordEvalValue(h, 100);
      this.leave(p);
    }
  }

  arriveHome(p) {
    const h = p.home;
    if (!h || h.dead || h.destroyed) return; // finishTrip が leave する
    this.recordEval(h, p);
    if (HOTEL.has(h.type)) this.noteStay(h, p);
    this.settle(p, h);
    if (HOTEL.has(h.type) && !p.checked) { p.checked = true; h.checkedIn++; }
  }

  leaveBuilding(p, onExit = null, tries = 0) {
    if (p.state === 'gone' || p.state === 'out') { if (onExit) onExit(p); return; }
    if (p.state !== 'in') {
      if (tries < 30) this.later(10, () => this.leaveBuilding(p, onExit, tries + 1));
      else { this.leave(p); if (onExit) onExit(p); }
      return;
    }
    const home = TRANSIENT.has(p.kind) ? null : p.home;
    const ok = this.exitTrip(p, (pp) => {
      if (home) this.recordEval(home, pp);
      this.leave(pp);
      if (onExit) onExit(pp);
    });
    if (!ok) {
      if (home) this.recordEvalValue(home, 90);
      this.leave(p);
      if (onExit) onExit(p);
    }
  }

  goBack(p) {
    const h = p.home;
    const homeOk = h && !h.dead && !TRANSIENT.has(p.kind) && (!(TENANT.has(h.type) || HOTEL.has(h.type)) || h.occupied);
    if (homeOk && this.startTrip(p, h.f, this.spotIn(h), (pp) => this.arriveHome(pp))) return;
    if (!this.exitTrip(p, (pp) => this.leave(pp))) this.leave(p);
  }

  goHome(p) {
    const h = p.home;
    if (!h || h.dead) { this.leave(p, false); return; }
    if (p.state === 'in' && p.loc === h) return;
    if (!this.startTrip(p, h.f, this.spotIn(h), (pp) => this.settle(pp, h))) {
      this.detach(p);
      if (p.state === 'in' && p.loc) p.loc.inCount--;
      p.f = h.f; p.x = this.spotIn(h);
      this.settle(p, h);
    }
  }

  outing(p, types) {
    if (p.state !== 'in') return;
    let best = null, bc = Infinity;
    for (const t of types) {
      for (const o of this.byType[t]) {
        if (o.burning || !this.isOpen(o)) continue;
        const d = this.dist(p.f, o.f, p.x, o.x + o.w / 2);
        if (d === Infinity) continue;
        const c = d + this.rand(6) + Math.abs(o.x - p.x) * 0.02;
        if (c < bc) { bc = c; best = o; }
      }
    }
    if (!best) return;
    const o = best;
    this.startTrip(p, o.f, this.spotIn(o), (pp) => this.atShop(pp, o));
  }

  visit(o) {
    if (o.dead || o.destroyed || !this.isOpen(o) || o.burning) return;
    const ent = this.pickVisitorEntrance(o.f, o.x + o.w / 2);
    if (!ent) return;
    const p = this.newPerson('visitor', null);
    this.spawnAt(p, ent, this.doorAim(ent, o.f, o.x + o.w / 2));
    if (!this.startTrip(p, o.f, this.spotIn(o), (pp) => this.atShop(pp, o))) this.leave(p);
  }

  atShop(p, o) {
    if (o.dead || o.destroyed) { this.goBack(p); return; }
    this.settle(p, o);
    if (this.isOpen(o)) {
      const pr = TYPES[o.type].price;
      this.earn(pr);
      this.dayLog.shop += pr;
      o.salesToday += pr; o.custToday++;
      this.recordEval(o, p);
    }
    const [a, b] = STAY[o.type] || [20, 20];
    this.later(a + this.rand(b), () => this.afterVisit(p));
  }

  afterVisit(p) {
    if (p.state !== 'in') return;
    this.goBack(p);
  }

  // ================= 時間 =================
  // budgetMs を指定すると、その時間を使い切ったところで止め、残りは backlog として次の呼び出しに持ち越す。
  // UI は毎フレーム sim.step(分, 4) のように呼ぶ（または sim.frameBudgetMs = 4）。
  step(minutes, budgetMs = this.frameBudgetMs) {
    if (this._reemit.length) {
      const l = this._reemit; this._reemit = [];
      for (const pr of l) this.emit('prompt', pr);
    }
    this.backlog += Math.max(0, +minutes || 0);
    const budget = budgetMs > 0 ? budgetMs : 0;
    if (budget && this.backlog > SIM.MAX_BACKLOG) this.backlog = SIM.MAX_BACKLOG; // 追いつけない分は捨てる（ゲームが遅く進む）
    const t0 = now();
    while (this.backlog > 1e-9) {
      const h = Math.min(this.backlog, SIM.TICK);
      this.backlog -= h;
      this.tick(h);
      if (budget && now() - t0 >= budget) break;
    }
    if (this.backlog < 1e-9) this.backlog = 0;
    this.lastStepMs = now() - t0;
    return this.lastStepMs;
  }

  tick(h) {
    this.ensureGraph();
    const t0 = this.time;
    this.time = t0 + h;
    if (Math.floor(this.time / DAY) !== Math.floor(t0 / DAY)) this.newDay();
    if (Math.floor(this.time / 60) !== Math.floor(t0 / 60)) this.hourly(this.hour);
    if (Math.floor(this.time / 5) !== Math.floor(t0 / 5)) this.every5();
    if (Math.floor(this.time) !== Math.floor(t0)) this.minutePass();
    // 1 tick に処理する予定の数に上限を置く（万一の連鎖でも固まらず、残りは次の tick へ）
    const ev = this.events;
    let guard = 200000;
    while (ev.peekT() <= this.time && guard-- > 0) ev.pop().fn();
    const wq = this.walkQ;
    guard = 200000;
    while (wq.peekT() <= this.time && guard-- > 0) wq.pop().fn();
    for (const e of this.elevs) for (const c of e.cars) this.updateCar(e, c, h);
    if (this.climbers.size) for (const p of this.climbers) this.updatePerson(p, h);
    if (this._needReindex) { this._needReindex = false; this.reindex(); this.checkStar(); }
    if (this._popDirty) this.recalcPop();
    if (this.fire) this.fireTick(h);
    if (this.heli) this.updateHeli(h);
    this.truckTick();
    if (this.bomb && !this.bomb.found && this.time >= this.bomb.deadline) this.explodeBomb();
    if (this._xmas || this.santa) this.updateSanta();
  }

  // 1ゲーム分ごと: 待っている人・乗っている人のストレスと時間をまとめて更新し、長すぎる移動を救済する
  minutePass() {
    const t = this.time, late = [];
    for (const e of this.elevs) {
      if (e.waitN) {
        for (const k in e.q) {
          for (const d of ['up', 'down']) {
            for (const p of e.q[k][d]) {
              const w = t - p.waitStart;
              p.waitT = w;
              p.stress = p.stressBase + Math.max(0, w - SIM.WAIT_GRACE) * SIM.WAIT_STRESS;
              if (t - p.tripStart > SIM.TRIP_LIMIT) late.push(p);
            }
          }
        }
      }
      for (const c of e.cars) {
        if (!c.pass.length) continue;
        const crowded = c.pass.length > c.capRef * 0.8;
        for (const p of c.pass) {
          p.rideT = t - p.rideStart;
          if (crowded) { p.stress += SIM.CROWD_STRESS; p.sCrowd += SIM.CROWD_STRESS; }
          if (t - p.tripStart > SIM.TRIP_LIMIT) late.push(p);
        }
      }
    }
    // 歩いている人（巡回中を除く）の長すぎる移動
    if (Math.floor(t) % 5 === 0) {
      for (const p of this.active) if (p.state !== 'wait' && p.state !== 'ride' && !p.patrol && t - p.tripStart > SIM.TRIP_LIMIT) late.push(p);
    }
    for (const p of late) if (this.active.has(p) && !p.patrol) this.rescue(p);
  }

  newDay() {
    this.endDay();
    this.planDay(this.day, this.time);
    this.dailyEvents();
    this.sickToday = 0;
    this.dailyIllness();
    this._xmas = this.isXmasEve();
  }

  endDay() {
    // 維持費
    let cost = 0, tiles = 0;
    for (const e of this.elevs) { cost += this.carMaint(e); e.peakWaitYesterday = e.peakWait; e.peakWaitRecent = Math.max(e.peakWait, (e.peakWaitRecent || 0) * 0.6); e.peakWait = 0; }
    for (const t in SIM.MAINT) cost += this.byType[t].length * SIM.MAINT[t];
    for (let f = MIN_F; f <= MAX_F; f++) { const row = this.grid[f]; for (let x = 0; x < W; x++) if (row[x] !== 0) tiles++; }
    cost += tiles * SIM.FLOOR_MAINT;
    for (const o of this.byType.lobby) cost += o.w * SIM.LOBBY_MAINT;
    if (cost) this.spend(cost);
    // 評価の集計と退去
    const left = [];
    for (const o of this.facs) {
      if (o.evalN) o.eval = o.evalSum / o.evalN;
      else if (!o.occupied || !TENANT.has(o.type)) o.eval *= 0.7;
      o.evalSum = 0; o.evalN = 0;
      o.cWait *= 0.5; o.cStair *= 0.5;
      for (const k in o.rs) o.rs[k] *= 0.5;
      o.salesYesterday = o.salesToday; o.custYesterday = o.custToday;
      o.salesToday = 0; o.custToday = 0;
      if (o.burnt > 0 && !o.burning) o.burnt = Math.max(0, o.burnt - 0.2);
      if (TENANT.has(o.type) && o.occupied) {
        if (this.evalLevel(o) === 'bad') {
          if (++o.badDays >= 2) { this.vacate(o, true); left.push(o); }
        } else o.badDays = 0;
      }
    }
    if (left.length) {
      const names = left.slice(0, 4).map((o) => `${floorName(o.f)}の${TYPES[o.type].name}`).join('、');
      this.msg(`評価が悪いため ${names}${left.length > 4 ? ` ほか${left.length - 4}件` : ''} が退去しました`, 'bad', left[0].f, left[0].x + left[0].w / 2);
    }
    this.yesterday = { ...this.ledger, maintenance: cost };
    this.dailySummary(this.dayLog, cost);
    this.dayLog = this.newDayLog();
    this.ledger = { income: 0, expense: 0 };
    this.recalcPop();
  }

  // 0時に前日のお金と入居の動きをまとめて1件だけ通知する
  dailySummary(L, maint) {
    const y = this.yesterday;
    const inc = [];
    if (L.rent) inc.push(`賃料 ${fmtMoney(L.rent)}`);
    if (L.sale) inc.push(`販売 ${fmtMoney(L.sale)}`);
    if (L.hotel) inc.push(`宿泊 ${fmtMoney(L.hotel)}`);
    if (L.shop) inc.push(`店舗 ${fmtMoney(L.shop)}`);
    const moves = [];
    if (L.inOffice) moves.push(`オフィス${L.inOffice}件`);
    if (L.inCondo) moves.push(`マンション${L.inCondo}件`);
    let text = `昨日の収支 ${fmtMoney(y.income - y.expense)}（収入 ${fmtMoney(y.income)}${inc.length ? `: ${inc.join('・')}` : ''} / 支出 ${fmtMoney(y.expense)}: 維持費 ${fmtMoney(maint)}${L.garbage ? `・ごみ回収 ${fmtMoney(L.garbage)}` : ''}）`;
    if (moves.length) text += `。新しい入居: ${moves.join('・')}`;
    if (L.out) text += `。退去 ${L.out}件${L.buyback ? `（買い戻し ${fmtMoney(L.buyback)}）` : ''}`;
    if (!y.income && !y.expense && !moves.length && !L.out) return;
    this.msg(text, y.income - y.expense < 0 ? 'bad' : 'money');
    if (this.money < 0) this.msg(`資金がマイナスです（${fmtMoney(this.money)}）。収入が入るまで建設できません`, 'bad');
  }

  hourly(h) {
    if (h === 6) this.tenancy(1);
    if (h === 14) this.tenancy(0.5);
    if (h === 12 && !this.isWeekend()) this.collectRent();
    if (h === 16) this.hotelBookings();
    this.spawnVisitors(h);
    this.hourlyGarbage();
    this.updateParking();
    this.hourlyEvents(h);
  }

  every5() {
    this.staffDispatch();
    for (const e of this.elevs) this.updateAvgWait(e);
    if (this.effects.length) this.effects = this.effects.filter((e) => e.t0 + e.dur > this.time);
    if (this.pending.size) this.checkPrompts();
  }

  collectRent() {
    let n = 0;
    for (const o of this.byType.office) if (o.occupied) n++;
    if (!n) return;
    const v = n * TYPES.office.rent;
    this.earn(v);
    this.dayLog.rent += v;
    this.sound('cash');
  }

  vacate(o, counted) {
    if (counted) { this.dayLog.out++; o.vacantUntil = this.time + SIM.BAD_COOLDOWN; }
    if (o.type === 'condo' && o.occupied && SIM.BUYBACK) {
      const v = Math.round(TYPES.condo.sale * SIM.BUYBACK);
      this.spend(v);
      this.dayLog.buyback += v;
    }
    for (const p of o.members.slice()) this.purge(p, false);
    o.members = []; o.occupied = false; o.badDays = 0; o.brand = ''; o.needsParking = 0; o.parkingShort = 0;
    o.evalSum = 0; o.evalN = 0;
  }

  tenancy(scale) {
    if (!this.entrances.length) return;
    const moved = { office: 0, condo: 0 };
    let sale = 0, first = null;
    for (const t of ['office', 'condo']) {
      for (const o of this.byType[t]) {
        if (o.occupied || o.burning) continue;
        const d = this.entranceDist(o.f, o.x + o.w / 2);
        if (d === Infinity) continue;
        let f = d <= 11 ? 1 : d <= 20 ? 0.6 : 0.3;
        if (o.noisy) f *= 0.4;
        if (o.eval >= 45) f *= 0.3;
        if (o.vacantUntil > this.time) continue; // 悪評で退去した直後は入居が決まらない
        f *= this.serviceFactor(o.f);
        const p = (t === 'office' ? SIM.TENANCY.office : SIM.TENANCY.condo) * scale * f;
        if (this.r() < p) {
          this.moveIn(o);
          moved[t]++;
          if (t === 'condo') sale += TYPES.condo.sale;
          first = first || o;
        }
      }
    }
    this.dayLog.inOffice += moved.office;
    this.dayLog.inCondo += moved.condo;
    if (moved.office || moved.condo) {
      // 最初の入居だけはその場で知らせる（以降は 0 時のまとめ）
      if (!this.flags.firstTenant) {
        this.flags.firstTenant = true;
        this.msg(`はじめての入居者が決まりました！ 収支は毎日0時にまとめてお知らせします`, 'good', first.f, first.x + first.w / 2);
      }
      this.sound(sale ? 'cash' : 'ding');
    }
    this.recalcPop();
  }

  // その階に止まるエレベーターの、前日の最大待ち時間に応じた入居のしやすさ
  serviceFactor(f) {
    let w = -1;
    for (const e of this.elevs) if (e.isStop[FI(f)] && f >= e.lo && f <= e.hi) w = w < 0 ? (e.peakWaitRecent || 0) : Math.min(w, e.peakWaitRecent || 0);
    if (w < 0) return 1; // 階段だけ
    return w < 2 ? 1 : w < 5 ? 0.5 : w < 10 ? 0.2 : 0.05;
  }

  moveIn(o) {
    const T = TYPES[o.type];
    this.rollVariant(o);
    this.rollParking(o);
    o.occupied = true; o.badDays = 0; o.evalSum = 0; o.evalN = 0; o.eval = Math.min(o.eval, 30);
    o.members = [];
    const kind = o.type === 'office' ? 'worker' : 'resident';
    for (let i = 0; i < T.cap; i++) o.members.push(this.newPerson(kind, o));
    if (o.type === 'condo') {
      this.earn(T.sale);
      this.dayLog.sale += T.sale;
      for (const p of o.members) this.later(30 + this.rand(300), () => this.enterBuilding(p));
    } else this.planOffice(o, this.day, this.time);
  }

  planDay(day, from) {
    for (const o of this.byType.office) this.planOffice(o, day, from);
    for (const o of this.byType.condo) this.planCondo(o, day, from);
  }

  planOffice(o, day, from) {
    if (!o.occupied || day % 7 >= 5) return;
    const b = day * DAY;
    for (const p of o.members) {
      // 出社は 7:30〜8:45、退社は 17:00〜18:30 に集中する（朝夕のラッシュ）
      const tIn = b + 450 + this.rand(75), tOut = b + 1020 + this.rand(90);
      if (tIn >= from) this.at(tIn, () => this.enterBuilding(p));
      else if (tOut > from + 60 && p.state === 'out') this.at(from + this.rand(30), () => this.enterBuilding(p));
      if (this.r() < 0.6) {
        const t = b + 690 + this.rand(60);
        if (t >= from) this.at(t, () => this.outing(p, LUNCH));
      }
      if (tOut >= from) this.at(tOut, () => this.leaveBuilding(p));
    }
  }

  planCondo(o, day, from) {
    if (!o.occupied) return;
    const b = day * DAY, weekday = day % 7 < 5;
    for (const p of o.members) {
      if (weekday && this.r() < 0.7) {
        const tOut = b + 420 + this.rand(120), tBack = b + 1020 + this.rand(180);
        if (tOut >= from) this.at(tOut, () => this.leaveBuilding(p));
        if (tBack >= from) this.at(tBack, () => this.enterBuilding(p));
        if (this.r() < 0.25) { const t = b + 1230 + this.rand(60); if (t >= from) this.at(t, () => this.outing(p, DINNER)); }
      } else if (this.r() < 0.6) {
        const t = b + 600 + this.rand(480);
        if (t >= from) this.at(t, () => this.outing(p, LEISURE));
      }
    }
  }

  hotelBookings() {
    if (!this.entrances.length) return;
    const d = this.day;
    const demand = Math.min(1, 0.45 + 0.1 * this.star);
    const vipComing = this.vip && this.vip.stage === 'announced';
    for (const o of this.hotels) {
      if (o.occupied || o.dirty || o.infested || o.burning || o.vipHold) continue;
      if (vipComing && o.type === 'hotelSuite') continue; // VIP のために空けておく
      if (this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
      if (this.r() >= 0.75 * demand * this.evalFactor(o)) continue;
      o.occupied = true; o.checkedIn = 0; o.members = [];
      if (o.type === 'hotelSuite') this.rollParking(o);
      const T = TYPES[o.type];
      const n = T.cap > 1 && this.r() < 0.3 ? 1 : T.cap;
      for (let i = 0; i < n; i++) {
        const p = this.newPerson('guest', o);
        o.members.push(p);
        this.later(this.rand(240), () => this.enterBuilding(p));
        if (this.r() < 0.35) this.at(d * DAY + 1140 + this.rand(120), () => this.outing(p, DINNER));
        this.at((d + 1) * DAY + 420 + this.rand(180), () => this.checkout(p));
      }
    }
    this.recalcPop();
  }

  checkout(p) { this.leaveBuilding(p, () => this.guestGone(p)); }

  guestGone(p) {
    const o = p.home;
    if (!o || o.dead) return;
    const i = o.members.indexOf(p);
    if (i >= 0) o.members.splice(i, 1);
    if (!o.members.length && o.occupied) {
      o.occupied = false;
      if (o.checkedIn) this.addReview(o);
      o.needsParking = 0;
      if (o.checkedIn) {
        const pr = TYPES[o.type].price;
        this.earn(pr);
        o.salesToday += pr;
        this.dayLog.hotel += pr;
        o.dirty = true; o.dirtySince = this.time;
      }
      this._popDirty = true;
    }
  }

  spawnVisitors(h) {
    if (!this.entrances.length) return;
    const base = 0.4 + this.pop / 250;
    for (const t of COMMERCE) {
      for (const o of this.byType[t]) {
        if (o.burning || !this.isOpen(o, h)) continue;
        if (t === 'partyHall' && h !== 12 && h !== 18) continue;
        if (this.entranceDist(o.f, o.x + o.w / 2) === Infinity) continue;
        const lam = base * VISIT_RATE[t] * this.evalFactor(o);
        const n = Math.min(VISIT_CAP[t], Math.floor(lam * (0.5 + this.r())));
        for (let i = 0; i < n; i++) this.later(this.rand(55), () => this.visit(o));
      }
    }
  }

  // ================= スタッフ =================
  createStaff(o) {
    const kind = STAFF_KIND[o.type], n = SIM.STAFF[o.type] || 0;
    for (let i = 0; i < n; i++) {
      const p = this.newPerson(kind, o);
      p.f = o.f; p.x = this.spotIn(o);
      this.settle(p, o);
      o.members.push(p);
    }
  }

  releaseTask(p) {
    const t = p.task;
    p.task = null;
    if (!t) return;
    if (t.kind === 'clean' && t.room && t.room.cleaner === p.id) t.room.cleaner = null;
    if (t.kind === 'search' && this.bomb) this.bomb.assigned.delete(t.f);
    if (t.kind === 'fire' && t.obj) t.obj.fighters = Math.max(0, (t.obj.fighters || 0) - 1);
  }

  // ================= 保存 =================
  serialize() {
    const rows = {};
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = this.grid[f];
      let any = false, s = '';
      for (let x = 0; x < W; x++) { const c = row[x] !== 0; any = any || c; s += c ? '1' : '0'; }
      if (any) rows[f] = s.replace(/0+$/, '');
    }
    const objs = [];
    for (const o of this.objs.values()) {
      const s = { id: o.id, type: o.type, f: o.f, x: o.x, w: o.w, h: o.h };
      if (ELEV.has(o.type)) { s.lo = o.lo; s.hi = o.hi; s.cars = o.cars.map((c) => Math.round(c.pos)); s.config = { ...o.config, skip: [...o.config.skip] }; }
      if (o.variant) s.variant = o.variant;
      if (o.brand) s.brand = o.brand;
      if (o.destroyed) s.destroyed = o.destroyed;
      if (o.constructUntil > 0) { s.constructStart = o.constructStart; s.constructUntil = o.constructUntil; }
      if (o.needsParking) { s.needsParking = o.needsParking; s.moveSeq = o.moveSeq; }
      if (o.medShort !== undefined && o.medShort !== null) s.medShort = o.medShort;
      if (o.reviews && o.reviews.length) s.reviews = o.reviews.map((r) => ({ ...r }));
      if (this.hasEval(o)) { s.eval = +o.eval.toFixed(2); s.badDays = o.badDays; }
      if (TENANT.has(o.type) || HOTEL.has(o.type)) s.occupied = !!o.occupied;
      if (HOTEL.has(o.type)) {
        Object.assign(s, { dirty: !!o.dirty, dirtySince: o.dirtySince, infested: !!o.infested, guests: o.members.length, checkedIn: o.checkedIn });
      }
      if (o.burnt) s.burnt = +o.burnt.toFixed(3);
      if (o.complaintUntil > this.time) { s.complaint = o.complaint; s.complaintUntil = o.complaintUntil; }
      if (o.salesToday) { s.salesToday = o.salesToday; s.custToday = o.custToday; }
      objs.push(s);
    }
    return {
      v: SAVE_VERSION, w: W, seed: this.seed, time: this.time, money: this.money, star: this.star, tower: this.tower,
      nextId: this.nextId, ledger: { ...this.ledger }, yesterday: this.yesterday ? { ...this.yesterday } : null,
      dayLog: { ...this.dayLog }, rows, objs, flags: { ...this.flags }, garbageBags: +this.garbageBags.toFixed(2), moveSeqN: this.moveSeqN,
      bomb: this.bomb ? { f: this.bomb.f, x: this.bomb.x, deadline: this.bomb.deadline, searched: [...this.bomb.searched], found: this.bomb.found } : null,
      fire: this.fire ? { start: this.fire.start, nextSpread: this.fire.nextSpread, heli: this.fire.heli, burned: this.fire.burned, saved: this.fire.saved, burning: [...this.fire.burning].map((o) => o.id) } : null,
      heli: this.heli ? { ...this.heli } : null,
      vip: this.vip ? { stage: this.vip.stage, arrive: this.vip.arrive } : null,
      prompts: [...this.pending.values()].map((p) => ({ id: p.id, kind: p.kind, title: p.title, text: p.text, choices: p.choices, data: p.data, deadline: p.deadline })),
      promptSeq: this.promptSeq,
    };
  }

  // v1/v2（横幅150、grid に移動手段の id が入っていた）も読める
  restore(d) {
    if (!d || typeof d !== 'object' || typeof d.v !== 'number') throw new Error('セーブデータが壊れています');
    if (d.v > SAVE_VERSION) throw new Error('新しいバージョンのセーブデータです');
    const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    this.seed = num(d.seed, this.seed) >>> 0;
    this.reset();
    this.rng = makeRng((this.seed ^ Math.floor(num(d.time, 0) * 7)) >>> 0);
    this.time = Math.max(0, num(d.time, 360));
    this.money = num(d.money, START_MONEY);
    this.star = Math.max(1, Math.min(5, num(d.star, 1) | 0));
    this.tower = !!d.tower;
    if (d.ledger) this.ledger = { income: num(d.ledger.income, 0), expense: num(d.ledger.expense, 0) };
    this.yesterday = d.yesterday && typeof d.yesterday === 'object' ? { ...d.yesterday } : null;
    if (d.dayLog && typeof d.dayLog === 'object') for (const k in this.dayLog) this.dayLog[k] = num(d.dayLog[k], 0);
    if (d.flags && typeof d.flags === 'object') Object.assign(this.flags, d.flags);
    // 構造（古いセーブでは移動手段のマスも '1'。そのまま空きフロアとして読む。短い行は右側が空）
    for (const k in d.rows || {}) {
      const f = +k, s = d.rows[k];
      if (!this.grid[f] || typeof s !== 'string') continue;
      for (let x = 0; x < W && x < s.length; x++) if (s[x] === '1') this.grid[f][x] = -1;
    }
    const fits = (f0, f1, x, w) => {
      if (x < 0 || x + w > W || f0 < MIN_F || f1 > MAX_F) return false;
      for (let f = f0; f <= f1; f++) for (let xi = x; xi < x + w; xi++) if (this.grid[f][xi] > 0) return false;
      return true;
    };
    const tfits = (type, x, w, lo, hi) => {
      if (x < 0 || x + w > W || lo < MIN_F || hi > MAX_F) return false;
      for (let f = lo; f <= hi; f++) for (let xi = x; xi < x + w; xi++) if (this.tgrid[f][xi] !== 0) return false;
      return true;
    };
    this._deferIndex = true;
    const elevs = [];
    const oldGarbage = [];
    let oldBags = 0;
    for (let s of Array.isArray(d.objs) ? d.objs : []) {
      try {
        // 旧 recycling は同じ場所の garbage として読む
        if (s && s.type === 'recycling') s = { ...s, type: 'garbage' };
        const T = TYPES[s.type];
        if (!T || typeof s.id !== 'number' || this.objs.has(s.id) || s.type === 'floor') continue;
        if (TRANSPORT.has(s.type)) {
          const lo = ELEV.has(s.type) ? s.lo : s.f, hi = ELEV.has(s.type) ? s.hi : s.f;
          if (typeof lo !== 'number' || typeof hi !== 'number' || !tfits(s.type, s.x, T.w, lo, hi)) continue;
          // 機械室・ピットが他と重なる古いセーブは、その部分だけ書かない
          const cfg = s.config && typeof s.config === 'object' ? {
            skip: Array.isArray(s.config.skip) ? s.config.skip.filter((v) => typeof v === 'number') : [],
            standby: STANDBY.includes(s.config.standby) ? s.config.standby : 'none', rush: !!s.config.rush,
            speed: s.config.speed === 2 ? 2 : 1, door: ['short', 'normal', 'long'].includes(s.config.door) ? s.config.door : 'normal',
          } : null;
          const o = this._placeTransport(s.type, s.x, lo, hi, s.id, Array.isArray(s.cars) ? s.cars.slice(0, T.maxCars) : null, cfg);
          if (ELEV.has(o.type)) elevs.push(o);
          if (num(s.constructUntil, 0) > 0) { o.constructStart = num(s.constructStart, this.time); o.constructUntil = s.constructUntil; }
          continue;
        }
        const h = T.h || 1, w = s.type === 'lobby' ? Math.max(1, s.w | 0) : T.w;
        // 古い1フロアのごみ収集室は、あとで地下に移す
        if (s.type === 'garbage' && (s.f + h - 1 >= 0 || (s.h || 1) !== h)) { oldGarbage.push(s); oldBags += Math.max(0, num(s.bags, 0)); continue; }
        // 幅が変わった施設（例: オフィス 9→10）は、差の分だけ左右にずらして置ける場所を探す
        let sx = s.x;
        if (!fits(s.f, s.f + h - 1, sx, w) && typeof s.w === 'number' && s.w !== w) {
          const dw = Math.abs(w - s.w);
          for (let d = 1; d <= dw && sx === s.x; d++) {
            if (fits(s.f, s.f + h - 1, s.x - d, w)) sx = s.x - d;
            else if (fits(s.f, s.f + h - 1, s.x + d, w)) sx = s.x + d;
          }
        }
        // 旧い幅の garbage（w16）は、置けなければ地下の空きへ移す
        if (s.type === 'garbage' && !fits(s.f, s.f + h - 1, sx, w)) { oldGarbage.push(s); continue; }
        if (!fits(s.f, s.f + h - 1, sx, w)) continue;
        s = { ...s, x: sx };
        const o = this.makeObj(s.type, s.f, s.x, w, h, s.id);
        for (let r = 0; r < h; r++) for (let xi = o.x; xi < o.x + w; xi++) this.grid[o.f + r][xi] = o.id;
        o.eval = num(s.eval, 0); o.badDays = num(s.badDays, 0);
        o.burnt = num(s.burnt, 0);
        const nv = VARIANTS[o.type] ? VARIANTS[o.type].length : 1;
        o.variant = Math.max(0, Math.min(nv - 1, num(s.variant, 0) | 0));
        o.brand = typeof s.brand === 'string' ? s.brand.slice(0, 40) : '';
        if (s.destroyed === 'bomb' || s.destroyed === 'fire') o.destroyed = s.destroyed;
        if (num(s.constructUntil, 0) > 0) { o.constructStart = num(s.constructStart, this.time); o.constructUntil = s.constructUntil; }
        if (Array.isArray(s.reviews) && HOTEL.has(o.type)) {
          o.reviews = s.reviews.filter((r) => r && typeof r.text === 'string').slice(-20)
            .map((r) => ({ stars: Math.max(1, Math.min(5, num(r.stars, 3) | 0)), text: r.text.slice(0, 60), day: num(r.day, 0), name: String(r.name || '宿泊客').slice(0, 20) }));
        }
        if (typeof s.medShort === 'number') o.medShort = s.medShort;
        if (s.needsParking) { o.needsParking = Math.max(0, num(s.needsParking, 0) | 0); o.moveSeq = num(s.moveSeq, 0); this.moveSeqN = Math.max(this.moveSeqN, o.moveSeq); }
        if (o.type === 'garbage') oldBags += Math.max(0, num(s.bags, 0));
        if (s.complaintUntil) { o.complaintUntil = num(s.complaintUntil, 0); o.complaint = String(s.complaint || ''); }
        o.salesToday = num(s.salesToday, 0); o.custToday = num(s.custToday, 0);
        if ((TENANT.has(o.type) || HOTEL.has(o.type)) && !o.destroyed) o.occupied = !!s.occupied;
        if (HOTEL.has(o.type)) {
          o.dirty = !!s.dirty; o.infested = !!s.infested;
          o.dirtySince = s.dirtySince == null ? (o.dirty ? this.time : null) : num(s.dirtySince, this.time);
          o.checkedIn = num(s.checkedIn, 0);
          o._guests = Math.max(1, Math.min(TYPES[o.type].cap, num(s.guests, TYPES[o.type].cap)));
        }
        // 古いセーブには個性がない
        if (!s.brand && !o.destroyed && (COMMERCE.has(o.type) || HOTEL.has(o.type) || (TENANT.has(o.type) && o.occupied))) this.rollVariant(o);
        if (STAFF_KIND[o.type] && !o.destroyed) this.createStaff(o);
      } catch (e) { /* 壊れた項目は読み飛ばす */ }
    }
    // 移動手段の各マスには構造が必要（古いセーブの空中シャフトはフロアとして補う）
    for (const o of this.objs.values()) {
      if (!TRANSPORT.has(o.type)) continue;
      const lo = ELEV.has(o.type) ? o.lo : o.f, hi = ELEV.has(o.type) ? o.hi : o.f + 1;
      for (let f = lo; f <= Math.min(MAX_F, hi); f++) for (let xi = o.x; xi < o.x + o.w; xi++) if (this.grid[f][xi] === 0) this.grid[f][xi] = -1;
    }
    // 古いごみ収集室: 置ける地下に移す（無理なら読み飛ばす）
    for (const s of oldGarbage) {
      let placed = false;
      for (let f = -2; f >= MIN_F && !placed; f--) {
        for (let x = 0; x + TYPES.garbage.w <= W && !placed; x++) {
          // すでにある地下の空きフロアの上だけ（新しく掘らない）
          let bare = true;
          for (let r = 0; r < TYPES.garbage.h && bare; r++) for (let xi = x; xi < x + TYPES.garbage.w; xi++) if (this.cell(f + r, xi) !== -1) { bare = false; break; }
          if (bare && this._planFacility('garbage', TYPES.garbage, { f, x }).ok) { this._place('garbage', f, x, TYPES.garbage.w, TYPES.garbage.h); placed = true; }
        }
      }
    }
    this.garbageBags = Math.max(0, num(d.garbageBags, oldBags));
    this._deferIndex = false;
    this._indexDirty = false;
    // 工事の続き
    for (const o of this.objs.values()) {
      if (!(o.constructUntil > 0)) continue;
      if (o.constructUntil <= this.time) { o.constructStart = 0; o.constructUntil = 0; } else this.queueConstruction(o);
    }
    this.nextId = Math.max(this.nextId, num(d.nextId, 1));
    this.moveSeqN = Math.max(this.moveSeqN, num(d.moveSeqN, 0));
    this.reindex();
    this.repopulate();
    // 事件
    if (d.bomb && typeof d.bomb === 'object') {
      this.bomb = {
        f: num(d.bomb.f, 0), x: num(d.bomb.x, 0), deadline: num(d.bomb.deadline, this.time + 60),
        searched: new Set(Array.isArray(d.bomb.searched) ? d.bomb.searched : []), found: !!d.bomb.found,
        assigned: new Set(), floors: this.builtFloors(),
      };
      if (this.bomb.found) this.later(10, () => { this.bomb = null; });
    }
    if (d.fire && typeof d.fire === 'object') {
      const burning = new Set();
      for (const id of d.fire.burning || []) { const o = this.objs.get(id); if (o && !o.destroyed) { o.burning = true; burning.add(o); } }
      if (burning.size) {
        const o0 = [...burning][0];
        this.fire = { start: num(d.fire.start, this.time), nextSpread: num(d.fire.nextSpread, this.time + 10), heli: d.fire.heli ? 'called' : null, burning,
          burned: num(d.fire.burned, 0), saved: num(d.fire.saved, 0), f: o0.f, x: o0.x + o0.w / 2 };
        this.updateFires();
      }
    }
    if (d.heli && typeof d.heli === 'object' && ['in', 'spray', 'out'].includes(d.heli.phase)) {
      const h = d.heli;
      this.heli = { x: num(h.x, -20), f: num(h.f, 10), phase: h.phase, targetX: num(h.targetX, W / 2), targetF: num(h.targetF, 10), until: num(h.until, this.time + 5), from: num(h.from, -1) };
    } else if (this.fire && this.fire.heli) this.dispatchHeli();
    if (d.vip && d.vip.stage === 'announced' && num(d.vip.arrive, 0) > this.time) {
      this.vip = { stage: 'announced', arrive: d.vip.arrive };
      this.at(d.vip.arrive, () => this.vipArrive());
    } else if (d.vip && !this.flags.vipOk) {
      // 滞在中の VIP は再現しない。翌日以降にもう一度予告する
      this.flags.vipNext = this.day + 1;
    }
    this.promptSeq = Math.max(1, num(d.promptSeq, 1));
    for (const p of Array.isArray(d.prompts) ? d.prompts : []) {
      if (!p || !p.id || !p.kind || !Array.isArray(p.choices) || !p.choices.length) continue;
      if (!p.choices.every((c) => c && typeof c.label === 'string' && 'value' in c)) continue;
      const pr = { id: p.id, kind: p.kind, title: p.title, text: p.text, choices: p.choices, data: p.data || {}, deadline: num(p.deadline, this.time + 60) };
      this.pending.set(pr.id, pr);
      this._reemit.push({ id: pr.id, kind: pr.kind, title: pr.title, text: pr.text, choices: pr.choices });
    }
    const F = this.flags;
    if (typeof F.bombAt === 'number' && F.bombAt > this.time) { const t = F.bombAt; this.at(t, () => { if (F.bombAt === t) this.startBombThreat(); }); } else F.bombAt = null;
    if (typeof F.fireAt === 'number' && F.fireAt > this.time) { const t = F.fireAt; this.at(t, () => { if (F.fireAt === t) this.startFire(); }); } else F.fireAt = null;
    this._xmas = this.isXmasEve();
    this.recalcPop();
    this.planDay(this.day, this.time);
    this.revision++;
    return this;
  }

  // ロード時: 時刻に応じて人を配置し直す
  repopulate() {
    const day = this.day, h = this.time / 60 % 24, weekday = day % 7 < 5, b = day * DAY;
    for (const o of this.byType.office) {
      if (!o.occupied) continue;
      o.members = [];
      for (let i = 0; i < TYPES.office.cap; i++) {
        const p = this.newPerson('worker', o);
        o.members.push(p);
        if (weekday && h >= 9 && h < 17) { p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); }
      }
    }
    for (const o of this.byType.condo) {
      if (!o.occupied) continue;
      o.members = [];
      for (let i = 0; i < TYPES.condo.cap; i++) {
        const p = this.newPerson('resident', o);
        o.members.push(p);
        if (weekday && h >= 9 && h < 17 && this.r() < 0.7) {
          this.at(b + 1020 + this.rand(180), () => this.enterBuilding(p));
        } else { p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); }
      }
    }
    for (const o of this.hotels) {
      if (!o.occupied) continue;
      const n = o._guests || TYPES[o.type].cap;
      delete o._guests;
      o.members = [];
      const coDay = h < 12 ? day : day + 1;
      for (let i = 0; i < n; i++) {
        const p = this.newPerson('guest', o);
        o.members.push(p);
        if (h >= 16 || h < 7 || o.checkedIn) {
          p.f = o.f; p.x = this.spotIn(o); this.settle(p, o); p.checked = true;
        } else {
          this.later(this.rand(120), () => this.enterBuilding(p));
        }
        let t = coDay * DAY + 420 + this.rand(180);
        if (t < this.time) t = this.time + this.rand(60);
        this.at(t, () => this.checkout(p));
      }
      if (!o.checkedIn && o.members.some((p) => p.checked)) o.checkedIn = o.members.filter((p) => p.checked).length;
    }
  }

  builtFloors() {
    const fl = [];
    for (let f = MIN_F; f <= MAX_F; f++) {
      const list = this.byFloor.get(f);
      if (list && list.length) fl.push(f);
    }
    return fl;
  }

  // デバッグ・テスト用: 事件を強制発生
  trigger(kind, opt) {
    switch (kind) {
      case 'bomb': return this.startBombThreat();
      case 'fire': return this.startFire(opt);
      case 'vip': return this.vipAnnounce(true);
      case 'wedding': return this.weddingStart(true);
      case 'roach': return opt ? (this.infest(opt), true) : false;
      case 'complaint': this.complaints(true); return true;
      default: return false;
    }
  }
}

Object.assign(Tower.prototype, RouteMixin, BuildMixin, ElevatorMixin, GarbageMixin, EventsMixin, PanelMixin, PeopleMixin);
export default Tower;
