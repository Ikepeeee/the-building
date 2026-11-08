// 施設ツールバー（カテゴリ別タブ・ミニアイコン・コスト・ロック表示・ツールチップ）
import { TYPES, TOOL_CATS, fmtMoney } from '../sim/constants.js';
import { iconURL } from './icons.js';

export function toolCost(key) {
  const t = TYPES[key];
  if (!t) return 0;
  if (t.costPerTile) return t.costPerTile * (t.minW || 1);
  return t.cost || 0;
}

export function costLabel(key) {
  const t = TYPES[key];
  if (!t) return '';
  if (t.costPerTile) return `${fmtMoney(t.costPerTile)}/マス`;
  return fmtMoney(t.cost || 0);
}

function sizeLabel(t) {
  if (t.drag === 'h') return '横にドラッグ';
  if (t.drag === 'v') return `幅${t.w}マス・縦にドラッグ`;
  return `幅${t.w}マス${t.h > 1 ? `×${t.h}フロア` : ''}`;
}

const ONLY = { lobbyFloor: '1F・15F毎の階のみ', top: '100Fのみ', basement: '地下のみ', aboveGround: '地上のみ', ground: '1Fのみ', high: '30F以上' };

export class Toolbar {
  constructor(app) {
    this.app = app;
    this.tabsEl = document.getElementById('tb-tabs');
    this.itemsEl = document.getElementById('tb-items');
    this.fixedEl = document.getElementById('tb-fixed');
    this.hintEl = document.getElementById('tb-hint');
    this.tip = document.getElementById('tooltip');
    this.cat = 'basic';
    this.buttons = new Map(); // key -> button
    this.tabs = new Map();
    this.state = '';
    this.seenStar = 1;
    this.newKeys = new Set();

    for (const [key, label, title] of [['inspect', '調べる', '施設を調べる (Esc / I)'], ['bulldoze', '撤去', '撤去する (B)'], ['copy', 'コピー', '範囲をまとめてコピー (K)'], ['eval', '評価', '施設の評価を色で表示 (V)']]) {
      const b = this.makeButton(key, label, '', title);
      b.classList.add('fixed');
      this.fixedEl.append(b);
    }
    for (const c of TOOL_CATS) {
      const t = document.createElement('button');
      t.className = 'tb-tab';
      t.setAttribute('role', 'tab');
      t.textContent = c.name;
      t.addEventListener('click', () => { app.userGesture(); this.showCat(c.id); });
      this.tabsEl.append(t);
      this.tabs.set(c.id, t);
    }
    // 縦ホイールで横スクロール
    this.itemsEl.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.itemsEl.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    this.showCat('basic');
  }

  makeButton(key, label, cost, title) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.key = key;
    const img = document.createElement('img');
    img.alt = '';
    img.src = iconURL(key);
    img.draggable = false;
    const n = document.createElement('span');
    n.className = 't-name';
    n.textContent = label;
    b.append(img, n);
    if (cost) {
      const c = document.createElement('span');
      c.className = 't-cost';
      c.textContent = cost;
      b.append(c);
    }
    if (title) b.title = title;
    b.addEventListener('click', () => {
      this.app.userGesture();
      if (key === 'eval') { this.app.toggleOverlay(); return; }
      this.app.setTool(this.app.tool === key && key !== 'inspect' ? 'inspect' : key);
    });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTip(b, key); });
    b.addEventListener('pointerleave', () => this.hideTip());
    this.buttons.set(key, b);
    return b;
  }

  /**
   * その型をツールバーに出すか・建てられるか。sim.canBuildType があればそれに従う（シナリオ・★・unlock を sim が判定）。
   * 無ければ ★ で判定。シナリオ専用の型は、そのシナリオ以外では出さない。
   */
  availability(key) {
    const t = TYPES[key];
    const sim = this.app.sim;
    if (!t || !sim) return { show: true, ok: true, reason: '' };
    const scn = sim.scenario && sim.scenario.id;
    if (t.scenario && t.scenario !== scn) return { show: false, ok: false, reason: 'このシナリオでは使えません' };
    if (typeof sim.canBuildType === 'function') {
      try {
        const r = sim.canBuildType(key) || {};
        return { show: !r.hidden, ok: !!r.ok, reason: r.reason || '', star: r.star ?? t.star };
      } catch (e) { console.error(e); }
    }
    return { show: true, ok: sim.star >= t.star, reason: `★${t.star}で解放`, star: t.star };
  }

  /** 表示できる型が1つも無いタブは隠す（「リゾート」はシナリオのときだけ） */
  refreshTabs() {
    let curOk = false;
    for (const [id, tab] of this.tabs) {
      const any = Object.entries(TYPES).some(([k, t]) => t.cat === id && this.availability(k).show);
      tab.hidden = !any;
      if (any && id === this.cat) curOk = true;
    }
    this.scnSig = this.app.sim && this.app.sim.scenario ? this.app.sim.scenario.id : '';
    if (!curOk) this.showCat('basic');
    else this.showCat(this.cat);
  }

  showCat(cat) {
    this.cat = cat;
    for (const [id, t] of this.tabs) t.classList.toggle('is-on', id === cat);
    for (const [k, b] of this.buttons) if (!b.classList.contains('fixed')) b.remove();
    for (const [key, t] of Object.entries(TYPES)) {
      if (t.cat !== cat || !this.availability(key).show) continue;
      let b = this.buttons.get(key);
      if (!b) b = this.makeButton(key, t.name, costLabel(key), '');
      this.itemsEl.append(b);
      this.newKeys.delete(key);
    }
    this.itemsEl.scrollLeft = 0;
    this.state = '';
    this.update(true);
  }

  /** 現在のツールが別のカテゴリなら、そのタブを開く */
  reveal(key) {
    const t = TYPES[key];
    if (t && t.cat !== this.cat) this.showCat(t.cat);
    const b = this.buttons.get(key);
    if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  showTip(b, key) {
    const tip = this.tip;
    if (key === 'inspect') tip.innerHTML = '<b>調べる</b><br><span class="tt-meta">施設をクリックすると詳細を表示。ドラッグでスクロール。</span>';
    else if (key === 'bulldoze') tip.innerHTML = '<b>撤去</b><br><span class="tt-meta">横にドラッグした範囲を撤去する（移動手段が優先）。返金はありません。</span>';
    else if (key === 'eval') tip.innerHTML = '<b>評価</b><br><span class="tt-meta">すべての施設の評価を色の網掛けで表示します（良い＝青・普通＝黄・悪い＝赤・空室＝灰）。もう一度押すと消えます。</span>';
    else if (key === 'copy') tip.innerHTML = '<b>コピー</b><br><span class="tt-meta">ドラッグで範囲を選び、貼り付けたい場所でクリック。フロア・施設・移動手段をまとめて建てます。</span>';
    else {
      const t = TYPES[key];
      const sim = this.app.sim;
      const av = this.availability(key);
      tip.innerHTML = `<b></b> <span class="tt-cost"></span>${av.ok ? '' : '<div class="tt-lock"></div>'}<div class="tt-desc"></div><div class="tt-meta"></div>`;
      if (!av.ok) tip.querySelector('.tt-lock').textContent = av.reason || `★${t.star}で解放`;
      tip.querySelector('b').textContent = t.name;
      tip.querySelector('.tt-cost').textContent = costLabel(key) + (t.carCost ? `（カゴ追加 ${fmtMoney(t.carCost)}）` : '');
      tip.querySelector('.tt-desc').textContent = t.desc || '';
      tip.querySelector('.tt-meta').textContent = [sizeLabel(t), ONLY[t.only], t.outdoor ? '屋外施設（上に何も建てられない）' : ''].filter(Boolean).join('・');
    }
    tip.hidden = false;
    const r = b.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(6, r.top - th - 8) + 'px';
  }

  hideTip() { this.tip.hidden = true; }

  /** ★・資金に応じたロック表示（変化があったときだけ DOM を触る） */
  update(force) {
    const sim = this.app.sim;
    if (!sim) return;
    const scnSig = sim.scenario ? sim.scenario.id : '';
    if (scnSig !== this.scnSig) { this.refreshTabs(); return; }
    if (sim.star > this.seenStar) {
      for (const [k, t] of Object.entries(TYPES)) if (t.star > this.seenStar && t.star <= sim.star && t.cat !== this.cat) this.newKeys.add(k);
      this.seenStar = sim.star;
    } else if (sim.star < this.seenStar) {
      this.seenStar = sim.star;
    }
    const tool = this.app.tool;
    let sig = `${sim.star}|${tool}|${this.app.overlay}|${[...this.newKeys].join()}|`;
    const avs = new Map();
    for (const [key, b] of this.buttons) {
      if (!TYPES[key] || !b.isConnected) continue;
      const av = this.availability(key);
      avs.set(key, av);
      sig += (sim.money >= toolCost(key) ? '1' : '0') + (av.ok ? 'o' : 'x');
    }
    if (!force && sig === this.state) return;
    this.state = sig;
    for (const [key, b] of this.buttons) {
      b.classList.toggle('is-on', key === 'eval' ? this.app.overlay === 'eval' : key === tool);
      const t = TYPES[key];
      if (!t) continue;
      const av = avs.get(key) || this.availability(key);
      const locked = !av.ok;
      b.classList.toggle('locked', locked);
      b.classList.toggle('no-money', !locked && sim.money < toolCost(key));
      let lk = b.querySelector('.t-lock');
      if (locked && !lk) { lk = document.createElement('span'); lk.className = 't-lock'; b.append(lk); }
      if (locked) { const m = /★\s*(\d)/.exec(av.reason || ''); lk.textContent = m ? `★${m[1]}` : '🔒'; b.title = av.reason || ''; }
      if (!locked && lk) { lk.remove(); b.title = ''; }
      b.setAttribute('aria-disabled', locked ? 'true' : 'false');
    }
    for (const [id, tab] of this.tabs) {
      const hasNew = [...this.newKeys].some((k) => TYPES[k].cat === id);
      let dot = tab.querySelector('.dot');
      if (hasNew && !dot) { dot = document.createElement('span'); dot.className = 'dot'; tab.append(dot); }
      if (!hasNew && dot) dot.remove();
    }
  }

  setHint(text) {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }
}
