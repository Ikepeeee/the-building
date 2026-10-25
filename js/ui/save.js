// セーブ／ロード。localStorage が使えない環境（プライベートモード等）でも落ちないようにする。
import { SAVE_KEY } from '../sim/constants.js';

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
    meta: {
      star: sim.star, tower: !!sim.tower, pop: sim.pop, day: sim.day, money: sim.money, ...(ui ? { ui } : {}),
      ...(sim.scenario ? { scenario: sim.scenario.id, scnState: sim.scenario.state, grade: sim.scenario.grade } : {}),
    },
    data: sim.serialize(),
  };
}

// ---- セーブの置き場所（モードごとに別）: フリープレイは SAVE_KEY、シナリオは SAVE_KEY + '.scn.' + id ----
export const slotKey = (scenarioId) => (scenarioId ? `${SAVE_KEY}.scn.${scenarioId}` : SAVE_KEY);
const bakKey = (key) => key + '.bak';

/** @returns {{ok:boolean, persisted:boolean, error?:string}} */
export function saveGame(sim, ui, key = slotKey(sim && sim.scenario && sim.scenario.id)) {
  let json;
  try {
    json = JSON.stringify(makeSaveObject(sim, ui));
  } catch (e) {
    return { ok: false, persisted: false, error: 'セーブデータを作れませんでした: ' + (e && e.message) };
  }
  try {
    const prev = storage.get(key);
    if (prev && validate(safeParse(prev))) storage.set(bakKey(key), prev);
  } catch { /* バックアップ失敗は無視 */ }
  const persisted = storage.set(key, json);
  return { ok: true, persisted };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function validate(o) {
  return !!(o && typeof o === 'object' && o.data && typeof o.data === 'object');
}

/** 読み込み候補（本体→バックアップの順）。壊れているものは飛ばす。 [{obj, backup}] */
export function loadCandidates(key = SAVE_KEY) {
  const out = [];
  for (const k of [key, bakKey(key)]) {
    const o = safeParse(storage.get(k));
    if (validate(o)) out.push({ obj: o, backup: k !== key });
  }
  return out;
}

export function peekSave(key = SAVE_KEY) {
  const c = loadCandidates(key);
  return c.length ? c[0].obj : null;
}

export function clearSave(key = SAVE_KEY) {
  storage.remove(key);
}

// ---- シナリオの最高成績 ----
const REC_KEY = SAVE_KEY + '.records';
export function loadRecords() {
  const o = safeParse(storage.get(REC_KEY));
  return o && typeof o === 'object' ? o : {};
}
/** 成績を記録する（前より良ければ）。更新したら true */
export function saveRecord(id, grade, day) {
  const r = loadRecords();
  const prev = r[id];
  if (prev && prev.grade >= grade) return false;
  r[id] = { grade, day, at: Date.now() };
  storage.set(REC_KEY, JSON.stringify(r));
  return true;
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
