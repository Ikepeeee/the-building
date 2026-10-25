// node tests/scenario.mjs — シナリオ「海辺のリゾート」を、上手なプレイヤーと普通のプレイヤーで遊ばせてクリア日を測る
import { Tower, AutoPlayer, TYPES, stepTo } from './helpers.mjs';

// 上手なプレイヤー: 最初にホテル3フロア・ハウスキーピング・警備室、1F・2F に浜向けの店、あとは人口を増やす
export class SeasidePlayer extends AutoPlayer {
  setup() {
    const s = this.s;
    s.build('lobby', { f: 0, x: 30, x2: 89 });
    s.build('restaurant', { f: 0, x: 90 });
    s.build('fastfood', { f: 0, x: 114 - 16 + 6 }); // 1F の右端
    super.buildFloor(1);
    s.build('elevator', { f: 0, f2: 1, x: this.shaftX[0][0] });
    this.top = 1;
    this.basement();
    this.special.security = 0;
  }

  roomPlan(f) {
    const s = this.s;
    if (f === 2 && !this.special.hk) return 'service';
    const hotelFloors = this.special.hotelFloors || 0;
    if (s.hotels.length < 46 && hotelFloors < 4 && f % 2 === 1) return 'hotel';
    if (f % 9 === 0) return 'commerce';
    if (this.money() < 350000 || f % 3 === 2) return 'condo';
    return 'office';
  }

  buildFloor(f) {
    if (f === 1) {
      // 2F: 浜から来る観光客向けのショップと飲食
      const s = this.s;
      if (!s.build('floor', { f, x: this.X0, x2: this.X1 }).ok && s.cell(f, this.X0) === 0) return false;
      const [s1, s2, s3] = this.segs;
      this.place('shop', f, s1); this.place('fastfood', f, s2); this.place('shop', f, s3);
      this.log.push(`d${s.day} 2F beach`);
      return true;
    }
    const plan = this.roomPlan(f);
    if (plan === 'service') {
      const s = this.s;
      s.build('floor', { f, x: this.X0, x2: this.X1 });
      if (s.build('housekeeping', { f, x: this.segs[0][0] }).ok) this.special.hk = f;
      if (s.build('security', { f, x: this.segs[1][0] }).ok) this.special.security = f;
      s.build('housekeeping', { f, x: this.segs[2][0] });
      return true;
    }
    return super.buildFloor(f);
  }
}

export function runSeaside(kind, seed, days = 130) {
  const s = new Tower({ seed, scenario: 'seaside', construction: true });
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.choices[p.choices.length - 1].value));
  const story = [];
  s.on('scenario', (e) => story.push([s.day, e.kind, e.title]));
  const ap = kind === 'competent' ? new SeasidePlayer(s) : new AutoPlayer(s);
  // 普通のプレイヤー: シナリオを意識せず、1日1フロアずつ、手元に余裕を残して建てる
  if (kind === 'average') ap.pace = { floorsPerDay: 1, reserve: 250000 };
  ap.setup();
  let clearDay = null, minMoney = Infinity;
  for (let d = 0; d < days && clearDay === null; d++) {
    stepTo(s, d + 1, 1);
    ap.act();
    minMoney = Math.min(minMoney, s.money);
    if (s.scenario.state === 'cleared') clearDay = s.scenario.clearDay - s.scenario.startDay;
  }
  const g = s.scenarioProgress();
  return { kind, seed, clearDay, grade: s.scenario.grade, state: s.scenario.state, minK: Math.round(minMoney / 1000), goals: g.goals.map((x) => (x.value === null ? null : +(+x.value).toFixed(1))), story, sim: s };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const k of ['competent', 'average']) {
    for (const seed of [1, 2, 3]) {
      const r = runSeaside(k, seed);
      console.log(`${k} seed${seed}: ${r.state} ${r.clearDay ?? '-'}日 成績★${r.grade} 最低資金 $${r.minK}k 目標 ${JSON.stringify(r.goals)}`);
    }
  }
}
