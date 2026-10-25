// シナリオの目標パネル（sim.scenarioProgress()）。スマホではたためる。
import { SAVE_KEY } from '../sim/constants.js';
import { storage } from './save.js';

const KEY = SAVE_KEY + '.goals';
const fmt = (v, target, digits) => {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(digits)) return v.toFixed(digits);
  const dec = !Number.isInteger(target) || (target <= 10 && !Number.isInteger(v));
  return dec ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
};

export class Goals {
  constructor(app) {
    this.app = app;
    let st = {};
    try { st = JSON.parse(storage.get(KEY) || '{}') || {}; } catch { st = {}; }
    const narrow = window.innerWidth < 760 || window.innerHeight < 520;
    this.collapsed = st.collapsed ?? narrow;
    const el = document.createElement('section');
    el.id = 'goals';
    el.className = 'frame';
    el.hidden = true;
    el.setAttribute('aria-label', 'シナリオの目標');
    el.innerHTML = '<div class="titlebar g-head"><span class="tb-title"></span><span class="g-days"></span><button class="btn-close g-toggle" aria-label="たたむ"></button></div><div class="g-sum"></div><div class="g-body"><ul></ul><div class="g-rule"></div></div>';
    el.querySelector('.g-head').addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      storage.set(KEY, JSON.stringify({ collapsed: this.collapsed }));
      this.sig = '';
      this.update();
    });
    document.getElementById('app').append(el);
    this.el = el;
    this.sig = '';
  }

  update() {
    const app = this.app, sim = app.sim, el = this.el;
    let prog = null;
    if (app.started && sim && sim.scenario && typeof sim.scenarioProgress === 'function') {
      try { prog = sim.scenarioProgress(); } catch (e) { app.reportError(e, 'scenarioProgress'); }
    }
    if (!prog) { if (!el.hidden) el.hidden = true; app.root.classList.remove('scenario-on'); return; }
    el.hidden = false;
    app.root.classList.add('scenario-on');
    const sig = JSON.stringify(prog) + this.collapsed;
    if (sig === this.sig) return;
    this.sig = sig;
    el.classList.toggle('collapsed', this.collapsed);
    const goals = Array.isArray(prog.goals) ? prog.goals : [];
    const done = goals.filter((g) => g.done).length;
    el.querySelector('.tb-title').textContent = `🎯 ${prog.name || 'シナリオ'}`;
    const st = prog.state || 'playing';
    const days = el.querySelector('.g-days');
    days.textContent = st === 'cleared' ? `クリア ${'★'.repeat(prog.grade || 0)}` : st === 'failed' ? '失敗' : `残り ${Math.max(0, prog.daysLeft ?? 0)}日`;
    days.className = `g-days ${st}` + (st === 'playing' && prog.daysLeft <= 10 ? ' urgent' : '');
    el.querySelector('.g-toggle').textContent = this.collapsed ? '＋' : '－';
    el.querySelector('.g-sum').textContent = `目標 ${done}/${goals.length} 達成`;
    const ul = el.querySelector('ul');
    ul.textContent = '';
    for (const g of goals) {
      const li = document.createElement('li');
      li.className = g.done ? 'done' : '';
      const p = g.target ? Math.max(0, Math.min(1, (+g.value || 0) / g.target)) : g.done ? 1 : 0;
      li.innerHTML = '<div class="g-row"><span class="g-ck"></span><span class="g-label"></span><span class="g-val"></span></div><div class="g-bar"><i></i></div>';
      li.querySelector('.g-ck').textContent = g.done ? '✓' : '';
      li.querySelector('.g-label').textContent = g.label;
      if (g.digits == null && g.unit === '★') g.digits = 1;
      const unit = g.unit && g.unit !== '★' ? g.unit : '';
      const star = g.unit === '★' ? '★' : '';
      li.querySelector('.g-val').textContent = g.target != null
        ? `${star}${fmt(g.value, g.target, g.digits)} / ${star}${fmt(g.target, g.target, g.digits)}${unit}`
        : `${fmt(g.value, null, g.digits)}${unit}`;
      if (g.value == null && g.note !== '') li.title = g.note || 'まだ数がそろっていません';
      if (g.value == null) li.querySelector('.g-val').title = g.note || 'まだ数がそろっていません';
      li.querySelector('.g-bar i').style.width = `${Math.round(p * 100)}%`;
      ul.append(li);
    }
    const rule = Array.isArray(prog.gradeRule)
      ? prog.gradeRule.map((r) => `${r.days}日以内★${r.grade}`).join('・')
      : prog.gradeRule || '';
    el.querySelector('.g-rule').textContent = rule ? `成績: ${rule}` : '';
  }
}
