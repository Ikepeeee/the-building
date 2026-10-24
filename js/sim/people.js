// 人のプロフィールとホテルのレビュー（Tower.prototype に混ぜ込む）。SPEC §14
import { DAY, TYPES, floorName } from './constants.js';
import { HOTEL, KIND_NAME, SIM } from './rules.js';
import { makeRng } from './util.js';

const SURNAME = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '清水', '森', '池田', '橋本', '阿部', '石川', '前田', '藤田', '小川', '岡田', '後藤', '長谷川'];
const GIVEN_M = ['翔太', '大輔', '健太', '拓也', '直樹', '誠', '浩', '隆', '蓮', '悠真', '湊', '陽翔', '和也', '修', '勇気', '海斗'];
const GIVEN_F = ['陽子', '美咲', '彩', '愛', '真由美', '恵', '結衣', '葵', '陽菜', 'さくら', '由美', '舞', '明美', '花子', '凛', '芽依'];
const TITLE = {
  standard: ['総務部 主任', '営業部', '経理担当', '課長'], it: ['エンジニア', 'デザイナー', 'プロダクトマネージャー', 'データ分析担当'],
  law: ['弁護士', 'パラリーガル', '事務員'], design: ['デザイナー', 'アートディレクター', 'イラストレーター'],
  bank: ['窓口担当', '融資担当', 'アナリスト'], publisher: ['編集者', 'ライター', '校正担当'],
  game: ['プログラマー', 'プランナー', 'サウンド担当', 'グラフィッカー'], trading: ['営業', '貿易事務', 'バイヤー'],
};
const RESIDENT_ADULT = ['会社員', '公務員', '自営業', '看護師', '教師', '主婦・主夫', 'フリーランス'];
const GUEST_JOB = ['観光客', '出張中の会社員', '学会の参加者', '旅行中の大学生', '家族旅行'];
const VISITOR_JOB = ['買い物客', '近所の会社員', '学生', '観光客', '映画好き'];
const VIP_JOB = ['有名俳優', '大企業の会長', '人気作家', '海外の要人'];

const STATE_TEXT = { walk: '歩いている', wait: 'エレベーター待ち', ride: 'エレベーターに乗っている', stairs: '階段を移動中', in: '室内', out: '外出中' };

// レビュー: 原因ごとの一言
const REVIEW_TEXT = {
  great: ['快適に過ごせました！', 'また泊まりたいです。', 'スタッフも部屋も最高でした。', '眺めが素晴らしい！'],
  good: ['おおむね満足です。', '値段なりに快適でした。', '静かでよく眠れました。'],
  wait: ['エレベーターがなかなか来ません。', 'エレベーター待ちが長くて疲れました。'],
  stress: ['部屋にたどり着くまでが大変でした。', '移動がとにかく疲れます。'],
  noisy: ['夜までうるさくて眠れませんでした。', '近くの店の音が響きます。'],
  roach: ['ゴキブリが出ました……。', '虫が出て最悪でした。'],
  garbage: ['ごみの臭いが気になりました。'],
  parking: ['車を停める場所がありませんでした。'],
};

export const PeopleMixin = {
  // ---- プロフィール（同じ人には同じ値。保存はしない） ----
  rollProfile(p) {
    const rng = makeRng((p.id * 2654435761) ^ this.seed);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const female = p.kind === 'bride' ? true : p.kind === 'groom' ? false : rng() < 0.5;
    const home = p.home;
    let surname = pick(SURNAME);
    if (home && home.type === 'condo' && home.brand) surname = home.brand.replace(/家$/, '');
    p.name = `${surname} ${pick(female ? GIVEN_F : GIVEN_M)}`;
    p.female = female;
    const age = (a, b) => a + Math.floor(rng() * (b - a + 1));
    switch (p.kind) {
      case 'worker': {
        const v = home && TYPES.office && home.variant !== undefined ? ['standard', 'it', 'law', 'design', 'bank', 'publisher', 'game', 'trading'][home.variant] : 'standard';
        p.age = age(22, 62); p.job = `${home && home.brand ? home.brand : 'オフィス'}の${pick(TITLE[v] || TITLE.standard)}`;
        break;
      }
      case 'resident': {
        const idx = home ? home.members.length : 0; // 3人家族: 大人2人と子ども
        if (idx >= 2) { p.age = age(4, 17); p.job = p.age < 6 ? '幼児' : p.age < 13 ? '小学生' : '中高生'; } else { p.age = age(28, 75); p.job = p.age >= 66 ? '年金生活' : pick(RESIDENT_ADULT); }
        break;
      }
      case 'guest': p.age = age(19, 75); p.job = pick(GUEST_JOB); break;
      case 'visitor': p.age = age(10, 80); p.job = pick(VISITOR_JOB); break;
      case 'guard': p.age = age(24, 60); p.job = '警備員'; break;
      case 'maid': p.age = age(20, 62); p.job = 'ハウスキーパー'; break;
      case 'vip': p.age = age(45, 78); p.job = pick(VIP_JOB); break;
      case 'bride': case 'groom': p.age = age(25, 36); p.job = p.kind === 'bride' ? '新婦' : '新郎'; break;
      default: p.age = age(20, 80); p.job = KIND_NAME[p.kind] || '人';
    }
  },

  // そのフロアの x 付近にいる人（移動中・待ち行列。室内とカゴの中は対象外）
  personAt(f, x, r = 1) {
    let best = null, bd = Infinity;
    for (const p of this.active) {
      if (p.state === 'ride') continue;
      const d = this.drawPos(p);
      if (!d || Math.abs(d.f - f) > 0.5) continue;
      const dx = Math.abs(d.x - x);
      if (dx <= r && dx < bd) { bd = dx; best = p; }
    }
    return best;
  },

  placeName(o) { return o ? `${floorName(o.f)}の${o.brand || TYPES[o.type].name}` : ''; },

  todayPlan(p) {
    const wk = this.day % 7 < 5;
    switch (p.kind) {
      case 'worker': return wk ? '7〜9時に出社、昼は外食、17〜19時に退社' : '今日はお休み';
      case 'resident': return wk && p.age >= 6 && p.job !== '年金生活' && p.job !== '主婦・主夫' ? '朝に出かけて夕方に帰宅' : '家で過ごし、買い物や外食へ';
      case 'guest': return '夕方にチェックイン、翌朝7〜10時にチェックアウト';
      case 'visitor': return '買い物や食事のあと帰宅';
      case 'guard': return p.task ? (p.task.kind === 'search' ? `${floorName(p.task.f)}で爆弾を捜索` : '火災の消火') : '警備室で待機';
      case 'maid': return p.task ? `${this.placeName(p.task.room)}を清掃` : '8〜20時に客室を清掃';
      case 'vip': return 'スイートに1泊して、翌朝に評価を下す';
      case 'bride': case 'groom': case 'weddingGuest': return '11時に大聖堂へ。14時までに着けば式は成功';
      default: return '';
    }
  },

  describePerson(p) {
    if (!p) return null;
    if (!p.name) this.rollProfile(p);
    const mood = p.stress < 30 ? 'good' : p.stress < 60 ? 'fair' : 'bad';
    const stats = [['名前', p.name], ['年齢', `${p.age}歳`], ['職業・所属', p.job]];
    const h = p.home;
    if (h && TYPES[h.type]) {
      const label = p.kind === 'resident' ? '住まい' : p.kind === 'guest' || p.kind === 'vip' ? '宿泊先' : p.kind === 'worker' ? '勤め先' : '所属';
      stats.push([label, this.placeName(h)]);
    }
    let doing = STATE_TEXT[p.state] || p.state;
    if (p.patrol) doing = '巡回中';
    if (p.sick) doing = p.medAt ? `体調不良で${this.placeName(p.medAt)}へ` : `体調不良（${doing}）`;
    stats.push(['いま', doing]);
    if (p.dest) {
      const o = this.objAt(p.dest.f, p.dest.x);
      stats.push(['行き先', o && TYPES[o.type] ? this.placeName(o) : floorName(p.dest.f)]);
    }
    stats.push(['ストレス', `${Math.round(p.stress)}${mood === 'bad' ? '（イライラ）' : mood === 'fair' ? '（少し疲れ気味）' : ''}`]);
    stats.push(['今日の予定', this.todayPlan(p)]);
    return {
      title: p.name, subtitle: `${p.age}歳・${p.job}`, stats, mood,
      level: mood, actions: [], kind: p.kind,
    };
  },

  // ---- 病人と医療センター ----
  // 毎日0時: 建物の中にいる人のうち、ごく一部がその日のどこかで体調を崩す
  dailyIllness() {
    const M = SIM.MEDICAL, wk = this.day % 7 < 5, b = this.day * DAY;
    for (const o of this.facs) {
      if (!o.occupied || !o.members.length) continue;
      if (o.type === 'office' ? !wk : !(o.type === 'condo' || HOTEL.has(o.type))) continue;
      const pr = M.daily * (1 + Math.min(2, this.evalScore(o) / 30));
      for (const p of o.members) {
        if (this.r() >= pr) continue;
        this.at(b + (9 + this.rand(11)) * 60, () => this.fallIll(p));
      }
    }
  },

  fallIll(p) {
    if (p.sick || p.state !== 'in' || !p.loc) return;
    const home = p.home;
    p.sick = true;
    this.sickToday = (this.sickToday || 0) + 1;
    const cs = (this.byType.medical || []);
    let best = null, bd = Infinity, busy = null;
    for (const c of cs) {
      if (c.patients >= c.beds) { busy = busy || c; continue; }
      const d = this.dist(p.f, c.f, p.x, c.x + c.w / 2);
      if (d < bd) { bd = d; best = c; }
    }
    const cure = () => this.later(SIM.MEDICAL.stay[0] + this.rand(SIM.MEDICAL.stay[1]), () => { p.sick = false; });
    if (!best) {
      if (home) home.medShort = this.day;
      this.medAdvice(busy);
      cure();
      return;
    }
    best.patients++;
    p.medAt = best;
    const c = best;
    const ok = this.startTrip(p, c.f, this.spotIn(c), (pp) => {
      if (c.dead || c.destroyed) { this.recover(pp, c); return; }
      this.settle(pp, c);
      c.custToday++;
      this.later(SIM.MEDICAL.stay[0] + this.rand(SIM.MEDICAL.stay[1]), () => this.recover(pp, c));
    });
    if (!ok) { c.patients--; p.medAt = null; if (home) home.medShort = this.day; cure(); }
  },

  recover(p, c) {
    if (p.medAt !== c) return;
    c.patients = Math.max(0, c.patients - 1);
    p.medAt = null;
    p.sick = false;
    if (p.state === 'in' && p.loc === c) this.goBack(p);
  },

  // 混雑・不足の知らせ（6時間に1回まで）
  medAdvice(busy) {
    if (this.time - (this._medMsgAt ?? -1e9) < 360) return;
    this._medMsgAt = this.time;
    if (busy) this.msg('医療センターが混雑しています。増設を検討してください', 'info', busy.f, busy.x + busy.w / 2);
    else this.msg('病人が出ましたが、医療センターがありません。建設を検討してください', 'info');
  },

  medShortRecent(o) { return o.medShort !== undefined && o.medShort !== null && this.day - o.medShort <= 1; },

  // ---- ホテルのレビュー ----
  noteStay(o, p) {
    if (!HOTEL.has(o.type)) return;
    o.stayStress = Math.max(o.stayStress || 0, Math.min(100, p.stress));
    o.stayWait = Math.max(o.stayWait || 0, p.waitTot || 0);
    if (!o.stayName) { if (!p.name) this.rollProfile(p); o.stayName = p.name; }
  },

  addReview(o) {
    const causes = [];
    let stars = 5;
    const st = o.stayStress || 0, wt = o.stayWait || 0;
    if (st >= 60) { stars -= 2; causes.push('stress'); } else if (st >= 30) { stars -= 1; causes.push('stress'); }
    if (wt >= 8) { stars -= 1; causes.push('wait'); }
    if (o.noisy) { stars -= 1; causes.push('noisy'); }
    if (o.infested) { stars -= 2; causes.push('roach'); }
    if (o.garbageBad) { stars -= 1; causes.push('garbage'); }
    if (o.parkingShort > 0) { stars -= 1; causes.push('parking'); }
    stars = Math.max(1, Math.min(5, stars));
    // いちばん大きな原因（ゴキブリ > 騒音 > 待ち > 移動 > ごみ > 駐車場）
    const order = ['roach', 'noisy', 'wait', 'stress', 'garbage', 'parking'];
    const main = order.find((c) => causes.includes(c));
    const pool = main ? REVIEW_TEXT[main] : stars >= 5 ? REVIEW_TEXT.great : REVIEW_TEXT.good;
    const text = pool[Math.floor(this.r() * pool.length)];
    o.reviews = o.reviews || [];
    o.reviews.push({ stars, text, day: this.day, name: o.stayName || '宿泊客' });
    if (o.reviews.length > 20) o.reviews.splice(0, o.reviews.length - 20);
    o.stayStress = 0; o.stayWait = 0; o.stayName = '';
  },

  reviewAverage(o) {
    const r = o.reviews || [];
    return r.length ? r.reduce((a, v) => a + v.stars, 0) / r.length : null;
  },
};

export const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
