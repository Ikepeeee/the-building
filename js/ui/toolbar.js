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

const ONLY = { lobbyFloor: '1F・15F毎の階のみ', top: '100Fのみ', basement: '地下のみ', aboveGround: '地上のみ' };

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

    for (const [key, label, title] of [['inspect', '調べる', '施設を調べる (Esc / I)'], ['bulldoze', '撤去', '撤去する (B)'], ['copy', 'コピー', '範囲をまとめてコピー (K)']]) {
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
      this.app.setTool(this.app.tool === key && key !== 'inspect' ? 'inspect' : key);
    });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTip(b, key); });
    b.addEventListener('pointerleave', () => this.hideTip());
    this.buttons.set(key, b);
    return b;
  }

  showCat(cat) {
    this.cat = cat;
    for (const [id, t] of this.tabs) t.classList.toggle('is-on', id === cat);
    for (const [k, b] of this.buttons) if (!b.classList.contains('fixed')) b.remove();
    for (const [key, t] of Object.entries(TYPES)) {
      if (t.cat !== cat) continue;
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
    else if (key === 'copy') tip.innerHTML = '<b>コピー</b><br><span class="tt-meta">ドラッグで範囲を選び、貼り付けたい場所でクリック。フロア・施設・移動手段をまとめて建てます。</span>';
    else {
      const t = TYPES[key];
      const sim = this.app.sim;
      const lock = sim && sim.star < t.star ? `<div class="tt-lock">★${t.star}で解放</div>` : '';
      tip.innerHTML = `<b></b> <span class="tt-cost"></span>${lock}<div class="tt-desc"></div><div class="tt-meta"></div>`;
      tip.querySelector('b').textContent = t.name;
      tip.querySelector('.tt-cost').textContent = costLabel(key) + (t.carCost ? `（カゴ追加 ${fmtMoney(t.carCost)}）` : '');
      tip.querySelector('.tt-desc').textContent = t.desc || '';
      tip.querySelector('.tt-meta').textContent = [sizeLabel(t), ONLY[t.only]].filter(Boolean).join('・');
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
    if (sim.star > this.seenStar) {
      for (const [k, t] of Object.entries(TYPES)) if (t.star > this.seenStar && t.star <= sim.star && t.cat !== this.cat) this.newKeys.add(k);
      this.seenStar = sim.star;
    } else if (sim.star < this.seenStar) {
      this.seenStar = sim.star;
    }
    const tool = this.app.tool;
    let sig = `${sim.star}|${tool}|${[...this.newKeys].join()}|`;
    for (const [key, b] of this.buttons) {
      if (!TYPES[key] || !b.isConnected) continue;
      sig += sim.money >= toolCost(key) ? '1' : '0';
    }
    if (!force && sig === this.state) return;
    this.state = sig;
    for (const [key, b] of this.buttons) {
      b.classList.toggle('is-on', key === tool);
      const t = TYPES[key];
      if (!t) continue;
      const locked = sim.star < t.star;
      b.classList.toggle('locked', locked);
      b.classList.toggle('no-money', !locked && sim.money < toolCost(key));
      let lk = b.querySelector('.t-lock');
      if (locked && !lk) { lk = document.createElement('span'); lk.className = 't-lock'; lk.textContent = `★${t.star}`; b.append(lk); }
      if (!locked && lk) lk.remove();
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
