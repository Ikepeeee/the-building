// 選択中の施設の情報パネル（sim.describe / sim.act）。スマホではボトムシート。
// describe() は頻繁に変わる（人数・待ち時間など）ので、DOM は作り直さずにその場で書き換える。
// タイトルかアクションの組み合わせが変わったときだけ作り直す（押している最中のボタンが消えないように）。
import { fmtMoney } from '../sim/constants.js';

const LEVEL = { good: ['良い', '◎'], fair: ['普通', '○'], bad: ['悪い', '×'] };

const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const setText = (el, t) => { t = t == null ? '' : String(t); if (el.textContent !== t) el.textContent = t; };

export class Panel {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('panel');
    this.id = null;
    this.sig = '';
    this.shape = '';
    this.dom = null;
    this.actions = new Map(); // id -> 最新の action
    this.el.addEventListener('pointerdown', () => app.userGesture());
  }

  get open() { return this.id !== null; }

  show(id) {
    if (this.id !== id) this.shape = '';
    this.id = id;
    this.sig = '';
    this.el.hidden = false;
    this.refresh();
    this.app.onPanelChange?.();
  }

  close() {
    if (this.id === null) return;
    this.id = null;
    this.el.hidden = true;
    this.el.textContent = '';
    this.dom = null;
    this.shape = '';
    this.app.selectedId = null;
    this.app.onPanelChange?.();
  }

  obj() {
    const sim = this.app.sim;
    return this.id === null || !sim || !sim.objs ? null : sim.objs.get(this.id) || null;
  }

  refresh() {
    if (this.id === null) return;
    const o = this.obj();
    if (!o) { this.close(); return; }
    let d;
    try { d = this.app.sim.describe(o); } catch (e) { console.error(e); d = null; }
    if (!d) { this.close(); return; }
    const unreachable = !!o.unreachable;
    const sig = JSON.stringify(d) + unreachable;
    if (sig === this.sig) return;
    this.sig = sig;
    const actions = Array.isArray(d.actions) ? d.actions.filter(Boolean) : [];
    const shape = `${d.title}|${actions.map((a) => a.id).join(',')}`;
    if (shape !== this.shape || !this.dom) { this.shape = shape; this.build(d, actions); }
    this.update(d, actions, unreachable);
  }

  /** 骨組みを作る（タイトルかアクションの組み合わせが変わったときだけ） */
  build(d, actions) {
    const el = this.el;
    el.textContent = '';
    const bar = mk('div', 'titlebar');
    const title = mk('span', 'tb-title');
    const x = mk('button', 'btn-close', '✕');
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', () => this.close());
    bar.append(title, x);
    const body = mk('div', 'p-body');
    const sub = mk('div', 'p-sub');
    const warn = mk('div', 'p-warn');
    const level = mk('div', 'p-level');
    const stats = mk('table', 'stats');
    const box = mk('div', 'p-actions');
    const btns = new Map();
    for (const a of actions) {
      const b = mk('button', 'btn');
      const l = mk('span', 'a-label');
      const c = mk('span', 'a-cost');
      b.append(l, c);
      b.addEventListener('click', () => this.doAction(a.id));
      box.append(b);
      btns.set(a.id, { b, l, c });
    }
    body.append(sub, warn, level, stats, box);
    el.append(bar, body);
    this.dom = { title, sub, warn, level, stats, box, btns, rows: [] };
  }

  /** 中身をその場で書き換える */
  update(d, actions, unreachable) {
    const dom = this.dom;
    setText(dom.title, d.title);
    setText(dom.sub, d.subtitle);
    dom.sub.hidden = !d.subtitle;
    // ロビーから行けない施設を目立たせる（describe がすでに書いていれば重ねない）
    const already = JSON.stringify(d).includes('行けません');
    dom.warn.hidden = !(unreachable && !already);
    setText(dom.warn, '⚠ ロビーから行けません（階段・エレベーターでつないでください）');
    if (d.level && LEVEL[d.level]) {
      dom.level.hidden = false;
      dom.level.className = `p-level ${d.level}`;
      setText(dom.level, `${LEVEL[d.level][1]} 評価: ${LEVEL[d.level][0]}`);
    } else dom.level.hidden = true;
    const stats = Array.isArray(d.stats) ? d.stats.filter(Boolean) : [];
    while (dom.rows.length < stats.length) {
      const tr = mk('tr');
      const th = mk('th');
      const td = mk('td');
      tr.append(th, td);
      dom.stats.append(tr);
      dom.rows.push({ tr, th, td });
    }
    while (dom.rows.length > stats.length) dom.rows.pop().tr.remove();
    stats.forEach((row, i) => { setText(dom.rows[i].th, row[0]); setText(dom.rows[i].td, row[1]); });
    dom.stats.hidden = !stats.length;
    this.actions.clear();
    for (const a of actions) {
      this.actions.set(a.id, a);
      const r = dom.btns.get(a.id);
      if (!r) continue;
      setText(r.l, a.label || a.id);
      setText(r.c, a.cost ? fmtMoney(a.cost) : '');
      const cls = 'btn' + (a.danger ? ' btn-danger' : '');
      if (r.b.className !== cls) r.b.className = cls;
      const dis = a.enabled === false;
      if (r.b.disabled !== dis) r.b.disabled = dis;
    }
    dom.box.hidden = !actions.length;
  }

  async doAction(actionId) {
    const app = this.app;
    const a = this.actions.get(actionId);
    if (!a || a.enabled === false || !this.obj()) return;
    if (a.danger) {
      const ok = await app.dialogs.confirm(`${a.label || '実行'}しますか？`, { okLabel: a.label || '実行', danger: true, text: '元に戻せません。返金はありません。' });
      if (!ok) return;
    }
    const cur = this.obj();
    if (!cur) return;
    app.withSoundCheck(() => {
      let r;
      try { r = app.sim.act(cur, a.id); } catch (e) { console.error(e); r = { ok: false, reason: 'エラーが発生しました' }; }
      if (r && !r.ok) app.toasts.show({ text: r.reason || 'できませんでした', kind: 'bad' });
      if (!r || !r.ok) return 'error';
      return a.id === 'remove' ? 'bulldoze' : /^(add|extend)/.test(a.id) ? 'build' : 'click';
    });
    this.sig = '';
    this.refresh();
  }
}
