// 「次にやること」チェックリスト（オンボーディング）。sim の状態から自動でチェックが付く。
import { SAVE_KEY } from '../sim/constants.js';
import { storage } from './save.js';

const KEY = SAVE_KEY + '.guide';

const has = (sim, ...types) => { for (const o of sim.objs.values()) if (types.includes(o.type)) return true; return false; };

const STEPS = [
  { label: '1Fにロビーを横長に置く', done: (s) => has(s, 'lobby') },
  { label: '2F より上にフロアを伸ばす', done: (s) => { for (let f = 1; f <= 99; f++) { const r = s.grid[f]; if (r && r.some((v) => v !== 0)) return true; } return false; } },
  { label: 'エレベーターを縦にドラッグして階をつなぐ', done: (s) => has(s, 'elevator', 'express', 'stairs', 'escalator') },
  { label: 'オフィスかマンションを建てる', done: (s) => has(s, 'office', 'condo') },
  { label: '入居を待つ（倍速ボタンで早送り。建てた直後は工事中）', done: (s) => (s.pop | 0) > 0 },
  { label: '地下にごみ集積所を建てる（サービス。ビル全体のごみを集める）', done: (s) => has(s, 'garbage') },
  { label: '混んできたらエレベーターを選んでカゴを増やす', done: (s) => { for (const o of s.objs.values()) if (o.cars && o.cars.length >= 2) return true; return false; } },
];

export class Guide {
  constructor(app) {
    this.app = app;
    let st = {};
    try { st = JSON.parse(storage.get(KEY) || '{}') || {}; } catch { st = {}; }
    this.hidden = !!st.hidden;
    const narrow = window.innerWidth < 760 || window.innerHeight < 520;
    this.collapsed = st.collapsed ?? narrow;
    this.autoCollapsed = !!st.autoCollapsed;
    this.sig = '';
    const el = document.createElement('section');
    el.id = 'guide';
    el.className = 'frame';
    el.setAttribute('aria-label', '次にやること');
    el.innerHTML = '<div class="titlebar g-head"><span class="tb-title">📋 次にやること</span><button class="btn-close g-toggle" aria-label="たたむ"></button><button class="btn-close g-close" aria-label="閉じる">✕</button></div><div class="g-next"></div><ul></ul>';
    this.el = el;
    this.list = el.querySelector('ul');
    this.next = el.querySelector('.g-next');
    this.toggleBtn = el.querySelector('.g-toggle');
    el.querySelector('.g-head').addEventListener('click', (e) => {
      if (e.target.closest('.g-close')) return;
      this.collapsed = !this.collapsed;
      this.persist();
      this.apply();
    });
    el.querySelector('.g-close').addEventListener('click', () => {
      this.setHidden(true);
      app.toasts.show({ text: '「次にやること」はメニューからまた表示できます', kind: 'info' });
    });
    document.getElementById('app').append(el);
    this.apply();
  }

  persist() { storage.set(KEY, JSON.stringify({ hidden: this.hidden, collapsed: this.collapsed, autoCollapsed: this.autoCollapsed })); }

  setHidden(h) {
    this.hidden = !!h;
    this.persist();
    this.apply();
  }

  apply() {
    this.el.hidden = this.hidden;
    this.el.classList.toggle('collapsed', this.collapsed);
    this.toggleBtn.textContent = this.collapsed ? '＋' : '－';
    this.toggleBtn.setAttribute('aria-label', this.collapsed ? '開く' : 'たたむ');
    this.sig = '';
    this.update();
  }

  items() {
    const sim = this.app.sim;
    const out = [];
    let basicsDone = true;
    for (const s of STEPS) {
      let d = false;
      try { d = !!s.done(sim); } catch { d = false; }
      if (!d) basicsDone = false;
      out.push({ label: s.label, done: d });
    }
    // ★2以上: 駐車場（★3から車で来る入居者が出てくる）
    if (sim.star >= 2) {
      const d = has(sim, 'parking');
      if (!d) basicsDone = false;
      out.push({ label: '地下に駐車場を建てる（★3から車で来る入居者がいる）', done: d });
    }
    // 基本が済んだら（または★2以上なら）次の★の条件を並べる
    let prog = null;
    try { prog = sim.starProgress(); } catch { prog = null; }
    if (prog && prog.next != null && Array.isArray(prog.reqs)) {
      const name = typeof prog.next === 'number' ? `★${prog.next}` : String(prog.next);
      const reqs = prog.reqs.map((r) => ({ label: r.label, done: !!r.done, sub: true }));
      // 基本がそろったら一度だけ自動でたたむ（建設の邪魔にならないように）
      if (basicsDone && !this.autoCollapsed) { this.autoCollapsed = true; this.collapsed = true; this.persist(); queueMicrotask(() => this.apply()); }
      if (basicsDone || sim.star >= 2) {
        const extra = out.filter((it) => !it.done && sim.star >= 2); // 未達の基本（駐車場など）は残す
        return [...extra, { label: `${name} の条件`, done: reqs.every((r) => r.done), head: true }, ...reqs];
      }
      out.push({ label: `${name} の条件をそろえる（HUDの★で確認）`, done: false });
    }
    return out;
  }

  update() {
    if (this.hidden || !this.app.started || !this.app.sim) return;
    const items = this.items();
    const sig = JSON.stringify(items);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    let nextLabel = '';
    for (const it of items) {
      const li = document.createElement('li');
      if (it.done) li.classList.add('done');
      else if (!nextLabel && !it.head) { li.classList.add('next'); nextLabel = it.label; }
      if (it.sub) li.classList.add('sub');
      const ck = document.createElement('span');
      ck.className = 'ck';
      ck.textContent = it.done ? '✓' : '';
      const tx = document.createElement('span');
      tx.textContent = it.label;
      li.append(ck, tx);
      this.list.append(li);
    }
    this.next.textContent = nextLabel ? `次: ${nextLabel}` : 'すべて達成！';
  }
}
