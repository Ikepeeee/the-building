// ごみ収集室（Tower.prototype に混ぜ込む）
// テナントが毎時ごみを出し、範囲内（上下 range フロア）の最も空いている収集室にたまる。
// 毎朝5時に回収（1袋ごとに料金。リサイクルセンターがあれば安い）。
import { TYPES, fmtMoney } from './constants.js';
import { HOTEL, COMMERCE, TENANT, SIM } from './rules.js';

const isProducer = (o) => TENANT.has(o.type) || HOTEL.has(o.type) || COMMERCE.has(o.type);

export const GarbageMixin = {
  // reindex の最後に呼ぶ: 各テナントの担当収集室
  indexGarbage() {
    const rooms = this.byType.garbage || [];
    const range = TYPES.garbage.range;
    for (const o of this.facs) {
      if (!isProducer(o)) continue;
      o.gRooms = rooms.filter((g) => Math.abs(g.f - o.f) <= range);
      if (!o.gRooms.length) o.garbageBad = true;
    }
  },

  // 1日あたりのごみ（袋）
  garbagePerDay(o) {
    if (TENANT.has(o.type)) return o.occupied ? SIM.GARBAGE.perDay[o.type] : 0;
    if (HOTEL.has(o.type)) return o.occupied ? SIM.GARBAGE.perDay.hotel : 0;
    if (COMMERCE.has(o.type)) return this.isOpen(o) ? SIM.GARBAGE.perDay.shop : 0;
    return 0;
  },

  hourlyGarbage() {
    const cap = SIM.GARBAGE.cap;
    for (const o of this.facs) {
      if (!isProducer(o)) continue;
      const rooms = o.gRooms || [];
      if (!rooms.length) { o.garbageBad = true; continue; }
      let best = rooms[0];
      for (const g of rooms) if (g.bags < best.bags) best = g;
      const amt = this.garbagePerDay(o) / 24;
      if (best.bags < cap) best.bags = Math.min(cap, best.bags + amt);
      best.fill = best.bags / cap;
      o.garbageBad = rooms.every((g) => g.fill >= 1);
    }
  },

  // 5時: 回収業者が持っていく
  collectGarbage() {
    const fee = this.byType.recycling.length ? SIM.GARBAGE.feeRecycle : SIM.GARBAGE.fee;
    let bags = 0;
    for (const g of this.byType.garbage) { bags += Math.round(g.bags); g.bags = 0; g.fill = 0; }
    if (!bags) return;
    const v = bags * fee;
    this.spend(v);
    this.dayLog.garbage = (this.dayLog.garbage || 0) + v;
    this.dayLog.garbageBags = (this.dayLog.garbageBags || 0) + bags;
    for (const o of this.facs) if (o.gRooms && o.gRooms.length) o.garbageBad = false;
  },

  garbageNote() {
    const L = this.dayLog;
    return L.garbage ? `ごみ回収 ${L.garbageBags}袋 ${fmtMoney(L.garbage)}` : '';
  },
};
