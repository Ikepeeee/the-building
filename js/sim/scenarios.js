// シナリオ（データ）。SPEC §16。新しいシナリオはここに足す。
// 動きの仕組みは scenario.js（ScenarioMixin）。ここには数値・文面・目標の測り方だけを書く。

// 目標の値の測り方（sim を受け取って数を返す）
export const GOAL_METRICS = {
  hotelRooms: (s) => s.hotels.length,
  // 直近30日のホテルの平均レビュー（★）。件数が少ないうちは null
  hotelReview30: (s) => {
    let n = 0, sum = 0;
    for (const o of s.hotels) for (const r of o.reviews || []) if (r.day >= s.day - 30) { n++; sum += r.stars; }
    return n >= 10 ? sum / n : null;
  },
  pop: (s) => s.pop,
  visitorsPerDay: (s) => Math.round(s.visitorsPerDay),
  hotelReviewAll: (s) => {
    let n = 0, sum = 0;
    for (const o of s.hotels) for (const r of o.reviews || []) { n++; sum += r.stars; }
    return n >= 10 ? sum / n : null;
  },
};

export const SCENARIOS = [
  {
    id: 'seaside',
    name: '海辺のリゾート',
    subtitle: '寂れた浜に、もう一度人を呼ぶ',
    desc: '夏の観光客をつかまえて、評判のよいリゾートホテルを建てよう。台風には気をつけて。',
    theme: 'seaside',
    start: { money: 1500000, star: 1, month: 7, day: 1, minFloor: -2 },
    // ★の解放の上書き（型 → 必要な★）
    unlock: { hotelSingle: 1, hotelTwin: 1, restaurant: 1, shop: 1, escalator: 1, housekeeping: 1 },
    // このシナリオでは使わない型
    disabled: ['cathedral'],
    // シナリオ独自の★の条件（6 は伝説のリゾート）
    stars: {
      2: { visitors: 300 },
      3: { visitors: 800, types: ['umiNoIe', 'security'] },
      4: { visitors: 1500, types: ['onsen', 'aquarium'], vip: true },
      5: { visitors: 2500, review: 4.5 },
      6: { types: ['seaChapel'], wedding: true },
    },
    // 季節だけ営業する店（月）
    openMonths: { umiNoIe: [7, 8, 9] },
    // 目玉施設: 人口や季節に関係なく観光客を呼ぶ（1時間・1施設あたり）
    attractions: { aquarium: { rate: 24, season: false }, umiNoIe: { rate: 6, season: true }, onsen: { rate: 4, season: true } },
    // 温泉があるとホテルのレビューが上がる（確率）
    onsenReview: 0.5,
    // 結婚式（伝説のリゾート）: 土日の夕方、海のチャペルで
    wedding: { venue: 'seaChapel', hour: 17, minutes: 60, ending: 'legend' },
    deadlineDays: 120,
    gradeRule: [{ days: 60, grade: 3 }, { days: 90, grade: 2 }, { days: 120, grade: 1 }],
    fail: { money: -500000, days: 7 },
    goals: [
      { id: 'rooms', label: 'ホテルの客室', metric: 'hotelRooms', target: 40, unit: '室' },
      { id: 'review', label: 'ホテルの平均レビュー（直近30日）', metric: 'hotelReview30', target: 4.0, unit: '★', digits: 1 },
      { id: 'visitors', label: '1日の来訪者（直近3日の平均）', metric: 'visitorsPerDay', target: 1500, unit: '人' },
    ],
    // 需要の倍率（施設の種類ごと）。ホテルは予約の確率、商業は来客、テナントは入居
    demand: { hotel: 1.6, restaurant: 1.6, shop: 1.5, fastfood: 1.4, cinema: 1.2, partyHall: 1.2, office: 0.25, condo: 1.1, umiNoIe: 1.5, onsen: 1.3, aquarium: 1.0 },
    // 季節の波（月ごと）。観光客・ホテル予約・浜からの来客にかかる
    season: { 1: 0.5, 2: 0.5, 3: 0.7, 4: 0.9, 5: 1.0, 6: 1.2, 7: 2.0, 8: 2.0, 9: 1.6, 10: 1.3, 11: 0.8, 12: 0.6 },
    // 浜からの観光客: 1F・2F の飲食店とショップに、人口に関係なく来る（1時間・1店あたり）
    beach: { floors: [0, 1], types: ['fastfood', 'restaurant', 'shop', 'umiNoIe'], rate: 3 },
    weather: {
      typhoon: { months: [8, 9, 10], daily: 0.05, hours: [18, 30], cancel: 0.6, damage: 0.15, topFloors: 3, repair: 0.05 },
      rain: { daily: 0.12, hours: [3, 8], visitors: 0.6 },
    },
    story: {
      intro: [
        { speaker: '町長', title: '海辺の町へようこそ', text: 'よく来てくれた。この浜も昔は海水浴客でにぎわったのだが、今はこの通りだ。\nもう一度、人を呼べるリゾートホテルを建ててくれないか。期限は120日だ。' },
        { speaker: '民宿のおかみさん', title: '民宿のおかみさん', text: 'あらまあ、若い人が来てくれて嬉しいわ。夏はお客さんが多いけど、秋の台風には気をつけてね。\n浜からのお客さんは、1階と2階のお店によく寄るわよ。' },
      ],
      firstHotel: { speaker: '民宿のおかみさん', title: '最初の客室', text: 'ホテルの客室ができたのね！ お掃除の人がいないと、すぐ汚れちゃうから気をつけて。' },
      firstFiveStar: { speaker: '町長', title: '★5 のレビュー', text: '聞いたかね、★5 のレビューが付いたそうだ！ この調子で評判を広めてくれ。' },
      typhoonSurvived: { speaker: '民宿のおかみさん', title: '台風一過', text: 'ひどい風だったわねえ。でも、ちゃんと乗り越えられたじゃない。明日はきっといい天気よ。' },
      halfway: { speaker: '町長', title: '折り返し', text: '期限の半分が過ぎた。目標の進み具合はどうかね。客室と評判、それに人口だ。' },
      clear: { speaker: '町長', title: 'リゾートの完成', text: 'ありがとう！ 浜にまた人が戻ってきた。この町の誇りだよ。\nこのまま★5を目指して、30階より上に「海のチャペル」を建ててみないか。夕日の結婚式が挙がれば、この浜は伝説のリゾートになる。' },
      firstUmiNoIe: { speaker: '民宿のおかみさん', title: '海の家', text: '海の家ができたのね！ 夏のあいだは浜のお客さんでいっぱいになるわよ。秋になったら閉めるの。' },
      firstOnsen: { speaker: '民宿のおかみさん', title: '温泉', text: 'まあ、温泉！ お客さんが喜ぶわ。レビューもきっと良くなるわよ。' },
      firstAquarium: { speaker: '町長', title: '水族館', text: '水族館とは大きく出たね。季節を問わずお客さんが来てくれるだろう。' },
      legend: { speaker: '町長', title: '伝説のリゾート', text: '夕日の結婚式、見事だった……。この浜は、もう伝説のリゾートだ。本当にありがとう！' },
      fail: { speaker: '町長', title: '計画の見直し', text: '残念だが、今回の計画はここまでのようだ……。それでも、続けたいなら止めはしないよ。' },
    },
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) || null;
