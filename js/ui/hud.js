// 上部 HUD（★・資金・人口・日付と時刻・速度・ミュート・メニュー）
import { WEEK, fmtMoney } from '../sim/constants.js';
import { UI_SPEEDS } from './speeds.js';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;


export class Hud {
  constructor(app) {
    this.app = app;
    const $ = (id) => document.getElementById(id);
    this.el = { stars: $('hud-stars'), star: $('hud-star'), money: $('hud-money-val'), net: $('hud-net'), pop: $('hud-pop'), day: $('hud-day'), time: $('hud-time'), speed: $('hud-speed'), mute: $('btn-mute'), menu: $('btn-menu'), moneyBtn: $('hud-money'), badge: $('pause-badge') };
    this.cache = {};
    this.speedBtns = UI_SPEEDS.map((s, i) => {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.title = s.title;
      b.setAttribute('aria-label', s.title);
      if (i === 0) b.classList.add('pause');
      if (s.rt) b.classList.add('rt');
      b.addEventListener('click', () => { app.userGesture(); i === 0 ? app.togglePause() : app.setSpeed(i); });
      this.el.speed.append(b);
      return b;
    });
    this.el.star.addEventListener('click', () => app.dialogs.status());
    this.el.moneyBtn.addEventListener('click', () => app.dialogs.status());
    this.el.mute.addEventListener('click', () => app.toggleMute());
    this.el.menu.addEventListener('click', () => app.dialogs.menu());
    this.el.night = document.getElementById('night-badge');
    const fs = document.getElementById('btn-fs');
    const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    // iPhone の Safari は全画面 API が無いので、ボタンで「ホーム画面に追加」を案内する。ホーム画面から起動中なら不要
    fs.hidden = (!canFs && !isIOS()) || isStandalone();
    if (!canFs) fs.classList.add('fs-guide');
    fs.addEventListener('click', () => app.toggleFullscreen());
  }

  set(key, el, text, prop = 'textContent') {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    el[prop] = text;
  }

  update() {
    const app = this.app, sim = app.sim;
    if (!sim) return;
    const star = Math.max(1, Math.min(5, sim.star | 0));
    // 最高ランクの称号: フリープレイは TOWER、海辺は LEGEND（sim が titleText を持てばそれ）
    const topTitle = sim.legend || (sim.scenario && sim.tower) ? (sim.titleText || 'LEGEND') : sim.tower ? 'TOWER' : '';
    const starHtml = topTitle || '★'.repeat(star) + `<span class="dim">${'★'.repeat(5 - star)}</span>`;
    this.set('stars', this.el.stars, starHtml, 'innerHTML');
    this.el.star.classList.toggle('is-tower', !!topTitle);
    this.el.star.title = topTitle ? `${topTitle} 達成！` : `★${star}（クリックで進捗）`;
    this.set('money', this.el.money, fmtMoney(sim.money));
    this.el.money.classList.toggle('neg', sim.money < 0);
    const lg = sim.ledger || { income: 0, expense: 0 };
    const net = (lg.income || 0) - (lg.expense || 0);
    this.set('net', this.el.net, `今日 ${net >= 0 ? '+' : ''}${fmtMoney(net)}`);
    this.el.net.className = 'hud-sub ' + (net >= 0 ? 'pos' : 'neg');
    this.set('pop', this.el.pop, (sim.pop | 0).toLocaleString('en-US'));
    const wd = WEEK[((sim.weekday ?? sim.day % 7) + 7) % 7] || '';
    this.set('day', this.el.day, `${(sim.day | 0) + 1}日目`);
    const hh = String(sim.hour | 0).padStart(2, '0'), mm = String(sim.minute | 0).padStart(2, '0');
    const w = sim.weather;
    const wx = w ? (w.kind === 'typhoon' ? ' 🌀' : ' ☂') : '';
    this.set('time', this.el.time, `${wd} ${hh}:${mm}${wx}`);
    this.el.time.title = w ? (w.kind === 'typhoon' ? '台風が来ています' : '雨') : '';
    const cur = app.speedIdx;
    this.speedBtns.forEach((b, i) => b.classList.toggle('is-on', i === cur));
    this.el.badge.hidden = !(cur === 0 && !app.blocked());
    const ff = !!app.nightFF && cur > 0 && !app.blocked();
    if (this.el.night.hidden === ff) this.el.night.hidden = !ff;
    if (ff) this.set('night', this.el.night, `🌙 早送り中 ×${((UI_SPEEDS[cur] || {}).v || 1) * 4}`);
    this.set('mute', this.el.mute, app.sound.muted ? '🔇' : '🔊');
    // 花火大会の告知・開催中
    const fest = sim.festival;
    const fb = this.el.fest || (this.el.fest = document.getElementById('fest-badge'));
    let ft = '';
    if (fest && fest.state === 'live') ft = '🎆 花火大会 開催中！';
    else if (fest && fest.state === 'announced' && Number.isFinite(fest.start)) {
      const d = Math.floor(fest.start / 1440);
      const wd = WEEK[(d % 7 + 7) % 7];
      const left = d - sim.day;
      ft = `🎆 ${left <= 0 ? '今日' : left === 1 ? '明日' : `${wd}曜`} ${String(Math.floor((fest.start % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(fest.start % 60)).padStart(2, '0')} 花火大会`;
    }
    if (fb) {
      if (fb.hidden === !!ft) fb.hidden = !ft;
      if (ft) this.set('fest', fb, ft);
      fb.classList.toggle('live', !!(fest && fest.state === 'live'));
      app.root.classList.toggle('badge-stack', !!ft && (!this.el.badge.hidden || !this.el.night.hidden));
    }
  }
}
