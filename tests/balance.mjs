// node tests/balance.mjs [days] — 素朴なプレイと真面目なプレイの資金・★の推移を測る
import { Tower, AutoPlayer, NaivePlayer, stepTo } from './helpers.mjs';

export function runStrategy(kind, seed, days) {
  const s = new Tower({ seed, construction: true });
  s.on('prompt', (p) => s.answer(p.id, p.kind === 'bomb' ? 'refuse' : p.choices[p.choices.length - 1].value));
  const ap = kind === 'naive' ? new NaivePlayer(s) : new AutoPlayer(s);
  ap.setup();
  let min = Infinity, minDay = 0, star2 = null, star3 = null, out = 0, buyback = 0;
  const money = {};
  s.on('star', (e) => { if (e.star === 2 && star2 === null) star2 = s.day; if (e.star === 3 && star3 === null) star3 = s.day; });
  for (let d = 0; d < days; d++) {
    stepTo(s, d + 1, 0);
    s.step(0.25); // 0時のまとめ
    out += s.dayLog.out; buyback += s.dayLog.buyback; // （新しい日の分は 0）
    stepTo(s, d + 1, 1);
    ap.act();
    if (s.money < min) { min = s.money; minDay = s.day; }
    if ([5, 10, 15, 20, 30, 45, 60].includes(d + 1)) money[d + 1] = Math.round(s.money / 1000);
  }
  return { kind, seed, minK: Math.round(min / 1000), minDay, star2, star3, pop: s.pop, money };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = +process.argv[2] || 30;
  for (const k of ['naive', 'smart']) {
    for (const seed of [1, 2, 3]) {
      const r = runStrategy(k, seed, days);
      console.log(`${k} seed${seed}: 最低 $${r.minK}k (${r.minDay}日目) ★2=${r.star2}日目 ★3=${r.star3}日目 人口${r.pop} 資金(k$)=${JSON.stringify(r.money)}`);
    }
  }
}
