// セーブ／ロード。localStorage が使えない環境（プライベートモード等）でも落ちないようにする。
import { SAVE_KEY } from '../sim/constants.js';

const BAK_KEY = SAVE_KEY + '.bak';
const memory = new Map(); // localStorage が使えないときの代替（そのページの間だけ有効）

let lsOk = null;
function ls() {
  if (lsOk === false) return null;
  try {
    const s = window.localStorage;
    if (lsOk === null) {
      const k = SAVE_KEY + '.probe';
      s.setItem(k, '1'); s.removeItem(k);
      lsOk = true;
    }
    return s;
  } catch {
    lsOk = false;
    return null;
  }
}

export const storage = {
  get available() { return !!ls(); },
  get(k) {
    // 書き込みに失敗してメモリに逃がした値があれば、そちらが新しい
    if (memory.has(k)) return memory.get(k);
    const s = ls();
    try { if (s) return s.getItem(k); } catch { /* fallthrough */ }
    return null;
  },
  set(k, v) {
    const s = ls();
    try { if (s) { s.setItem(k, v); memory.delete(k); return true; } } catch { /* 容量不足など */ }
    memory.set(k, v);
    return false;
  },
  remove(k) {
    const s = ls();
    try { if (s) s.removeItem(k); } catch { /* ignore */ }
    memory.delete(k);
  },
};

export function makeSaveObject(sim, ui) {
  return {
    app: 'thebuilding',
    v: 1,
    savedAt: Date.now(),
    meta: { star: sim.star, tower: !!sim.tower, pop: sim.pop, day: sim.day, money: sim.money, ...(ui ? { ui } : {}) },
    data: sim.serialize(),
  };
}

/** @returns {{ok:boolean, persisted:boolean, error?:string}} */
export function saveGame(sim, ui) {
  let json;
  try {
    json = JSON.stringify(makeSaveObject(sim, ui));
  } catch (e) {
    return { ok: false, persisted: false, error: 'セーブデータを作れませんでした: ' + (e && e.message) };
  }
  try {
    const prev = storage.get(SAVE_KEY);
    if (prev && validate(safeParse(prev))) storage.set(BAK_KEY, prev);
  } catch { /* バックアップ失敗は無視 */ }
  const persisted = storage.set(SAVE_KEY, json);
  return { ok: true, persisted };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function validate(o) {
  return !!(o && typeof o === 'object' && o.data && typeof o.data === 'object');
}

/** 読み込み候補（本体→バックアップの順）。壊れているものは飛ばす。 [{obj, backup}] */
export function loadCandidates() {
  const out = [];
  for (const k of [SAVE_KEY, BAK_KEY]) {
    const o = safeParse(storage.get(k));
    if (validate(o)) out.push({ obj: o, backup: k === BAK_KEY });
  }
  return out;
}

export function peekSave() {
  const c = loadCandidates();
  return c.length ? c[0].obj : null;
}

export function clearSave() {
  storage.remove(SAVE_KEY);
}

export function exportText(sim, ui) {
  return JSON.stringify(makeSaveObject(sim, ui));
}

/** 貼り付け・ファイルの文字列からセーブを取り出す。sim.serialize() の生データも受け付ける。 */
export function parseImport(text) {
  const o = safeParse(String(text || '').trim());
  if (!o || typeof o !== 'object') throw new Error('JSON として読めませんでした');
  if (validate(o)) return o;
  if (typeof o.time === 'number') return { app: 'thebuilding', v: 1, savedAt: Date.now(), meta: {}, data: o };
  throw new Error('The Building のセーブデータではありません');
}

export function downloadText(filename, text) {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
