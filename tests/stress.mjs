// node tests/stress.mjs [seeds] [minutes] — エレベーターが固まらないかの長めのストレステスト
import { elevatorStress } from './helpers.mjs';
const seeds = +process.argv[2] || 30, minutes = +process.argv[3] || 600;
let bad = 0, trips = 0;
const t0 = performance.now();
for (let seed = 1; seed <= seeds; seed++) {
  const r = elevatorStress(seed, minutes, { burst: seed % 2 === 0 });
  trips += r.trips;
  if (r.problems.length) { bad++; console.log('seed', seed, r.problems.slice(0, 3).join(' | ')); }
}
console.log(`${seeds}シード × ${minutes}分: 問題 ${bad}件, 到着 ${trips}回, ${((performance.now() - t0) / 1000).toFixed(1)}秒`);
process.exit(bad ? 1 : 0);
