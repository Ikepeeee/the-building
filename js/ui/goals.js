// シナリオのパネル（目標 / 次にやること のタブ）。スマホではたためる。
// - 目標: sim.scenarioProgress() の 120日目標（進み具合のバー・残り日数・成績の目安）
// - 次にやること: ビル運営の基本手順（建物の状態から自動チェック）＋ 次の★で足りないもの（starProgress）
//                 ＋ 120日目標のまとめ ＋ 物語の次の節目のヒント（scenarioProgress().nextBeat）
import { SAVE_KEY, WEEK } from '../sim/constants.js';
import { storage } from './save.js';

const KEY = SAVE_KEY + '.goals';
const fmt = (v, target, digits) => {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(digits)) return v.toFixed(digits);
  const dec = !Number.isInteger(target) || (target <= 10 && !Number.isInteger(v));
  return dec ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
};

const HOTEL = new Set(['hotelSingle', 'hotelTwin', 'hotelSuite', 'hotelFamily']);
const countType = (sim, ...types) => { let n = 0; for (const o of sim.objs.values()) if (types.includes(o.type) && !o.destroyed) n++; return n; };

/** ビル運営の基本手順（シナリオ用）。done は建物の状態から判定。when が false の項目は出さない */
export function basicsChecklist(sim) {
  const has = (...t) => countType(sim, ...t) > 0;
  let upper = false;
  for (let f = 1; f <= 99 && !upper; f++) { const r = sim.grid[f]; if (r && r.some((v) => v !== 0)) upper = true; }
  const hotels = countType(sim, ...HOTEL);
  // 混んでいるエレベーター（待ちが多い）
  let crowded = 0;
  for (const o of sim.objs.values()) {
    if (!o.cars || !o.q) continue;
    let wait = 0;
    for (const k in o.q) { const q = o.q[k]; wait += (q.up ? q.up.length : 0) + (q.down ? q.down.length : 0); }
    if (wait > 8 * o.cars.length) crowded++;
  }
  const star = sim.star | 0;
  return [
    { label: '1Fにロビーを置く', done: has('lobby') },
    { label: '2F より上にフロアを伸ばす', done: upper },
    { label: 'エレベーターか階段で階をつなぐ', done: has('elevator', 'express', 'stairs', 'escalator') },
    { label: 'ホテルの客室を建てる', done: hotels > 0 },
    { label: 'ハウスキーピングで客室を清掃する', done: has('housekeeping'), when: hotels > 0 },
    { label: '地下にごみ・リサイクルセンター', done: has('garbage') },
    { label: '警備室（台風や事件に備える）', done: has('security'), when: star >= 2 || hotels >= 6 },
    { label: '混んでいるエレベーターのカゴを増やす', done: crowded === 0, when: crowded > 0 },
    { label: '地下に駐車場（★3から車の客が増える）', done: has('parking'), when: star >= 3 },
    { label: 'ファミリールームを増やす（家族連れ向け）', done: countType(sim, 'hotelFamily') >= 10, when: star >= 3 },
  ].filter((it) => it.when !== false);
}

/** 花火大会の予定と、新しい施設のヒント（海辺） */
export function facilityTips(sim) {
  const out = [];
  const f = sim.festival;
  if (f && f.state === 'live') out.push('🎆 花火大会の真っ最中！ 屋外施設やスカイラウンジ、浜に人が集まっています');
  else if (f && f.state === 'announced' && Number.isFinite(f.start)) {
    const day = Math.floor(f.start / 1440), d = day - sim.day;
    const wd = WEEK[(day % 7 + 7) % 7];
    out.push(`🎆 ${d <= 0 ? '今日' : d === 1 ? '明日' : `${d}日後（${wd}曜）`}の夜は花火大会。屋外施設やスカイラウンジがあると、見物の客が増えます`);
  }
  if (!sim.scenario || sim.scenario.id !== 'seaside') return out;
  const has = (t) => countType(sim, t) > 0;
  const star = sim.star | 0;
  if (star >= 3 && has('aquarium') && !has('dolphinShow')) out.push('🐬 水族館の横（同じ階で隣り合わせ）にイルカショーを建てると、ショーの時間に家族連れが集まります');
  if (star >= 2 && !has('nightPool')) out.push('🏊 屋外プール: 昼は家族連れ、夜はナイトプールでカップルが来ます（屋上や空き地に）');
  if (star >= 2 && !has('cottage')) out.push('🏕 コテージ: 浜や屋上に建てる宿泊施設。夏は予約がいっぱいに');
  if (star >= 3 && !has('skyLounge')) out.push('🌃 スカイラウンジ: 20F以上に。高い階ほど客が増え、夜景で夜に売れます');
  return out.slice(0, 2);
}

export class Goals {
  constructor(app) {
    this.app = app;
    let st = {};
    try { st = JSON.parse(storage.get(KEY) || '{}') || {}; } catch { st = {}; }
    const narrow = window.innerWidth < 760 || window.innerHeight < 520;
    this.collapsed = st.collapsed ?? narrow;
    this.tab = st.tab === 'todo' ? 'todo' : 'goals';
    const el = document.createElement('section');
    el.id = 'goals';
    el.className = 'frame';
    el.hidden = true;
    el.setAttribute('aria-label', 'シナリオの目標と次にやること');
    el.innerHTML = '<div class="titlebar g-head"><span class="tb-title"></span><span class="g-days"></span><button class="btn-close g-toggle" aria-label="たたむ"></button></div>'
      + '<div class="g-tabs" role="tablist"><button class="g-tab" data-tab="goals" role="tab">🎯 目標</button><button class="g-tab" data-tab="todo" role="tab">📋 次にやること</button></div>'
      + '<div class="g-sum"></div><div class="g-body"><ul class="g-goals"></ul><div class="g-rule"></div><div class="g-todo"></div></div>';
    el.querySelector('.g-head').addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.persist();
      this.sig = '';
      this.update();
    });
    for (const b of el.querySelectorAll('.g-tab')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        if (this.collapsed) this.collapsed = false;
        this.persist();
        this.sig = '';
        this.update();
      });
    }
    document.getElementById('app').append(el);
    this.el = el;
    this.sig = '';
  }

  persist() { storage.set(KEY, JSON.stringify({ collapsed: this.collapsed, tab: this.tab })); }

  update() {
    const app = this.app, sim = app.sim, el = this.el;
    let prog = null;
    if (app.started && sim && sim.scenario && typeof sim.scenarioProgress === 'function') {
      try { prog = sim.scenarioProgress(); } catch (e) { app.reportError(e, 'scenarioProgress'); }
    }
    if (!prog) { if (!el.hidden) el.hidden = true; app.root.classList.remove('scenario-on'); return; }
    el.hidden = false;
    app.root.classList.add('scenario-on');
    let star = null;
    try { star = sim.starProgress(); } catch { star = null; }
    const basics = basicsChecklist(sim);
    const sig = JSON.stringify([prog, star, basics.map((b) => b.done), this.collapsed, this.tab]);
    if (sig === this.sig) return;
    this.sig = sig;
    el.classList.toggle('collapsed', this.collapsed);
    for (const b of el.querySelectorAll('.g-tab')) b.classList.toggle('is-on', b.dataset.tab === this.tab);
    el.querySelector('.g-goals').hidden = this.tab !== 'goals';
    el.querySelector('.g-rule').hidden = this.tab !== 'goals';
    el.querySelector('.g-todo').hidden = this.tab !== 'todo';

    const goals = Array.isArray(prog.goals) ? prog.goals : [];
    const done = goals.filter((g) => g.done).length;
    el.querySelector('.tb-title').textContent = `🎯 ${prog.name || 'シナリオ'}`;
    const st = prog.state || 'playing';
    const days = el.querySelector('.g-days');
    days.textContent = st === 'cleared' ? `クリア ${'★'.repeat(prog.grade || 0)}` : st === 'failed' ? '失敗' : `残り ${Math.max(0, prog.daysLeft ?? 0)}日`;
    days.className = `g-days ${st}` + (st === 'playing' && prog.daysLeft <= 10 ? ' urgent' : '');
    el.querySelector('.g-toggle').textContent = this.collapsed ? '＋' : '－';
    // たたんだときの1行: 目標の数と、次にやることの先頭
    const firstTodo = basics.find((b) => !b.done) || (star && Array.isArray(star.reqs) ? star.reqs.find((r) => !r.done) : null);
    el.querySelector('.g-sum').textContent = `目標 ${done}/${goals.length}` + (firstTodo ? `・次: ${firstTodo.label}` : '');

    // ---- 目標タブ ----
    const ul = el.querySelector('.g-goals');
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
      const starU = g.unit === '★' ? '★' : '';
      li.querySelector('.g-val').textContent = g.target != null
        ? `${starU}${fmt(g.value, g.target, g.digits)} / ${starU}${fmt(g.target, g.target, g.digits)}${unit}`
        : `${fmt(g.value, null, g.digits)}${unit}`;
      if (g.value == null) li.querySelector('.g-val').title = g.note || 'まだ数がそろっていません';
      li.querySelector('.g-bar i').style.width = `${Math.round(p * 100)}%`;
      ul.append(li);
    }
    const rule = Array.isArray(prog.gradeRule)
      ? prog.gradeRule.map((r) => `${r.days}日以内★${r.grade}`).join('・')
      : prog.gradeRule || '';
    el.querySelector('.g-rule').textContent = rule ? `成績: ${rule}` : '';

    // ---- 次にやることタブ ----
    const todo = el.querySelector('.g-todo');
    todo.textContent = '';
    const section = (title, items, opts = {}) => {
      if (!items.length) return;
      const h = document.createElement('div'); h.className = 'g-sec'; h.textContent = title;
      const list = document.createElement('ul'); list.className = 'g-list';
      let shown = 0;
      for (const it of items) {
        if (it.done && opts.hideDone) continue;
        if (opts.max && shown >= opts.max) break;
        const li = document.createElement('li');
        li.className = it.done ? 'done' : '';
        const ck = document.createElement('span'); ck.className = 'g-ck'; ck.textContent = it.done ? '✓' : '';
        const tx = document.createElement('span'); tx.textContent = it.label;
        li.append(ck, tx);
        list.append(li);
        shown++;
      }
      if (!shown) return;
      todo.append(h, list);
    };
    // (d) 物語の次の節目
    const beat = prog.nextBeat;
    const beatText = beat ? (typeof beat === 'string' ? beat : beat.hint || beat.text || beat.label || '') : '';
    if (beatText) {
      const b = document.createElement('div'); b.className = 'g-beat'; b.textContent = `📖 ${beatText}`;
      todo.append(b);
    }
    // 花火大会・新しい施設のヒント
    const tips = facilityTips(sim);
    for (const t of tips) { const b = document.createElement('div'); b.className = 'g-beat g-tip'; b.textContent = t; todo.append(b); }
    // (b) 次の★で足りないもの
    if (star && Array.isArray(star.reqs) && star.next != null) {
      const name = typeof star.next === 'number' ? `★${star.next}` : String(star.next);
      section(`${name} まであと`, star.reqs.map((r) => ({ label: r.label, done: !!r.done })), { hideDone: true });
    }
    // (a) 基本の手順（未完了を先に、最大5件）
    const left = basics.filter((b) => !b.done);
    section(`建物の基本（${basics.length - left.length}/${basics.length}）`, left, { max: 5 });
    // (c) 120日目標のまとめ
    if (st === 'playing') {
      const g = document.createElement('div');
      g.className = 'g-goalline';
      g.textContent = `120日目標: ${done}/${goals.length} 達成・残り ${Math.max(0, prog.daysLeft ?? 0)}日` + (goals.find((x) => !x.done) ? `（次: ${goals.find((x) => !x.done).label}）` : '');
      todo.append(g);
    }
    if (!todo.childElementCount) { const p = document.createElement('div'); p.className = 'g-goalline'; p.textContent = 'いまできることは全部できています！'; todo.append(p); }
  }
}
