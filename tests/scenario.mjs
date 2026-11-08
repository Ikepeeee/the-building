// node tests/scenario.mjs [-v] — シナリオ「海辺のリゾート」を、上手なプレイヤーと普通のプレイヤーで遊ばせてクリア日を測る
// どちらもオフィスは建てない（ホテル・浜の店・専用施設・別荘のマンション）
import { Tower, AutoPlayer, TYPES, stepTo } from './helpers.mjs';

export class SeasidePlayer extends AutoPlayer {
  constructor(sim, skill = 'competent') {
    super(sim);
    this.skill = skill;
    if (skill === 'average') this.pace = { floorsPerDay: 1, reserve: 400000 };
  }

  setup() {
    const s = this.s;
    s.build('lobby', { f: 0, x: 30, x2: 89 });
    s.build('restaurant', { f: 0, x: 90 });
    s.build('floor', { f: 0, x: 114, x2: 160 });
    s.build('umiNoIe', { f: 0, x: 120 });
    s.build('umiNoIe', { f: 0, x: 136 }); // 海の家は並べて（デザイン違い）
    this.buildFloor(1);
    s.build('elevator', { f: 0, f2: 1, x: this.shaftX[0][0] });
    this.top = 1;
    this.basement();
  }

  roomPlan(f) {
    const s = this.s, sp = this.special;
    if (!sp.hk && f >= 2) return 'service';
    // ファミリールーム（★2 から、★4 の条件は10室）
    if (s.star >= 2 && s.byType.hotelFamily.length < 10 && this.money() > (this.skill === 'average' ? 800000 : 500000)) return 'family';
    if (s.hotels.length < 48 && f % 2 === 1 && ((sp.hotelFloors || 0) < 4 || s.hotels.length < 44)) return 'hotel';
    if (!sp.onsen && s.star >= 2 && this.money() > (this.skill === 'average' ? 1200000 : 500000)) return 'onsen';
    const avg = this.skill === 'average';
    if (!sp.aquarium && s.star >= 3 && this.money() > (avg ? 2600000 : 900000)) return 'aquarium';
    // 上手なプレイヤーは、資金に余裕があればさらに人を呼ぶ（水族館・店のフロア）
    if (avg && sp.aquarium && s.byType.aquarium.length < 2 && this.money() > 3500000) return 'aquarium';
    // 普通のプレイヤーも、かなり余裕ができたら店のフロアを足す
    if (avg && sp.aquarium && this.money() > 3500000 && f % 3 === 1) return 'commerce';
    if (!avg && this.money() > 1500000) {
      if (sp.aquarium && s.byType.aquarium.length < 3 && f % 3 === 0) return 'aquarium';
      if (f % 3 === 1) return 'commerce';
    }
    return 'condo';
  }

  buildFloor(f) {
    const s = this.s;
    if (f === 1) {
      // 2F: 浜から来る観光客向けのショップと飲食
      if (!s.build('floor', { f, x: this.X0, x2: this.X1 }).ok && s.cell(f, this.X0) === 0) return false;
      const [s1, s2, s3] = this.segs;
      this.place('shop', f, s1); this.place('fastfood', f, s2); this.place('shop', f, s3);
      this.log.push(`d${s.day} 2F beach`);
      return true;
    }
    const plan = this.roomPlan(f);
    if (plan === 'family') {
      if (!s.build('floor', { f, x: this.X0, x2: this.X1 }).ok && s.cell(f, this.X0) === 0) return false;
      for (const seg of this.segs) this.place('hotelFamily', f, seg);
      this.log.push(`d${s.day} ${f + 1}F family`);
      return true;
    }
    if (plan === 'service' || plan === 'onsen' || plan === 'aquarium') {
      const r = s.build('floor', { f, x: this.X0, x2: this.X1 });
      if (!r.ok && s.cell(f, this.X0) === 0) return false;
      if (plan === 'service') {
        if (s.build('housekeeping', { f, x: this.segs[0][0] }).ok) this.special.hk = f;
        s.build('housekeeping', { f, x: this.segs[2][0] });
      } else if (plan === 'onsen') {
        if (s.build('onsen', { f, x: 60 }).ok) this.special.onsen = f;
      } else if (s.build('aquarium', { f, x: 60 }).ok) this.special.aquarium = f;
      this.log.push(`d${s.day} ${f + 1}F ${plan}`);
      return true;
    }
    return super.buildFloor(f);
  }

  act() {
    super.act();
    const s = this.s;
    // 上手なプレイヤーは、爆発・火災で壊れた施設をすぐ建て直す
    if (this.skill !== 'average') {
      for (const o of [...s.ruins]) {
        const { type, f, x } = o;
        if (this.money() < (TYPES[type].cost || 0) + 150000) continue; // 建て直せるようになってから
        s.act(o, 'remove');
        s.build(type, { f, x });
      }
    }
    // 浜辺の屋外施設: テラスカフェ（★2）と遊園地（★4）
    if (s.star >= 2 && !s.byType.terraceCafe.length && this.money() > (this.skill === 'average' ? 600000 : 250000)) s.build('terraceCafe', { f: 0, x: 161 });
    if (s.star >= 4 && !s.byType.amusement.length && this.money() > (this.skill === 'average' ? 3500000 : 2300000)) s.build('amusement', { f: 0, x: 180 });
    // ★2 で警備室（台風と★3 の条件）
    if (s.star >= 2 && !s.byType.security.length && this.money() > 200000) {
      for (let f = 2; f <= this.top; f++) if (s.build('security', { f, x: 74 }).ok || s.build('security', { f, x: 98 }).ok) break;
    }
  }
}

export function runSeaside(kind, seed, days = 130) {
  const s = new Tower({ seed, scenario: 'seaside', construction: true });
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.choices[p.choices.length - 1].value));
  const story = [];
  s.on('scenario', (e) => story.push([s.day, e.kind, e.title]));
  const ap = new SeasidePlayer(s, kind);
  ap.setup();
  let clearDay = null, minMoney = Infinity;
  const trace = [];
  for (let d = 0; d < days && clearDay === null; d++) {
    stepTo(s, d + 1, 1);
    ap.act();
    minMoney = Math.min(minMoney, s.money);
    if ((d + 1) % 15 === 0) trace.push(`d${d + 1}:★${s.star} 来訪${Math.round(s.visitorsPerDay)} 客室${s.hotels.length} $${Math.round(s.money / 1000)}k`);
    if (s.scenario.state === 'cleared') clearDay = s.scenario.clearDay - s.scenario.startDay;
  }
  const g = s.scenarioProgress();
  return {
    kind, seed, clearDay, grade: s.scenario.grade, state: s.scenario.state, minK: Math.round(minMoney / 1000), star: s.star,
    offices: s.byType.office.length, goals: g.goals.map((x) => (x.value === null ? null : +(+x.value).toFixed(1))), story, trace, sim: s,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const k of ['competent', 'average']) {
    for (const seed of [1, 2, 3]) {
      const r = runSeaside(k, seed);
      console.log(`${k} seed${seed}: ${r.state} ${r.clearDay ?? '-'}日 成績★${r.grade} ★${r.star} オフィス${r.offices} 最低資金 $${r.minK}k 目標 ${JSON.stringify(r.goals)}`);
      if (process.argv[2] === '-v') console.log('   ', r.trace.join(' '));
    }
  }
}
