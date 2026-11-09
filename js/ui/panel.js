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
    this.person = null;       // 人のプロフィールを表示中
    this.reviewsAll = false;
    this.el.addEventListener('pointerdown', () => app.userGesture());
  }

  get open() { return this.id !== null || this.person !== null; }

  show(id) {
    if (this.id !== id) { this.shape = ''; this.reviewsAll = false; }
    this.person = null;
    this.app.selectedPerson = null;
    this.id = id;
    this.sig = '';
    this.el.hidden = false;
    this.refresh();
    this.app.onPanelChange?.();
  }

  /** 人のプロフィールを表示する */
  showPerson(p) {
    this.id = null;
    this.app.selectedId = null;
    this.person = p;
    this.shape = '';
    this.sig = '';
    this.el.hidden = false;
    this.refresh();
    this.app.onPanelChange?.();
  }

  close() {
    if (this.id === null && this.person === null) return;
    this.id = null;
    this.person = null;
    this.app.selectedPerson = null;
    this.app.follow = false;
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

  refreshPerson() {
    const sim = this.app.sim;
    const p = this.person;
    let d = null;
    try { d = typeof sim.describePerson === 'function' ? sim.describePerson(p) : null; } catch (e) { console.error(e); }
    if (!d) { this.close(); return; }
    const sig = JSON.stringify(d) + this.app.follow;
    if (sig === this.sig) return;
    this.sig = sig;
    if (this.shape !== 'person' || !this.dom) { this.shape = 'person'; this.build(d, [], false, true); }
    this.cons = null;
    this.update({ ...d, level: d.mood || d.level }, [], false, true);
    setText(this.dom.follow, this.app.follow ? '⏹ 追いかけるのをやめる' : '📍 追いかける');
    this.dom.follow.classList.toggle('btn-primary', !this.app.follow);
  }

  refresh() {
    if (this.person) { this.refreshPerson(); return; }
    if (this.id === null) return;
    const o = this.obj();
    if (!o) { this.close(); return; }
    let d;
    try { d = this.app.sim.describe(o); } catch (e) { console.error(e); d = null; }
    if (!d) { this.close(); return; }
    const unreachable = !!o.unreachable;
    // 工事中（describe が書いていなければ UI で出す）
    const sim = this.app.sim;
    let cons = null;
    if (Number.isFinite(o.constructUntil) && sim.time < o.constructUntil && !JSON.stringify(d).includes('工事')) {
      const left = Math.max(0, o.constructUntil - sim.time);
      const start = Number.isFinite(o.constructStart) ? o.constructStart : o.constructUntil - Math.max(left, 1);
      const total = Math.max(1, o.constructUntil - start);
      const h = Math.floor(left / 60), m = Math.ceil(left % 60);
      cons = { text: `🚧 工事中（残り${h ? `${h}時間` : ''}${h && m ? `${m}分` : !h ? `${Math.max(1, m)}分` : ''}）`, p: Math.max(0, Math.min(1, 1 - left / total)) };
    }
    const sig = JSON.stringify(d) + unreachable + JSON.stringify(cons);
    this.cons = cons;
    if (sig === this.sig) return;
    this.sig = sig;
    const actions = Array.isArray(d.actions) ? d.actions.filter(Boolean) : [];
    const isElev = !!(o.cars && o.lo != null);
    const shape = `${d.title}|${actions.map((a) => a.id).join(',')}|${isElev}`;
    if (shape !== this.shape || !this.dom) { this.shape = shape; this.build(d, actions, isElev); }
    this.update(d, actions, unreachable);
  }

  /** 骨組みを作る（タイトルかアクションの組み合わせが変わったときだけ） */
  build(d, actions, isElev, isPerson) {
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
    const cons = mk('div', 'p-cons');
    const consT = mk('div', 'p-cons-t');
    const consBar = mk('div', 'p-cons-bar');
    const consFill = mk('i');
    consBar.append(consFill);
    cons.append(consT, consBar);
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
    // 評価の内訳（describe().reasons）
    const why = mk('div', 'p-reasons');
    const whyH = mk('div', 'p-reasons-h', '評価の内訳');
    const whyList = mk('ul');
    why.append(whyH, whyList);
    // ホテルのレビュー
    const rev = mk('div', 'p-reviews');
    const revH = mk('div', 'p-reviews-h');
    const revList = mk('ul');
    const revMore = mk('button', 'btn btn-small p-reviews-more');
    revMore.addEventListener('click', () => { this.reviewsAll = !this.reviewsAll; this.dom.revSig = ''; this.sig = ''; this.refresh(); });
    rev.append(revH, revList, revMore);
    body.append(sub, cons, warn, level, why, rev, stats, box);
    let follow = null;
    if (isPerson) {
      const ex = mk('div', 'p-elev');
      follow = mk('button', 'btn btn-primary', '📍 追いかける');
      follow.addEventListener('click', () => { this.app.setFollow(!this.app.follow); this.sig = ''; this.refresh(); });
      ex.append(follow);
      body.insertBefore(ex, stats);
    }
    if (isElev) {
      const ex = mk('div', 'p-elev');
      const cfg = mk('button', 'btn btn-primary', '⚙ 運転設定・停止階・カゴ');
      cfg.addEventListener('click', () => this.app.dialogs.elevatorSettings(this.id));
      const tip = mk('div', 'p-tip', '▲▼ のつまみをドラッグすると、シャフトを伸ばしたり縮めたりできます');
      ex.append(cfg, tip);
      // 長いボトムシートでも見えるよう、統計より上に置く
      body.insertBefore(ex, stats);
    }
    el.append(bar, body);
    this.dom = { title, sub, warn, cons, consT, consFill, level, stats, box, btns, rows: [], why, whyList, whySig: '', rev, revH, revList, revMore, revSig: '', follow };
  }

  /** 中身をその場で書き換える */
  update(d, actions, unreachable, isPerson) {
    const dom = this.dom;
    setText(dom.title, d.title);
    setText(dom.sub, d.subtitle);
    dom.sub.hidden = !d.subtitle;
    // ロビーから行けない施設を目立たせる（describe がすでに書いていれば重ねない）
    // describe().warning（破壊された施設など）を優先。なければ行けない施設を目立たせる
    const warnText = d.warning ? `⚠ ${d.warning}` : unreachable ? '⚠ ロビーから行けません（階段・エレベーターでつないでください）' : '';
    dom.warn.hidden = !warnText;
    setText(dom.warn, warnText);
    dom.cons.hidden = !this.cons;
    if (this.cons) { setText(dom.consT, this.cons.text); dom.consFill.style.width = `${Math.round(this.cons.p * 100)}%`; }
    if (d.level && LEVEL[d.level]) {
      dom.level.hidden = false;
      dom.level.className = `p-level ${d.level}`;
      setText(dom.level, `${LEVEL[d.level][1]} ${isPerson ? '気分' : '評価'}: ${LEVEL[d.level][0]}`);
    } else dom.level.hidden = true;
    const reasons = Array.isArray(d.reasons) ? d.reasons.filter((r) => r && r.label) : [];
    const rsig = JSON.stringify(reasons);
    if (rsig !== dom.whySig) {
      dom.whySig = rsig;
      dom.whyList.textContent = '';
      for (const r of reasons) {
        const li = mk('li', `r-${r.level || 'fair'}`);
        li.append(mk('span', 'r-mark', r.level === 'good' ? '◎' : r.level === 'bad' ? '×' : '△'), mk('span', 'r-text', r.label));
        dom.whyList.append(li);
      }
    }
    dom.why.hidden = !reasons.length;
    this.updateReviews(Array.isArray(d.reviews) ? d.reviews.filter(Boolean) : []);
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

  /** レビュー: 平均の★と最新3件（「すべて見る」で全件） */
  updateReviews(list) {
    const dom = this.dom;
    const sig = JSON.stringify(list) + this.reviewsAll;
    if (sig === dom.revSig) return;
    dom.revSig = sig;
    dom.rev.hidden = !list.length;
    if (!list.length) return;
    const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, Math.round(n)))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Math.round(n))));
    const avg = list.reduce((a, r) => a + (+r.stars || 0), 0) / list.length;
    dom.revH.textContent = '';
    dom.revH.append(mk('span', 'r-title', 'レビュー'), mk('span', 'r-stars', stars(avg)), mk('span', 'r-avg', `${avg.toFixed(1)}（${list.length}件）`));
    // 新しい順に
    const sorted = [...list].sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
    const shown = this.reviewsAll ? sorted : sorted.slice(0, 3);
    dom.revList.textContent = '';
    for (const r of shown) {
      const li = mk('li');
      li.append(mk('span', 'r-stars', stars(r.stars || 0)), mk('span', 'r-text', `「${r.text || ''}」`), mk('span', 'r-who', [r.name, r.day != null ? `${r.day + 1}日目` : ''].filter(Boolean).join('・')));
      dom.revList.append(li);
    }
    dom.revMore.hidden = list.length <= 3;
    dom.revMore.textContent = this.reviewsAll ? '最新3件だけ表示' : `すべて見る（${list.length}件）`;
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
