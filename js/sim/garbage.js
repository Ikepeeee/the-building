// ごみ集積所と駐車場（Tower.prototype に混ぜ込む）。SPEC §13
// ごみ: ビル全体のごみを、すべての集積所の合計容量でまとめて受け持つ。各室の bags/fill はその割り振り。
//       毎朝 4:30〜5:30 に収集車（各室の o.truck）が来て、'load' の間に袋が減り、袋の数に比例した料金を払う。
// 駐車場: ★3以上で入居者の一部が車を持つ（o.needsParking）。先に入居した順に台数を割り当てる。
import { DAY, TYPES, fmtMoney } from './constants.js';
import { HOTEL, COMMERCE, TENANT, SIM } from './rules.js';

export const isGarbageProducer = (o) => TENANT.has(o.type) || HOTEL.has(o.type) || COMMERCE.has(o.type);
// 収集車の時間割（その日の分）
const T_IN = 270, T_LOAD = 285, T_OUT = 315, T_END = 330;

export const GarbageMixin = {
  // reindex の最後に呼ぶ
  indexGarbage() {
    const rooms = this.byType.garbage || [];
    this.garbageCap = rooms.length * TYPES.garbage.capacity;
    if (this.garbageBags === undefined) this.garbageBags = 0;
    this.garbageBags = Math.min(this.garbageBags, this.garbageCap);
    this.spreadGarbage();
    this.updateGarbageFlags();
    this.updateParking();
  },

  // 溜まった量を各室に割り振る（収集中の室は truck の進み具合で減る）
  spreadGarbage() {
    const rooms = this.byType.garbage || [];
    const cap = TYPES.garbage.capacity;
    for (const g of rooms) {
      g.bags = this.garbageCap ? this.garbageBags * (cap / this.garbageCap) : 0;
      g.fill = Math.min(1, g.bags / cap);
    }
  },

  // ★4 の条件: センターがあり、ごみが溢れていない
  garbageOk() { return (this.byType.garbage || []).length > 0 && this.garbageProblem() !== 'full'; },

  garbageProblem() {
    if (!(this.byType.garbage || []).length) return 'none';
    return this.garbageBags >= this.garbageCap - 1e-6 ? 'full' : null;
  },

  updateGarbageFlags() {
    const bad = !!this.garbageProblem();
    for (const o of this.facs) if (isGarbageProducer(o)) o.garbageBad = bad && this.producesGarbage(o);
  },

  producesGarbage(o) {
    return TENANT.has(o.type) || HOTEL.has(o.type) ? !!o.occupied : true;
  },

  // 1日あたりのごみ（袋）
  garbagePerDay(o) {
    const P = SIM.GARBAGE.perDay;
    if (TENANT.has(o.type)) return o.occupied ? P[o.type] : 0;
    if (HOTEL.has(o.type)) return o.occupied ? P.hotel : 0;
    if (COMMERCE.has(o.type)) return this.isOpen(o) ? P.shop : 0;
    return 0;
  },

  hourlyGarbage() {
    let amt = 0;
    for (const o of this.facs) if (isGarbageProducer(o)) amt += this.garbagePerDay(o) / 24;
    this.garbageBags = Math.min(this.garbageCap || 0, this.garbageBags + amt);
    if (!this.truckActive) this.spreadGarbage();
    this.updateGarbageFlags();
  },

  // 毎 tick（収集の時間帯だけ動く）
  truckTick() {
    const rooms = this.byType.garbage || [];
    const m = this.time % DAY;
    if (m < T_IN || m >= T_END || !rooms.length) {
      if (this.truckActive) {
        this.truckActive = false;
        for (const g of this.byType.garbage || []) g.truck = null;
        this.spreadGarbage();
      }
      return;
    }
    if (!this.truckActive) {
      this.truckActive = true;
      this.truckStartBags = this.garbageBags;
      this.truckPaid = false;
    }
    let phase, t;
    if (m < T_LOAD) { phase = 'in'; t = (m - T_IN) / (T_LOAD - T_IN); }
    else if (m < T_OUT) { phase = 'load'; t = (m - T_LOAD) / (T_OUT - T_LOAD); }
    else { phase = 'out'; t = (m - T_OUT) / (T_END - T_OUT); }
    for (const g of rooms) g.truck = { phase, t };
    if (phase === 'load') {
      this.garbageBags = Math.max(0, this.truckStartBags * (1 - t));
      this.spreadGarbage();
    } else if (phase === 'out' && !this.truckPaid) {
      this.truckPaid = true;
      const bags = Math.round(this.truckStartBags);
      this.garbageBags = 0;
      this.spreadGarbage();
      this.updateGarbageFlags();
      if (bags) {
        const fee = SIM.GARBAGE.fee;
        const v = bags * fee;
        this.spend(v);
        this.dayLog.garbage = (this.dayLog.garbage || 0) + v;
        this.dayLog.garbageBags = (this.dayLog.garbageBags || 0) + bags;
      }
    }
  },

  garbageNote() {
    const L = this.dayLog;
    return L.garbage ? `ごみ回収 ${L.garbageBags}袋 ${fmtMoney(L.garbage)}` : '';
  },

  // ================= 駐車場 =================
  rollParking(o) {
    o.moveSeq = ++this.moveSeqN;
    o.needsParking = 0;
    if (this.star < 3) return;
    const P = SIM.PARKING.share;
    if (o.type === 'office') { if (this.r() < P.office) o.needsParking = this.r() < 0.3 ? 2 : 1; }
    else if (o.type === 'condo') { if (this.r() < P.condo) o.needsParking = 1; }
    else if (o.type === 'hotelSuite') o.needsParking = 1;
  },

  updateParking() {
    const lots = this.byType.parking || [];
    const spaces = lots.length * TYPES.parking.spaces;
    const users = [];
    for (const o of this.facs) {
      o.parkingShort = 0;
      if (o.needsParking > 0 && o.occupied) users.push(o);
    }
    users.sort((a, b) => (a.moveSeq || 0) - (b.moveSeq || 0));
    let left = spaces, short = 0, used = 0;
    for (const o of users) {
      const got = Math.min(left, o.needsParking);
      left -= got; used += got;
      o.parkingShort = o.needsParking - got;
      short += o.parkingShort;
    }
    this.parkingSpaces = spaces;
    this.parkingUsed = used;
    this.parkingShort = short;
    for (const p of lots) { const u = Math.min(TYPES.parking.spaces, used); p.used = u; used -= u; }
  },
};
