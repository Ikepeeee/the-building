// 事件・スタッフ・プロンプト（Tower.prototype に混ぜ込む）
// 爆破予告、火災、ゴキブリ、苦情、VIP、結婚式、警備員とメイドの派遣。
import { DAY, W, STAR_POP, TYPES, floorName, fmtMoney } from './constants.js';

import { FI, HOTEL, TENANT, SIM, burnable } from './rules.js';
import { clamp } from './util.js';

export const EventsMixin = {
  // ================= プロンプト =================
  ask(kind, title, text, choices, data = {}, timeout = 60) {
    const id = `p${this.promptSeq++}`;
    const pr = { id, kind, title, text, choices, data, deadline: this.time + timeout };
    this.pending.set(id, pr);
    this.emit('prompt', { id, kind, title, text, choices });
    return id;
  },

  answer(id, value) {
    const pr = this.pending.get(id);
    if (!pr) return false;
    this.pending.delete(id);
    const h = this[`_answer_${pr.kind}`];
    if (h) h.call(this, value, pr.data || {});
    return true;
  },

  hasPending(kind) {
    for (const p of this.pending.values()) if (p.kind === kind) return true;
    return false;
  },

  // UI が答えないまま時間が進んだら最後の選択肢を既定とする
  checkPrompts() {
    for (const pr of [...this.pending.values()]) {
      if (this.time >= pr.deadline) this.answer(pr.id, pr.choices[pr.choices.length - 1].value);
    }
  },

  _answer_vip() {},
  _answer_wedding() {},

  // ================= 日次・時間ごとのフック =================
  dailyEvents() {
    this.dailyRoach();
    if (this.star < 2) return;
    const d = this.day, F = this.flags;
    if (F.nextBomb !== null && d >= F.nextBomb && !this.bomb && this.r() < 0.15) {
      const t = d * DAY + (9 + this.rand(9)) * 60;
      F.bombAt = t;
      this.at(t, () => { if (F.bombAt === t) this.startBombThreat(); });
      F.nextBomb = d + 21 + Math.floor(this.rand(14));
    } else if (F.nextFire !== null && d >= F.nextFire && !this.fire && this.r() < 0.15) {
      const t = d * DAY + (8 + this.rand(12)) * 60;
      F.fireAt = t;
      this.at(t, () => { if (F.fireAt === t) this.startFire(); });
      F.nextFire = d + 21 + Math.floor(this.rand(14));
    }
  },

  hourlyEvents(h) {
    if (h === 9 || h === 13 || h === 18) this.complaints(false);
    if (h === 9) this.vipAnnounce(false);
    if (h === 11) this.weddingStart(false);
    if (h === 18 && this.isXmasEve()) {
      this.msg('メリークリスマス！ 今夜はサンタクロースがビルの上空を飛んでいます', 'event', this.topBuiltFloor() + 2, W / 2);
      this.sound('bells');
    }
  },

  // ================= スタッフ派遣（5分ごと） =================
  staffDispatch() {
    const h = this.hour;
    if (h >= 8 && h < 20) {
      for (const hk of this.byType.housekeeping) {
        for (const m of hk.members) {
          if (m.task || m.state !== 'in' || m.loc !== hk) continue;
          const room = this.findDirty(m.f);
          if (!room) break;
          this.assignClean(m, room);
        }
      }
    }
    const bombHunt = this.bomb && !this.bomb.found;
    if (!bombHunt && !(this.fire && this.fire.burning.size)) return;
    for (const s of this.byType.security) {
      let out = 0;
      for (const g of s.members) if (g.task) out++;
      for (const g of s.members) {
        if (out >= SIM.SQUAD) break;
        if (g.task || g.state !== 'in' || g.loc !== s) continue;
        if (bombHunt) { if (!this.assignSearch(g)) break; } else if (!this.assignFire(g)) break;
        out++;
      }
    }
  },

  unsettle(p) {
    if (p.state === 'in' && p.loc) p.loc.inCount--;
    p.loc = null;
  },

  // ---- メイド ----
  findDirty(f) {
    let best = null, bd = Infinity;
    for (const o of this.hotels) {
      if (!o.dirty || o.occupied || o.cleaner || o.burning || o.cleanFail > this.time - 60) continue;
      const d = Math.abs(o.f - f);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  },

  assignClean(m, room) {
    room.cleaner = m.id;
    m.task = { kind: 'clean', room };
    if (!this.startTrip(m, room.f, this.spotIn(room), (p) => this.cleanArrive(p, room))) {
      room.cleaner = null; room.cleanFail = this.time; m.task = null;
      return false;
    }
    return true;
  },

  cleanArrive(p, room) {
    if (room.dead || room.destroyed || !p.task || p.task.room !== room) { this.releaseTask(p); this.goHome(p); return; }
    this.settle(p, room);
    this.later(20 + this.rand(10), () => this.cleanDone(p, room));
  },

  cleanDone(p, room) {
    if (!p.task || p.task.room !== room) return;
    p.task = null;
    if (!room.dead) {
      room.cleaner = null;
      if (!room.occupied) {
        room.dirty = false; room.dirtySince = null;
        this.effect('sparkle', room.f, room.x + room.w / 2, 10);
      }
    }
    const h = this.hour;
    const next = h >= 8 && h < 20 ? this.findDirty(p.f) : null;
    if (next && this.assignClean(p, next)) return;
    this.goHome(p);
  },

  // ---- 警備員: 爆弾捜索 ----
  assignSearch(g) {
    const b = this.bomb;
    if (!b || b.found) return false;
    const r = this.routeFrom(g.f);
    let best = null, bd = Infinity;
    const base = g.home ? g.home.f : g.f;
    for (const f of b.floors) {
      if (b.searched.has(f) || b.assigned.has(f) || Math.abs(f - base) > SIM.GUARD_RANGE) continue;
      const d = f === g.f ? 0 : r.dist[FI(f)];
      if (d < bd) { bd = d; best = f; }
    }
    if (best === null) return false;
    b.assigned.add(best);
    g.task = { kind: 'search', f: best };
    const onArrive = (p) => this.startPatrol(p, this.searchTime(best), (pp) => this.searchDone(pp));
    if (best === g.f) { this.unsettle(g); onArrive(g); return true; }
    if (!this.startTrip(g, best, g.x, onArrive)) { b.assigned.delete(best); b.searched.add(best); g.task = null; return false; }
    return true;
  },

  // 1フロアの捜索時間: 広いフロアほどかかる
  searchTime(f) {
    const row = this.grid[f];
    let n = 0;
    if (row) for (let x = 0; x < W; x++) if (row[x] !== 0) n++;
    return SIM.SEARCH_BASE + n / SIM.SEARCH_PER;
  },

  searchDone(p) {
    const t = p.task;
    p.task = null;
    const b = this.bomb;
    if (b && t && t.kind === 'search') {
      b.assigned.delete(t.f);
      b.searched.add(t.f);
      if (t.f === b.f && !b.found) this.bombFound();
      if (!b.found && this.assignSearch(p)) return;
    }
    this.goHome(p);
  },

  // ---- 警備員: 消火 ----
  assignFire(g) {
    const F = this.fire;
    if (!F || !F.burning.size) return false;
    const r = this.routeFrom(g.f);
    let best = null, bc = Infinity;
    const base = g.home ? g.home.f : g.f;
    for (const o of F.burning) {
      if (Math.abs(o.f - base) > SIM.GUARD_RANGE) continue;
      const d = o.f === g.f ? 0 : r.dist[FI(o.f)];
      if (d === Infinity) continue;
      const c = d + (o.fighters || 0) * 20;
      if (c < bc) { bc = c; best = o; }
    }
    if (!best) return false;
    const o = best;
    o.fighters = (o.fighters || 0) + 1;
    g.task = { kind: 'fire', obj: o };
    const onArrive = (p) => this.startPatrol(p, SIM.FIGHT_TIME, (pp) => this.fireDone(pp), o.x + 0.5, o.x + o.w - 0.5);
    if (o.f === g.f) { this.unsettle(g); onArrive(g); return true; }
    if (!this.startTrip(g, o.f, o.x + o.w / 2, onArrive)) { this.releaseTask(g); return false; }
    return true;
  },

  fireDone(p) {
    const t = p.task;
    this.releaseTask(p);
    if (t && t.obj && t.obj.burning && !t.obj.dead && this.fire) {
      this.extinguish(t.obj);
      this.fire.saved++;
    }
    if (this.fire && this.fire.burning.size && this.assignFire(p)) return;
    this.goHome(p);
  },

  // ================= テロリストの爆破予告 =================
  startBombThreat() {
    this.flags.bombAt = null;
    if (this.bomb || this.hasPending('bomb') || !this.facs.length) return false;
    const ransom = clamp(Math.round((this.pop * 200) / 50000) * 50000, 100000, 1000000);
    const n = this.byType.security.length;
    this.sound('alarm');
    this.ask('bomb', 'テロリストの爆破予告',
      `「ビルに爆弾を仕掛けた。身代金 ${fmtMoney(ransom)} を払え。」\n拒否すると、3時間後に爆弾が爆発します。` +
      (n ? `\n警備室（${n}室）の警備員が捜索します。` : '\n警備室がないため、爆弾を捜索できません。'),
      [{ label: `身代金を払う（${fmtMoney(ransom)}）`, value: 'pay' }, { label: '拒否する', value: 'refuse' }],
      { ransom });
    return true;
  },

  _answer_bomb(value, data) {
    const ransom = data.ransom || 100000;
    if (value === 'pay') {
      if (this.money >= ransom) {
        this.spend(ransom);
        this.msg(`身代金 ${fmtMoney(ransom)} を支払いました。犯人は去っていきました`, 'money');
        this.sound('cash');
        return;
      }
      this.msg('資金が足りず、身代金を払えません！', 'bad');
    }
    this.plantBomb();
  },

  plantBomb(f, x) {
    if (f === undefined) {
      const cands = this.facs.filter((o) => burnable(o.type));
      if (!cands.length) { this.msg('爆破予告はいたずらだったようです', 'info'); return false; }
      const o = this.pick(cands);
      f = o.f + Math.floor(this.rand(o.h));
      x = o.x + Math.floor(this.rand(o.w));
    }
    this.bomb = { f, x, deadline: this.time + SIM.BOMB_TIME, searched: new Set(), found: false, assigned: new Set(), floors: this.builtFloors() };
    if (!this.bomb.floors.includes(f)) this.bomb.floors.push(f);
    const n = this.byType.security.length;
    this.msg(`爆弾が仕掛けられました！ 3時間以内に見つけないと爆発します${n ? '。警備員が捜索を始めます' : '（警備室がありません）'}`, 'event');
    this.sound('alarm');
    this.staffDispatch();
    return true;
  },

  bombFound() {
    const b = this.bomb;
    b.found = true;
    this.msg(`警備員が${floorName(b.f)}で爆弾を発見し、解除しました！`, 'good', b.f, b.x);
    this.sound('ding');
    this.effect('sparkle', b.f, b.x, 20);
    this.later(20, () => { if (this.bomb === b) this.bomb = null; });
  },

  explodeBomb() {
    const b = this.bomb;
    this.bomb = null;
    const hit = new Set();
    for (let f = b.f - 1; f <= b.f + 1; f++) {
      for (const o of this.byFloor.get(f) || []) {
        if (!burnable(o.type)) continue;
        if (o.x + o.w - 1 < b.x - 20 || o.x > b.x + 20) continue;
        hit.add(o);
      }
    }
    for (const o of hit) this.destroyObj(o, 'bomb');
    this.effect('explosion', b.f, b.x, 30);
    this.effect('smoke', b.f + 1, b.x, 90);
    this.sound('boom');
    this.msg(`爆弾が爆発しました！ ${floorName(b.f)}付近の施設${hit.size}件が破壊されました。撤去して建て直してください`, 'bad', b.f, b.x);
  },

  // ================= 火災 =================
  startFire(o) {
    if (this.fire) return false;
    if (!o) {
      const cands = this.facs.filter((c) => burnable(c.type) && c.type !== 'cathedral');
      if (!cands.length) return false;
      o = this.pick(cands);
    }
    if (!o || o.dead || !burnable(o.type)) return false;
    this.flags.fireAt = null;
    this.fire = { start: this.time, nextSpread: this.time + 10, heli: null, burning: new Set(), burned: 0, saved: 0, f: o.f, x: o.x + o.w / 2 };
    this.ignite(o);
    const n = this.byType.security.length;
    this.msg(`${floorName(o.f)}の${TYPES[o.type].name}で火災が発生しました！`, 'event', o.f, o.x + o.w / 2);
    this.sound('fire');
    this.sound('alarm');
    this.ask('fire', '火災発生！',
      `${floorName(o.f)}の${TYPES[o.type].name}で火災が発生しました。` +
      (n ? '警備員が消火に向かいます。' : '警備室がないため、火が広がるおそれがあります。') +
      `\n消防ヘリ（${fmtMoney(SIM.HELI)}）を呼べば、すぐに消し止められます。`,
      [{ label: `ヘリで消火（${fmtMoney(SIM.HELI)}）`, value: 'heli' }, { label: '様子を見る', value: 'wait' }]);
    this.staffDispatch();
    return true;
  },

  _answer_fire(value) {
    if (value !== 'heli' || !this.fire) return;
    if (this.money < SIM.HELI) { this.msg('資金が足りず、ヘリを呼べません', 'bad'); this.sound('error'); return; }
    this.spend(SIM.HELI);
    this.fire.heli = 'called';
    this.dispatchHeli();
    this.msg('消防ヘリを要請しました', 'info');
  },

  // ---- 消防ヘリ: 画面外から飛来 → 散水 → 去る。消火は散水が終わったとき ----
  dispatchHeli() {
    const F = this.fire;
    if (!F || this.heli) return;
    const tx = F.x, tf = F.f;
    const from = tx > W / 2 ? 1 : -1;
    this.heli = { x: from > 0 ? W + 25 : -25, f: this.topBuiltFloor() + 5, phase: 'in', targetX: tx, targetF: tf, until: 0, from };
    this.sound('heli');
  },

  updateHeli(dt) {
    const h = this.heli;
    const hover = h.targetF + 2;
    if (h.phase === 'in') {
      const dx = h.targetX - h.x;
      const step = SIM.HELI_SPEED * dt;
      h.x = Math.abs(dx) <= step ? h.targetX : h.x + Math.sign(dx) * step;
      const cruise = Math.max(hover, this.topBuiltFloor() + 4);
      const goal = Math.abs(dx) < 30 ? hover : cruise;
      const df = goal - h.f, vs = SIM.HELI_CLIMB * dt;
      h.f = Math.abs(df) <= vs ? goal : h.f + Math.sign(df) * vs;
      if (h.x === h.targetX && Math.abs(h.f - hover) < 1e-6) {
        h.phase = 'spray'; h.until = this.time + SIM.HELI_SPRAY;
        this.effect('smoke', h.targetF, h.targetX, SIM.HELI_SPRAY + 10);
      }
    } else if (h.phase === 'spray') {
      if (this.time >= h.until) {
        if (this.fire) this.fire.heliDone = true;
        h.phase = 'out';
      }
    } else {
      h.x -= h.from * SIM.HELI_SPEED * dt;
      h.f += SIM.HELI_CLIMB * 0.5 * dt;
      if (h.x < -40 || h.x > W + 40) this.heli = null;
    }
  },

  ignite(o) {
    o.burning = true;
    o.fighters = 0;
    this.fire.burning.add(o);
    this.updateFires();
  },

  updateFires() {
    const out = [];
    if (this.fire) for (const o of this.fire.burning) for (let r = 0; r < o.h; r++) out.push({ f: o.f + r, x0: o.x, x1: o.x + o.w });
    this.fires = out;
  },

  fireNeighbors(o) {
    const out = [];
    for (let r = 0; r < o.h; r++) {
      for (const n of this.byFloor.get(o.f + r) || []) {
        if (n === o || !burnable(n.type)) continue;
        const gap = Math.max(n.x - (o.x + o.w), o.x - (n.x + n.w));
        if (gap <= 1) out.push(n);
      }
    }
    for (const n of this.byFloor.get(o.f + o.h) || []) {
      if (n === o || !burnable(n.type)) continue;
      if (n.x < o.x + o.w && o.x < n.x + n.w) out.push(n);
    }
    return out;
  },

  fireTick(dt) {
    const F = this.fire;
    for (const o of [...F.burning]) {
      o.burnt = Math.min(1, o.burnt + dt / SIM.BURN_TIME);
      if (o.burnt >= 1) {
        F.burning.delete(o);
        o.burning = false;
        F.burned++;
        this.effect('smoke', o.f, o.x + o.w / 2, 60);
        this.destroyObj(o, 'fire');
        this.updateFires();
      }
    }
    if (this.time >= F.nextSpread) {
      F.nextSpread += 10;
      let spread = false;
      for (const o of [...F.burning]) {
        for (const n of this.fireNeighbors(o)) {
          if (!n.burning && !n.dead && !n.destroyed && !(n.fireSafeUntil > this.time) && this.r() < 0.18) { this.ignite(n); spread = true; }
        }
      }
      if (spread) { this.sound('fire'); this.staffDispatch(); }
    }
    let text = null;
    if (F.heliDone) text = '消防ヘリが火を消し止めました';
    else if (this.time - F.start >= 360) text = '消防隊が到着し、火を消し止めました';
    if (text) {
      for (const o of F.burning) o.burning = false;
      F.burning.clear();
    }
    if (!F.burning.size) {
      this.fire = null;
      this.fires = [];
      let m = text || '火災は鎮火しました';
      if (F.saved) m += `。警備員が${F.saved}件を消火`;
      if (F.burned) m += `。火災で施設${F.burned}件が焼失しました`;
      this.msg(m, F.burned ? 'bad' : 'good', F.f, F.x);
      this.sound('ding');
    }
  },

  extinguish(o) {
    o.burning = false;
    o.fireSafeUntil = this.time + 120; // 消し止めた直後は燃え移らない
    if (this.fire) this.fire.burning.delete(o);
    this.updateFires();
    this.effect('smoke', o.f, o.x + o.w / 2, 30);
  },

  // ================= ゴキブリ =================
  hotelNeighbors(o) {
    const out = [];
    for (let f = o.f - 1; f <= o.f + 1; f++) {
      for (const n of this.byFloor.get(f) || []) {
        if (n === o || !HOTEL.has(n.type)) continue;
        if (f === o.f) { if (n.x === o.x + o.w || n.x + n.w === o.x) out.push(n); } else if (n.x < o.x + o.w && o.x < n.x + n.w) out.push(n);
      }
    }
    return out;
  },

  infest(o) {
    if (!o || !HOTEL.has(o.type) || o.infested) return false;
    o.infested = true;
    return true;
  },

  dailyRoach() {
    const fresh = [];
    for (const o of this.hotels) {
      if (!o.infested && o.dirty && !o.occupied && o.dirtySince !== null && this.time - o.dirtySince >= 2 * DAY - 1) {
        this.infest(o); fresh.push(o);
      }
    }
    const src = this.hotels.filter((o) => o.infested && !fresh.includes(o));
    for (const o of src) {
      for (const n of this.hotelNeighbors(o)) if (!n.infested && this.r() < 0.6) { this.infest(n); fresh.push(n); }
    }
    if (fresh.length) {
      const o = fresh[0];
      this.msg(`${floorName(o.f)}のホテル客室${fresh.length > 1 ? `など${fresh.length}室` : ''}にゴキブリが発生しました！ 情報パネルから駆除できます`, 'bad', o.f, o.x + o.w / 2);
      this.sound('roach');
    }
  },

  exterminate(o) {
    if (!o || !o.infested) return { ok: false, reason: 'ゴキブリはいません' };
    if (this.money < SIM.EXTERMINATE) return { ok: false, reason: '資金が足りません' };
    this.spend(SIM.EXTERMINATE);
    o.infested = false;
    this.effect('sparkle', o.f, o.x + o.w / 2, 15);
    this.msg(`${floorName(o.f)}の客室のゴキブリを駆除しました`, 'good', o.f, o.x + o.w / 2);
    this.sound('ding');
    return { ok: true, reason: '' };
  },

  // ================= 苦情 =================
  complaintCause(o) {
    const fl = floorName(o.f);
    const who = o.type === 'condo' ? `${fl}の住人` : o.type === 'office' ? `${fl}のオフィス` : `${fl}の宿泊客`;
    let line = null;
    // いちばん大きな原因を言う: ゴキブリ → 移動のストレス → 騒音 → ごみ
    const bad = this.evalLevel(o) === 'bad';
    if (o.infested) line = 'ゴキブリが出た！ なんとかして！';
    else if (bad && o.cWait >= o.cStair && o.cWait > 1) line = o.type === 'office' ? 'エレベーターが遅すぎて仕事にならない！' : 'エレベーターが遅すぎる！';
    else if (bad && o.cStair > 1) line = '階段ばかりで疲れる！';
    else if (o.noisy) line = o.type === 'condo' ? '近くの店がうるさくて眠れない！' : '騒がしくて休めない！';
    else if (o.garbageBad) line = 'ごみが溜まっていて臭う！';
    else if (o.parkingShort > 0) line = '車を停める場所がない！';
    else if (bad) line = 'ここは居心地が悪い！';
    return line ? `${who}: ${line}` : null;
  },

  complaints(force) {
    const list = [];
    for (const o of this.facs) {
      if (!(TENANT.has(o.type) || HOTEL.has(o.type)) || !o.occupied) continue;
      if (o.complaintUntil > this.time) continue;
      const text = this.complaintCause(o);
      if (!text) continue;
      if (!force && this.r() >= 0.4) continue;
      o.complaint = text;
      o.complaintUntil = this.time + 180;
      list.push(o);
    }
    if (!list.length) return false;
    // 1回のチェックでは1件だけ通知し、残りは「ほかN件」にまとめる（吹き出しは全件）
    const o = list[0];
    this.msg(list.length > 1 ? `${o.complaint}（ほか${list.length - 1}件の苦情）` : o.complaint, 'complaint', o.f, o.x + o.w / 2);
    this.sound('complaint');
    return true;
  },

  // ================= VIP =================
  vipAnnounce(force) {
    if (this.vip) return false;
    if (!force) {
      if (this.star !== 3 || this.flags.vipOk || this.day < this.flags.vipNext) return false;
      if (this.pop < STAR_POP[4] || !this.byType.medical.length || !this.byType.recycling.length) return false;
    }
    if (!this.byType.hotelSuite.length) return false;
    const arrive = force ? this.time + 30 : (this.day + 1) * DAY + 17 * 60 + this.rand(60);
    this.vip = { stage: 'announced', arrive };
    this.ask('vip', 'VIP来館のお知らせ',
      `${force ? 'まもなく' : '明日の夕方、'}VIPがお忍びで来館し、スイートルームに1泊します。\n移動の快適さと客室の清潔さが評価されます。`,
      [{ label: 'OK', value: 'ok' }]);
    this.msg('VIPの来館が予告されました。スイートルームを清潔にしておきましょう', 'event');
    this.sound('ding');
    this.at(arrive, () => this.vipArrive());
    return true;
  },

  vipArrive() {
    const v = this.vip;
    if (!v || v.stage !== 'announced') return;
    const suites = this.byType.hotelSuite.filter((o) => !o.occupied && !o.burning && this.entranceDist(o.f) < Infinity);
    if (!suites.length) { this.vipFail('空いているスイートルームがありませんでした'); return; }
    suites.sort((a, b) => (a.dirty + a.infested * 2) - (b.dirty + b.infested * 2) || this.evalScore(a) - this.evalScore(b));
    const suite = suites[0];
    const ent = this.pickEntranceTo(suite.f);
    const p = this.newPerson('vip', suite);
    suite.occupied = true; suite.vipHold = true; suite.checkedIn = 0; suite.members = [p];
    Object.assign(v, { stage: 'stay', suite, p, dirty: !!suite.dirty, infested: !!suite.infested });
    this.spawnAt(p, ent);
    const ok = this.startTrip(p, suite.f, this.spotIn(suite), (pp) => {
      v.arrStress = pp.stress;
      if (suite.dead) return;
      this.settle(pp, suite);
      suite.checkedIn = 1;
      this.msg('VIPがスイートルームに到着しました', 'event', suite.f, suite.x + suite.w / 2);
    });
    if (!ok) { this.leave(p); this.vipEnd(['部屋までの経路がなかった']); return; }
    this.msg('VIPが来館しました', 'event', ent.f, (ent.x0 + ent.x1) / 2);
    this.recalcPop();
    this.at((this.day + 1) * DAY + 9 * 60 + this.rand(60), () => this.vipLeave());
  },

  vipLeave() {
    const v = this.vip;
    if (!v || v.stage !== 'stay') return;
    this.leaveBuilding(v.p, (pp) => { v.leaveStress = pp.stress; this.vipJudge(); });
  },

  vipJudge() {
    const v = this.vip;
    if (!v) return;
    const reasons = [];
    if (v.arrStress === undefined) reasons.push('部屋にたどり着けなかった');
    else if (v.arrStress >= 40) reasons.push('到着までの移動がつらかった');
    if ((v.leaveStress || 0) >= 40) reasons.push('帰りの移動がつらかった');
    if (v.dirty) reasons.push('客室が清掃されていなかった');
    if (v.infested || v.suite.infested) reasons.push('客室にゴキブリが出た');
    if (v.suite.noisy) reasons.push('客室がうるさかった');
    this.vipEnd(reasons);
  },

  vipEnd(reasons) {
    const v = this.vip;
    this.vip = null;
    const s = v && v.suite;
    if (s && !s.dead) {
      s.members = []; s.occupied = false; s.vipHold = false;
      if (s.checkedIn) { this.earn(TYPES.hotelSuite.price); s.dirty = true; s.dirtySince = this.time; }
    }
    this.recalcPop();
    if (!reasons.length) {
      this.flags.vipOk = true;
      this.msg('VIPはあなたのビルを絶賛して帰りました！', 'good', s && s.f, s && s.x + s.w / 2);
      this.sound('fanfare');
      if (s) this.effect('sparkle', s.f, s.x + s.w / 2, 30);
      this.checkStar();
    } else {
      this.flags.vipNext = this.day + 7;
      this.msg(`VIPの評価は芳しくありませんでした（${reasons.join('、')}）。7日後に再訪します`, 'bad');
    }
  },

  vipFail(reason) { this.vipEnd([reason]); },

  // ================= 結婚式 =================
  weddingStart(force) {
    if (this.wedding) return false;
    if (!force && (this.tower || this.star < 5 || !this.isWeekend() || this.day < this.flags.weddingNext)) return false;
    const cath = this.byType.cathedral[0];
    if (!cath) return false;
    const ent = this.lobbyEntrance();
    if (!ent || this.dist(ent.f, cath.f) === Infinity) {
      if (!force) {
        this.flags.weddingNext = this.day + 1;
        this.msg('ロビーから大聖堂までの経路がないため、結婚式は延期されました', 'bad', cath.f, cath.x + cath.w / 2);
      }
      return false;
    }
    const w = { deadline: force ? this.time + 180 : this.day * DAY + 14 * 60, people: [], arrived: 0, worst: 0, done: false, cath };
    this.wedding = w;
    this.ask('wedding', '大聖堂で結婚式',
      '新郎新婦と招待客10人が、ロビーから100Fの大聖堂へ向かいます。\n14時までに、疲れずに到着できれば式は成功です。',
      [{ label: 'OK', value: 'ok' }]);
    this.sound('bells');
    const kinds = ['bride', 'groom'];
    for (let i = 0; i < 10; i++) kinds.push('weddingGuest');
    kinds.forEach((k, i) => {
      const p = this.newPerson(k, cath);
      w.people.push(p);
      this.later(i * 0.5, () => {
        if (cath.dead) return;
        this.spawnAt(p, ent);
        if (!this.startTrip(p, cath.f, this.spotIn(cath), (pp) => this.weddingArrive(pp, w))) this.leave(p);
      });
    });
    this.at(w.deadline, () => { if (!w.done) this.weddingEnd(w, false, '新郎新婦が14時までに到着できませんでした'); });
    return true;
  },

  weddingArrive(p, w) {
    const cath = p.home;
    if (!cath || cath.dead) return;
    this.settle(p, cath);
    if (w.done || (p.kind !== 'bride' && p.kind !== 'groom')) return;
    w.arrived++;
    w.worst = Math.max(w.worst, p.stress);
    if (w.arrived === 2) {
      if (w.worst < 60 && this.time <= w.deadline) this.weddingEnd(w, true);
      else this.weddingEnd(w, false, '新郎新婦が移動で疲れ果ててしまいました');
    }
  },

  weddingEnd(w, ok, reason) {
    w.done = true;
    const c = w.cath;
    if (ok) {
      this.tower = true;
      this.effect('bells', c.f, c.x + c.w / 2, 120);
      this.effect('fireworks', c.f + 1, c.x + c.w / 2, 180);
      this.sound('bells');
      this.sound('fanfare');
      this.msg('大聖堂で結婚式が挙げられました！ あなたのビルは「タワー」に認定されました！', 'star', c.f, c.x + c.w / 2);
      this.emit('tower', {});
    } else {
      this.flags.weddingNext = this.day - this.weekday + 7;
      this.msg(`結婚式は失敗しました（${reason}）。来週もう一度挙げられます`, 'bad', c.f, c.x + c.w / 2);
    }
    this.later(ok ? 90 : 20, () => {
      for (const p of w.people) this.leaveBuilding(p);
      if (this.wedding === w) this.wedding = null;
    });
  },
};
