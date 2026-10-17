// 情報パネル: describe(o) / act(o, id)（Tower.prototype に混ぜ込む）
import { TYPES, floorName, fmtMoney } from './constants.js';
import { ELEV, HOTEL, COMMERCE, SIM, KIND_NAME } from './rules.js';

const LEVEL_TEXT = { good: '良い', fair: '普通', bad: '悪い' };
const STATE_TEXT = { walk: '歩いている', wait: 'エレベーター待ち', ride: 'エレベーターに乗っている', stairs: '階段を移動中', in: '室内', out: '外出中' };

export const PanelMixin = {
  describe(o) {
    if (!o) return null;
    if (o.kind && !o.type) return this.describePerson(o);
    const T = TYPES[o.type];
    if (!T) return null;
    const where = o.h > 1 ? `${floorName(o.f)}〜${floorName(o.f + o.h - 1)}` : floorName(o.f);
    const stats = [];
    const actions = [];
    let subtitle = where;
    const level = this.evalLevel(o);
    if (level) stats.push(['評価', LEVEL_TEXT[level]]);

    if (ELEV.has(o.type)) {
      subtitle = `${floorName(o.lo)}〜${floorName(o.hi)}`;
      const riders = o.cars.reduce((s, c) => s + c.pass.length, 0);
      stats.push(['カゴ', `${o.cars.length} / ${T.maxCars}台`]);
      stats.push(['定員', `${o.cap}人`]);
      stats.push(['停止階', `${o.stops.length}フロア`]);
      stats.push(['待っている人', `${o.waitN}人`]);
      stats.push(['平均待ち時間', `${(o.avgWait || 0).toFixed(1)}分（直近1時間）`]);
      stats.push(['昨日の最大待ち', `${(o.peakWaitYesterday || 0).toFixed(1)}分`]);
      stats.push(['乗っている人', `${riders}人`]);
      stats.push(['維持費', `${fmtMoney(o.cars.length * SIM.CAR_MAINT[o.type])}/日`]);
      const up = this.planExtend(o, 1), down = this.planExtend(o, -1);
      actions.push({ id: 'addCar', label: 'カゴを追加', cost: T.carCost, enabled: o.cars.length < T.maxCars && this.money >= T.carCost, danger: false });
      actions.push({ id: 'removeCar', label: 'カゴを減らす', cost: 0, enabled: o.cars.length > 1, danger: false });
      actions.push({ id: 'extendUp', label: '上に1フロア延長', cost: up.cost || SIM.EXTEND_COST[o.type], enabled: up.ok, danger: false });
      actions.push({ id: 'extendDown', label: '下に1フロア延長', cost: down.cost || SIM.EXTEND_COST[o.type], enabled: down.ok, danger: false });
    } else if (o.type === 'office') {
      subtitle = `${where}・${o.occupied ? '入居中' : '空室（入居者募集中）'}`;
      stats.push(['在室', `${o.inCount} / ${T.cap}人`]);
      stats.push(['賃料', `${fmtMoney(T.rent)}/平日`]);
    } else if (o.type === 'condo') {
      subtitle = `${where}・${o.occupied ? '入居中' : '販売中'}`;
      stats.push(['在宅', `${o.inCount} / ${T.cap}人`]);
      stats.push(['販売価格', fmtMoney(T.sale)]);
      if (o.noisy) stats.push(['騒音', 'あり']);
    } else if (HOTEL.has(o.type)) {
      let st = o.occupied ? (o.vipHold ? 'VIP宿泊中' : '宿泊中') : o.dirty ? '要清掃' : '空室';
      if (o.infested) st += '・ゴキブリ発生';
      subtitle = `${where}・${st}`;
      stats.push(['宿泊料', `${fmtMoney(T.price)}/泊`]);
      stats.push(['宿泊客', `${o.occupied ? o.members.length : 0}人`]);
      stats.push(['清掃', o.dirty ? (o.cleaner ? '清掃中' : '要清掃') : 'きれい']);
      if (o.noisy) stats.push(['騒音', 'あり']);
      actions.push({ id: 'exterminate', label: 'ゴキブリ駆除', cost: SIM.EXTERMINATE, enabled: !!o.infested && this.money >= SIM.EXTERMINATE, danger: false });
    } else if (COMMERCE.has(o.type)) {
      subtitle = `${where}・${this.isOpen(o) ? '営業中' : '準備中'}`;
      stats.push(['営業時間', `${T.open[0]}〜${T.open[1]}時`]);
      stats.push(['店内', `${o.inCount}人`]);
      stats.push(['今日の客数', `${o.custToday}人`]);
      stats.push(['今日の売上', fmtMoney(o.salesToday)]);
      stats.push(['昨日の売上', fmtMoney(o.salesYesterday)]);
    } else if (o.type === 'security') {
      const away = o.members.filter((p) => p.task).length;
      stats.push(['警備員', `${o.members.length}人（出動中 ${away}人）`]);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.security)}/日`]);
    } else if (o.type === 'housekeeping') {
      const away = o.members.filter((p) => p.task).length;
      const dirty = this.hotels.filter((h) => h.dirty).length;
      stats.push(['メイド', `${o.members.length}人（清掃中 ${away}人）`]);
      stats.push(['要清掃の客室', `${dirty}室`]);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.housekeeping)}/日`]);
    } else if (o.type === 'lobby') {
      stats.push(['幅', `${o.w}マス`]);
      if (o.f === 0) stats.push(['役割', '出入口']);
    } else if (o.type === 'metro') {
      stats.push(['役割', '第2の出入口']);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.metro)}/日`]);
    } else if (o.type === 'cathedral') {
      stats.push(['結婚式', this.tower ? '挙式済み' : this.star >= 5 ? '毎週土日 11時' : '★5で開催']);
    } else if (o.type === 'stairs' || o.type === 'escalator') {
      subtitle = `${floorName(o.f)}〜${floorName(o.f + 1)}`;
    } else if (SIM.MAINT[o.type]) {
      stats.push(['維持費', `${fmtMoney(SIM.MAINT[o.type])}/日`]);
    }
    if (o.burning) stats.push(['状態', `火災発生中（${Math.round(o.burnt * 100)}%焼損）`]);
    else if (o.burnt > 0.05) stats.push(['焼損', `${Math.round(o.burnt * 100)}%`]);
    if (o.complaintUntil > this.time && o.complaint) stats.push(['苦情', o.complaint.replace(/^[^:]*:\s*/, '')]);
    actions.push({ id: 'remove', label: '撤去', cost: 0, enabled: true, danger: true });
    const d = { title: T.name, subtitle, stats, level, actions };
    if (o.unreachable) { stats.unshift(['⚠ 警告', 'ロビーから行けません']); d.warning = 'ロビーから行けません'; }
    return d;
  },

  describePerson(p) {
    const stats = [['ストレス', `${Math.round(p.stress)}`], ['状態', STATE_TEXT[p.state] || p.state]];
    if (p.home && TYPES[p.home.type]) stats.push(['所属', `${floorName(p.home.f)}の${TYPES[p.home.type].name}`]);
    if (p.dest) stats.push(['行き先', floorName(p.dest.f)]);
    const lv = p.stress < 30 ? 'good' : p.stress < 60 ? 'fair' : 'bad';
    return { title: KIND_NAME[p.kind] || '人', subtitle: floorName(Math.round(p.f)), stats, level: lv, actions: [] };
  },

  act(o, id) {
    if (!o || o.dead || !this.objs.has(o.id)) return { ok: false, reason: '対象がありません' };
    const isE = ELEV.has(o.type);
    switch (id) {
      case 'addCar': return isE ? this.addCar(o) : { ok: false, reason: 'エレベーターではありません' };
      case 'removeCar': return isE ? this.removeCar(o) : { ok: false, reason: 'エレベーターではありません' };
      case 'extendUp': return isE ? this.extendElevator(o, 1) : { ok: false, reason: 'エレベーターではありません' };
      case 'extendDown': return isE ? this.extendElevator(o, -1) : { ok: false, reason: 'エレベーターではありません' };
      case 'exterminate': return HOTEL.has(o.type) ? this.exterminate(o) : { ok: false, reason: 'ホテルではありません' };
      case 'remove':
        this.removeObj(o);
        this.sound('bulldoze');
        return { ok: true, reason: '' };
      default: return { ok: false, reason: '不明な操作です' };
    }
  },
};

