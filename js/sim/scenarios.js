// シナリオ（データ）。SPEC §16。新しいシナリオはここに足す。
// 動きの仕組みは scenario.js（ScenarioMixin）。ここには数値・文面・目標の測り方だけを書く。

// 目標の値の測り方（sim を受け取って数を返す）
export const GOAL_METRICS = {
  // ホテルの客室（コテージは数えない）
  hotelRooms: (s) => s.hotels.reduce((n, o) => n + (o.type !== 'cottage' ? 1 : 0), 0),
  // 直近30日のホテルの平均レビュー（★）。件数が少ないうちは null
  hotelReview30: (s) => {
    let n = 0, sum = 0;
    for (const o of s.hotels) if (o.type !== 'cottage') for (const r of o.reviews || []) if (r.day >= s.day - 30) { n++; sum += r.stars; }
    return n >= 10 ? sum / n : null;
  },
  pop: (s) => s.pop,
  visitorsPerDay: (s) => Math.round(s.visitorsPerDay),
  hotelReviewAll: (s) => {
    let n = 0, sum = 0;
    for (const o of s.hotels) if (o.type !== 'cottage') for (const r of o.reviews || []) { n++; sum += r.stars; }
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
      2: { visitors: 300, types: ['umiNoIe'] },
      3: { visitors: 800, types: ['security', 'onsen'], anyOf: [{ types: ['terraceCafe', 'beerGarden'], label: '屋外レストラン（テラスカフェかビアガーデン）' }] },
      4: { visitors: 1500, types: ['aquarium'], counts: [{ type: 'hotelFamily', n: 10 }], vip: true },
      5: { visitors: 2500, types: ['amusement'], review: 4.5 },
      6: { types: ['seaChapel'], wedding: true },
    },
    // 季節だけ営業する店（月）
    openMonths: { umiNoIe: [7, 8, 9] },
    // 目玉施設: 人口や季節に関係なく観光客を呼ぶ（1時間・1施設あたり）
    // （来訪者は連れの人数で数えるので、組の数で書く。家族連れが多い施設ほど1組の人数が多い）
    attractions: {
      aquarium: { rate: 10, season: false }, umiNoIe: { rate: 2.5, season: true }, onsen: { rate: 2, season: true }, amusement: { rate: 12, season: false },
      nightPool: { rate: 2, season: true }, skyLounge: { rate: 3, season: false },
    },
    // イルカショー（1日4回。ショーの前に観客が集まる）
    dolphin: { times: [630, 750, 870, 960], minutes: 25, crowd: 8, rain: 0.4, aquariumBoost: 1.3 },
    // 花火大会: 7〜8月の土曜 19:30〜20:30。3日前に告知、雨・台風なら翌日に順延（それも駄目なら中止）
    festival: { months: [7, 8], weekday: 5, start: 19 * 60 + 30, minutes: 60, notice: 3, crowd: 1.5, sales: 1.3 },
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
    beach: { floors: [0, 1], types: ['fastfood', 'restaurant', 'shop', 'umiNoIe', 'terraceCafe', 'beerGarden'], rate: 1.2 },
    weather: {
      typhoon: { months: [8, 9, 10], daily: 0.05, hours: [18, 30], cancel: 0.6, damage: 0.15, topFloors: 3, repair: 0.05 },
      rain: { daily: 0.12, hours: [3, 8], visitors: 0.6 },
    },
    // 物語の節目。lines は会話の行（1行が1つの 'scenario' 通知）。順番は storyOrder
    story: {
      intro: { title: '海辺の町へようこそ', lines: [
        { speaker: '町長', text: 'よく来てくれた。この浜も昔は海水浴客でにぎわったが、今はこの通りだ。\nもう一度、人を呼べるリゾートを建ててくれないか。まずは120日、頼んだよ。' },
        { speaker: '民宿のおかみさん', text: 'あらまあ、若い人が来てくれて嬉しいわ。うちの民宿も手伝うからね。\n夏は浜のお客さんが多いけど、秋の台風には気をつけて。' },
      ] },
      firstHotel: { title: 'フロントの渚', lines: [
        { speaker: '渚', text: '今日からフロントに立つ、渚です！ 母がいつもお世話になってます。\nお客さんを一番に迎えるのが私の仕事。お部屋はきれいにしておいてくださいね。' },
        { speaker: '民宿のおかみさん', text: 'うちの娘よ。にぎやかでしょう？ よろしくね。' },
      ] },
      firstUmiNoIe: { title: '浜のライフガード', lines: [
        { speaker: '航', text: 'あ、どうも……。この浜のライフガードの、航です。\n海の家ができたなら、泳ぐ人も増えますね。見張り、がんばります。' },
        { speaker: '渚', text: '航くん、相変わらず声が小さいなあ。でも、浜に人が戻ってきて嬉しいね！' },
      ] },
      star2: { title: '★2 リゾートらしく', lines: [
        { speaker: '町長', text: '★2だ！ 町の評判が少しずつ上がってきたよ。' },
        { speaker: '渚', text: 'だんだんリゾートらしくなってきましたね！ フロントも忙しくなってきました。' },
      ] },
      firstOutdoor: { title: '夕暮れのテラス', lines: [
        { speaker: '渚', text: '外で食べるのって気持ちいいね。海が夕焼けで真っ赤。' },
        { speaker: '航', text: '……うん。こういう景色、ずっと見ていたいな。' },
        { speaker: '渚', text: 'え、今なにか言った？' },
      ] },
      firstOnsen: { title: 'スーパー銭湯', lines: [
        { speaker: '民宿のおかみさん', text: 'まあ、立派なお風呂！ 露天風呂から海が見えるなんて贅沢ねえ。\n泊まったお客さんの評判も、きっと良くなるわよ。' },
      ] },
      star3: { title: '★3 町に人が戻る', lines: [
        { speaker: '町長', text: '★3だ！ 町を出ていった若い人たちが、少しずつ戻ってきているそうだ。\n商店街にも明かりが増えた。君のおかげだよ。' },
      ] },
      typhoonSurvived: { title: '台風の夜', lines: [
        { speaker: '民宿のおかみさん', text: 'ひどい風だったわねえ。でも、みんな無事でよかった。' },
        { speaker: '渚', text: '航くんが、浜のお客さんを一人ずつビルの中に案内してくれたんです。\n……ちょっと、かっこよかった。' },
        { speaker: '航', text: 'い、いや。仕事だから。' },
      ] },
      fireworks: { title: '花火大会', lines: [
        { speaker: '渚', text: 'わあ、大きい！ 浜から見る花火って、こんなにきれいだったんだ。' },
        { speaker: '航', text: '子どものころ、毎年ここで見てた。……今年は、渚さんと見られてよかった。' },
        { speaker: '渚', text: 'え？ 花火の音で聞こえなかった。もう一回言って？' },
      ] },
      firstAquarium: { title: '水族館の飼育員', lines: [
        { speaker: '航', text: '水族館の飼育員になりました。海の生き物のことなら、少しは詳しいので……。' },
        { speaker: '渚', text: 'ウミガメの前で、航くんがずっと楽しそうに説明してくれたの。\nあんなにしゃべる航くん、初めて見たかも。' },
      ] },
      star4: { title: '★4 VIPのお墨付き', lines: [
        { speaker: '町長', text: 'あのVIPが、うちの浜を「また来たい」と言ってくれたそうだ！ 信じられないよ。' },
        { speaker: '渚', text: 'フロントでお見送りしたとき、手を振ってくださったんです！' },
      ] },
      firstAmusement: { title: '観覧車のてっぺんで', lines: [
        { speaker: '航', text: '観覧車のてっぺんから見ると、浜もビルも全部見えるんだね。' },
        { speaker: '航', text: '（……決めた。次の★が上がったら、ちゃんと言おう。）' },
      ] },
      star5: { title: '★5 プロポーズ', lines: [
        { speaker: '航', text: '渚さん。僕と、結婚してください。' },
        { speaker: '渚', text: '……はい！ ねえ、式はこの浜でしたいな。30階より上の、海が全部見える場所で。' },
        { speaker: '町長', text: 'それなら「海のチャペル」だ。ビルの30階より上に建ててくれないか。' },
      ] },
      chapelBuilt: { title: '海のチャペル', lines: [
        { speaker: '民宿のおかみさん', text: 'なんてきれいなチャペル……。式は、次の土曜か日曜の夕方にしましょう。' },
        { speaker: '渚', text: '夕日の時間に、ロビーからみんなでチャペルへ上がるの。エレベーターが混まないといいな。' },
      ] },
      legend: { title: '伝説のリゾート', lines: [
        { speaker: '渚', text: '夕日がチャペルいっぱいに差し込んで……。最高の式でした！' },
        { speaker: '航', text: 'この浜で、ずっと一緒に。ありがとう、渚。' },
        { speaker: '民宿のおかみさん', text: 'よかったねえ、二人とも。' },
        { speaker: '町長', text: 'この浜は、もう伝説のリゾートだ。本当にありがとう！' },
      ] },
      firstFiveStar: { title: '★5 のレビュー', lines: [
        { speaker: '渚', text: '★5 のレビューが付きました！ 「フロントの笑顔がよかった」ですって。えへへ。' },
      ] },
      halfway: { title: '折り返し', lines: [
        { speaker: '町長', text: '期限の半分が過ぎた。客室と評判、それに1日の来訪者。目標の進み具合はどうかね。' },
      ] },
      clear: { title: 'リゾートの完成', lines: [
        { speaker: '町長', text: 'ありがとう！ 120日の約束は果たしてくれた。浜にまた人が戻ってきたよ。' },
        { speaker: '民宿のおかみさん', text: 'でも、まだまだこれから。あの二人も、なんだかいい感じだしね。\n★5 を目指して、もっと素敵な浜にしてちょうだい。' },
      ] },
      fail: { title: '計画の見直し', lines: [
        { speaker: '町長', text: '残念だが、今回の計画はここまでのようだ……。それでも、続けたいなら止めはしないよ。' },
      ] },
    },
    // 物語の順番と、「次の節目」のヒント
    storyOrder: [
      { key: 'firstHotel', label: '最初の客室', hint: 'ホテルの客室を建てると、フロントに誰かが立つ…？' },
      { key: 'firstUmiNoIe', label: '海の家', hint: '1Fに海の家を建てると、浜で誰かに会えるかも' },
      { key: 'star2', label: '★2', hint: '1日の来訪者 300人と海の家で★2' },
      { key: 'firstOutdoor', label: '夕暮れのテラス', hint: 'テラスカフェかビアガーデンを建てると…？' },
      { key: 'firstOnsen', label: 'スーパー銭湯', hint: 'スーパー銭湯を建てると、おかみさんが喜ぶ' },
      { key: 'star3', label: '★3', hint: '来訪者 800人・警備室・スーパー銭湯・屋外レストランで★3' },
      { key: 'typhoonSurvived', label: '台風の夜', hint: '台風を乗り越えると…？' },
      { key: 'fireworks', label: '花火大会', months: [7, 8], hint: '7〜8月の土曜の夜は花火大会。★3 になったら、浜で二人が…？' },
      { key: 'firstAquarium', label: '水族館', hint: '水族館を建てると、航に新しい仕事が' },
      { key: 'star4', label: '★4', hint: '来訪者 1,500人・水族館・ファミリールーム10室・VIP の高評価で★4' },
      { key: 'firstAmusement', label: '観覧車', hint: '遊園地を建てると、観覧車で…？' },
      { key: 'star5', label: '★5', hint: '来訪者 2,500人・遊園地・レビュー★4.5で★5' },
      { key: 'chapelBuilt', label: '海のチャペル', hint: '30F以上に海のチャペルを建てる' },
      { key: 'legend', label: '結婚式', hint: '土日の夕方、ロビーからチャペルまで二人を無事に送り届ける' },
    ],
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) || null;
