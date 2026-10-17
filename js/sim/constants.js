// 共有定数。全モジュールがここを参照する。
// キー名・フィールド名は変更しないこと（数値バランスの調整は sim 担当が行ってよい）。

export const TILE_W = 8;        // 1マスの幅（ワールドpx）
export const FLOOR_H = 24;      // 1フロアの高さ（ワールドpx）
export const W = 150;           // 横のマス数
export const MIN_F = -10;       // 最下層 B10F
export const MAX_F = 99;        // 最上層 100F
export const DAY = 1440;        // 1日 = 1440 ゲーム分
export const GAME_MIN_PER_SEC = 6;      // 等倍で 1 実秒 = 6 ゲーム分
export const SPEEDS = [0, 1, 2, 4, 8];
export const START_MONEY = 2000000;
export const LOBBY_FLOORS = [0, 14, 29, 44, 59, 74, 89]; // 1F と スカイロビー階 (15F,30F,...,90F)
export const STAR_POP = [0, 0, 300, 1000, 3000, 6000];   // ★n に必要な人口
export const WEEK = ['月', '火', '水', '木', '金', '土', '日'];
export const SAVE_KEY = 'thebuilding.save.v1';

export const floorName = (f) => (f >= 0 ? `${f + 1}F` : `B${-f}F`);
export const fmtMoney = (v) => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');

// ---- 座標変換 ----
// ワールド座標: wx = マス * TILE_W、フロア f の上端 wy = -(f+1)*FLOOR_H、下端 wy = -f*FLOOR_H（地面は wy=0）。
// カメラ cam = { x, y, zoom }: x,y は画面左上に映るワールド座標、zoom は CSS px / ワールドpx。
export const worldToScreen = (cam, wx, wy) => [(wx - cam.x) * cam.zoom, (wy - cam.y) * cam.zoom];
export const screenToWorld = (cam, sx, sy) => [sx / cam.zoom + cam.x, sy / cam.zoom + cam.y];
export const worldToCell = (wx, wy) => ({ x: Math.floor(wx / TILE_W), f: Math.floor(-wy / FLOOR_H) });

// ---- 施設定義 ----
// cat:   ツールバーのグループ
// w:     幅（マス）。drag:'h' の場合は可変（minW）
// h:     高さ（フロア数、既定1）。h>1 は f〜f+h-1 を占有
// drag:  'h' 横ドラッグ / 'v' 縦ドラッグ（エレベーター）
// only:  'lobbyFloor' LOBBY_FLOORS のみ / 'top' 100F のみ / 'basement' 地下のみ / 'aboveGround' 地上のみ
// cap:   所属人数
export const TYPES = {
  floor:       { name: 'フロア', cat: 'basic', drag: 'h', minW: 1, costPerTile: 500, star: 1, desc: '空きフロア。施設の土台になる' },
  lobby:       { name: 'ロビー', cat: 'basic', drag: 'h', minW: 4, costPerTile: 2000, star: 1, only: 'lobbyFloor', desc: '人の出入口。1Fと15F毎のスカイロビー階に設置' },
  stairs:      { name: '階段', cat: 'transport', w: 8, cost: 5000, star: 1, desc: '1つ上の階とつなぐ。近い階の移動向き' },
  escalator:   { name: 'エスカレーター', cat: 'transport', w: 8, cost: 20000, star: 2, desc: '1つ上の階とつなぐ。商業施設向き' },
  elevator:    { name: 'エレベーター', cat: 'transport', w: 4, drag: 'v', cost: 200000, carCost: 80000, maxSpan: 30, maxCars: 8, cap: 21, star: 1, desc: '全階停止。最大30フロア' },
  express:     { name: '急行エレベーター', cat: 'transport', w: 6, drag: 'v', cost: 400000, carCost: 150000, maxSpan: 110, maxCars: 8, cap: 40, star: 3, desc: 'ロビー階と地下のみ停止' },
  office:      { name: 'オフィス', cat: 'office', w: 9, cost: 40000, cap: 6, rent: 5000, star: 1, only: 'aboveGround', desc: '6人が平日に通勤。平日毎日賃料' },
  condo:       { name: 'マンション', cat: 'living', w: 16, cost: 80000, cap: 3, sale: 100000, star: 1, only: 'aboveGround', desc: '3人家族が住む。入居時に販売収入' },
  hotelSingle: { name: 'シングルルーム', cat: 'hotel', w: 4, cost: 20000, cap: 1, price: 1000, star: 2, only: 'aboveGround', desc: '1人宿泊。清掃が必要' },
  hotelTwin:   { name: 'ツインルーム', cat: 'hotel', w: 6, cost: 50000, cap: 2, price: 2000, star: 2, only: 'aboveGround', desc: '2人宿泊。清掃が必要' },
  hotelSuite:  { name: 'スイートルーム', cat: 'hotel', w: 12, cost: 100000, cap: 2, price: 5000, star: 3, only: 'aboveGround', desc: '高級客室。VIPが泊まる' },
  fastfood:    { name: 'ファストフード', cat: 'commerce', w: 16, cost: 100000, price: 50, open: [10, 21], star: 1, desc: '10〜21時営業' },
  restaurant:  { name: 'レストラン', cat: 'commerce', w: 24, cost: 200000, price: 200, open: [17, 24], star: 2, desc: '17〜24時営業' },
  shop:        { name: 'ショップ', cat: 'commerce', w: 12, cost: 100000, price: 100, open: [10, 21], star: 2, desc: '10〜21時営業' },
  cinema:      { name: '映画館', cat: 'commerce', w: 31, h: 2, cost: 500000, price: 150, open: [10, 24], star: 3, desc: '2フロア分。週替わり上映' },
  partyHall:   { name: 'パーティーホール', cat: 'commerce', w: 27, h: 2, cost: 100000, price: 2000, open: [12, 22], star: 3, desc: '2フロア分。団体客が来る' },
  security:    { name: '警備室', cat: 'service', w: 16, cost: 100000, cap: 6, star: 2, desc: '爆弾捜索・消火を行う。★3の条件' },
  housekeeping:{ name: 'ハウスキーピング', cat: 'service', w: 15, cost: 50000, cap: 6, star: 2, desc: 'ホテルの客室を清掃する' },
  medical:     { name: '医療センター', cat: 'service', w: 26, cost: 500000, star: 3, desc: '★4の条件' },
  recycling:   { name: 'リサイクルセンター', cat: 'service', w: 25, h: 2, cost: 500000, star: 3, only: 'basement', desc: '地下2フロア分。★4の条件' },
  metro:       { name: '地下鉄駅', cat: 'special', w: 30, h: 3, cost: 1000000, star: 4, only: 'basement', desc: '地下3フロア分。第2の出入口。★5の条件' },
  cathedral:   { name: '大聖堂', cat: 'special', w: 30, cost: 3000000, star: 5, only: 'top', desc: '100Fのみ。結婚式が挙がればタワー達成' },
};

export const TOOL_CATS = [
  { id: 'basic', name: '基本' },
  { id: 'transport', name: '移動' },
  { id: 'office', name: 'オフィス' },
  { id: 'living', name: '住居' },
  { id: 'hotel', name: 'ホテル' },
  { id: 'commerce', name: '商業' },
  { id: 'service', name: 'サービス' },
  { id: 'special', name: '特別' },
];
