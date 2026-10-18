// モーダル類: 事件の prompt、確認、メニュー、遊び方、状況（★進捗・財務）、セーブ入出力、★昇格演出、エンディング
import { TYPES, STAR_POP, LOBBY_FLOORS, fmtMoney, floorName } from '../sim/constants.js';
import { iconURL } from './icons.js';
import { exportText, parseImport, downloadText, peekSave, storage } from './save.js';

const PROMPT_ICON = { bomb: '💣', fire: '🔥', vip: '🎩', wedding: '💒', roach: '🪳', santa: '🎅' };

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export class Dialogs {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('modal-root');
    this.stack = []; // 開いているモーダル
    this.queue = []; // 順番に見せる事件・演出
    this.busy = false; // 事件・演出を表示中
  }

  get count() { return this.stack.length + (this.busy ? 1 : 0); }

  /**
   * 汎用モーダル
   * opts: {title, kind, body: Node|string, buttons:[{label, primary, danger, value, onClick}], closable, wide, col}
   * 戻り値: Promise<value>（閉じる操作は null）
   */
  open(opts) {
    return new Promise((resolve) => {
      const wrap = h('div', { class: 'modal-wrap' });
      const box = h('div', { class: `modal frame ${opts.wide ? 'wide' : ''} ${opts.kind ? 'k-' + opts.kind : ''}`, role: 'dialog', 'aria-modal': 'true' });
      const bar = h('div', { class: 'titlebar' }, h('span', { class: 'tb-title', text: opts.title || '' }));
      const entry = { wrap, closable: opts.closable !== false, close: null };
      const close = (v) => {
        if (!wrap.isConnected) return;
        wrap.remove();
        this.stack = this.stack.filter((e) => e !== entry);
        this.app.onModalChange();
        if (opts.onClose) opts.onClose(v);
        resolve(v);
      };
      entry.close = close;
      if (entry.closable) bar.append(h('button', { class: 'btn-close', 'aria-label': '閉じる', text: '✕', onclick: () => close(null) }));
      const body = h('div', { class: 'm-body' });
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.append(opts.body);
      box.append(bar, body);
      if (opts.buttons && opts.buttons.length) {
        const foot = h('div', { class: 'm-foot' + (opts.col ? ' col' : '') });
        for (const b of opts.buttons) {
          const btn = h('button', { class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''), text: b.label });
          if (b.disabled) btn.disabled = true;
          btn.addEventListener('click', () => {
            this.app.sound.play('click');
            if (b.onClick && b.onClick(close) === false) return;
            close(b.value !== undefined ? b.value : b.label);
          });
          foot.append(btn);
        }
        box.append(foot);
      }
      wrap.append(box);
      if (entry.closable) {
        // 背景の押下と離しの両方が背景上のときだけ閉じる（タッチのゴーストクリックが下のボタンに届かないように）
        let downOnBackdrop = false;
        wrap.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === wrap; });
        wrap.addEventListener('click', (e) => { if (downOnBackdrop && e.target === wrap) close(null); downOnBackdrop = false; });
      }
      this.root.append(wrap);
      this.stack.push(entry);
      this.app.onModalChange();
      const first = box.querySelector('.m-foot .btn-primary') || box.querySelector('.m-foot .btn');
      if (first && !('ontouchstart' in window)) setTimeout(() => first.focus({ preventScroll: true }), 30);
    });
  }

  /** Esc: 一番上の閉じられるモーダルを閉じる。閉じたら true */
  escape() {
    const top = this.stack[this.stack.length - 1];
    if (top && top.closable) { top.close(null); return true; }
    return !!top;
  }

  closeAll() {
    for (const e of [...this.stack]) e.close(null);
  }

  confirm(title, o = {}) {
    return this.open({
      title, body: o.text ? h('p', { text: o.text }) : null,
      buttons: [{ label: o.cancelLabel || 'やめる', value: false }, { label: o.okLabel || 'OK', value: true, primary: !o.danger, danger: !!o.danger }],
    }).then((v) => v === true);
  }

  // ---------- 順番待ちの事件・演出 ----------
  enqueue(item) {
    this.queue.push(item);
    this.pump();
  }

  pump() {
    if (this.busy || !this.queue.length) return;
    const item = this.queue.shift();
    this.busy = true;
    this.app.onModalChange();
    const done = () => { this.busy = false; this.app.onModalChange(); setTimeout(() => this.pump(), 50); };
    try {
      if (item.type === 'prompt') this.showPrompt(item.data, done);
      else if (item.type === 'star') this.showStar(item.star, done);
      else if (item.type === 'tower') this.showEnding(done);
      else done();
    } catch (e) {
      console.error(e);
      done();
    }
  }

  clearQueue() { this.queue = []; }

  showPrompt(p, done) {
    const app = this.app;
    const sim = app.sim;
    const body = h('div', {},
      h('div', { class: 'prompt-icon', text: PROMPT_ICON[p.kind] || '📢' }),
      ...(String(p.text || '').split('\n').map((line) => h('p', { text: line }))));
    const choices = Array.isArray(p.choices) && p.choices.length ? p.choices : [{ label: 'OK', value: true }];
    const wrapClose = { closed: false };
    this.open({
      title: p.title || 'お知らせ', kind: p.kind, body, closable: false, col: choices.length > 2,
      buttons: choices.map((c, i) => ({ label: c.label, value: c.value, primary: i === 0 })),
    }).then((v) => {
      if (wrapClose.closed) return;
      wrapClose.closed = true;
      if (sim === app.sim) {
        try { sim.answer(p.id, v); } catch (e) { console.error(e); }
      }
      done();
    });
  }

  showStar(star, done) {
    const app = this.app;
    app.sound.play('fanfare');
    const unlocked = Object.entries(TYPES).filter(([, t]) => t.star === star);
    const el = h('div', { class: 'celebrate', role: 'dialog', 'aria-label': `★${star}` });
    el.append(this.confetti(60));
    el.append(h('div', { class: 'c-star', text: '★' }));
    el.append(h('h2', { text: star >= 5 ? '★5 超高層ビルに認定！' : `★${star} に昇格！` }));
    const msg = { 2: 'ホテルや商業施設が建てられるようになりました。', 3: '急行エレベーターや映画館などが解放されました。', 4: '地下鉄駅を建てて、さらに人を呼び込もう。', 5: '100Fに大聖堂を建てて、結婚式を成功させよう！' }[star] || '';
    if (msg) el.append(h('p', { text: msg }));
    if (unlocked.length) {
      const u = h('div', { class: 'c-unlock' }, h('div', { text: '新しく建てられる施設' }));
      for (const [k, t] of unlocked) u.append(h('span', { class: 'u' }, h('img', { src: iconURL(k), alt: '' }), t.name));
      el.append(u);
    }
    el.append(h('div', { class: 'c-tap', text: 'タップして続ける' }));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.remove();
      if (unlocked.length) app.toolbar.update(true);
      done();
    };
    setTimeout(() => el.addEventListener('click', close), 500);
    this.escHandler = close;
    document.getElementById('app').append(el);
  }

  confetti(n) {
    const box = h('div', { class: 'confetti' });
    const colors = ['#ffcc33', '#ff5a7a', '#5ad1ff', '#7cff6a', '#ffffff', '#b07aff'];
    for (let i = 0; i < n; i++) {
      const c = h('i');
      c.style.left = (Math.random() * 100).toFixed(1) + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.5).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's';
      box.append(c);
    }
    return box;
  }

  showEnding(done) {
    const app = this.app;
    const sim = app.sim;
    app.sound.play('bells');
    setTimeout(() => app.sound.play('fanfare'), 1800);
    let shops = 0, tenants = 0;
    for (const o of sim.objs.values()) { if (TYPES[o.type]?.cat === 'commerce') shops++; if (o.occupied) tenants++; }
    const el = h('div', { class: 'ending', role: 'dialog', 'aria-label': 'TOWER 達成' });
    el.append(this.confetti(90));
    const fin = h('table', { class: 'fin' },
      h('tr', {}, h('th', { text: '達成までの日数' }), h('td', { text: `${sim.day + 1}日` })),
      h('tr', {}, h('th', { text: '人口' }), h('td', { text: `${(sim.pop | 0).toLocaleString('en-US')}人` })),
      h('tr', {}, h('th', { text: '資金' }), h('td', { text: fmtMoney(sim.money) })),
      h('tr', {}, h('th', { text: '施設の数' }), h('td', { text: `${sim.objs.size}` })),
      h('tr', {}, h('th', { text: '商業施設' }), h('td', { text: `${shops}` })),
      h('tr', {}, h('th', { text: '稼働中の施設' }), h('td', { text: `${tenants}` })));
    const box = h('div', { class: 'e-box' },
      h('p', { text: '100Fの大聖堂で、結婚式が無事に挙がりました。' }),
      h('h1', { class: 'e-tower', text: 'TOWER' }),
      h('h2', { text: 'おめでとうございます！ 最高ランク「TOWER」に認定されました' }),
      h('p', { text: 'ロビーから始まった小さなビルは、街いちばんの超高層タワーになりました。' }),
      fin,
      h('div', { class: 'e-btns' },
        h('button', { class: 'btn btn-big btn-primary', text: 'このまま続けて遊ぶ', onclick: () => { app.sound.play('click'); close(); } }),
        h('button', { class: 'btn btn-big', text: 'タイトルへ', onclick: () => { close(); app.toTitle(); } })));
    box.querySelectorAll('.btn-big').forEach((b) => { b.style.width = 'auto'; });
    el.append(box);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.remove();
      app.manualSave(true);
      done();
    };
    this.escHandler = null;
    document.getElementById('app').append(el);
  }

  // ---------- メニュー・情報 ----------
  menu() {
    const app = this.app;
    const item = (label, key, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: () => { app.sound.play('click'); close(); fn(); } }, label, key ? h('span', { class: 'k', text: key }) : null);
    let close = () => {};
    const list = h('div', { class: 'menu-list' },
      item('💾 セーブする', 'Ctrl+S', () => app.manualSave()),
      item('📂 最後のセーブを読み込む', '', () => app.askLoad()),
      item('🗂 バックアップから読み込む', '', () => app.askLoadBackup()),
      item('🏗 新しく建てる', '', () => app.askNewGame()),
      item('⇅ セーブデータの書き出し／読み込み', '', () => this.saveIO()),
      item('📊 タワーの状況・財務', '', () => this.status()),
      item('❓ 遊び方・操作方法', '', () => this.help()),
      item(app.guide.hidden ? '📋 「次にやること」を表示する' : '📋 「次にやること」を隠す', '', () => app.guide.setHidden(!app.guide.hidden)),
      item('🔊 サウンド設定（効果音・環境音）', 'M で全体ミュート', () => this.soundSettings()),
      item('⛶ 全画面表示の切り替え', '', () => app.toggleFullscreen()),
      item(app.perf.visible ? '📈 性能表示を隠す' : '📈 性能表示（FPS など）', 'F3', () => app.perf.toggle()),
      item(app.perf.adaptive ? '🖥 重いときに解像度を自動で下げる: オン' : '🖥 重いときに解像度を自動で下げる: オフ', '', () => { app.perf.setAdaptive(!app.perf.adaptive); app.toasts.show({ text: `解像度の自動調整を${app.perf.adaptive ? 'オン' : 'オフ'}にしました`, kind: 'info' }); }),
      item('🏠 タイトルへ戻る', '', () => app.toTitle()));
    const p = this.open({ title: 'メニュー', body: list });
    close = () => { const top = this.stack[this.stack.length - 1]; if (top) top.close(null); };
    return p;
  }

  /** セグメント（択一ボタン）を作る */
  seg(options, cur, onPick) {
    const box = h('div', { class: 'seg', role: 'radiogroup' });
    for (const [value, label] of options) {
      const b = h('button', { class: 'btn seg-b' + (value === cur ? ' is-on' : ''), role: 'radio', 'aria-checked': value === cur ? 'true' : 'false', text: label });
      b.addEventListener('click', () => { if (value !== cur) onPick(value); });
      box.append(b);
    }
    return box;
  }

  soundSettings() {
    const app = this.app;
    const body = h('div');
    const render = () => {
      body.textContent = '';
      body.append(
        h('h3', { text: '全体' }),
        this.seg([[false, '🔊 鳴らす'], [true, '🔇 ミュート']], app.sound.muted, (v) => { app.sound.unlock(); app.sound.setMuted(v); app.hud.update(); render(); }),
        h('h3', { text: '効果音' }),
        h('p', { class: 'small', text: '建設・お金・事件などの音' }),
        this.seg([[true, 'オン'], [false, 'オフ']], app.sound.sfxOn, (v) => { app.sound.setSfx(v); render(); }),
        h('h3', { text: '環境音' }),
        h('p', { class: 'small', text: '画面に映っているものに合わせた音（エレベーターの走行音とチャイム、オフィスのタイピングと電話、飲食店の雑談と調理音、ロビーのざわめき、消防ヘリ）。音量は控えめです。' }),
        this.seg([[true, 'オン'], [false, 'オフ']], app.ambience.enabled, (v) => { app.ambience.setEnabled(v); render(); }));
    };
    render();
    return this.open({ title: 'サウンド設定', body, buttons: [{ label: '閉じる', primary: true }] });
  }

  /** エレベーターの設定（カゴの数・速度・ドア・待機・ラッシュ・停止階） */
  elevatorSettings(id) {
    const app = this.app;
    const sim = app.sim;
    const body = h('div', { class: 'elev-cfg' });
    let closeFn = null;
    const apply = (patch) => {
      const e = sim.objs.get(id);
      if (!e) return;
      let r;
      try { r = sim.setElevatorConfig(e, patch); } catch (err) { console.error(err); r = { ok: false, reason: 'エラーが発生しました' }; }
      if (!r || !r.ok) { app.toasts.show({ text: (r && r.reason) || '変更できませんでした', kind: 'bad' }); app.sound.play('error'); }
      else app.sound.play('click');
      render();
    };
    const act = (actionId) => {
      const e = sim.objs.get(id);
      if (!e) return;
      app.withSoundCheck(() => {
        let r;
        try { r = sim.act(e, actionId); } catch (err) { console.error(err); r = { ok: false, reason: 'エラーが発生しました' }; }
        if (!r || !r.ok) { app.toasts.show({ text: (r && r.reason) || 'できませんでした', kind: 'bad' }); return 'error'; }
        return actionId === 'addCar' ? 'build' : 'click';
      });
      render();
    };
    const render = () => {
      const e = sim.objs.get(id);
      body.textContent = '';
      if (!e) { body.append(h('p', { text: 'このエレベーターはもうありません。' })); return; }
      const T = TYPES[e.type] || {};
      const n = e.cars ? e.cars.length : 0;
      body.append(h('h3', { text: `カゴ（${n} / ${T.maxCars || 8}台）` }),
        h('div', { class: 'cars-row' },
          h('button', { class: 'btn', text: '－ 減らす', disabled: n <= 1, onclick: () => act('removeCar') }),
          h('span', { class: 'cars-n', text: '🛗'.repeat(Math.min(n, 8)) || '—' }),
          h('button', { class: 'btn btn-primary', disabled: n >= (T.maxCars || 8), onclick: () => act('addCar') }, `＋ 増やす ${T.carCost ? fmtMoney(T.carCost) : ''}`)));
      const cfg = e.config;
      if (!cfg || typeof sim.setElevatorConfig !== 'function') {
        body.append(h('p', { class: 'small', text: '（この版のシミュレーションでは運転設定は使えません）' }));
        return;
      }
      body.append(
        h('h3', { text: 'モーター' }),
        this.seg([[1, '標準'], [2, '高速（維持費2倍）']], cfg.speed ?? 1, (v) => apply({ speed: v })),
        h('h3', { text: 'ドアの開閉' }),
        this.seg([['short', '短い'], ['normal', '普通'], ['long', '長い']], cfg.door ?? 'normal', (v) => apply({ door: v })),
        h('h3', { text: '待機中のカゴ' }),
        this.seg([['none', 'その場'], ['lobby', 'ロビーへ'], ['spread', '分散']], cfg.standby ?? 'none', (v) => apply({ standby: v })),
        h('h3', { text: 'ラッシュ運転' }),
        h('p', { class: 'small', text: '朝は空のカゴをロビーへ、夕方は上の階へ回します' }),
        this.seg([[false, 'オフ'], [true, 'オン']], !!cfg.rush, (v) => apply({ rush: v })));
      // 停止階
      const skip = new Set(cfg.skip || []);
      const express = e.type === 'express';
      const floors = [];
      for (let f = e.hi; f >= e.lo; f--) floors.push(f);
      body.append(h('h3', { text: '停止階（押すと止まる／通過を切り替え）' }));
      body.append(h('p', { class: 'small', text: express
        ? '急行は最初はロビー階（★印）と地下だけに止まります。ほかの階も止まるようにできます。止まる階は2つ以上必要です。'
        : '★印はロビー階です。止まる階は2つ以上必要です。' }));
      const grid = h('div', { class: 'stops' });
      for (const f of floors) {
        const stop = !skip.has(f);
        const lobby = LOBBY_FLOORS.includes(f);
        grid.append(h('button', {
          class: 'btn stop-b' + (stop ? ' is-on' : '') + (lobby ? ' lobby' : ''), 'aria-pressed': stop ? 'true' : 'false',
          title: `${floorName(f)}${lobby ? '（ロビー階）' : ''}: ${stop ? '止まる' : '通過'}`,
          text: (lobby ? '★' : '') + floorName(f),
          onclick: () => { const ns = new Set(skip); if (stop) ns.add(f); else ns.delete(f); apply({ skip: [...ns].sort((a, b) => a - b) }); },
        }));
      }
      body.append(grid, h('div', { class: 'stops-foot' },
        h('span', { class: 'small', text: `通過 ${skip.size}階` }),
        h('button', { class: 'btn btn-small', text: 'すべて止まる', disabled: !skip.size, onclick: () => apply({ skip: [] }) })));
    };
    render();
    const e0 = sim.objs.get(id);
    const p = this.open({ title: `${TYPES[e0?.type]?.name || 'エレベーター'}の設定`, body, wide: true, buttons: [{ label: '閉じる', primary: true }] });
    closeFn = p;
    return closeFn;
  }

  status() {
    const app = this.app;
    const sim = app.sim;
    if (!sim) return;
    const body = h('div');
    const star = Math.max(1, Math.min(5, sim.star | 0));
    body.append(h('div', { class: 'big-stars', html: sim.tower ? 'TOWER' : '★'.repeat(star) + `<span class="dim">${'★'.repeat(5 - star)}</span>` }));
    let prog = null;
    try { prog = sim.starProgress(); } catch (e) { console.error(e); }
    if (prog) {
      const nextLabel = prog.next == null ? null : typeof prog.next === 'number' ? `★${prog.next}` : String(prog.next);
      body.append(h('h3', { text: nextLabel ? `${nextLabel} への条件` : '最高ランクに到達しました' }));
      if (Array.isArray(prog.reqs) && prog.reqs.length) {
        const ul = h('ul', { class: 'reqs' });
        for (const r of prog.reqs) ul.append(h('li', { class: r.done ? 'done' : '' }, h('span', { class: 'ck', text: r.done ? '✓' : '' }), h('span', { text: r.label })));
        body.append(ul);
      }
    } else if (star < 5) {
      body.append(h('p', { text: `次の★まで: 人口 ${STAR_POP[star + 1].toLocaleString()}人` }));
    }
    body.append(h('h3', { text: '財務' }));
    const lg = sim.ledger || { income: 0, expense: 0 };
    const y = sim.yesterday;
    const cell = (v, sign) => h('td', { class: v == null ? '' : sign > 0 ? 'pos' : sign < 0 ? 'neg' : '', text: v == null ? '—' : fmtMoney(v) });
    const net = (l) => (l ? (l.income || 0) - (l.expense || 0) : null);
    body.append(h('table', { class: 'fin' },
      h('tr', {}, h('th', { text: '' }), h('th', { text: '今日' }), h('th', { text: '昨日' })),
      h('tr', {}, h('th', { text: '収入' }), cell(lg.income || 0, 1), cell(y ? y.income || 0 : null, 1)),
      h('tr', {}, h('th', { text: '支出' }), cell(lg.expense || 0, -1), cell(y ? y.expense || 0 : null, -1)),
      h('tr', {}, h('th', { text: '収支' }), cell(net(lg), Math.sign(net(lg))), cell(net(y), y ? Math.sign(net(y)) : 0))));
    body.append(h('table', { class: 'stats', style: 'margin-top:10px' },
      h('tr', {}, h('th', { text: '資金' }), h('td', { text: fmtMoney(sim.money) })),
      h('tr', {}, h('th', { text: '人口' }), h('td', { text: `${(sim.pop | 0).toLocaleString('en-US')}人` })),
      h('tr', {}, h('th', { text: '施設の数' }), h('td', { text: `${sim.objs ? sim.objs.size : 0}` }))));
    return this.open({ title: 'タワーの状況', body, buttons: [{ label: '閉じる', primary: true }] });
  }

  help() {
    const touch = matchMedia('(hover: none)').matches;
    const body = h('div', { html: `
      <h3>目標</h3>
      <p>1Fにロビーを作り、オフィス・マンション・ホテル・お店を建ててビルに人を呼び込みましょう。人口が増えると★が上がり、新しい施設が建てられるようになります。★5で100Fに大聖堂を建て、結婚式が成功すれば最高ランク「TOWER」達成です。</p>
      <h3>はじめの一歩</h3>
      <ul>
        <li>「基本」の<b>ロビー</b>を1Fに横長に置く（人の出入口）</li>
        <li>上の階に<b>フロア</b>を伸ばし、<b>エレベーター</b>を縦にドラッグして各階をつなぐ</li>
        <li><b>オフィス</b>や<b>マンション</b>を置くと入居者が来て収入が入る</li>
        <li>エレベーターが混んだら施設を選んで<b>カゴを増やす</b>。待ち時間が長いと人のストレス（ピンク→赤）が上がり、評価が下がって退去してしまう</li>
        <li>ホテルは<b>ハウスキーピング</b>、事件には<b>警備室</b>が必要</li>
        <li>建てた施設はしばらく<b>工事中</b>（足場とクレーン）。完成するまで使えません</li>
        <li>地下に<b>ごみ集積所</b>（サービス・地下2フロア分）を建てる。ビル全体のごみを集め、毎朝収集車が回収する。無い・満杯だと評価が下がる</li>
        <li>★3からは車で来る入居者がいる。地下に<b>駐車場</b>（★2で解放）を用意しないと評価が下がる</li>
      </ul>
      <h3>便利な機能</h3>
      <ul>
        <li><b>全体図</b>（右下）: タップでその場所へ移動</li>
        <li><b>エレベーター</b>を選ぶと ▲▼ のつまみで伸縮。「⚙ 運転設定」で止まる階・速度・ドア・待機・ラッシュ運転</li>
        <li><b>コピー</b>: 範囲を選んで、別の場所にまとめて建てる</li>
        <li>深夜 0〜6 時は自動で ×4 の<b>早送り</b>（事件中は止まる）</li>
        <li>施設のパネルの<b>評価の内訳</b>で、評価が悪い理由がわかる</li>
      </ul>
      <h3>操作（${touch ? 'スマホ・タブレット' : 'パソコン'}）</h3>
      ${touch ? `
      <table class="keys">
        <tr><td>1本指でドラッグ</td><td>スクロール（建設ツールの「フロア・ロビー・撤去・エレベーター」選択中は配置）</td></tr>
        <tr><td>指を置いて滑らせる</td><td>施設を選んでいるとき: ゴーストが指の少し上に出て、指に合わせて動く。離すと仮置き → ✓ で確定</td></tr>
        <tr><td>2本指</td><td>ピンチでズーム、ドラッグでスクロール</td></tr>
        <tr><td>タップ</td><td>施設を調べる／施設を仮置き → もう一度タップか「✓ 建設」で確定</td></tr>
        <tr><td>下のツールバー</td><td>横にスクロールして施設を選ぶ。もう一度押すと「調べる」に戻る</td></tr>
      </table>` : `
      <table class="keys">
        <tr><td>左クリック／ドラッグ</td><td>建設（フロア・ロビー・撤去は横、エレベーターは縦にドラッグ）</td></tr>
        <tr><td>右・中ドラッグ／<kbd>Space</kbd>＋ドラッグ</td><td>スクロール（「調べる」中は左ドラッグでも可）</td></tr>
        <tr><td>ホイール</td><td>スクロール（<kbd>Shift</kbd>で横）</td></tr>
        <tr><td><kbd>Ctrl</kbd>＋ホイール／ピンチ</td><td>ズーム（<kbd>+</kbd> <kbd>-</kbd> キーでも）</td></tr>
        <tr><td><kbd>←↑↓→</kbd> / <kbd>WASD</kbd></td><td>スクロール</td></tr>
        <tr><td><kbd>Space</kbd></td><td>一時停止／再開</td></tr>
        <tr><td><kbd>0</kbd>〜<kbd>4</kbd> / <kbd>5</kbd></td><td>速度（停止・1・2・4・8倍）／リアルタイム</td></tr>
        <tr><td><kbd>F3</kbd></td><td>性能表示</td></tr>
        <tr><td><kbd>Esc</kbd> / <kbd>I</kbd></td><td>「調べる」に戻る・閉じる</td></tr>
        <tr><td><kbd>F</kbd> <kbd>L</kbd> <kbd>E</kbd> <kbd>X</kbd> <kbd>T</kbd></td><td>フロア・ロビー・エレベーター・急行・階段</td></tr>
        <tr><td><kbd>O</kbd> <kbd>C</kbd> <kbd>H</kbd> <kbd>R</kbd> <kbd>B</kbd></td><td>オフィス・マンション・シングル・レストラン・撤去</td></tr>
        <tr><td><kbd>K</kbd> / <kbd>Ctrl+C</kbd></td><td>コピー</td></tr>
        <tr><td><kbd>Home</kbd> / <kbd>M</kbd> / <kbd>Ctrl+S</kbd></td><td>1Fへ戻る／効果音／セーブ</td></tr>
      </table>`}
      <h3>セーブ</h3>
      <p>ゲーム内の1日ごとと、ページを閉じるときに自動でブラウザに保存されます。別の端末へ移すときはメニューの「セーブデータの書き出し／読み込み」を使ってください。</p>
      <p style="font-size:12px;color:#666">このゲームはファンメイドのオリジナル作品で、既存のゲーム会社・作品とは関係ありません。</p>` });
    return this.open({ title: '遊び方', body, wide: true, buttons: [{ label: 'OK', primary: true }] });
  }

  /** セーブデータの書き出し・読み込み（ファイル or コピペ） */
  saveIO(importOnly = false) {
    const app = this.app;
    const body = h('div');
    if (!importOnly && app.sim && app.started) {
      let text = '';
      try { text = exportText(app.sim, app.uiState()); } catch (e) { text = ''; }
      const ta = h('textarea', { class: 'io', readonly: true, spellcheck: 'false' });
      ta.value = text;
      body.append(
        h('h3', { text: '書き出し' }),
        h('p', { text: '今の状態をファイルに保存するか、下の文字列をコピーして保管してください。' }),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px' },
          h('button', { class: 'btn', text: '⬇ ファイルに保存', onclick: () => {
            const d = new Date();
            const name = `the-building-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${app.sim.day + 1}d.json`;
            if (downloadText(name, text)) app.toasts.show({ text: 'セーブデータをファイルに保存しました', kind: 'good' });
          } }),
          h('button', { class: 'btn', text: '📋 コピー', onclick: async () => {
            try { await navigator.clipboard.writeText(text); app.toasts.show({ text: 'クリップボードにコピーしました', kind: 'good' }); } catch {
              ta.focus(); ta.select();
              try { document.execCommand('copy'); app.toasts.show({ text: 'コピーしました', kind: 'good' }); } catch { app.toasts.show({ text: '文字列を選択してコピーしてください', kind: 'info' }); }
            }
          } })),
        ta);
    }
    const ta2 = h('textarea', { class: 'io', placeholder: 'ここにセーブデータの文字列を貼り付け', spellcheck: 'false' });
    const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: 'display:none' });
    const doImport = (text) => {
      let obj;
      try { obj = parseImport(text); } catch (e) { app.toasts.show({ text: '読み込めません: ' + e.message, kind: 'bad' }); app.sound.play('error'); return false; }
      const top = this.stack[this.stack.length - 1];
      if (top) top.close(null);
      app.loadFromObject(obj, true);
      return true;
    };
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => doImport(String(rd.result || ''));
      rd.onerror = () => app.toasts.show({ text: 'ファイルを読めませんでした', kind: 'bad' });
      rd.readAsText(f);
      file.value = '';
    });
    body.append(
      h('h3', { text: '読み込み' }),
      h('p', { text: '読み込むと今の進行は置き換わります。' }),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px' },
        h('button', { class: 'btn', text: '📂 ファイルを選ぶ', onclick: () => file.click() }), file),
      ta2,
      h('div', { style: 'display:flex;justify-content:flex-end;margin-top:8px' },
        h('button', { class: 'btn btn-primary', text: '貼り付けた文字列を読み込む', onclick: () => doImport(ta2.value) })));
    if (!storage.available) body.prepend(h('p', { style: 'color:#b22', text: '※ このブラウザ（プライベートモード等）では自動保存が使えません。書き出しで保存してください。' }));
    return this.open({ title: importOnly ? 'セーブデータを読み込む' : 'セーブデータの書き出し／読み込み', body, wide: true });
  }

  saveInfoText() {
    const s = peekSave();
    if (!s) return '';
    const m = s.meta || {};
    const parts = [];
    if (m.tower) parts.push('TOWER');
    else if (m.star) parts.push('★' + m.star);
    if (m.pop != null) parts.push(`人口 ${Number(m.pop).toLocaleString('en-US')}`);
    if (m.day != null) parts.push(`${m.day + 1}日目`);
    if (s.savedAt) {
      const d = new Date(s.savedAt);
      parts.push(`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 保存`);
    }
    return parts.join(' ・ ');
  }
}
