// 経路: (階, 区画) を節点にしたグラフ（Tower.prototype に混ぜ込む）。SPEC §14
// 区画 = 同じ階で構造（grid≠0）が切れ目なく続く範囲。人は区画の中しか歩けない。
// 移動手段は、そのマスが触れている区画どうしをつなぐ。グラフは revision ごとに作り直す（遅延）。
import { W, MIN_F, MAX_F } from './constants.js';
import { SIM } from './rules.js';
import { Heap } from './util.js';

const K_NAMES = { 1: 'elev', 2: 'express', 3: 'stairs', 4: 'esc' };

export const RouteMixin = {
  // ---- 区画 ----
  ensureGraph() {
    if (this._gRev === this.revision && this.gNodes) return;
    this.rebuildGraph();
  },

  rebuildGraph() {
    // 区画
    const segIdx = {}, segs = {}, nodes = [];
    for (let f = MIN_F; f <= MAX_F; f++) {
      const row = this.grid[f], idx = new Int32Array(W).fill(-1), list = [];
      for (let x = 0; x < W;) {
        if (row[x] === 0) { x++; continue; }
        let e = x;
        while (e < W && row[e] !== 0) e++;
        const n = nodes.length;
        nodes.push({ f, x0: x, x1: e });
        list.push(n);
        idx.fill(n, x, e);
        x = e;
      }
      segIdx[f] = idx; segs[f] = list;
    }
    this.segIdx = segIdx; this.segsOf = segs; this.gNodes = nodes;
    // 辺（同じ組は安い方だけ残す）
    const N = nodes.length, C = SIM.COST;
    const edges = new Map();
    const add = (u, v, c, k) => {
      if (u < 0 || v < 0 || u === v) return;
      const key = u * N + v, cur = edges.get(key);
      if (!cur || c < cur.c) edges.set(key, { u, v, c, k });
    };
    for (const e of this.elevs || []) {
      const st = e.stops, exp = e.type === 'express';
      const base = exp ? C.expBase : C.elevBase, per = exp ? C.expPer : C.elevPer, k = exp ? 2 : 1;
      const ns = st.map((f) => this.nodeOf(f, e.x));
      for (let i = 0; i < st.length; i++) {
        for (let j = i + 1; j < st.length; j++) {
          const c = base + per * (st[j] - st[i]);
          add(ns[i], ns[j], c, k); add(ns[j], ns[i], c, k);
        }
      }
    }
    for (const [m, k, c] of [[this.stairsAt, 3, C.stairs], [this.escAt, 4, C.esc]]) {
      if (!m) continue;
      for (const list of m.values()) {
        for (const s of list) {
          const a = this.nodeOf(s.f, s.x), b = this.nodeOf(s.f + 1, s.x);
          add(a, b, c, k); add(b, a, c, k);
        }
      }
    }
    const adj = Array.from({ length: N }, () => []);
    for (const ed of edges.values()) adj[ed.u].push(ed);
    this.gAdj = adj;
    this.rcache = new Map();
    this._gRev = this.revision;
    // 入口の区画と、施設の到達不能フラグ
    for (const en of this.entrances || []) en.n = this.nodeOf(en.f, en.x0);
    if (this.facs) for (const o of this.facs) o.unreachable = !this.noVisit(o) && this.entranceDist(o.f, o.x + o.w / 2) === Infinity;
  },

  // x が無いときは、その階でいちばん広い区画
  nodeOf(f, x) {
    if (f < MIN_F || f > MAX_F || !this.segIdx) return -1;
    if (x === undefined || x === null) {
      let best = -1, bw = -1;
      for (const n of this.segsOf[f]) { const s = this.gNodes[n]; if (s.x1 - s.x0 > bw) { bw = s.x1 - s.x0; best = n; } }
      return best;
    }
    const xi = Math.floor(x);
    if (xi < 0 || xi >= W) return -1;
    return this.segIdx[f][xi];
  },
  // (f, x) の区画の左右端（マス座標、x1 は含まない）
  segBounds(f, x) {
    this.ensureGraph();
    const n = this.nodeOf(f, x);
    return n < 0 ? null : this.gNodes[n];
  },

  routeFromNode(a) {
    let r = this.rcache.get(a);
    if (r) return r;
    const N = this.gNodes.length;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), prevK = new Uint8Array(N);
    const h = new Heap();
    dist[a] = 0;
    h.push(0, a);
    while (h.size) {
      const top = h.pop(), u = top.fn, du = top.t;
      if (du > dist[u]) continue;
      for (const ed of this.gAdj[u]) {
        const d = du + ed.c;
        if (d < dist[ed.v]) { dist[ed.v] = d; prev[ed.v] = u; prevK[ed.v] = ed.k; h.push(d, ed.v); }
      }
    }
    r = { dist, prev, prevK, legs: new Map() };
    this.rcache.set(a, r);
    return r;
  },

  dist(fa, fb, xa, xb) {
    this.ensureGraph();
    const a = this.nodeOf(fa, xa), b = this.nodeOf(fb, xb);
    if (a < 0 || b < 0) return Infinity;
    if (a === b) return 0;
    return this.routeFromNode(a).dist[b];
  },

  // legs: [{kind, from, to, fromN, toN}]。同じ区画なら []、行けなければ null
  route(fa, fb, xa, xb) {
    this.ensureGraph();
    const a = this.nodeOf(fa, xa), b = this.nodeOf(fb, xb);
    if (a < 0 || b < 0) return null;
    if (a === b) return [];
    const r = this.routeFromNode(a);
    if (r.dist[b] === Infinity) return null;
    let legs = r.legs.get(b);
    if (legs) return legs;
    legs = [];
    for (let n = b; n !== a;) {
      const u = r.prev[n];
      legs.push({ kind: K_NAMES[r.prevK[n]], from: this.gNodes[u].f, to: this.gNodes[n].f, fromN: u, toN: n });
      n = u;
    }
    legs.reverse();
    r.legs.set(b, legs);
    return legs;
  },
};
