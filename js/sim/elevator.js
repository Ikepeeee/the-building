// エレベーター: 設定・伸縮・カゴの運動（加速・定速・減速）・配車（Tower.prototype に混ぜ込む）
import { MIN_F, MAX_F, TYPES, floorName } from './constants.js';
import { NF, FI, LOBBY_SET, SIM, isStopFloor } from './rules.js';

const dk = (d) => (d > 0 ? 'up' : 'down');
const legTo = (p) => p.legs[p.li].to;

export const DOOR_TIME = { short: 0.2, normal: 0.35, long: 0.6 };
export const STANDBY = ['none', 'lobby', 'spread'];
// 最高速度（フロア/分）と加速度（フロア/分²）。speed:2（高速モーター）で ×1.6 / ×1.4
export const KIN = { elevator: { vmax: 6, acc: 12 }, express: { vmax: 15, acc: 30 } };
const SUB = 0.04;          // 運動の積分刻み（分）。最高速でも1刻みで1フロア未満しか進まない
const CLAIM_PATIENCE = 4;  // この分数以上待っている呼びは、他のカゴが向かっていても取りに行く

// 既定の通過階: 急行はロビー階と地下階以外のすべて、通常は無し
export const defaultSkip = (type, lo, hi) => {
  const sk = [];
  if (type === 'express') for (let f = lo; f <= hi; f++) if (!isStopFloor(type, f)) sk.push(f);
  return sk;
};
export const defaultElevConfig = (type = 'elevator', lo = 0, hi = 0) => ({ skip: defaultSkip(type, lo, hi), standby: 'none', rush: false, speed: 1, door: 'normal' });
export const countStops = (lo, hi, skip) => { const s = new Set(skip); let n = 0; for (let f = lo; f <= hi; f++) if (!s.has(f)) n++; return n; };

export const ElevatorMixin = {
  initElevator(e) {
    e.f = e.lo; e.h = e.hi - e.lo + 1;
    if (!e.config) e.config = defaultElevConfig(e.type, e.lo, e.hi);
    const cfg = e.config;
    cfg.skip = [...new Set((cfg.skip || []).filter((f) => Number.isInteger(f) && f >= e.lo && f <= e.hi))].sort((a, b) => a - b);
    // 停止階が2つ未満になる古いデータは既定に戻す
    if (countStops(e.lo, e.hi, cfg.skip) < 2) cfg.skip = defaultSkip(e.type, e.lo, e.hi);
    const skip = new Set(cfg.skip);
    e.stops = [];
    e.isStop = new Uint8Array(NF);
    for (let f = e.lo; f <= e.hi; f++) if (!skip.has(f)) { e.stops.push(f); e.isStop[FI(f)] = 1; }
    e.sLo = e.stops[0]; e.sHi = e.stops[e.stops.length - 1];
    const k = KIN[e.type], fast = cfg.speed === 2;
    e.vmax = k.vmax * (fast ? 1.6 : 1);
    e.acc = k.acc * (fast ? 1.4 : 1);
    e.doorTime = DOOR_TIME[cfg.door] ?? DOOR_TIME.normal;
    e.cap = TYPES[e.type].cap;
    if (!e.qn) { e.qn = new Int32Array(NF); e.waitN = 0; }
    if (!e.wSum) { e.wSum = new Float64Array(12); e.wN = new Int32Array(12); e.wb = 0; e.avgWait = 0; e.peakWait = 0; e.peakWaitYesterday = 0; e.peakWaitRecent = 0; }
  },

  // このエレベーターで a 階から b 階へ行けるか
  serves(e, a, b) {
    return !e.dead && a >= e.sLo && a <= e.sHi && b >= e.sLo && b <= e.sHi && e.isStop[FI(a)] === 1 && e.isStop[FI(b)] === 1;
  },

  newCar(e, f) {
    let pos = Math.max(e.sLo, Math.min(e.sHi, Math.round(f)));
    if (!e.isStop[FI(pos)]) pos = this.nearestStop(e, pos);
    return { pos, v: 0, dir: 0, state: 'idle', pass: [], timer: 0, target: null, stopAt: null, parking: false, idleT: 0, capRef: e.cap, drop: new Int16Array(NF) };
  },

  nearestStop(e, f) {
    let best = e.sLo, bd = Infinity;
    for (const s of e.stops) { const d = Math.abs(s - f); if (d < bd) { bd = d; best = s; } }
    return best;
  },

  carMaint(e) { return e.cars.length * SIM.CAR_MAINT[e.type] * (e.config && e.config.speed === 2 ? 2 : 1); },

  // ---- 設定 ----
  setElevatorConfig(e, patch) {
    if (!e || e.dead || !e.cars) return { ok: false, reason: 'エレベーターではありません' };
    if (!patch || typeof patch !== 'object') return { ok: false, reason: '設定が不正です' };
    const cfg = { ...e.config, skip: [...e.config.skip] };
    if ('skip' in patch) {
      if (!Array.isArray(patch.skip)) return { ok: false, reason: 'skip は階の配列です' };
      const sk = [...new Set(patch.skip.map((f) => f | 0))].sort((a, b) => a - b);
      for (const f of sk) if (f < e.lo || f > e.hi) return { ok: false, reason: `${floorName(f)}はこのエレベーターの範囲外です` };
      if (countStops(e.lo, e.hi, sk) < 2) return { ok: false, reason: '停止階が2つ以上必要です' };
      cfg.skip = sk;
    }
    if ('standby' in patch) { if (!STANDBY.includes(patch.standby)) return { ok: false, reason: '待機方法が不正です' }; cfg.standby = patch.standby; }
    if ('rush' in patch) cfg.rush = !!patch.rush;
    if ('speed' in patch) { if (patch.speed !== 1 && patch.speed !== 2) return { ok: false, reason: '速度は 1 か 2 です' }; cfg.speed = patch.speed; }
    if ('door' in patch) { if (!(patch.door in DOOR_TIME)) return { ok: false, reason: 'ドア時間が不正です' }; cfg.door = patch.door; }
    e.config = cfg;
    this.initElevator(e);
    this.reindex();
    this.fixElevatorPeople(e);
    return { ok: true, reason: '' };
  },

  // 範囲や停止階が変わったあとで、続けられない人を降ろして経路を引き直す
  fixElevatorPeople(e) {
    const ok = (f) => f >= e.sLo && f <= e.sHi && e.isStop[FI(f)];
    const redo = [];
    for (const k in e.q) {
      const f = +k;
      for (const d of ['up', 'down']) {
        const line = e.q[k][d], keep = [];
        for (const p of line) {
          if (ok(f) && p.legs && ok(legTo(p))) keep.push(p);
          else { e.qn[FI(f)]--; e.waitN--; p.elev = null; p.state = 'walk'; redo.push(p); }
        }
        e.q[k][d] = keep;
      }
    }
    for (const c of e.cars) {
      const out = c.pos < e.lo - 1e-6 || c.pos > e.hi + 1e-6 || c.pos < e.sLo - 1e-6 || c.pos > e.sHi + 1e-6;
      // 範囲外・端の停止階より外へ向かう乗客がいたら、近くの停止階で降ろす（通過階行きはそのまま降ろせる）
      const bad = out || c.pass.some((p) => legTo(p) < e.sLo || legTo(p) > e.sHi);
      if (c.stopAt !== null && !(c.stopAt >= e.sLo && c.stopAt <= e.sHi)) c.stopAt = null;
      if (c.target !== null && !ok(c.target)) { c.target = null; c.parking = false; }
      if (!bad) continue;
      const f = this.nearestStop(e, Math.round(Math.max(e.lo, Math.min(e.hi, c.pos))));
      const pass = c.pass;
      c.pass = []; c.drop.fill(0);
      Object.assign(c, { pos: f, v: 0, dir: 0, state: 'idle', target: null, stopAt: null, parking: false, timer: 0 });
      for (const p of pass) { p.f = f; p.x = e.x + e.w / 2; p.car = null; p.elev = null; p.state = 'walk'; redo.push(p); }
    }
    // 呼び出し側でグラフを更新してから呼ぶこと
    for (const p of redo) if (p.state === 'walk' && this.active.has(p)) this.reroute(p);
  },

  // ---- 伸縮 ----
  planResize(e, lo, hi) {
    const T = TYPES[e.type];
    lo = lo | 0; hi = hi | 0;
    if (lo > hi) [lo, hi] = [hi, lo];
    const ghost = { x: e.x, w: e.w, lo, hi };
    const fail = (reason) => ({ ok: false, reason, cost: 0, ghost });
    if (lo < MIN_F || hi > MAX_F) return fail('建設範囲の外です');
    if (hi - lo + 1 < 2) return fail('2フロア以上必要です');
    if (hi - lo + 1 > T.maxSpan) return fail(`最大${T.maxSpan}フロアまでです`);
    if (lo === e.lo && hi === e.hi) return fail('範囲が変わっていません');
    const r = this.checkTransportCells(e.type, e.x, e.w, lo, hi, e.id);
    if (r) return fail(r);
    if (countStops(lo, hi, this.resizedSkip(e, lo, hi)) < 2) return fail('停止階が2つ以上必要です');
    const added = Math.max(0, e.lo - lo) + Math.max(0, hi - e.hi);
    const cost = added * SIM.EXTEND_COST[e.type];
    return { ok: true, reason: '', cost, ghost, apply: () => this.applyResize(e, lo, hi) };
  },

  // 伸縮後の通過階: 既存の設定を残し、新しく加わった階は既定（急行ならロビー階・地下階以外は通過）
  resizedSkip(e, lo, hi) {
    const sk = e.config.skip.filter((f) => f >= lo && f <= hi);
    for (const f of defaultSkip(e.type, lo, hi)) if (f < e.lo || f > e.hi) sk.push(f);
    return sk;
  },

  applyResize(e, lo, hi) {
    this.clearTransportCells(e);
    e.config.skip = this.resizedSkip(e, lo, hi);
    e.lo = lo; e.hi = hi;
    this.writeTransportCells(e);
    this.initElevator(e);
    this.reindex();
    this.fixElevatorPeople(e);
  },

  extendElevator(e, dir) {
    const r = this.planResize(e, dir < 0 ? e.lo - 1 : e.lo, dir > 0 ? e.hi + 1 : e.hi);
    if (!r.ok) return { ok: false, reason: r.reason, cost: r.cost };
    if (r.cost > this.money) return { ok: false, reason: '資金が足りません', cost: r.cost };
    this.spend(r.cost);
    r.apply();
    this.sound('build');
    return { ok: true, reason: '', cost: r.cost };
  },

  addCar(e) {
    const T = TYPES[e.type];
    if (e.cars.length >= T.maxCars) return { ok: false, reason: `カゴは最大${T.maxCars}台です` };
    if (this.money < T.carCost) return { ok: false, reason: '資金が足りません' };
    this.spend(T.carCost);
    let best = e.sLo, bd = -1;
    for (const s of e.stops) {
      let d = Infinity;
      for (const c of e.cars) d = Math.min(d, Math.abs(c.pos - s));
      if (d > bd) { bd = d; best = s; }
    }
    e.cars.push(this.newCar(e, best));
    this.sound('build');
    return { ok: true, reason: '', cost: T.carCost };
  },

  removeCar(e) {
    if (e.cars.length <= 1) return { ok: false, reason: 'カゴは最低1台必要です' };
    let ci = 0;
    e.cars.forEach((c, i) => { if (c.pass.length < e.cars[ci].pass.length) ci = i; });
    const c = e.cars.splice(ci, 1)[0];
    const f = this.nearestStop(e, Math.round(c.pos));
    const pass = c.pass; c.pass = [];
    for (const p of pass) this.dropOff(e, p, f);
    this.sound('bulldoze');
    return { ok: true, reason: '' };
  },

  // ---- 運動 ----
  updateCar(e, c, dt) {
    if (c.state === 'doors') {
      c.timer -= dt;
      if (c.timer > 0) return;
      c.state = 'idle';
    }
    if (c.state === 'idle') {
      if (!this.carDecide(e, c)) { c.idleT += dt; return; }
    }
    c.idleT = 0;
    let t = dt;
    while (t > 1e-9 && c.state === 'moving') {
      const h = t < SUB ? t : SUB;
      t -= h;
      this.moveCar(e, c, h);
    }
  },

  moveCar(e, c, h) {
    const a = e.acc, dir = c.dir;
    const end = dir > 0 ? e.sHi : e.sLo;
    if ((end - c.pos) * dir <= 1e-6) { this.arrive(e, c, end, dir); return; }
    // 今の速度から止まれる最初の階 g と、このまま加速したら止まれなくなる階 gN。
    // g〜gN の階をすべて調べる（加速中は1刻みで2階以上進むことがあり、見落とすと乗客の階を通り過ぎる）
    const firstStoppable = (pos, v) => {
      const br = (v * v) / (2 * a);
      let x = dir > 0 ? Math.ceil(pos + br - 1e-6) : Math.floor(pos - br + 1e-6);
      if ((x - pos) * dir < 1e-6) x += dir;
      return (x - end) * dir >= 0 ? end : x;
    };
    const g = firstStoppable(c.pos, c.v);
    const vN = Math.min(e.vmax, c.v + a * h);
    const gN = firstStoppable(c.pos + dir * vN * h, vN);
    for (let f = g; (f - gN) * dir <= 0; f += dir) {
      if (c.stopAt !== null && (f - c.stopAt) * dir >= 0) break;
      if (f === end || this.shouldStop(e, c, f)) { c.stopAt = f; break; }
    }
    if (c.stopAt !== null) {
      const rem = (c.stopAt - c.pos) * dir;
      const v = Math.min(e.vmax, c.v + a * h, Math.sqrt(2 * a * Math.max(0, rem)));
      const step = v * h;
      if (step >= rem - 1e-4) { this.arrive(e, c, c.stopAt, dir); return; }
      c.v = v;
      c.pos += dir * step;
    } else {
      c.v = Math.min(e.vmax, c.v + a * h);
      c.pos += dir * c.v * h;
    }
  },

  arrive(e, c, g, dir) {
    c.pos = g; c.v = 0; c.stopAt = null;
    this.serve(e, c, g, dir);
  },

  passBeyond(c, f, dir) {
    const d = c.drop;
    if (dir > 0) { for (let i = FI(f) + 1; i < NF; i++) if (d[i]) return true; } else { for (let i = FI(f) - 1; i >= 0; i--) if (d[i]) return true; }
    return false;
  },

  callBeyond(e, f, dir) {
    if (!e.waitN) return false;
    const qn = e.qn;
    if (dir > 0) { for (let i = FI(f) + 1, end = FI(e.sHi); i <= end; i++) if (qn[i]) return true; } else { for (let i = FI(f) - 1, end = FI(e.sLo); i >= end; i--) if (qn[i]) return true; }
    return false;
  },

  // その階の呼びの最長待ち時間
  oldestWait(e, g) {
    const q = e.q[g];
    if (!q) return 0;
    let w = 0;
    for (const d of ['up', 'down']) if (q[d].length) w = Math.max(w, this.time - q[d][0].waitStart);
    return w;
  },

  // 他のカゴがその階へ実際に向かっているか（止まっている古い target は数えない）
  claimed(e, c, g) {
    for (const o of e.cars) {
      if (o === c || o.parking || o.target !== g || o.state === 'idle') continue;
      if (o.pass.length >= e.cap) continue;
      return true;
    }
    return false;
  },

  carDecide(e, c) {
    const f = Math.round(c.pos);
    c.pos = f; c.v = 0; c.stopAt = null;
    if (c.pass.length) {
      c.parking = false;
      if (!c.dir) c.dir = Math.sign(legTo(c.pass[0]) - f) || 1;
      if (!this.passBeyond(c, f, c.dir)) c.dir = -c.dir;
      if (c.target !== null && (c.target - f) * c.dir <= 0) c.target = null;
      const q = e.q[f];
      if (q && q[dk(c.dir)].length && c.pass.length < e.cap) { this.serve(e, c, f, c.dir); return false; }
      c.state = 'moving';
      return true;
    }
    if (e.waitN && e.qn[FI(f)] > 0) {
      const q = e.q[f];
      const d = c.dir && q[dk(c.dir)].length ? c.dir : (q.up.length ? 1 : -1);
      c.parking = false;
      this.serve(e, c, f, d);
      return false;
    }
    if (e.waitN) {
      if (c.target !== null && c.target !== f && !c.parking && e.qn[FI(c.target)] > 0) {
        c.dir = Math.sign(c.target - f); c.state = 'moving';
        return true;
      }
      c.target = null; c.parking = false;
      let best = null, bd = Infinity;
      for (const g of e.stops) {
        if (!e.qn[FI(g)]) continue;
        const d = Math.abs(g - f);
        if (d >= bd) continue;
        if (this.claimed(e, c, g) && this.oldestWait(e, g) < CLAIM_PATIENCE) continue;
        bd = d; best = g;
      }
      if (best !== null) {
        c.target = best; c.dir = Math.sign(best - f); c.state = 'moving';
        return true;
      }
    }
    // 呼びがない: 待機場所へ回す
    c.target = null;
    const park = this.standbyFloor(e, c);
    if (park !== null && park !== f) {
      c.target = park; c.parking = true; c.dir = Math.sign(park - f); c.state = 'moving';
      return true;
    }
    c.parking = false;
    c.dir = 0;
    return false;
  },

  standbyFloor(e, c) {
    const cfg = e.config;
    let mode = cfg.standby;
    let lo = e.sLo, hi = e.sHi;
    if (cfg.rush && this.day % 7 < 5) {
      const h = this.hour;
      if (h >= 7 && h < 9) mode = 'lobby';
      else if (h >= 17 && h < 19) { mode = 'spread'; lo = Math.round((e.sLo + e.sHi) / 2); }
    }
    if (mode === 'lobby') {
      for (const s of e.stops) if (LOBBY_SET.has(s)) return s;
      return e.sLo;
    }
    if (mode === 'spread') {
      const st = e.stops.filter((s) => s >= lo && s <= hi);
      if (!st.length) return null;
      const k = e.cars.indexOf(c), n = e.cars.length;
      return st[Math.min(st.length - 1, Math.round(((k + 0.5) / n) * (st.length - 1)))];
    }
    return null;
  },

  shouldStop(e, c, g) {
    const i = FI(g);
    if (c.drop[i]) return true;
    if (!e.isStop[i]) return false;
    if (g <= e.sLo || g >= e.sHi) return true;
    if (c.target === g) return true;
    if (!e.qn[i]) return false;
    const q = e.q[g];
    if (q[dk(c.dir)].length && c.pass.length < e.cap) return true;
    if (!c.pass.length && q[dk(-c.dir)].length && !this.callBeyond(e, g, c.dir)) return true;
    return false;
  },

  serve(e, c, g, dir) {
    if (c.target === g) { c.target = null; c.parking = false; }
    let moved = 0;
    const i = FI(g);
    if (c.drop[i]) {
      const pass = c.pass, stay = [];
      c.pass = stay;
      c.drop[i] = 0;
      for (const p of pass) {
        if (legTo(p) === g) {
          p.f = g; p.x = e.x + e.w / 2; p.car = null; p.elev = null;
          p.li++; p.state = 'walk';
          this.aimNext(p);
          moved++;
        } else stay.push(p);
      }
    }
    if (g >= e.sHi) dir = -1; else if (g <= e.sLo) dir = 1;
    const q = e.q[g];
    if (q && e.qn[i] && e.isStop[i]) {
      if (!c.pass.length && !q[dk(dir)].length && q[dk(-dir)].length && !this.callBeyond(e, g, dir)) dir = -dir;
      const line = q[dk(dir)];
      let n = 0;
      while (n < line.length && c.pass.length < e.cap) {
        const p = line[n++];
        // 待ち時間とそのストレスは乗るときにまとめて確定する
        const w = this.time - p.waitStart, extra = Math.max(0, w - SIM.WAIT_GRACE) * SIM.WAIT_STRESS;
        p.waitT = w; p.stress = p.stressBase + extra; p.sWait += extra;
        e.wSum[e.wb] += w; e.wN[e.wb]++;
        p.waitTot = (p.waitTot || 0) + w;
        p.state = 'ride'; p.car = c; p.rideT = 0; p.rideStart = this.time;
        c.pass.push(p);
        c.drop[FI(legTo(p))]++;
        moved++;
      }
      if (n) { line.splice(0, n); e.qn[i] -= n; e.waitN -= n; }
    }
    c.dir = dir;
    c.state = 'doors';
    c.timer = e.doorTime + moved * SIM.BOARD;
  },

  // 直近1時間（5分×12区間）の平均待ち時間。乗った人＋いま待っている人
  updateAvgWait(e) {
    let sum = 0, n = 0;
    for (let i = 0; i < 12; i++) { sum += e.wSum[i]; n += e.wN[i]; }
    if (e.waitN) {
      for (const k in e.q) for (const d of ['up', 'down']) for (const p of e.q[k][d]) { sum += this.time - p.waitStart; n++; }
    }
    e.avgWait = n ? sum / n : 0;
    if (e.avgWait > e.peakWait) e.peakWait = e.avgWait;
    e.wb = (e.wb + 1) % 12;
    e.wSum[e.wb] = 0; e.wN[e.wb] = 0;
  },
};
