// シミュレーション用の小さなユーティリティ（DOM 非依存）

// 時刻つきイベントの最小ヒープ。同時刻は登録順に実行する（決定性のため）。
export class Heap {
  constructor() { this.a = []; this.seq = 0; }
  get size() { return this.a.length; }
  clear() { this.a = []; }
  peekT() { return this.a.length ? this.a[0].t : Infinity; }
  push(t, fn) {
    const a = this.a, n = { t, s: this.seq++, fn };
    let i = a.length;
    a.push(n);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (lt(a[j], n)) break;
      a[i] = a[j]; i = j;
    }
    a[i] = n;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      const len = a.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1;
        if (l < len && lt(a[l], last)) m = l;
        if (r < len && lt(a[r], m < 0 ? last : a[l])) m = r;
        if (m < 0) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
}
const lt = (x, y) => x.t < y.t || (x.t === y.t && x.s < y.s);

// mulberry32: 速くて十分な品質のシード付き乱数
export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
