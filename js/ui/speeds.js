// UI の速度の選択肢。sim の SPEEDS（0,1,2,4,8 倍）に「リアルタイム」（ゲーム内1分＝実時間1分）を加える。
import { SPEEDS, GAME_MIN_PER_SEC } from '../sim/constants.js';

// 等速は 1実秒 = GAME_MIN_PER_SEC ゲーム分。リアルタイムは 1実秒 = 1/60 ゲーム分 → 倍率 1/(60*GAME_MIN_PER_SEC) = 1/360
const RT = 1 / (60 * GAME_MIN_PER_SEC);

export const UI_SPEEDS = [
  { v: 0, label: '❚❚', title: '一時停止 (Space / 0)' },
  { v: RT, label: '実時間', title: 'リアルタイム: ゲーム内の1分＝実際の1分 (5)', rt: true },
  ...SPEEDS.filter((v) => v > 0).map((v, i) => ({ v, label: `${v}×`, title: `${v === 1 ? '等速' : `${v}倍速`} (${i + 1})` })),
];
export const SPEED_ONE = UI_SPEEDS.findIndex((s) => s.v === 1);
export const SPEED_RT = 1;
