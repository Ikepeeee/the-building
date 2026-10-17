// アプリ本体: ゲームループ・sim と renderer の接続・ツール・セーブの流れ
import { TYPES, W, MIN_F, MAX_F, FLOOR_H, SPEEDS, GAME_MIN_PER_SEC, fmtMoney, floorName } from '../sim/constants.js';
import { Camera } from './camera.js';
import { Input, isDragTool } from './input.js';
import { Hud } from './hud.js';
import { Toolbar } from './toolbar.js';
import { Panel } from './panel.js';
import { Toasts } from './toast.js';
import { Dialogs } from './dialogs.js';
import { Sound } from './audio.js';
import { saveGame, loadCandidates, peekSave, storage } from './save.js';
import { Guide } from './guide.js';

const MAX_FRAME_SEC = 0.1; // 1フレームで進める実時間の上限（スパイク対策）
const isTouchDevice = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

export class App {
  constructor({ Tower, Renderer }) {
    this.Tower = Tower;
    this.Renderer = Renderer;
    this.root = document.getElementById('app');
    this.canvas = document.getElementById('view');
    this.cam = new Camera();
    this.sound = new Sound();
    this.tool = 'inspect';
    this.speedIdx = 1;
    this.prevSpeed = 1;
    this.selectedId = null;
    this.hover = null;
    this.hoverGhost = null;
    this.dragGhost = null;
    this.pending = null; // タッチの仮置き {tool, p, ghost}
    this.started = false; // タイトルを抜けてプレイ中
    this.lastDay = 0;
    this.errors = 0;
    this.restoring = false;
    this.lastT = 0;
    this.raf = 0;
    this.uiTimer = 0;
    this.slowTimer = 0;
    this.soundFlag = false;
    this.warnedStorage = false;

    this.sim = new Tower();
    this.renderer = new Renderer(this.canvas, this.sim);
    this.attachSim(this.sim);

    this.toasts = new Toasts(this, document.getElementById('toasts'));
    this.dialogs = new Dialogs(this);
    this.hud = new Hud(this);
    this.toolbar = new Toolbar(this);
    this.panel = new Panel(this);
    this.input = new Input(this);
    this.guide = new Guide(this);
    this.simFailed = false; // sim.step が例外を出したら自動保存を止める

    this.setupConfirmBar();
    this.setupTitle();
    this.setupResize();
    this.setupLifecycle();
    this.frame = this.frame.bind(this);
    this.setTool('inspect');
  }

  start() {
    this.showTitle();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------- sim の接続 ----------------
  attachSim(sim) {
    const mine = (fn) => (d) => { if (sim === this.sim) fn(d || {}); };
    sim.on('message', mine((m) => this.toasts && this.toasts.show(m)));
    sim.on('prompt', mine((p) => { if (!this.restoring) this.dialogs.enqueue({ type: 'prompt', data: p }); }));
    sim.on('star', mine((s) => { if (!this.restoring && this.started) this.dialogs.enqueue({ type: 'star', star: s.star }); }));
    sim.on('tower', mine(() => { if (!this.restoring && this.started) this.dialogs.enqueue({ type: 'tower' }); }));
    sim.on('sound', mine((s) => { this.soundFlag = true; if (!this.restoring) this.sound.play(s.name); }));
  }

  setSim(sim) {
    this.sim = sim;
    this.renderer.setSim(sim);
    this.lastDay = sim.day;
    this.panel.close();
    this.selectedId = null;
    this.pending = null;
    this.hoverGhost = this.dragGhost = null;
    this.dialogs.clearQueue();
    this.toasts.clear();
    this.toolbar.seenStar = sim.star;
    this.toolbar.newKeys.clear();
    this.toolbar.update(true);
    this.updateConfirmBar();
  }

  /** sim を呼んだ結果、sim が音を出さなかったときだけ UI 側で鳴らす */
  withSoundCheck(fn) {
    this.soundFlag = false;
    const name = fn();
    if (!this.soundFlag && name) this.sound.play(name);
  }

  // ---------------- 時間・一時停止 ----------------
  blocked() { return !this.started || this.dialogs.count > 0; }

  effectiveSpeed() {
    if (this.blocked() || document.hidden) return 0;
    return SPEEDS[this.speedIdx] || 0;
  }

  setSpeed(i) {
    i = Math.max(0, Math.min(SPEEDS.length - 1, i | 0));
    if (i > 0) this.prevSpeed = i;
    this.speedIdx = i;
    this.hud.update();
  }

  togglePause() {
    this.setSpeed(this.speedIdx === 0 ? this.prevSpeed || 1 : 0);
    this.sound.play('click');
  }

  onModalChange() {
    if (this.hud) this.hud.update();
    // モーダルが開いたら押しかけの操作はすべて取り消す（裏で建設されないように）
    if (this.input && this.dialogs.count > 0) { this.input.cancelAll(); this.dragGhost = null; }
  }

  userGesture() { this.sound.unlock(); }

  toggleMute() {
    this.sound.unlock();
    this.sound.setMuted(!this.sound.muted);
    this.hud.update();
    this.toasts.show({ text: this.sound.muted ? '効果音をオフにしました' : '効果音をオンにしました', kind: 'info' });
  }

  // ---------------- ゲームループ ----------------
  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, MAX_FRAME_SEC);

    this.input.update(dt);
    this.cam.update(now);

    const spd = this.effectiveSpeed();
    if (spd > 0) {
      try {
        this.sim.step(dt * GAME_MIN_PER_SEC * spd);
      } catch (e) {
        this.reportError(e, 'sim.step');
      }
      if (this.sim.day !== this.lastDay) {
        this.lastDay = this.sim.day;
        this.autosave();
      }
    }

    if (now - this.uiTimer > 150) {
      this.uiTimer = now;
      this.hud.update();
      this.panel.refresh();
    }
    if (now - this.slowTimer > 400) {
      this.slowTimer = now;
      this.toolbar.update();
      this.recheckGhosts();
      this.guide.update();
    }

    try {
      this.renderer.render({
        cam: this.cam.view,
        ghost: this.started ? this.dragGhost || (this.pending && this.pending.ghost) || this.hoverGhost : null,
        selectedId: this.selectedId,
        hover: this.started && this.input.lastType === 'mouse' ? this.hover : null,
        nowMs: now,
      });
    } catch (e) {
      this.reportError(e, 'renderer.render');
    }
  }

  reportError(e, where) {
    this.errors++;
    if (where === 'sim.step' && !this.simFailed) {
      this.simFailed = true;
      this.toasts.show({ text: 'エラーのため自動保存を止めました（壊れた状態で上書きしないため）', kind: 'bad' });
    }
    if (this.errors <= 5) console.error(`[${where}]`, e);
    if (this.errors === 3) this.toasts.show({ text: '内部エラーが発生しました（コンソールを確認してください）', kind: 'bad' });
  }

  // ---------------- 画面サイズ ----------------
  setupResize() {
    const hud = document.getElementById('hud');
    const tb = document.getElementById('toolbar');
    let queued = false;
    let first = true;
    const apply = () => {
      queued = false;
      // スマホ横向きなど低い画面では、ツールバーを左の縦列にする
      const side = matchMedia('(max-height: 520px) and (orientation: landscape)').matches;
      this.root.classList.toggle('side-tb', side);
      // renderer が canvas に px 指定の style を付けるので、外してから CSS 上の大きさを測る
      this.canvas.style.width = ''; this.canvas.style.height = '';
      const w = this.canvas.clientWidth || this.root.clientWidth, hgt = this.canvas.clientHeight || this.root.clientHeight;
      const hudH = this.started ? hud.offsetHeight : 0;
      const tbH = this.started && !side ? tb.offsetHeight : 0;
      this.root.style.setProperty('--hud-h', hudH + 'px');
      this.root.style.setProperty('--tb-h', tbH + 'px');
      try { this.renderer.resize(w, hgt); } catch (e) { this.reportError(e, 'renderer.resize'); }
      this.cam.setViewport(w, hgt, hudH, tbH);
      if (first) { first = false; this.cam.home(); }
    };
    this.layout = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
    this.layoutNow = apply;
    window.addEventListener('resize', this.layout);
    window.addEventListener('orientationchange', this.layout);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(this.layout);
      ro.observe(this.root); ro.observe(hud); ro.observe(tb);
    }
    apply();
  }

  // ---------------- タブ非表示・離脱 ----------------
  setupLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.autosave();
        this.sound.suspend();
      } else {
        this.sound.resume();
        this.lastT = performance.now();
        if (!this.raf) this.raf = requestAnimationFrame(this.frame);
      }
    });
    window.addEventListener('pagehide', () => this.autosave());
    window.addEventListener('beforeunload', () => this.autosave());
  }

  // ---------------- ツール ----------------
  setTool(key) {
    if (key !== 'inspect' && key !== 'bulldoze') {
      const t = TYPES[key];
      if (!t) return;
      if (this.sim && this.sim.star < t.star) {
        this.toasts.show({ text: `${t.name}は★${t.star}で解放されます`, kind: 'info' });
        this.sound.play('error');
        return;
      }
    }
    this.tool = key;
    this.pending = null;
    this.hoverGhost = null;
    this.dragGhost = null;
    if (key !== 'inspect') {
      this.toolbar.reveal(key);
      if (isTouchDevice() || this.root.clientWidth < 760) this.panel.close();
    }
    this.toolbar.update(true);
    this.updateHint();
    this.updateConfirmBar();
    this.input.updateCursor();
    if (this.hover && key !== 'inspect') this.hoverAt(this.hover);
  }

  updateHint() {
    const touch = isTouchDevice();
    const key = this.tool;
    let s;
    if (key === 'inspect') s = touch ? 'タップで詳細／1本指でスクロール／2本指でズーム' : '施設をクリックで詳細／ドラッグ・ホイールでスクロール／Ctrl+ホイールでズーム';
    else if (key === 'bulldoze') s = touch ? '撤去: 横になぞって範囲を選び ✓ で確定（返金なし）' : '撤去: 横にドラッグした範囲を撤去（施設があれば確認します。返金なし）';
    else {
      const t = TYPES[key];
      const how = t.drag === 'h' ? (touch ? '横になぞって設置' : '横にドラッグして設置')
        : t.drag === 'v' ? (touch ? '縦になぞって範囲を決める' : '縦にドラッグして範囲を決める')
          : touch ? '指の位置が中心。タップで仮置き→再タップか✓で確定' : 'クリックで設置（カーソルの位置が施設の中心）';
      s = touch ? `${t.name}: ${how}。${t.desc || ''}` : `${t.name}: ${t.desc || ''}｜${how}`;
    }
    this.toolbar.setHint(s);
  }

  clampCell(c) {
    return { f: Math.max(MIN_F, Math.min(MAX_F, c.f)), x: Math.max(0, Math.min(W - 1, c.x)) };
  }

  clickParams(tool, cell) {
    const t = TYPES[tool];
    const c = this.clampCell(cell);
    const h = t.h || 1;
    const w = t.w || 1;
    let f = t.only === 'basement' ? c.f - (h - 1) : c.f;
    f = Math.max(MIN_F, Math.min(MAX_F - h + 1, f));
    return { f, x: Math.max(0, Math.min(W - w, c.x - Math.floor(w / 2))) };
  }

  paramsFor(tool, a, b) {
    const A = this.clampCell(a), B = this.clampCell(b);
    const t = TYPES[tool];
    if (tool === 'bulldoze' || (t && t.drag === 'h')) return { f: A.f, x: A.x, x2: B.x };
    if (t && t.drag === 'v') return { f: A.f, x: Math.max(0, Math.min(W - t.w, A.x - Math.floor(t.w / 2))), f2: B.f };
    return this.clickParams(tool, b);
  }

  evalGhost(tool, p) {
    let r = null;
    try { r = this.sim.check(tool, p); } catch (e) { this.reportError(e, 'sim.check'); }
    if (!r || !r.ghost) return null;
    let label;
    if (r.ok) label = tool === 'bulldoze' ? (r.cost ? `撤去 ${fmtMoney(r.cost)}` : '撤去') : fmtMoney(r.cost || 0);
    else label = r.reason || '置けません';
    return { ...r.ghost, type: tool === 'bulldoze' ? undefined : tool, ok: !!r.ok, label, res: r };
  }

  /** マウスのホバー（PC のゴースト表示） */
  hoverAt(cell, dragging) {
    this.hover = cell ? this.clampCell(cell) : null;
    if (dragging) return;
    if (!cell || this.tool === 'inspect' || !this.started) { this.hoverGhost = null; return; }
    const p = isDragTool(this.tool) ? this.paramsFor(this.tool, cell, cell) : this.clickParams(this.tool, cell);
    this.hoverGhost = this.evalGhost(this.tool, p);
    this.hoverParams = p;
  }

  recheckGhosts() {
    if (!this.started) return;
    if (this.pending) {
      this.pending.ghost = this.evalGhost(this.pending.tool, this.pending.p);
      this.updateConfirmBar();
    }
    if (this.hoverGhost && this.hoverParams && this.tool !== 'inspect') this.hoverGhost = this.evalGhost(this.tool, this.hoverParams);
  }

  dragUpdate(d) {
    this.hoverGhost = null;
    this.dragGhost = this.evalGhost(d.tool, this.paramsFor(d.tool, d.start, d.cur));
  }

  dragCancel() {
    this.dragGhost = null;
  }

  dragEnd(d) {
    this.dragGhost = null;
    const p = this.paramsFor(d.tool, d.start, d.cur);
    if (d.touch) {
      const same = d.start.f === d.cur.f && d.start.x === d.cur.x;
      if (same && this.pending && this.inGhost(this.pending.ghost, d.cur)) { this.confirmPending(); return; }
      if (d.tool === 'bulldoze') { this.setPending(d.tool, p); return; }
    }
    if (d.tool === 'bulldoze' && !d.touch) { this.confirmBulldoze(p); return; }
    this.doBuild(d.tool, p);
  }

  /** PC の撤去: 施設を含むときだけ確認する（空きフロアだけならすぐ撤去） */
  async confirmBulldoze(p) {
    const ids = new Set();
    const row = this.sim.grid && this.sim.grid[p.f];
    const a = Math.min(p.x, p.x2 ?? p.x), b = Math.max(p.x, p.x2 ?? p.x);
    if (row) for (let x = Math.max(0, a); x <= Math.min(W - 1, b); x++) if (row[x] > 0) ids.add(row[x]);
    if (ids.size) {
      const names = [...ids].map((id) => TYPES[this.sim.objs.get(id)?.type]?.name).filter(Boolean);
      const uniq = [...new Set(names)].slice(0, 4).join('・');
      const ok = await this.dialogs.confirm(`${ids.size}件の施設を撤去しますか？`, { text: `${uniq}${names.length > 4 ? ' など' : ''}を撤去します。元に戻せません。返金はありません。`, okLabel: '撤去する', danger: true });
      if (!ok) return;
    }
    this.doBuild('bulldoze', p);
  }

  inGhost(g, c) {
    if (!g || !c) return false;
    const lo = g.lo ?? g.f, hi = g.hi ?? g.f + (g.h || 1) - 1;
    return c.x >= g.x && c.x < g.x + g.w && c.f >= lo && c.f <= hi;
  }

  tapAt(cell, touch) {
    if (!this.started) return;
    if (this.tool === 'inspect') {
      const c = this.clampCell(cell);
      let o = null;
      try { o = cell.f >= MIN_F && cell.f <= MAX_F && cell.x >= 0 && cell.x < W ? this.sim.objAt(c.f, c.x) : null; } catch (e) { this.reportError(e, 'sim.objAt'); }
      if (o) this.select(o.id);
      else { this.panel.close(); }
      return;
    }
    if (isDragTool(this.tool)) return;
    const p = this.clickParams(this.tool, cell);
    if (!touch) { this.doBuild(this.tool, p); return; }
    if (this.pending && this.pending.tool === this.tool && this.inGhost(this.pending.ghost, cell)) { this.confirmPending(); return; }
    this.setPending(this.tool, p);
  }

  setPending(tool, p) {
    const ghost = this.evalGhost(tool, p);
    this.pending = ghost ? { tool, p, ghost } : null;
    if (ghost && !ghost.ok) this.sound.play('error');
    else this.sound.play('click');
    this.updateConfirmBar();
  }

  confirmPending() {
    const pd = this.pending;
    if (!pd) return;
    this.doBuild(pd.tool, pd.p);
  }

  cancelPending() {
    this.pending = null;
    this.updateConfirmBar();
  }

  doBuild(tool, p) {
    let r = null;
    this.withSoundCheck(() => {
      try { r = this.sim.build(tool, p); } catch (e) { this.reportError(e, 'sim.build'); r = { ok: false, reason: 'エラーが発生しました' }; }
      if (!r) return null;
      if (r.ok) return tool === 'bulldoze' ? 'bulldoze' : 'build';
      return 'error';
    });
    if (!r) return;
    if (r.ok) {
      this.pending = null;
      this.updateConfirmBar();
      this.toolbar.update();
      if (this.hover && this.input.lastType === 'mouse') this.hoverAt(this.hover);
      if (this.firstBuildTip === undefined && tool === 'lobby') {
        this.firstBuildTip = true;
        this.toasts.show({ text: '次はフロアを上に伸ばし、エレベーターでつなぎましょう', kind: 'info' });
      }
    } else {
      this.toasts.show({ text: r.reason || '建設できません', kind: 'bad' });
    }
  }

  setupConfirmBar() {
    this.cb = {
      el: document.getElementById('confirm-bar'),
      name: document.getElementById('cb-name'),
      cost: document.getElementById('cb-cost'),
      ok: document.getElementById('cb-ok'),
      cancel: document.getElementById('cb-cancel'),
    };
    this.cb.ok.addEventListener('click', () => { this.userGesture(); this.confirmPending(); });
    this.cb.cancel.addEventListener('click', () => { this.cancelPending(); });
  }

  updateConfirmBar() {
    const cb = this.cb;
    if (!cb) return;
    const pd = this.pending;
    const show = !!(pd && pd.ghost);
    this.root.classList.toggle('confirming', show);
    if (!show) { cb.el.hidden = true; return; }
    cb.el.hidden = false;
    const t = TYPES[pd.tool];
    cb.name.textContent = pd.tool === 'bulldoze' ? '撤去' : t ? t.name : pd.tool;
    cb.cost.textContent = pd.ghost.label || '';
    cb.el.classList.toggle('bad', !pd.ghost.ok);
    cb.ok.disabled = !pd.ghost.ok;
    cb.ok.textContent = pd.tool === 'bulldoze' ? '✓ 撤去' : '✓ 建設';
    cb.ok.className = 'btn ' + (pd.tool === 'bulldoze' ? 'btn-danger' : 'btn-primary');
  }

  onPanelChange() {
    this.root.classList.toggle('sheet-open', !!(this.panel && this.panel.open));
  }

  // ---------------- 選択・移動 ----------------
  select(id) {
    this.selectedId = id;
    this.panel.show(id);
    this.sound.play('click');
    this.keepVisible(id);
  }

  /** ボトムシートに隠れた施設が見えるようにカメラを少しずらす */
  keepVisible(id) {
    const o = this.sim.objs && this.sim.objs.get(id);
    const el = this.panel.el;
    if (!o || el.hidden) return;
    const cr = this.canvas.getBoundingClientRect();
    if (el.offsetWidth < cr.width * 0.7) return; // 横に出るパネルなら不要
    const pr = { top: el.offsetTop + cr.top }; // アニメーション中の transform を除いた位置
    const cam = this.cam;
    const lo = o.lo ?? o.f;
    const bottomY = (-lo * FLOOR_H - cam.y) * cam.zoom;
    const limit = pr.top - cr.top - 16;
    if (bottomY > limit) {
      const dy = (bottomY - limit) / cam.zoom;
      cam.anim = { kind: 'move', x0: cam.x, y0: cam.y, z0: cam.zoom, x1: cam.x, y1: cam.y + dy, z1: cam.zoom, t0: performance.now(), dur: 300 };
    }
  }

  jumpTo(f, x) {
    if (!Number.isFinite(f) || !Number.isFinite(x)) return;
    this.cam.focus(f, x);
    let o = null;
    try { o = this.sim.objAt(f, x); } catch { /* */ }
    if (o) { this.selectedId = o.id; this.panel.show(o.id); }
  }

  escape() {
    if (this.dialogs.busy && this.dialogs.escHandler && !this.dialogs.stack.length) { const h = this.dialogs.escHandler; this.dialogs.escHandler = null; h(); return; }
    if (this.dialogs.escape()) return;
    if (!this.started) return;
    if (this.input.mode === 'drag') { this.dragCancel(); this.input.mode = null; this.input.drag = null; return; }
    if (this.pending) { this.cancelPending(); return; }
    if (this.tool !== 'inspect') { this.setTool('inspect'); return; }
    this.panel.close();
  }

  // ---------------- セーブ・ロード ----------------
  autosave() {
    if (!this.started || !this.sim || this.simFailed) return;
    const r = saveGame(this.sim);
    if (!r.ok) console.warn(r.error);
    if (r.ok && !r.persisted && !this.warnedStorage) {
      this.warnedStorage = true;
      this.toasts.show({ text: 'このブラウザでは自動保存できません。メニューの「書き出し」で保存してください', kind: 'bad' });
    }
  }

  manualSave(silent) {
    if (!this.started) return;
    if (this.simFailed) {
      if (!silent) this.toasts.show({ text: 'エラー発生後のため保存しません（書き出しは使えます）', kind: 'bad' });
      return;
    }
    const r = saveGame(this.sim);
    if (silent) return;
    if (!r.ok) { this.toasts.show({ text: r.error || 'セーブに失敗しました', kind: 'bad' }); this.sound.play('error'); return; }
    if (!r.persisted) { this.toasts.show({ text: 'ブラウザに保存できません（プライベートモード等）。メニューの「書き出し」を使ってください', kind: 'bad' }); return; }
    this.toasts.show({ text: `セーブしました（${this.sim.day + 1}日目 ${String(this.sim.hour).padStart(2, '0')}:${String(this.sim.minute).padStart(2, '0')}）`, kind: 'good' });
    this.sound.play('ding');
  }

  /** セーブ候補（本体→バックアップ）を順に試す */
  loadLatest() {
    const cands = loadCandidates();
    for (const c of cands) {
      if (this.loadFromObject(c.obj, false, c.backup)) return true;
    }
    this.toasts.show({ text: 'セーブデータを読み込めませんでした', kind: 'bad' });
    this.sound.play('error');
    return false;
  }

  loadFromObject(obj, imported, isBackup) {
    let sim;
    try {
      sim = new this.Tower();
      this.restoring = true;
      this.attachSim(sim);
      sim.restore(obj.data);
      if (typeof sim.time !== 'number' || !sim.objs) throw new Error('データが不完全です');
    } catch (e) {
      this.restoring = false;
      console.error('restore failed', e);
      if (imported) { this.toasts.show({ text: 'このセーブデータは読み込めませんでした', kind: 'bad' }); this.sound.play('error'); }
      return false;
    }
    this.restoring = false;
    this.setSim(sim);
    this.simFailed = false;
    this.enterGame();
    this.cam.home();
    this.toasts.show({ text: isBackup ? 'バックアップから読み込みました' : imported ? 'セーブデータを読み込みました' : `${sim.day + 1}日目から再開します`, kind: isBackup ? 'bad' : 'good' });
    if (imported) this.autosave();
    return true;
  }

  async askLoadBackup() {
    const c = loadCandidates().find((x) => x.backup);
    if (!c) { this.toasts.show({ text: 'バックアップはありません', kind: 'info' }); return; }
    const m = c.obj.meta || {};
    const ok = await this.dialogs.confirm('バックアップから読み込みますか？', { text: `1つ前のセーブ（${m.day != null ? m.day + 1 + '日目' : '日付不明'}${m.pop != null ? '・人口 ' + m.pop : ''}）に戻します。今の進行は失われます。`, okLabel: '読み込む' });
    if (ok && !this.loadFromObject(c.obj, false, true)) { this.toasts.show({ text: 'バックアップを読み込めませんでした', kind: 'bad' }); this.sound.play('error'); }
  }

  newGame() {
    let sim;
    try { sim = new this.Tower(); } catch (e) { this.reportError(e, 'new Tower'); return; }
    this.attachSim(sim);
    this.setSim(sim);
    this.simFailed = false;
    this.enterGame();
    this.cam.home();
    this.setSpeed(1);
    this.toasts.show({ text: 'ようこそ！ まずは「基本」→「ロビー」を1Fに横長に置きましょう', kind: 'info' });
    this.firstBuildTip = undefined;
    this.autosave();
  }

  async askNewGame() {
    if (this.started || peekSave()) {
      const ok = await this.dialogs.confirm('新しく建て始めますか？', { text: 'すぐに新しいビルで保存し直します。今のセーブはバックアップとして残り、次の自動保存（ゲーム内で1日後）まではメニューの「バックアップから読み込む」で戻せます。', okLabel: '新しく建てる', danger: true });
      if (!ok) return;
    }
    this.newGame();
  }

  async askLoad() {
    if (!peekSave()) { this.toasts.show({ text: 'セーブデータがありません', kind: 'info' }); return; }
    const ok = await this.dialogs.confirm('最後のセーブを読み込みますか？', { text: 'セーブ後の進行は失われます。', okLabel: '読み込む' });
    if (ok) this.loadLatest();
  }

  // ---------------- タイトル ----------------
  setupTitle() {
    const $ = (id) => document.getElementById(id);
    $('t-new').addEventListener('click', () => { this.userGesture(); this.sound.play('click'); this.askNewGame(); });
    $('t-continue').addEventListener('click', () => { this.userGesture(); this.sound.play('click'); this.loadLatest(); });
    $('t-help').addEventListener('click', () => { this.userGesture(); this.dialogs.help(); });
    $('t-import').addEventListener('click', () => { this.userGesture(); this.dialogs.saveIO(true); });
  }

  showTitle() {
    this.started = false;
    this.root.classList.add('is-title');
    const info = this.dialogs.saveInfoText();
    const cont = document.getElementById('t-continue');
    cont.disabled = !info;
    document.getElementById('t-saveinfo').textContent = info || (storage.available ? 'セーブデータはありません' : 'このブラウザでは自動保存が使えません');
    (info ? cont : document.getElementById('t-new')).focus?.({ preventScroll: true });
    this.layoutNow && this.layoutNow();
  }

  enterGame() {
    this.dialogs.closeAll();
    this.started = true;
    this.root.classList.remove('is-title');
    this.setTool('inspect');
    this.lastDay = this.sim.day;
    this.layoutNow();
    this.hud.update();
    this.toolbar.update(true);
  }

  toTitle() {
    this.autosave();
    this.panel.close();
    this.pending = null;
    this.updateConfirmBar();
    this.dialogs.clearQueue();
    this.showTitle();
  }
}
