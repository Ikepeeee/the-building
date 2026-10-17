// sim 内部で共有するルール定数（constants.js にない、sim 固有の数値）
import { MIN_F, MAX_F, LOBBY_FLOORS } from './constants.js';

export const SAVE_VERSION = 2;
export const NF = MAX_F - MIN_F + 1;      // フロア数
export const FI = (f) => f - MIN_F;       // フロア → 配列添字
export const LOBBY_SET = new Set(LOBBY_FLOORS);

export const TRANSPORT = new Set(['stairs', 'escalator', 'elevator', 'express']);
export const ELEV = new Set(['elevator', 'express']);
export const HOTEL = new Set(['hotelSingle', 'hotelTwin', 'hotelSuite']);
export const COMMERCE = new Set(['fastfood', 'restaurant', 'shop', 'cinema', 'partyHall']);
export const NOISY = new Set(['fastfood', 'restaurant', 'cinema', 'partyHall']);
export const TENANT = new Set(['office', 'condo']);
export const TRANSIENT = new Set(['visitor', 'vip', 'bride', 'groom', 'weddingGuest']);
export const STAFF_KIND = { security: 'guard', housekeeping: 'maid' };

// 燃える施設（移動手段とロビー以外）
export const burnable = (t) => !TRANSPORT.has(t) && t !== 'lobby';

export const isStopFloor = (type, f) => type !== 'express' || f < 0 || LOBBY_SET.has(f);

export const SIM = {
  TICK: 0.25,
  WALK: 2.5,            // マス/分
  STAIR_TIME: 1.2,      // 階段1階分（分）
  ESC_TIME: 0.7,        // エスカレーター1階分（分）
  DOOR: 0.35,           // ドア開閉（分）
  BOARD: 0.02,          // 1人の乗降（分）
  SPEED: { elevator: 6, express: 15 },   // フロア/分
  WAIT_GRACE: 3,        // この時間を超える待ちでストレス増
  WAIT_STRESS: 1.5,     // /分
  STAIR_STRESS: 5,      // /階
  ESC_STRESS: 1,        // /階
  TRIP_LIMIT: 360,      // これを超えた移動は救済（リーク防止）
  EXTEND_COST: { elevator: 10000, express: 20000 },
  EXTERMINATE: 10000,
  HELI: 500000,
  BURN_TIME: 150,       // 施設が焼失するまで（分）
  BOMB_TIME: 180,
  CAR_MAINT: { elevator: 1000, express: 2000 },
  FLOOR_MAINT: 5,       // 構造のあるマス1つにつき/日
  LOBBY_MAINT: 20,      // ロビー1マスにつき/日（フロア分に上乗せ）
  BAD_COOLDOWN: 3 * 1440, // 悪評で退去した区画に次の入居者が付くまで（分）
  BUYBACK: 1.0,         // マンションの住人が退去したときの買い戻し（販売価格に対する割合）
  SQUAD: 3,             // 警備室1室から出動する警備員
  GUARD_RANGE: 15,      // 警備室がカバーする上下のフロア数
  SEARCH_BASE: 10,      // 1フロアの捜索時間 = BASE + 構造マス数 / PER（分）
  SEARCH_PER: 7,
  FIGHT_TIME: 30,       // 警備員1人が1施設を消火するのにかかる時間（分）
  MAINT: { escalator: 300, security: 1500, housekeeping: 800, medical: 3000, recycling: 3000, metro: 8000, cathedral: 5000 },
  STAFF: { security: 6, housekeeping: 6 },
  // 経路コスト（ダイクストラ）
  COST: { elevBase: 5, elevPer: 0.12, expBase: 5, expPer: 0.04, stairs: 2.2, esc: 1.6 },
};

// 商業施設: 滞在時間 [最小, 幅]、来客率、1時間あたりの上限
export const STAY = { fastfood: [20, 25], restaurant: [40, 40], shop: [20, 30], cinema: [110, 20], partyHall: [120, 30] };
export const VISIT_RATE = { fastfood: 1, restaurant: 0.8, shop: 0.8, cinema: 1.2, partyHall: 0.8 };
export const VISIT_CAP = { fastfood: 14, restaurant: 12, shop: 10, cinema: 25, partyHall: 14 };

export const KIND_NAME = {
  worker: '会社員', resident: '住人', guest: '宿泊客', visitor: '来客', guard: '警備員',
  maid: 'メイド', vip: 'VIP', bride: '新婦', groom: '新郎', weddingGuest: '招待客',
};
