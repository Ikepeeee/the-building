# The Building 仕様書（チーム共通の契約）

ニンテンドー「ザ・タワー」（SimTower）にインスパイアされた**オリジナル**のビル経営シミュレーション。
本家の名称・ロゴ・画像・音楽は使わない。絵はすべて Canvas でプロシージャルに描く（外部画像ファイルなし）。

- 静的ファイルのみで動く SPA（GitHub Pages にそのまま置ける）。ビルド工程なし、依存ライブラリなし。
- ES Modules（`<script type="module">`）。import は相対パスで、拡張子 `.js` を付ける。
- セーブは `localStorage`（キーは `SAVE_KEY` を基準にする）。
- PC（マウス・キーボード）とスマホ（タッチ・縦横画面）の両方に対応する。
- UI の文言は日本語。

## ファイル構成と担当

| パス | 担当 | 内容 |
|---|---|---|
| `js/sim/constants.js` | リード（数値バランスの調整のみ sim 担当も可） | 共有定数・施設定義・座標変換 |
| `js/sim/tower.js` | sim | `export class Tower`（シミュレーション本体、DOM 非依存） |
| `js/sim/events.js` 他 `js/sim/*.js` | sim | 事件（爆弾・火災・ゴキブリ・苦情・VIP・結婚式） |
| `tests/*.mjs` | sim | Node で動く自動テスト（`node tests/sim.test.mjs`） |
| `js/render/*.js` | render | `export class Renderer`、ピクセルアート描画 |
| `index.html`, `css/*`, `js/main.js`, `js/ui/*.js` | ui | 画面・入力・ゲームループ・セーブ・効果音 |
| `README.md` | ui | 遊び方と GitHub Pages への公開手順 |

**自分の担当外のファイルは編集しない。** 他担当への要望は、最終報告の中に書くこと。

## 座標系

- マス x: 0〜`W-1`、フロア f: `MIN_F`(-10, B10F) 〜 `MAX_F`(99, 100F)。f=0 が 1F、地面は 1F の下端。
- ワールドpx: `wx = x*TILE_W`、フロア f の上端は `wy = -(f+1)*FLOOR_H`、下端は `-f*FLOOR_H`。
- カメラ `cam = {x, y, zoom}`。持ち主は UI。変換関数は constants.js にある。

## ゲーム内容（本家準拠）

### 時間
- 1日 = 1440 分。`time` は開始からの通算分。0日目は月曜の 06:00 に始まる。曜日は `WEEK[day % 7]`（5・6 が土日）。
- 等倍で 1 実秒 = 6 ゲーム分。速度は `SPEEDS`。

### 建設ルール
- 地上の f>0 に建てるには、真下（f-1）の同じマスに何か（フロア・施設）が必要。地下の f<0 は真上（f+1）に何か必要。f=0 は常に建てられる。
- 施設は空マスまたは空きフロアの上に置ける。空マスに置いた場合はフロア代（1マス $500）を加算する。
- `only` 制約: lobby は `LOBBY_FLOORS` の階のみ、cathedral は f=99 のみ、recycling と metro は地下のみ（h フロアすべてが f<0）、`aboveGround` は f>=0。
- h>1 の施設は f〜f+h-1 を占有する。支えの判定は一番下の段（地下施設は一番上の段）で行う。
- 階段とエスカレーターは f に置き、f と f+1 をつなぐ。f+1 の同じマスにもフロアが必要。
- エレベーターは縦にドラッグして範囲 lo〜hi を決める。通常のエレベーターは最大30フロア。急行エレベーターはロビー階と地下階にだけ停止する。
- 撤去: 施設を撤去すると空きフロアに戻る。空きフロアの撤去は、それが支えている上下の構造がなければできる。返金はない。

### 人の流れ
- 人はロビー（1F）と地下鉄駅から出入りする。経路はフロアを節点としたダイクストラ法で求め、手段は通常・急行エレベーター、階段、エスカレーター。徒歩は 1分あたり 2.5 マス。
- ストレス: エレベーター待ちが3分を超えると増え、階段でも増える。移動のたびに 0 から数える。色は 0〜29 が黒、30〜59 がピンク、60 以上が赤。
- 評価: 目的地に着いたときのストレスを施設ごとに平均する。`evalLevel(o)` は `'good'`（<20）、`'fair'`（<45）、`'bad'` のいずれか。テナントは bad が2日続くと退去する。
- オフィス: 平日 7〜9時に出社、昼に 6割が飲食店へ、17〜19時に退社。平日の正午に賃料が入る。
- マンション: 入居時に販売収入。平日は 7割が通勤・通学で外出し、休日は買い物や外食に出る。
- ホテル: 16時に予約、16〜20時にチェックイン、翌 7〜10時にチェックアウトで宿泊料。チェックアウト後は「要清掃」になり、ハウスキーピングが清掃するまで次の予約が入らない。
- 商業施設: 営業時間中、外部客が人口に比例して来店する。客1人ごとに売上。
- 騒音: マンションまたはホテルの同じ階・4マス以内に飲食・映画館・パーティーホールがあると、評価が悪化し苦情の原因になる。
- 維持費: 毎日0時に、エレベーターのカゴ1台につき $600 などを支払う。

### ★評価
| ★ | 条件 | 解放（主なもの） |
|---|---|---|
| 1 | 開始 | フロア、ロビー、階段、エレベーター、オフィス、マンション、ファストフード |
| 2 | 人口 300 | ホテル（シングル・ツイン）、レストラン、ショップ、エスカレーター、警備室、ハウスキーピング |
| 3 | 人口 1000 ＋ 警備室 | 急行エレベーター、スイート、映画館、パーティーホール、医療センター、リサイクルセンター |
| 4 | 人口 3000 ＋ 医療センター ＋ リサイクルセンター ＋ VIP の高評価 | 地下鉄駅 |
| 5 | 人口 6000 ＋ 地下鉄駅 | 大聖堂 |
| TOWER | ★5 ＋ 100F の大聖堂で結婚式が成功 | エンディング |

### 事件（events）
- **テロリストの爆破予告**: ★2 以上でまれに発生する。`prompt` で身代金（人口に応じて $10万〜$100万）を要求される。払えば終わり。拒否すると、ランダムなフロアに爆弾が仕掛けられ、制限時間は3時間。警備室があれば警備員が1フロアずつ捜索し（警備室が多いほど速い）、見つかれば解除。見つからなければ爆発し、爆心の ±1 フロア・±20 マスの施設が消える（エレベーターと階段は残る）。
- **火災**: ★2 以上でまれに発生する。ある施設から燃え始め、横と上の階に広がる。警備室があれば消火に向かう。`prompt` で「ヘリで消火 $50万」も選べる。一定時間燃えた施設は焼失する。
- **ゴキブリ**: 要清掃のホテル客室が2日放置されると発生する。毎日、隣接する客室（同じ階で隣り合う、または上下で重なる）に広がる。発生中の客室は予約が入らない。パネルの「駆除 $1万」で解消する。
- **住民の苦情**: 評価が bad の、または騒音のあるマンション・オフィス・ホテルが苦情を出す。`message` で通知し（「〇Fの住人: エレベーターが遅すぎる！」など、原因別の文面）、施設に `complaintUntil` を設定して吹き出しを表示する。
- **VIP 来館**: ★4 の VIP 以外の条件がそろい、スイートがあるとき、予告のあと VIP が来館して1泊する。移動時のストレスと清掃状態で判定する。成功すれば★4、失敗なら7日後に再挑戦。
- **結婚式**: ★5 で 100F に大聖堂があると、土日の 11時に新郎新婦と招待客10人がロビーから大聖堂へ向かう。新郎新婦が14時までにストレス 60 未満で着けば TOWER 達成（`tower` イベントを出す）。失敗なら翌週に再挑戦。
- ほかにも本家らしい演出（クリスマスのサンタなど）を足してよい。

## Sim API（`js/sim/tower.js` の `Tower`）

```js
const sim = new Tower();          // 新規ゲーム
sim.step(minutes);                // 時間を進める（内部で 0.25 分刻み）
sim.on(name, fn);                 // 通知の購読
sim.serialize() -> plainObject;   // JSON にできる形
sim.restore(obj);                 // 読み込み（人の状態は時刻に応じて妥当に再構成）
```

### 読み取り用フィールド（render と UI は読むだけ。書き換えない）
- `sim.time`, `sim.day`, `sim.hour`, `sim.minute`, `sim.weekday`（0〜6）, `sim.money`, `sim.pop`, `sim.star`（1〜5）, `sim.tower`（bool）
- `sim.ledger = {income, expense}`（当日分）, `sim.yesterday`（前日分または null）
- `sim.grid[f]`: 長さ `W` の `Int32Array`。0 は空、-1 は空きフロア、正の数は施設 id。h>1 の施設や縦長のエレベーターは占有するすべてのマスに id が入る。
- `sim.objs`: `Map<id, obj>`。施設の共通フィールドは `{id, type, f, x, w, h, occupied, inCount}`。
  - `occupied`: テナントが入居中、ホテルなら宿泊中、商業・サービス施設は常に true。
  - `inCount`: 中にいる人数（室内に人影を描くのに使う）。
  - ホテル: `dirty`（要清掃）, `infested`（ゴキブリ）。
  - `complaintUntil`（この時刻まで吹き出しを出す）, `complaint`（文面）。
  - `burnt`（0〜1、焦げの度合い）。
  - エレベーター（`type` が `'elevator'` または `'express'`）: `{x, w, lo, hi, cars:[{pos, dir, state, pass:[]}], q:{[floor]:{up:[], down:[]}}}`。`pos` はフロアの小数値、`state` は `'idle'|'moving'|'doors'`。
- `sim.evalLevel(o)` -> `'good'|'fair'|'bad'|null`, `sim.isOpen(o)` -> bool（営業時間内か）
- `sim.active`: 移動中の人の `Set`。人は `{id, kind, state, stress, f, x}`。
  - `kind`: `'worker'|'resident'|'guest'|'visitor'|'guard'|'maid'|'vip'|'bride'|'groom'|'weddingGuest'`
  - `state`: `'walk'|'wait'|'ride'|'stairs'`。`ride` の人はカゴの中なので描かない。`wait` の人はエレベーターの待ち列 `q` から描く。
  - `sim.drawPos(p)` -> `{x, f}` または null。x はマスの小数値、f はフロアの小数値で、階段の途中なら中間値になる。
- `sim.fires`: `[{f, x0, x1}]`（燃えている区間）
- `sim.bomb`: null または `{f, x, deadline, searched:Set<f>, found:bool}`
- `sim.effects`: `[{kind:'explosion'|'smoke'|'bells'|'fireworks'|'sparkle', f, x, t0, dur}]`（t0 と dur はゲーム分。sim が期限切れを取り除く）
- `sim.santa`: null または `{x, f}`（クリスマスの演出用。任意）

### 操作
- `sim.check(tool, p)` -> `{ok, reason, cost, ghost}`。実際には何もしない。
- `sim.build(tool, p)` -> 戻り値は `check` と同じ。成功時は建設する。
  - `tool` は `TYPES` のキーまたは `'bulldoze'`。
  - `p = {f, x}`。横ドラッグのツール（floor・lobby・bulldoze）は `x2` も渡す。縦ドラッグのツール（elevator・express）は `f2` も渡す。クリックで置くツールの `x` は左端のマス。
  - `ghost`: 単一フロアの施設は `{x, w, f, h}`、エレベーターは `{x, w, lo, hi}`。UI はこれを renderer にそのまま渡す。
- `sim.objAt(f, x)` -> obj または null
- `sim.describe(o)` -> `{title, subtitle, stats:[[label, value]], level, actions:[{id, label, cost, enabled, danger}]}`
- `sim.act(o, actionId)` -> `{ok, reason}`。アクションは `addCar`、`removeCar`、`extendUp`、`extendDown`、`exterminate`、`remove` など。
- `sim.answer(promptId, value)`: `prompt` への回答。
- `sim.starProgress()` -> `{star, next, reqs:[{label, done}]}`

### 通知（`sim.on`）
- `'message'`: `{text, kind:'info'|'good'|'bad'|'money'|'star'|'event'|'complaint', f?, x?}`。f と x があれば、UI はその場所へジャンプできる。
- `'prompt'`: `{id, kind:'bomb'|'fire'|'vip'|'wedding'|..., title, text, choices:[{label, value}]}`。UI はモーダルを出して一時停止し、`sim.answer` で答える。
- `'star'`: `{star}`
- `'tower'`: `{}`（エンディング）
- `'sound'`: `{name}`。name は `'cash'|'ding'|'build'|'bulldoze'|'error'|'boom'|'fire'|'alarm'|'bells'|'fanfare'|'roach'|'complaint'`

## Renderer API（`js/render/renderer.js`）

```js
const r = new Renderer(canvas, sim);
r.resize(cssWidth, cssHeight);      // devicePixelRatio の処理は renderer の中で行う
r.render(view);                     // 毎フレーム呼ぶ
// view = { cam:{x,y,zoom}, ghost:{...sim の ghost, ok:bool, label?:string} | null,
//          selectedId: number|null, hover:{f,x}|null, nowMs: performance.now() }
r.setSim(sim);                      // ロード時などに差し替える
```
- 本家風のピクセルアート。横から見た断面図で、黒い輪郭線、室内の家具と人影、昼夜で変わる空、夜の窓明かり、雲、地層の見える地下を描く。
- 評価は小さなインジケータで示し、ストレスは人の色で示す。苦情は吹き出し、ゴキブリ・火災・爆発・爆弾捜索中の表示、結婚式の演出も描く。
- フロア番号のラベル（1F、B1F、…）を左端に描く。
- 画面外は描かない（カリング）。100F・数千人の規模でもスマホで 60fps 近くを目指す。生成したスプライトはオフスクリーンキャンバスにキャッシュする。

## UI（`index.html`, `js/main.js`, `js/ui/*`）
- タイトル画面（新規・続きから）、上部 HUD（★、資金、人口、日付・曜日・時刻、速度）、施設ツールバー（カテゴリ別、コストと★によるロック表示）、情報パネル（`describe` と `act`）、トースト通知、事件のモーダル、★の昇格演出、TOWER 達成のエンディング。
- 入力: PC はドラッグで建設、右クリックドラッグまたはスペース＋ドラッグでスクロール、ホイールでスクロール、Ctrl＋ホイールでズーム、ショートカットキー。スマホは1本指で建設またはパン、2本指でピンチズームとパン。小さい施設は配置プレビューをもう一度タップして確定する。
- オートセーブ（ゲーム内の1日ごと）と手動セーブ・ロード。データ破損に強くし、try/catch で囲む。
- 効果音は WebAudio で合成する（音声ファイルなし）。ミュートボタンを付ける。
