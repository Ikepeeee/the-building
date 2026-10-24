// アプリ本体: ゲームループ・sim と renderer の接続・ツール・セーブの流れ
import { TYPES, W, MIN_F, MAX_F, FLOOR_H, TILE_W, GAME_MIN_PER_SEC, fmtMoney, floorName, screenToWorld } from '../sim/constants.js';
import { UI_SPEEDS, SPEED_ONE } from './speeds.js';
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
import { CopyTool } from './copytool.js';
import { ElevatorResize } from './resize.js';
import { Minimap } from './minimap.js';
import { Ambience } from './ambience.js';
import { Perf } from './perf.js';
import { TRANSPORT_TYPES } from '../sim/constants.js';

const TRANSPORT_SET = new Set(TRANSPORT_TYPES);

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
    this.speedIdx = SPEED_ONE;
    this.prevSpeed = SPEED_ONE;
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
    this.copy = new CopyTool(this);
    this.resize = new ElevatorResize(this);
    this.minimap = new Minimap(this);
    this.ambience = new Ambience(this.sound);
    this.hoverGhosts = null;
    this.selectedPerson = null;
    this.follow = false;
    this.overlay = null; // 'eval' で評価の網掛け
    this.ambTimer = 0;
    this.nightFF = false;
    this.simFailed = false; // sim.step が例外を出したら自動保存を止める

    this.perf = new Perf(this);
    this.setupConfirmBar();
    this.setupCopyBar();
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
    sim.on('message', mine((m) => { if (m.kind === 'event' && !this.restoring) this.calmSpeed(); if (this.toasts) this.toasts.show(m); }));
    sim.on('prompt', mine((p) => { if (!this.restoring) { this.calmSpeed(); this.dialogs.enqueue({ type: 'prompt', data: p }); } }));
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
    const base = (UI_SPEEDS[this.speedIdx] || UI_SPEEDS[0]).v;
    return base * (this.nightFF ? 4 : 1);
  }

  /** 事件が起きているか（夜の早送りを止める） */
  eventActive() {
    const s = this.sim;
    if (!s) return false;
    return !!(s.bomb || s.heli || s.fire || (s.fires && s.fires.length) || (s.vip && s.vip.active) || this.dialogs.count);
  }

  /** 深夜（0〜6時）で事件中でなければ、さらに ×4 */
  updateNightFF() {
    const s = this.sim;
    const sp = UI_SPEEDS[this.speedIdx];
    this.nightFF = !!(this.started && s && s.hour < 6 && sp && sp.v > 0 && !sp.rt && !this.eventActive());
  }

  /** 事件のときは等速に戻す */
  calmSpeed() {
    if ((UI_SPEEDS[this.speedIdx] || {}).v > 1) {
      this.setSpeed(SPEED_ONE);
      this.toasts.show({ text: '事件のため速度を等速に戻しました', kind: 'info' });
    }
    this.nightFF = false;
  }

  setSpeed(i) {
    i = Math.max(0, Math.min(UI_SPEEDS.length - 1, i | 0));
    if (i > 0) this.prevSpeed = i;
    this.speedIdx = i;
    this.hud.update();
  }

  togglePause() {
    this.setSpeed(this.speedIdx === 0 ? this.prevSpeed || SPEED_ONE : 0);
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
    const tA = performance.now();
    const dtMs = now - this.lastT;
    let simMs = 0, renderMs = 0;
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, MAX_FRAME_SEC);

    this.input.update(dt);
    this.cam.update(now);
    this.updateNightFF();
    this.updateFollow(dt);

    const spd = this.effectiveSpeed();
    if (spd > 0) {
      try {
        const t0 = performance.now();
        this.sim.step(dt * GAME_MIN_PER_SEC * spd, 4); // 1フレームの計算は最大4msまで（残りは次のフレームへ）
        simMs = performance.now() - t0;
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
    }
    if (now - (this.guideTimer || 0) > 1500) { this.guideTimer = now; this.guide.update(); }
    // 遊んでいない（タイトル・一時停止）ときは AudioContext を止める
    this.sound.idle(!this.started || (spd === 0 && !this.dialogs.count));
    if (now - this.ambTimer > 200) {
      this.ambTimer = now;
      try { this.ambience.update(this); } catch (e) { this.reportError(e, 'ambience'); }
    }
    this.resize.frame(dt);
    if (this.started) this.minimap.draw(now);

    const tR = performance.now();
    try {
      this.renderer.render({
        cam: this.cam.view,
        ghost: this.started ? this.dragGhost || (this.pending && this.pending.ghost) || this.hoverGhost : null,
        ghosts: this.started ? (this.pending && this.pending.ghosts) || (this.tool === 'copy' && this.input.lastType === 'mouse' ? this.hoverGhosts : null) : null,
        marked: this.started && this.tool === 'copy' && this.copy.marked.size ? this.copy.marked : null,
        selectedId: this.selectedId,
        selectedPerson: this.selectedPerson || null,
        overlay: this.started ? this.overlay : null,
        simplifyPeople: spd >= 4, // 4倍速以上（夜の早送りを含む）は歩く人の描写を省く
        hover: this.started && this.input.lastType === 'mouse' ? this.hover : null,
        nowMs: now,
      });
    } catch (e) {
      this.reportError(e, 'renderer.render');
    }
    const tEnd = performance.now();
    renderMs = tEnd - tR;
    this.perf.record(now, dtMs, simMs, renderMs, Math.max(0, tEnd - tA - simMs - renderMs));
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
      try { this.perf.resizeRenderer(this.renderer, w, hgt); } catch (e) { this.reportError(e, 'renderer.resize'); }
      if (this.minimap) this.minimap.measure();
      if (this.resize) this.resize.measure();
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
    if (key !== 'inspect' && key !== 'bulldoze' && key !== 'copy') {
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
    this.hoverGhosts = null;
    this.dragGhost = null;
    this.copy.reset();
    this.resize.cancel();
    this.updateCopyBar();
    if (key !== 'inspect') {
      if (TYPES[key]) this.toolbar.reveal(key);
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
    else if (key === 'copy') {
      s = this.copy.phase === 'paste'
        ? (touch ? 'コピー: 指で上下に動かして ✓ で建設（横は「↔」で解除）' : 'コピー: 貼り付けたい階でクリック（横はコピー元と同じ。Shift で横も動かす）。Esc で選び直す')
        : (touch ? 'コピー: なぞって範囲を選ぶ／施設をタップして選ぶ → 「貼り付けへ」' : 'コピー: ドラッグで範囲、クリックで施設を選ぶ（✔が付く）→「貼り付けへ」か Enter');
    } else if (key === 'bulldoze') s = touch ? '撤去: 横になぞって範囲を選び ✓ で確定（返金なし）' : '撤去: 横にドラッグした範囲を撤去（施設があれば確認します。返金なし）';
    else {
      const t = TYPES[key];
      const how = t.drag === 'h' ? (touch ? '横になぞって設置' : '横にドラッグして設置')
        : t.drag === 'v' ? (touch ? '縦になぞって範囲を決める' : '縦にドラッグして範囲を決める')
          : touch ? '指を置いて滑らせると位置合わせ（指の少し上に出ます）→ ✓ で確定' : 'クリックで設置（カーソルが中心。隣の施設にぴったり寄せます／Shift で寄せない）';
      s = touch ? `${t.name}: ${how}。${t.desc || ''}` : `${t.name}: ${t.desc || ''}｜${how}`;
    }
    this.toolbar.setHint(s);
  }

  clampCell(c) {
    return { f: Math.max(MIN_F, Math.min(MAX_F, c.f)), x: Math.max(0, Math.min(W - 1, c.x)) };
  }

  clickParams(tool, cell, snap = !this.noSnap) {
    const t = TYPES[tool];
    const c = this.clampCell(cell);
    const h = t.h || 1;
    const w = t.w || 1;
    let f = t.only === 'basement' ? c.f - (h - 1) : c.f;
    f = Math.max(MIN_F, Math.min(MAX_F - h + 1, f));
    let x = Math.max(0, Math.min(W - w, c.x - Math.floor(w / 2)));
    if (snap) x = this.snapX(tool, f, x, w, h);
    return { f, x };
  }

  /**
   * すき間なく並べやすいように x を寄せる（1マスずれているときだけの弱い磁石）。Shift を押している間は寄せない。
   * どの位置にも置けるよう、寄せるのは「1マス」だけにする（2マス以上は寄せない＝その位置にも置ける）。
   * 優先: 隣の施設にぴったり付く位置 → 施設の幅の倍数（W は全施設の幅で割り切れる）
   */
  snapX(tool, f, x, w, h) {
    const sim = this.sim;
    if (!sim || !sim.grid || TRANSPORT_SET.has(tool)) return x;
    const rows = [];
    for (let k = 0; k < h; k++) if (sim.grid[f + k]) rows.push(sim.grid[f + k]);
    if (!rows.length) return x;
    const free = (cx) => {
      if (cx < 0 || cx + w > W) return false;
      for (const row of rows) for (let i = cx; i < cx + w; i++) if (row[i] > 0) return false;
      return true;
    };
    const R = 1;
    const cands = [];
    for (const row of rows) {
      // 左隣の施設の右端、右隣の施設の左端
      for (let i = Math.max(0, x - R - 1); i <= Math.min(W - 1, x + R + w); i++) {
        const v = row[i];
        if (v > 0 && (i + 1 >= W || row[i + 1] !== v)) cands.push({ x: i + 1, pri: 0 });
        if (v > 0 && (i === 0 || row[i - 1] !== v)) cands.push({ x: i - w, pri: 0 });
      }
    }
    cands.push({ x: Math.round(x / w) * w, pri: 1 });
    let best = null;
    for (const c of cands) {
      const d = Math.abs(c.x - x);
      if (d === 0 && c.pri === 0 && free(c.x)) return x;
      if (d > R || !free(c.x)) continue;
      if (!best || c.pri < best.pri || (c.pri === best.pri && d < best.d)) best = { ...c, d };
    }
    return best ? best.x : x;
  }

  /** 今のツールがドラッグで操作するものか */
  toolIsDrag(tool = this.tool) {
    return tool === 'copy' ? this.copy.isDrag : isDragTool(tool);
  }

  paramsFor(tool, a, b) {
    const A = this.clampCell(a), B = this.clampCell(b);
    const t = TYPES[tool];
    if (tool === 'bulldoze' || (t && t.drag === 'h')) return { f: A.f, x: A.x, x2: B.x };
    if (t && t.drag === 'v') return { f: A.f, x: Math.max(0, Math.min(W - t.w, A.x - Math.floor(t.w / 2))), f2: B.f };
    return this.clickParams(tool, b);
  }

  evalGhost(tool, p, type) {
    let r = null;
    try { r = this.sim.check(tool, p); } catch (e) { this.reportError(e, 'sim.check'); }
    if (!r || !r.ghost) return null;
    let label;
    if (r.ok) label = tool === 'bulldoze' ? (r.cost ? `撤去 ${fmtMoney(r.cost)}` : '撤去') : fmtMoney(r.cost || 0);
    else label = r.reason || '置けません';
    return { ...r.ghost, type: type || (tool === 'bulldoze' ? undefined : tool), ok: !!r.ok, label, res: r };
  }

  /** マウスのホバー（PC のゴースト表示） */
  hoverAt(cell, dragging) {
    this.hover = cell ? this.clampCell(cell) : null;
    if (dragging) return;
    if (this.tool === 'inspect' && cell && this.started) {
      // シャフトの端の上では伸縮カーソル
      this.canvas.classList.toggle('c-resize', !!this.resize.hitEnd(this.clampCell(cell)));
    } else this.canvas.classList.remove('c-resize');
    if (this.tool === 'copy') {
      this.hoverGhost = null;
      this.hoverGhosts = cell && this.started && this.copy.phase === 'paste' ? this.copy.preview(this.clampCell(cell)) : null;
      return;
    }
    if (!cell || this.tool === 'inspect' || !this.started) { this.hoverGhost = null; return; }
    const p = isDragTool(this.tool) ? this.paramsFor(this.tool, cell, cell) : this.clickParams(this.tool, cell);
    this.hoverGhost = this.evalGhost(this.tool, p);
    this.hoverParams = p;
  }

  recheckGhosts() {
    if (!this.started) return;
    if (this.pending && this.pending.tool === 'copy') {
      const gs = this.copy.preview(this.pending.cell, true);
      this.pending.ghosts = gs;
      this.pending.ghost = this.copyPendingGhost();
      this.updateConfirmBar();
    } else if (this.pending) {
      this.pending.ghost = this.evalGhost(this.pending.tool, this.pending.p);
      this.updateConfirmBar();
    }
    if (this.tool === 'copy' && this.hover && this.copy.phase === 'paste' && this.input.lastType === 'mouse') this.hoverGhosts = this.copy.preview(this.hover, true);
    if (this.hoverGhost && this.hoverParams && this.tool !== 'inspect') this.hoverGhost = this.evalGhost(this.tool, this.hoverParams);
  }

  dragUpdate(d) {
    this.hoverGhost = null;
    if (d.tool === 'copy') { this.dragGhost = this.copy.selectGhost(this.clampCell(d.start), this.clampCell(d.cur)); return; }
    this.dragGhost = this.evalGhost(d.tool, this.paramsFor(d.tool, d.start, d.cur));
  }

  dragCancel() {
    this.dragGhost = null;
  }

  dragEnd(d) {
    this.dragGhost = null;
    if (d.tool === 'copy') {
      const a = this.clampCell(d.start), b = this.clampCell(d.cur);
      // クリック／タップ: 施設の選択を切り替える
      if (a.f === b.f && a.x === b.x) {
        const o = this.pickAt(a.f, a.x);
        if (o) { this.copy.toggle(o.id); this.sound.play('click'); }
        this.updateCopyBar();
        return;
      }
      // 範囲ドラッグ: 中の施設を選択に加える。施設が無ければ（フロアだけ）範囲ごとコピー
      if (this.copy.markRange(a, b) > 0) { this.sound.play('click'); this.updateCopyBar(); return; }
      if (this.copy.marked.size) { this.updateCopyBar(); return; }
      if (this.copy.finishSelect(a, b)) {
        this.updateHint();
        this.afterCopyReady(d.touch);
      }
      return;
    }
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
    const trow = this.sim.tgrid && this.sim.tgrid[p.f];
    if (row) for (let x = Math.max(0, a); x <= Math.min(W - 1, b); x++) { if (row[x] > 0) ids.add(row[x]); if (trow && trow[x] > 0) ids.add(trow[x]); }
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
      // 人を施設より優先（タッチは当たり判定を広めに）
      const p = this.personAtCell(cell, touch);
      if (p) { this.selectPerson(p); return; }
      let o = null;
      try { o = cell.f >= MIN_F && cell.f <= MAX_F && cell.x >= 0 && cell.x < W ? this.pickAt(c.f, c.x) : null; } catch (e) { this.reportError(e, 'sim.objAt'); }
      if (o) this.select(o.id);
      else { this.panel.close(); }
      return;
    }
    if (this.tool === 'copy') {
      if (this.copy.phase !== 'paste') return;
      const c = this.clampCell(cell);
      if (!touch) { this.copy.preview(c, true); if (this.copy.build()) this.hoverGhosts = this.copy.preview(c, true); return; }
      if (this.pending && this.pending.tool === 'copy' && this.inGhost(this.pending.ghost, c)) { this.confirmPending(); return; }
      this.setCopyPending(c);
      return;
    }
    if (isDragTool(this.tool)) return;
    const p = this.clickParams(this.tool, cell);
    if (!touch) { this.doBuild(this.tool, p); return; }
    if (this.pending && this.pending.tool === this.tool && this.inGhost(this.pending.ghost, cell)) { this.confirmPending(); return; }
    this.setPending(this.tool, p);
  }

  // ---------- 人のプロフィール ----------
  personAtCell(cell, touch) {
    const s = this.sim;
    if (!s || typeof s.personAt !== 'function' || !cell) return null;
    const fx = cell.fx ?? cell.x + 0.5;
    const r = touch ? 2.5 : 1.2;
    try {
      // 指は少しずれやすいので、上下の階も見る（タッチ）
      const fs = touch ? [cell.f, cell.f - 1, cell.f + 1] : [cell.f];
      for (const f of fs) { const p = s.personAt(f, fx, r); if (p) return p; }
    } catch (e) { this.reportError(e, 'sim.personAt'); }
    return null;
  }

  selectPerson(p) {
    this.selectedId = null;
    this.selectedPerson = p;
    this.follow = false;
    this.panel.showPerson(p);
    this.sound.play('click');
  }

  setFollow(on) {
    this.follow = !!on && !!this.selectedPerson;
    this.cam.anim = null;
  }

  /** 追いかけるカメラ、画面外に出たときの「追いかける」ボタン */
  updateFollow(dt) {
    const chip = this.followChip || (this.followChip = this.makeFollowChip());
    const p = this.selectedPerson;
    let pos = null;
    if (p && this.started && this.sim && typeof this.sim.drawPos === 'function') {
      try { pos = this.sim.drawPos(p); } catch { pos = null; }
    }
    const cam = this.cam;
    let off = false;
    if (pos) {
      const sx = ((pos.x + 0.5) * TILE_W - cam.x) * cam.zoom, sy = (-(pos.f + 0.5) * FLOOR_H - cam.y) * cam.zoom;
      off = sx < 0 || sx > cam.vw || sy < cam.insetTop || sy > cam.vh - cam.insetBottom;
      if (this.follow) {
        const usable = cam.vh - cam.insetTop - cam.insetBottom;
        const tx = (pos.x + 0.5) * TILE_W - cam.vw / 2 / cam.zoom;
        const ty = -(pos.f + 0.5) * FLOOR_H - (cam.insetTop + usable / 2) / cam.zoom;
        const k = Math.min(1, dt * 5);
        cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
        cam.clamp();
      }
    }
    const show = !!p && !!pos && off && !this.follow && !this.blocked();
    if (chip.hidden === show) chip.hidden = !show;
  }

  makeFollowChip() {
    const b = document.createElement('button');
    b.id = 'follow-chip';
    b.className = 'btn btn-primary';
    b.textContent = '📍 選んだ人を追いかける';
    b.hidden = true;
    b.addEventListener('click', () => { this.setFollow(true); this.panel.sig = ''; this.panel.refresh(); });
    this.root.append(b);
    return b;
  }

  // ---------- 評価の一括表示 ----------
  toggleOverlay() {
    this.overlay = this.overlay === 'eval' ? null : 'eval';
    this.sound.play('click');
    this.toolbar.update(true);
    let lg = document.getElementById('legend');
    if (!lg) {
      lg = document.createElement('div');
      lg.id = 'legend';
      lg.className = 'frame';
      lg.innerHTML = '<b>評価</b><span><i class="lg-good"></i>良い</span><span><i class="lg-fair"></i>普通</span><span><i class="lg-bad"></i>悪い</span><span><i class="lg-none"></i>空室・なし</span>';
      lg.addEventListener('click', () => this.toggleOverlay());
      lg.title = 'タップで閉じる';
      this.root.append(lg);
    }
    lg.hidden = this.overlay !== 'eval';
    this.root.classList.toggle('overlay-on', this.overlay === 'eval');
  }

  /** 移動手段を優先して拾う（v2: 移動手段は施設と重なる） */
  pickAt(f, x) {
    const s = this.sim;
    let o = null;
    if (s.transportAt) o = s.transportAt(f, x);
    return o || s.objAt(f, x);
  }

  // ---------- コピーの操作バー ----------
  setupCopyBar() {
    const $ = (id) => document.getElementById(id);
    this.cpb = { el: $('copy-bar'), text: $('cp-text'), clear: $('cp-clear'), free: $('cp-free'), back: $('cp-back'), go: $('cp-go') };
    this.cpb.clear.addEventListener('click', () => { this.copy.clearMarks(); this.sound.play('click'); this.updateCopyBar(); });
    this.cpb.go.addEventListener('click', () => this.startCopyPaste());
    this.cpb.back.addEventListener('click', () => this.backToCopySelect());
    this.cpb.free.addEventListener('click', () => {
      this.copy.freeX = !this.copy.freeX;
      this.sound.play('click');
      if (this.pending && this.pending.tool === 'copy') this.setCopyPending(this.pending.cell, true);
      else if (this.hover) this.hoverAt(this.hover);
      this.updateCopyBar();
    });
  }

  startCopyPaste() {
    this.userGesture();
    if (!this.copy.startPasteMarked()) return;
    this.updateHint();
    this.afterCopyReady(isTouchDevice());
  }

  /** 貼り付けモードに入った直後: スマホは元の場所に仮置きして見せる */
  afterCopyReady(touch) {
    const src = this.copy.src;
    if (touch && src) {
      // 元の列の建物のいちばん上の、すぐ上に置いてみる（たいてい空いている）
      let top = src.f2;
      for (let f = src.f2 + 1; f <= MAX_F; f++) {
        const row = this.sim.grid[f];
        let any = false;
        if (row) for (let x = src.x1; x <= src.x2; x++) if (row[x] !== 0) { any = true; break; }
        if (!any) break;
        top = f;
      }
      const cell = { f: Math.min(MAX_F - this.copy.bp.h + 1, top + 1), x: src.x1 + Math.floor(this.copy.bp.w / 2) };
      this.setCopyPending(cell);
      this.cam.focus(cell.f, cell.x, this.cam.zoom);
    } else if (this.hover) this.hoverAt(this.hover);
    this.toasts.show({ text: touch ? 'コピーしました。指で上下に動かして ✓ で建設（横も動かすときは「↔」）' : 'コピーしました。貼り付けたい階でクリック（横も動かすときは Shift）', kind: 'info' });
    this.updateCopyBar();
  }

  backToCopySelect() {
    this.copy.reset(true);
    this.pending = null;
    this.hoverGhosts = null;
    this.updateConfirmBar();
    this.updateHint();
    this.updateCopyBar();
  }

  updateCopyBar() {
    const b = this.cpb;
    if (!b) return;
    const on = this.started && this.tool === 'copy';
    const paste = on && this.copy.phase === 'paste';
    const n = this.copy.marked.size;
    b.el.hidden = !on || (!paste && !n);
    if (b.el.hidden) return;
    b.text.textContent = paste ? 'コピー貼り付け中' : `✔ ${n}件選択中`;
    b.clear.hidden = paste;
    b.go.hidden = paste;
    b.back.hidden = !paste;
    b.free.hidden = !paste;
    b.free.classList.toggle('is-on', this.copy.freeX);
    b.free.setAttribute('aria-pressed', this.copy.freeX ? 'true' : 'false');
    b.free.textContent = this.copy.freeX ? '↔ 横も動かす: オン' : '↔ 横も動かす';
  }

  setCopyPending(cell, silent) {
    const gs = this.copy.preview(cell, true);
    this.pending = { tool: 'copy', cell, ghosts: gs, ghost: null };
    this.pending.ghost = this.copyPendingGhost();
    if (!silent) this.sound.play(this.copy.res && this.copy.res.ok ? 'click' : 'error');
    this.updateConfirmBar();
  }

  // ---------- タッチ: 指を滑らせて位置を合わせる ----------
  /** 指を滑らせて位置合わせするツールか（施設のクリック設置・コピーの貼り付け） */
  placeTool() {
    const t = this.tool;
    if (!this.started || t === 'inspect') return false;
    if (t === 'copy') return this.copy.phase === 'paste';
    return !isDragTool(t);
  }

  fingerCellF(sx, sy) {
    const [wx, wy] = screenToWorld(this.cam, sx, sy);
    return { x: wx / TILE_W, f: -wy / FLOOR_H };
  }

  /** 画面上の点が仮置きのゴースト（の近く）か */
  pendingHit(sx, sy) {
    const g = this.pending && this.pending.ghost;
    if (!g) return false;
    const lo = g.lo ?? g.f, hi = g.hi ?? g.f + (g.h || 1) - 1;
    const c = this.cam;
    const x0 = (g.x * TILE_W - c.x) * c.zoom, x1 = ((g.x + g.w) * TILE_W - c.x) * c.zoom;
    const y0 = (-(hi + 1) * FLOOR_H - c.y) * c.zoom, y1 = (-lo * FLOOR_H - c.y) * c.zoom;
    const m = 28;
    // ゴーストは指の 1.5 フロア上に出るので、その下（指があった所）も掴める範囲に含める
    const below = 1.5 * FLOOR_H * c.zoom;
    return sx >= x0 - m && sx <= x1 + m && sy >= y0 - m && sy <= y1 + below + m;
  }

  /** 指を置いた: 仮置きを掴むか、新しく指の少し上（1.5フロア上）に出す */
  placeStart(sx, sy, fresh) {
    const fc = this.fingerCellF(sx, sy);
    const grab = !fresh && !!(this.pending && this.pending.cell && this.pending.tool === this.tool && this.pendingHit(sx, sy));
    const off = grab
      ? { x: this.pending.cell.x + 0.5 - fc.x, f: this.pending.cell.f + 0.5 - fc.f }
      : { x: 0, f: 1.5 };
    this.place = { grab, off, last: null, moved: false };
    if (!grab) this.placeMove(sx, sy);
  }

  placeMove(sx, sy, moved) {
    const pl = this.place;
    if (!pl) return;
    if (moved) pl.moved = true;
    const fc = this.fingerCellF(sx, sy);
    const cell = this.clampCell({ x: Math.floor(fc.x + pl.off.x), f: Math.floor(fc.f + pl.off.f) });
    if (pl.last && pl.last.x === cell.x && pl.last.f === cell.f) return;
    pl.last = cell;
    // 滑らせている間は寄せない（1マスずつ動かせるように）。寄せるのは指を離したときだけ
    if (this.tool === 'copy') this.setCopyPending(cell, true);
    else this.setPending(this.tool, this.clickParams(this.tool, cell, false), cell, true);
  }

  placeEnd() {
    const pl = this.place;
    this.place = null;
    if (!pl) return;
    // 仮置きを動かさずにタップ → 確定
    if (pl.grab && !pl.moved) { this.confirmPending(); return; }
    const pd = this.pending;
    if (pd && pd.tool !== 'copy' && pd.tool !== 'bulldoze' && pd.cell && !this.noSnap) {
      const snapped = this.clickParams(pd.tool, pd.cell, true);
      if (snapped.x !== pd.p.x) {
        const cell = { ...pd.cell, x: pd.cell.x + (snapped.x - pd.p.x) };
        this.setPending(pd.tool, snapped, cell, true);
      }
    }
    this.sound.play(this.pending && this.pending.ghost && this.pending.ghost.ok ? 'click' : 'error');
  }

  /** 仮置きを1マス（1階）ずつ動かす（確定バーの ◀ ▶ ▲ ▼） */
  nudge(dx, df) {
    const pd = this.pending;
    if (!pd) return;
    this.userGesture();
    if (pd.tool === 'copy') {
      const cp = this.copy;
      let cell = { ...pd.cell };
      if (dx && !cp.xFree) {
        // 横に動かすときは「横も動かす」をオンにして、今の位置から1マスずつ
        cell.x = cp.anchor.x + Math.floor(cp.bp.w / 2);
        cp.freeX = true;
        this.updateCopyBar();
      }
      cell = this.clampCell({ x: cell.x + dx, f: cell.f + df });
      this.setCopyPending(cell, true);
    } else if (pd.tool !== 'bulldoze') {
      const t = TYPES[pd.tool];
      const p = { ...pd.p, x: Math.max(0, Math.min(W - (t.w || 1), pd.p.x + dx)), f: Math.max(MIN_F, Math.min(MAX_F - (t.h || 1) + 1, pd.p.f + df)) };
      const cell = { x: (pd.cell ? pd.cell.x : p.x) + (p.x - pd.p.x), f: (pd.cell ? pd.cell.f : p.f) + (p.f - pd.p.f) };
      this.setPending(pd.tool, p, cell, true);
    }
    this.sound.play('click');
  }

  placeCancel() { this.place = null; }

  /** コピーの仮置き: 外枠（判定・確定バー用。描画は ghosts） */
  copyPendingGhost() {
    const b = this.copy.bbox();
    if (!b) return null;
    const r = this.copy.res || {};
    return { ...b, ok: !!r.ok, label: this.copy.label(), outline: true };
  }

  setPending(tool, p, cell, silent) {
    const ghost = this.evalGhost(tool, p);
    this.pending = ghost ? { tool, p, ghost, cell } : null;
    if (!silent) this.sound.play(ghost && !ghost.ok ? 'error' : 'click');
    this.updateConfirmBar();
  }

  confirmPending() {
    const pd = this.pending;
    if (!pd) return;
    if (pd.tool === 'copy') {
      this.copy.preview(pd.cell, true);
      if (this.copy.build()) this.setCopyPending(pd.cell);
      return;
    }
    this.doBuild(pd.tool, pd.p);
  }

  cancelPending() {
    // コピーの貼り付け中に「やめる」→ 範囲を選び直す
    if (this.pending && this.pending.tool === 'copy') { this.copy.reset(true); this.updateHint(); this.updateCopyBar(); }
    this.pending = null;
    this.updateConfirmBar();
  }

  /** 全画面表示の切り替え */
  toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (!(d.fullscreenEnabled || d.webkitFullscreenEnabled) || !(el.requestFullscreen || el.webkitRequestFullscreen)) {
      this.dialogs.installGuide();
      return;
    }
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
    } catch {
      this.toasts.show({ text: 'このブラウザでは全画面表示にできません（ホーム画面に追加すると全画面で遊べます）', kind: 'info' });
    }
  }

  /** 建物の中心（ロビー階の構造の中央。なければ世界の中央） */
  buildingCenterX() {
    const row = this.sim && this.sim.grid && this.sim.grid[0];
    if (!row) return null;
    let a = -1, b = -1;
    for (let x = 0; x < row.length; x++) if (row[x]) { if (a < 0) a = x; b = x; }
    return a < 0 ? null : (a + b + 1) / 2;
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
    for (const [id, dx, df] of [['cb-l', -1, 0], ['cb-r', 1, 0], ['cb-u', 0, 1], ['cb-d', 0, -1]]) {
      const b = document.getElementById(id);
      if (!b) continue;
      // 押しっぱなしで連続して動く
      let timer = 0;
      const stop = () => { clearInterval(timer); clearTimeout(timer); timer = 0; };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.nudge(dx, df); stop(); timer = setTimeout(() => { timer = setInterval(() => this.nudge(dx, df), 90); }, 380); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
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
    cb.name.textContent = pd.tool === 'bulldoze' ? '撤去' : pd.tool === 'copy' ? 'コピー' : t ? t.name : pd.tool;
    cb.cost.textContent = pd.ghost.label || '';
    cb.el.classList.toggle('bad', !pd.ghost.ok);
    cb.ok.disabled = !pd.ghost.ok;
    cb.ok.textContent = pd.tool === 'bulldoze' ? '✓ 撤去' : '✓ 建設';
    cb.ok.className = 'btn ' + (pd.tool === 'bulldoze' ? 'btn-danger' : 'btn-primary');
    const nudges = cb.el.querySelector('.cb-nudge');
    if (nudges) nudges.hidden = pd.tool === 'bulldoze';
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
    if (this.resize.active) { this.resize.cancel(); return; }
    if (this.tool === 'copy' && this.copy.phase === 'paste') { this.backToCopySelect(); return; }
    if (this.tool === 'copy' && this.copy.marked.size) { this.copy.clearMarks(); this.updateCopyBar(); return; }
    if (this.pending) { this.cancelPending(); return; }
    if (this.tool !== 'inspect') { this.setTool('inspect'); return; }
    this.panel.close();
  }

  // ---------------- セーブ・ロード ----------------
  /** セーブに一緒に残す UI の状態（速度など） */
  uiState() {
    return { speed: this.speedIdx, prevSpeed: this.prevSpeed };
  }
  autosave() {
    if (!this.started || !this.sim || this.simFailed) return;
    // 画面を隠す・閉じるで続けて呼ばれても、1秒以内の2回目は書かない
    const now = performance.now();
    if (now - (this.lastSaveT || -1e9) < 1000) return;
    this.lastSaveT = now;
    const r = saveGame(this.sim, this.uiState());
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
    const r = saveGame(this.sim, this.uiState());
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
    const ui = obj.meta && obj.meta.ui;
    if (ui && Number.isInteger(ui.speed) && UI_SPEEDS[ui.speed]) {
      this.speedIdx = ui.speed;
      if (Number.isInteger(ui.prevSpeed) && UI_SPEEDS[ui.prevSpeed] && ui.prevSpeed > 0) this.prevSpeed = ui.prevSpeed;
    }
    this.enterGame();
    this.cam.home(this.buildingCenterX());
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
    this.setSpeed(SPEED_ONE);
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
