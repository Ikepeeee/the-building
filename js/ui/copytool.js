// 一括コピー: ドラッグで範囲を選ぶ → 貼り付け位置に合わせると全体のゴースト → クリック（スマホは確定）で建てる
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
    this.reset();
  }

  reset() {
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
    this.src = r;
    this.phase = 'paste';
    this.anchor = null;
    app.sound.play('click');
    return true;
  }

  /** 貼り付け位置: カーソルの位置が設計図の下の段の中央 */
  anchorFor(cell) {
    const bp = this.bp;
    return {
      f: Math.max(MIN_F, Math.min(MAX_F - bp.h + 1, cell.f)),
      x: Math.max(0, Math.min(W - bp.w, cell.x - Math.floor(bp.w / 2))),
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
