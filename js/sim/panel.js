// 情報パネル: describe(o) / act(o, id)（Tower.prototype に混ぜ込む）
import { TYPES, floorName, fmtMoney } from './constants.js';
import { ELEV, HOTEL, COMMERCE, SIM, KIND_NAME } from './rules.js';
import { STANDBY } from './elevator.js';
import { starText } from './people.js';

const LEVEL_TEXT = { good: '良い', fair: '普通', bad: '悪い' };
const STATE_TEXT = { walk: '歩いている', wait: 'エレベーター待ち', ride: 'エレベーターに乗っている', stairs: '階段を移動中', in: '室内', out: '外出中' };
const DOOR_NEXT = { short: 'normal', normal: 'long', long: 'short' };
const DOOR_TEXT = { short: '短い', normal: '標準', long: '長い' };
const STANDBY_TEXT = { none: 'その場で待機', lobby: 'ロビーで待機', spread: '分散して待機' };
const lv3 = (v, a, b) => (v < a ? 'good' : v < b ? 'fair' : 'bad');

export const PanelMixin = {
  // 評価の内訳（ストレスの原因）
  evalReasons(o) {
    const out = [];
    if (o.unreachable) out.push({ label: 'ロビーから行けない', level: 'bad' });
    const r = o.rs || {};
    if (r.fail >= 0.5) out.push({ label: `たどり着けなかった人がいる（${Math.round(r.fail)}人）`, level: 'bad' });
    if (r.n >= 0.5) {
      const w = r.wait / r.n, st = r.stairs / r.n, wk = r.walk / r.n, cr = r.crowd / r.n;
      out.push({ label: `エレベーター待ち 平均${w.toFixed(1)}分`, level: lv3(w, 1, 3) });
      if (st > 0.5) out.push({ label: `階段の上り下り（ストレス ${st.toFixed(0)}）`, level: lv3(st, 6, 15) });
      out.push({ label: `移動距離 歩き平均${wk.toFixed(1)}分`, level: lv3(wk, 3, 6) });
      if (cr > 0.2) out.push({ label: `エレベーターの混雑（ストレス ${cr.toFixed(1)}）`, level: lv3(cr, 2, 6) });
    }
    if (o.noisy) out.push({ label: '騒音（近くの飲食店・映画館など）', level: 'bad' });
    if (o.garbageBad) out.push({ label: this.garbageProblem() === 'none' ? 'ごみが溜まっている（ごみ集積所がない）' : 'ごみが溜まっている（集積所が満杯）', level: 'bad' });
    if (o.parkingShort > 0) out.push({ label: `駐車場がない（${o.parkingShort}台不足）`, level: 'bad' });
    else if (o.needsParking > 0) out.push({ label: `駐車場 ${o.needsParking}台 確保`, level: 'good' });
    if (HOTEL.has(o.type)) {
      if (o.infested) out.push({ label: 'ゴキブリが出る', level: 'bad' });
      else if (o.dirty) out.push({ label: '未清掃', level: o.cleaner ? 'fair' : 'bad' });
    }
    if (!out.length) out.push({ label: 'まだ利用者がいません', level: 'fair' });
    return out;
  },

  describe(o) {
    if (!o) return null;
    if (o.kind && !o.type) return this.describePerson(o);
    const T = TYPES[o.type];
    if (!T) return null;
    const where = o.h > 1 && !ELEV.has(o.type) ? `${floorName(o.f)}〜${floorName(o.f + o.h - 1)}` : floorName(o.f);
    const stats = [];
    const actions = [];
    let d0warn = null;
    let subtitle = where;
    let title = T.name;
    if (o.brand) { title = o.brand; subtitle = `${T.name}・${where}`; }

    if (o.destroyed) {
      const why = o.destroyed === 'bomb' ? '爆発で破壊されました' : '火災で焼け落ちました';
      actions.push({ id: 'remove', label: '撤去', cost: 0, enabled: true, danger: true });
      return {
        title: T.name, subtitle: `${where}・${why}`, stats: [['状態', `${why}。撤去して建て直してください`]],
        level: 'bad', reasons: [{ label: why, level: 'bad' }], actions, warning: '撤去して建て直してください',
      };
    }

    if (o.constructUntil > 0) {
      const dur = Math.max(1, o.constructUntil - o.constructStart);
      const pct = Math.round(Math.min(1, Math.max(0, (this.time - o.constructStart) / dur)) * 100);
      actions.push({ id: 'remove', label: '撤去', cost: 0, enabled: true, danger: true });
      return {
        title, subtitle: `${T.name}・${where}・工事中`, level: null, actions,
        stats: [['工事', `${pct}%（あと${Math.max(0, Math.ceil(o.constructUntil - this.time))}分）`]],
        construction: { start: o.constructStart, until: o.constructUntil, progress: pct / 100 },
      };
    }
    const level = this.evalLevel(o);
    if (level) stats.push(['評価', LEVEL_TEXT[level]]);

    if (ELEV.has(o.type)) {
      subtitle = `${floorName(o.lo)}〜${floorName(o.hi)}`;
      const cfg = o.config;
      const riders = o.cars.reduce((s, c) => s + c.pass.length, 0);
      stats.push(['カゴ', `${o.cars.length} / ${T.maxCars}台`]);
      stats.push(['定員', `${o.cap}人`]);
      stats.push(['停止階', `${o.stops.length}フロア${cfg.skip.length ? `（通過 ${cfg.skip.map(floorName).join('・')}）` : ''}`]);
      stats.push(['待っている人', `${o.waitN}人`]);
      stats.push(['乗っている人', `${riders}人`]);
      stats.push(['平均待ち時間', `${(o.avgWait || 0).toFixed(1)}分（直近1時間）`]);
      stats.push(['昨日の最大待ち', `${(o.peakWaitYesterday || 0).toFixed(1)}分`]);
      stats.push(['運転', `${STANDBY_TEXT[cfg.standby]}${cfg.rush ? '・ラッシュ運転' : ''}・ドア${DOOR_TEXT[cfg.door]}${cfg.speed === 2 ? '・高速モーター' : ''}`]);
      stats.push(['維持費', `${fmtMoney(this.carMaint(o))}/日`]);
      const up = this.planResize(o, o.lo, o.hi + 1), down = this.planResize(o, o.lo - 1, o.hi);
      actions.push({ id: 'addCar', label: 'カゴを追加', cost: T.carCost, enabled: o.cars.length < T.maxCars && this.money >= T.carCost, danger: false });
      actions.push({ id: 'removeCar', label: 'カゴを減らす', cost: 0, enabled: o.cars.length > 1, danger: false });
      actions.push({ id: 'extendUp', label: '上に1フロア延長', cost: up.cost || SIM.EXTEND_COST[o.type], enabled: up.ok && this.money >= up.cost, danger: false });
      actions.push({ id: 'extendDown', label: '下に1フロア延長', cost: down.cost || SIM.EXTEND_COST[o.type], enabled: down.ok && this.money >= down.cost, danger: false });
      actions.push({ id: 'cfg:standby', label: `待機: ${STANDBY_TEXT[STANDBY[(STANDBY.indexOf(cfg.standby) + 1) % STANDBY.length]]}にする`, cost: 0, enabled: true, danger: false });
      actions.push({ id: 'cfg:rush', label: cfg.rush ? 'ラッシュ運転をやめる' : 'ラッシュ運転にする', cost: 0, enabled: true, danger: false });
      actions.push({ id: 'cfg:door', label: `ドアを${DOOR_TEXT[DOOR_NEXT[cfg.door]]}にする`, cost: 0, enabled: true, danger: false });
      actions.push({ id: 'cfg:speed', label: cfg.speed === 2 ? '標準モーターに戻す' : '高速モーター（維持費2倍）', cost: 0, enabled: true, danger: false });
    } else if (o.type === 'office') {
      subtitle = o.brand ? `オフィス・${where}` : `${where}・空室（入居者募集中）`;
      stats.push(['在室', `${o.inCount} / ${T.cap}人`]);
      stats.push(['賃料', `${fmtMoney(T.rent)}/平日`]);
    } else if (o.type === 'condo') {
      subtitle = o.brand ? `マンション・${where}` : `${where}・販売中`;
      stats.push(['在宅', `${o.inCount} / ${T.cap}人`]);
      stats.push(['販売価格', fmtMoney(T.sale)]);
    } else if (HOTEL.has(o.type)) {
      let st = o.occupied ? (o.vipHold ? 'VIP宿泊中' : '宿泊中') : o.dirty ? '要清掃' : '空室';
      if (o.infested) st += '・ゴキブリ発生';
      subtitle = `${T.name}・${where}・${st}`;
      stats.push(['宿泊料', `${fmtMoney(T.price)}/泊`]);
      stats.push(['宿泊客', `${o.occupied ? o.members.length : 0}人`]);
      stats.push(['清掃', o.dirty ? (o.cleaner ? '清掃中' : '要清掃') : 'きれい']);
      const avg = this.reviewAverage(o);
      if (avg !== null) {
        stats.push(['レビュー', `★${avg.toFixed(1)}（${o.reviews.length}件）`]);
        for (const r of o.reviews.slice(-3).reverse()) stats.push([`${starText(r.stars)} ${r.name}`, r.text]);
      } else stats.push(['レビュー', 'まだありません']);
      actions.push({ id: 'exterminate', label: 'ゴキブリ駆除', cost: SIM.EXTERMINATE, enabled: !!o.infested && this.money >= SIM.EXTERMINATE, danger: false });
    } else if (COMMERCE.has(o.type)) {
      subtitle = `${T.name}・${where}・${this.isOpen(o) ? '営業中' : '準備中'}`;
      stats.push(['営業時間', `${T.open[0]}〜${T.open[1]}時`]);
      stats.push(['店内', `${o.inCount}人`]);
      stats.push(['今日の客数', `${o.custToday}人`]);
      stats.push(['今日の売上', fmtMoney(o.salesToday)]);
      stats.push(['昨日の売上', fmtMoney(o.salesYesterday)]);
    } else if (o.type === 'security') {
      const away = o.members.filter((p) => p.task).length;
      stats.push(['警備員', `${o.members.length}人（出動中 ${away}人）`]);
      stats.push(['担当範囲', `${floorName(Math.max(-10, o.f - SIM.GUARD_RANGE))}〜${floorName(Math.min(99, o.f + SIM.GUARD_RANGE))}`]);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.security)}/日`]);
    } else if (o.type === 'housekeeping') {
      const away = o.members.filter((p) => p.task).length;
      const dirty = this.hotels.filter((h) => h.dirty).length;
      stats.push(['メイド', `${o.members.length}人（清掃中 ${away}人）`]);
      stats.push(['要清掃の客室', `${dirty}室`]);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.housekeeping)}/日`]);
    } else if (o.type === 'garbage') {
      stats.push(['この集積所', `${Math.round(o.bags)} / ${TYPES.garbage.capacity}袋（${Math.round(o.fill * 100)}%）`]);
      stats.push(['ビル全体', `${Math.round(this.garbageBags)} / ${this.garbageCap}袋（${this.byType.garbage.length}室）`]);
      stats.push(['回収', `毎朝4:30〜5:30・1袋 ${fmtMoney(SIM.GARBAGE.fee)}`]);
      if (o.truck) stats.push(['収集車', { in: '到着中', load: '積み込み中', out: '出発' }[o.truck.phase]]);
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.garbage)}/日`]);
      if (this.garbageProblem() === 'full') d0warn = '満杯です。ごみ集積所を増やしてください';
    } else if (o.type === 'parking') {
      stats.push(['駐車場', `使用 ${o.used} / ${TYPES.parking.spaces}台`]);
      stats.push(['ビル全体', `使用 ${this.parkingUsed} / ${this.parkingSpaces}台`]);
      if (this.parkingShort > 0) { stats.push(['不足', `${this.parkingShort}台`]); d0warn = `駐車場が${this.parkingShort}台足りません`; }
      stats.push(['維持費', `${fmtMoney(SIM.MAINT.parking)}/日`]);
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
    let reasons;
    if (this.hasEval(o) && (o.occupied || COMMERCE.has(o.type) || o.rs.n > 0)) {
      reasons = this.evalReasons(o);
      const r = o.rs;
      if (r.n >= 0.5) {
        stats.push(['平均待ち', `${(r.wait / r.n).toFixed(1)}分`]);
        stats.push(['平均の歩き', `${(r.walk / r.n).toFixed(1)}分`]);
        stats.push(['平均ストレス', `${(r.stress / r.n).toFixed(0)}`]);
      }
    }
    if (o.burning) stats.push(['状態', `火災発生中（${Math.round(o.burnt * 100)}%焼損）`]);
    else if (o.burnt > 0.05) stats.push(['焼損', `${Math.round(o.burnt * 100)}%`]);
    if (o.complaintUntil > this.time && o.complaint) stats.push(['苦情', o.complaint.replace(/^[^:]*:\s*/, '')]);
    actions.push({ id: 'remove', label: '撤去', cost: 0, enabled: true, danger: true });
    const d = { title, subtitle, stats, level, actions };
    if (HOTEL.has(o.type)) d.reviews = (o.reviews || []).slice().reverse();
    if (d0warn) d.warning = d0warn;
    if (reasons) d.reasons = reasons;
    if (o.unreachable) { stats.unshift(['⚠ 警告', 'ロビーから行けません']); d.warning = d.warning || 'ロビーから行けません'; }
    return d;
  },

  act(o, id) {
    if (!o || o.dead || !this.objs.has(o.id)) return { ok: false, reason: '対象がありません' };
    const isE = ELEV.has(o.type);
    if (id.startsWith('cfg:')) {
      if (!isE) return { ok: false, reason: 'エレベーターではありません' };
      const cfg = o.config;
      switch (id) {
        case 'cfg:standby': return this.setElevatorConfig(o, { standby: STANDBY[(STANDBY.indexOf(cfg.standby) + 1) % STANDBY.length] });
        case 'cfg:rush': return this.setElevatorConfig(o, { rush: !cfg.rush });
        case 'cfg:door': return this.setElevatorConfig(o, { door: DOOR_NEXT[cfg.door] });
        case 'cfg:speed': return this.setElevatorConfig(o, { speed: cfg.speed === 2 ? 1 : 2 });
        default: return { ok: false, reason: '不明な操作です' };
      }
    }
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

