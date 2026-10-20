// 一括コピー:
//  1) 範囲をドラッグ、または施設をクリック／タップして選ぶ（選んだ施設は view.marked でチェックマーク表示）
//  2) 「貼り付けへ」で貼り付けモード。既定ではコピー元と同じ横位置に固定し、上下だけ動かす
//     （PC は Shift を押している間、スマホは「横も動かす」で自由に動かせる）
//  3) クリック（スマホは ✓）で建てる
import { W, MIN_F, MAX_F, fmtMoney } from '../sim/constants.js';

const shiftP = (p, a) => {
  const q = { ...p };
  for (const k of ['f', 'f2', 'lo', 'hi']) if (q[k] != null) q[k] += a.f;
  for (const k of ['x', 'x2']) if (q[k] != null) q[k] += a.x;
  // エレベーターの停止階設定も一緒にずらす
  if (q.config && Array.isArray(q.config.skip)) q.config = { ...q.config, skip: q.config.skip.map((f) => f + a.f) };
  return q;
};

export class CopyTool {
  constructor(app) {
    this.app = app;
    this.marked = new Set();
    this.freeX = false; // スマホの「横も動かす」
    this.reset();
  }

  /** keepMarks: 貼り付けから選択に戻るとき、選んだ施設は残す */
  reset(keepMarks) {
    if (!keepMarks) this.marked = new Set();
    this.phase = 'select';
    this.bp = null;
    this.anchor = null;
    this.ops = null;
    this.res = null;
    this.ghosts = null;
  }

  get isDrag() { return this.phase === 'select'; }
  get supported() { const s = this.app.sim; return !!(s && s.blueprint && s.checkBatch && s.buildBatch); }

  rect(a, b) {
    const c = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    return { f1: c(Math.min(a.f, b.f), MIN_F, MAX_F), f2: c(Math.max(a.f, b.f), MIN_F, MAX_F), x1: c(Math.min(a.x, b.x), 0, W - 1), x2: c(Math.max(a.x, b.x), 0, W - 1) };
  }

  selectGhost(a, b) {
    const r = this.rect(a, b);
    const w = r.x2 - r.x1 + 1, h = r.f2 - r.f1 + 1;
    return { x: r.x1, w, f: r.f1, h, ok: true, label: `コピー範囲 ${w}マス×${h}階` };
  }

  // ---------- 施設ごとの選択 ----------
  toggle(id) {
    if (this.marked.has(id)) this.marked.delete(id); else this.marked.add(id);
    this.marked = new Set(this.marked); // renderer に変化が伝わるよう新しい Set にする
  }

  /** 範囲内に丸ごと入っている施設・移動手段を選択に加える。加えた数を返す */
  markRange(a, b) {
    const r = this.rect(a, b);
    const sim = this.app.sim;
    let n = 0;
    const next = new Set(this.marked);
    for (const o of sim.objs.values()) {
      if (o.destroyed) continue;
      const lo = o.lo ?? o.f, hi = o.hi ?? o.f + (o.h || 1) - 1;
      if (o.x >= r.x1 && o.x + o.w - 1 <= r.x2 && lo >= r.f1 && hi <= r.f2 && !next.has(o.id)) { next.add(o.id); n++; }
    }
    this.marked = next;
    return n;
  }

  clearMarks() { this.marked = new Set(); }

  /** 選んだ施設の外枠 */
  marksBox() {
    const sim = this.app.sim;
    let x1 = Infinity, x2 = -Infinity, f1 = Infinity, f2 = -Infinity;
    for (const id of this.marked) {
      const o = sim.objs.get(id);
      if (!o) continue;
      const lo = o.lo ?? o.f, hi = o.hi ?? o.f + (o.h || 1) - 1;
      x1 = Math.min(x1, o.x); x2 = Math.max(x2, o.x + o.w - 1); f1 = Math.min(f1, lo); f2 = Math.max(f2, hi);
    }
    return x1 === Infinity ? null : { x1, x2, f1, f2 };
  }

  /** 選んだ施設から設計図を作って貼り付けモードへ */
  startPasteMarked() {
    const app = this.app, sim = app.sim;
    for (const id of [...this.marked]) if (!sim.objs.has(id)) this.marked.delete(id);
    if (!this.marked.size) { app.toasts.show({ text: 'コピーする施設を選んでください', kind: 'info' }); return false; }
    const box = this.marksBox();
    let bp = null;
    try {
      bp = typeof sim.blueprintOf === 'function' ? sim.blueprintOf([...this.marked]) : sim.blueprint(box);
    } catch (e) { app.reportError(e, 'sim.blueprintOf'); }
    if (!bp || !Array.isArray(bp.ops) || !bp.ops.length) {
      app.toasts.show({ text: 'コピーできませんでした', kind: 'bad' });
      app.sound.play('error');
      return false;
    }
    this.bp = bp;
    // 設計図の左下（sim が origin を返せばそれを使う）
    const o = bp.origin || { f: box.f1, x: box.x1 };
    this.src = { f1: o.f, x1: o.x, f2: o.f + bp.h - 1, x2: o.x + bp.w - 1 };
    this.phase = 'paste';
    this.anchor = null;
    app.sound.play('click');
    return true;
  }

  /** 範囲選択を終えた。設計図が取れたら貼り付けモードへ */
  finishSelect(a, b) {
    const app = this.app;
    if (!this.supported) { app.toasts.show({ text: 'この版ではコピーが使えません', kind: 'bad' }); return false; }
    const r = this.rect(a, b);
    let bp = null;
    try { bp = app.sim.blueprint(r); } catch (e) { app.reportError(e, 'sim.blueprint'); }
    if (!bp || !Array.isArray(bp.ops) || !bp.ops.length) {
      app.toasts.show({ text: 'コピーできるもの（フロア・施設・移動手段）がありません', kind: 'info' });
      app.sound.play('error');
      return false;
    }
    this.bp = bp;
    this.src = bp.origin ? { f1: bp.origin.f, x1: bp.origin.x, f2: bp.origin.f + bp.h - 1, x2: bp.origin.x + bp.w - 1 } : r;
    this.phase = 'paste';
    this.anchor = null;
    app.sound.play('click');
    return true;
  }

  /** 横も自由に動かすか（PC は Shift、スマホはトグル） */
  get xFree() { return this.freeX || !!this.app.shiftHeld; }

  /** 貼り付け位置: カーソルの位置が設計図の下の段（横はコピー元に固定、自由なら中央） */
  anchorFor(cell) {
    const bp = this.bp;
    const x = this.xFree || !this.src ? cell.x - Math.floor(bp.w / 2) : this.src.x1;
    return {
      f: Math.max(MIN_F, Math.min(MAX_F - bp.h + 1, cell.f)),
      x: Math.max(0, Math.min(W - bp.w, x)),
    };
  }

  /** 位置を合わせてゴーストを計算する（同じ位置なら再計算しない。force で強制） */
  preview(cell, force) {
    if (this.phase !== 'paste' || !this.bp) return null;
    const a = this.anchorFor(cell);
    if (!force && this.anchor && a.f === this.anchor.f && a.x === this.anchor.x) return this.ghosts;
    this.anchor = a;
    this.ops = this.bp.ops.map((op) => ({ tool: op.tool, p: shiftP(op.p, a) }));
    let res = null;
    try { res = this.app.sim.checkBatch(this.ops); } catch (e) { this.app.reportError(e, 'sim.checkBatch'); }
    this.res = res || { ok: false, reason: '確認できませんでした', cost: 0, ghosts: [] };
    const gs = Array.isArray(this.res.ghosts) ? this.res.ghosts : [];
    // renderer が施設の薄いプレビューを描けるよう、各ゴーストに type（ツール名）を付ける
    this.ghosts = gs.map((g, i) => (g ? {
      ...g,
      type: g.type || (this.ops[i] && this.ops[i].tool),
      ok: g.ok !== undefined ? !!g.ok && this.res.ok !== false : !!this.res.ok && i !== this.res.failedIndex,
    } : null)).filter(Boolean);
    if (!this.res.ok && this.res.failedIndex >= 0 && this.ghosts[this.res.failedIndex]) this.ghosts[this.res.failedIndex].ok = false;
    // ラベルは一番下の段（最初の要素）にまとめて出す
    if (this.ghosts.length) this.ghosts[0] = { ...this.ghosts[0], label: this.label() };
    return this.ghosts;
  }

  label() {
    const r = this.res;
    if (!r) return '';
    return r.ok ? `コピー ${fmtMoney(r.cost || 0)}` : r.reason || '建てられません';
  }

  /** 貼り付け範囲の外枠（タッチで「同じ場所をもう一度タップ」を判定する） */
  bbox() {
    if (!this.anchor || !this.bp) return null;
    return { x: this.anchor.x, w: this.bp.w, f: this.anchor.f, h: this.bp.h };
  }

  build() {
    const app = this.app;
    if (!this.ops) return false;
    let r = null;
    app.withSoundCheck(() => {
      try { r = app.sim.buildBatch(this.ops); } catch (e) { app.reportError(e, 'sim.buildBatch'); r = { ok: false, reason: 'エラーが発生しました' }; }
      return r && r.ok ? 'build' : 'error';
    });
    if (!r || !r.ok) {
      app.toasts.show({ text: (r && r.reason) || 'コピーを建てられませんでした', kind: 'bad' });
      return false;
    }
    app.toasts.show({ text: `コピーを建てました（${fmtMoney(r.cost || 0)}）`, kind: 'good' });
    this.anchor = null; // 同じ場所でも再計算させる
    return true;
  }
}
