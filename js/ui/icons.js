// ツールバー用のミニアイコン（24x15 ドットをキャンバスで描いて data URL にする）
const IW = 24, IH = 15;
const cache = new Map();

const K = '#161616';

function frame(g, bg) {
  g.fillStyle = K; g.fillRect(0, 0, IW, IH);
  g.fillStyle = bg; g.fillRect(1, 1, IW - 2, IH - 2);
}
const r = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const floorLine = (g, c = '#6b6b6b') => r(g, c, 1, IH - 2, IW - 2, 1);

function person(g, x, y, c = '#222') {
  r(g, c, x, y, 1, 1); r(g, c, x - 1, y + 1, 3, 2); r(g, c, x - 1, y + 3, 1, 1); r(g, c, x + 1, y + 3, 1, 1);
}

const DRAW = {
  inspect(g) {
    frame(g, '#dfe9ff');
    r(g, K, 7, 2, 6, 1); r(g, K, 6, 3, 1, 6); r(g, K, 13, 3, 1, 6); r(g, K, 7, 9, 6, 1);
    r(g, '#aee3ff', 7, 3, 6, 6); r(g, '#fff', 8, 4, 2, 2);
    r(g, '#7a4a20', 13, 9, 2, 2); r(g, '#7a4a20', 15, 11, 2, 2); r(g, '#7a4a20', 17, 12, 2, 1);
  },
  bulldoze(g) {
    frame(g, '#ffe7b0');
    r(g, '#e8a317', 6, 5, 11, 5); r(g, K, 6, 5, 11, 1);
    r(g, '#e8a317', 11, 2, 5, 3); r(g, '#aee3ff', 12, 3, 3, 2); r(g, K, 11, 2, 5, 1);
    r(g, '#555', 2, 5, 2, 7); r(g, '#555', 4, 9, 2, 1);
    r(g, K, 6, 10, 12, 3); r(g, '#777', 7, 11, 1, 1); r(g, '#777', 10, 11, 1, 1); r(g, '#777', 13, 11, 1, 1); r(g, '#777', 16, 11, 1, 1);
  },
  eval(g) {
    frame(g, '#e8e8e8');
    for (let i = 0; i < 4; i++) { r(g, '#3b7be0', 2 + i * 2, 2, 1, 4); }
    r(g, '#2b6cd6', 2, 2, 9, 5); r(g, '#e8c020', 13, 2, 9, 5); r(g, '#d9302a', 2, 8, 9, 5); r(g, '#9a9a9a', 13, 8, 9, 5);
    for (let x = 2; x < 22; x += 3) { r(g, 'rgba(255,255,255,.45)', x, 2, 1, 11); }
    r(g, K, 12, 1, 1, 13); r(g, K, 1, 7, 22, 1);
  },
  copy(g) {
    frame(g, '#e4f0ff');
    r(g, K, 3, 2, 10, 8); r(g, '#fff', 4, 3, 8, 6); r(g, '#9a9a9a', 5, 5, 6, 1); r(g, '#9a9a9a', 5, 7, 6, 1);
    r(g, K, 10, 5, 11, 9); r(g, '#9cd0ff', 11, 6, 9, 7); r(g, '#2b6cd6', 13, 8, 5, 1); r(g, '#2b6cd6', 13, 10, 5, 1);
  },
  floor(g) {
    frame(g, '#c9c9c9');
    r(g, '#e8e8e8', 1, 1, IW - 2, 3); r(g, '#8a8a8a', 1, IH - 4, IW - 2, 3);
    for (let x = 4; x < IW - 2; x += 6) r(g, '#9a9a9a', x, 4, 1, IH - 8);
  },
  bridge(g) {
    frame(g, '#8fc4f0');
    r(g, '#6a6a72', 1, 4, 4, 9); r(g, '#6a6a72', IW - 5, 4, 4, 9); // 両側の建物
    r(g, '#ffd34d', 2, 6, 1, 1); r(g, '#ffd34d', IW - 4, 8, 1, 1);
    r(g, '#cfe8ff', 5, 6, 14, 3); r(g, K, 5, 5, 14, 1); r(g, K, 5, 9, 14, 1); // ガラスの通路
    for (let x = 5; x < 19; x += 3) { r(g, '#555', x, 6, 1, 3); r(g, '#777', x, 10, 2, 1); r(g, '#777', x + 1, 11, 1, 1); } // トラス
  },
  lobby(g) {
    frame(g, '#efe2c0');
    r(g, '#c9b27a', 1, IH - 3, IW - 2, 2);
    for (const x of [3, 9, 15, 20]) { r(g, '#fff6dc', x, 2, 2, IH - 5); r(g, '#b59a5e', x + 1, 2, 1, IH - 5); }
    r(g, '#6a4a2a', 11, 6, 3, 6); r(g, '#ffd34d', 2, 1, IW - 4, 1);
    person(g, 6, 8, '#333');
  },
  stairs(g) {
    frame(g, '#d8d2c2');
    for (let i = 0; i < 6; i++) r(g, '#7a6a52', 3 + i * 3, IH - 3 - i * 2, 4, 2);
    r(g, K, 3, IH - 4, 1, 1);
  },
  escalator(g) {
    frame(g, '#d8e4ef');
    for (let i = 0; i < 9; i++) r(g, '#888', 3 + i * 2, IH - 3 - i, 3, 2);
    for (let i = 0; i < 9; i++) r(g, '#2b6cd6', 3 + i * 2, IH - 6 - i, 2, 1);
  },
  elevator(g) {
    frame(g, '#5a5a5a');
    r(g, '#3a3a3a', 7, 1, 10, IH - 2);
    r(g, '#d8d2c2', 8, 4, 8, 8); r(g, K, 8, 4, 8, 1); r(g, '#8a8372', 12, 5, 1, 7);
    r(g, '#ffd34d', 11, 2, 2, 1);
  },
  express(g) {
    frame(g, '#4a3a3a');
    r(g, '#2a2020', 5, 1, 14, IH - 2);
    r(g, '#d24a3a', 6, 3, 12, 9); r(g, K, 6, 3, 12, 1); r(g, '#8a2418', 12, 4, 1, 8);
    r(g, '#ffd34d', 9, 1, 6, 1);
  },
  office(g) {
    frame(g, '#c9d8ec');
    r(g, '#7c97c0', 2, 2, 20, 4); for (let x = 6; x < 22; x += 5) r(g, K, x, 2, 1, 4);
    r(g, '#8a5a2a', 3, 9, 6, 2); r(g, '#8a5a2a', 13, 9, 6, 2);
    r(g, '#333', 4, 7, 2, 2); r(g, '#333', 14, 7, 2, 2);
    r(g, '#6b6b6b', 1, IH - 2, IW - 2, 1);
  },
  condo(g) {
    frame(g, '#f3dcb4');
    r(g, '#7cc0f0', 3, 3, 5, 4); r(g, K, 5, 3, 1, 4);
    r(g, '#d9534f', 12, 8, 9, 3); r(g, '#fff', 12, 7, 3, 1); r(g, '#7a4a20', 12, 11, 1, 2); r(g, '#7a4a20', 20, 11, 1, 2);
    r(g, '#5a8a3a', 9, 9, 2, 3);
    floorLine(g, '#a07850');
  },
  hotelSingle(g) {
    frame(g, '#e6dcf3');
    r(g, '#fff', 6, 7, 12, 3); r(g, '#7a5ac0', 9, 7, 9, 3); r(g, '#5a3a20', 6, 10, 1, 3); r(g, '#5a3a20', 17, 10, 1, 3);
    r(g, '#5a3a20', 5, 5, 1, 8);
    floorLine(g, '#8c7aa8');
  },
  hotelTwin(g) {
    frame(g, '#e6dcf3');
    for (const x of [2, 13]) { r(g, '#fff', x, 7, 9, 3); r(g, '#4a7ad0', x + 3, 7, 6, 3); r(g, '#5a3a20', x, 10, 1, 3); r(g, '#5a3a20', x + 8, 10, 1, 3); }
    floorLine(g, '#8c7aa8');
  },
  hotelSuite(g) {
    frame(g, '#f6e7c4');
    r(g, '#ffd34d', 1, 1, IW - 2, 1);
    r(g, '#fff', 4, 6, 16, 4); r(g, '#b02a4a', 9, 6, 11, 4); r(g, '#5a3a20', 3, 3, 2, 10); r(g, '#5a3a20', 4, 10, 16, 1);
    r(g, '#ffd34d', 11, 3, 3, 1); r(g, '#ffd34d', 12, 2, 1, 1);
    floorLine(g, '#b08a40');
  },
  fastfood(g) {
    frame(g, '#ffe1a8');
    r(g, '#d9302a', 1, 1, IW - 2, 3); r(g, '#ffd34d', 4, 2, 4, 1); r(g, '#ffd34d', 14, 2, 4, 1);
    r(g, '#d9302a', 3, 8, 6, 2); r(g, '#ffd34d', 3, 7, 6, 1); r(g, '#8a5a2a', 3, 10, 6, 1);
    r(g, '#888', 13, 8, 8, 1); r(g, '#888', 16, 9, 1, 4);
    person(g, 20, 6, '#333');
  },
  restaurant(g) {
    frame(g, '#3a2a3a');
    r(g, '#ffd34d', 4, 2, 1, 1); r(g, '#ffd34d', 12, 2, 1, 1); r(g, '#ffd34d', 19, 2, 1, 1);
    for (const x of [2, 13]) { r(g, '#c0202a', x, 8, 9, 2); r(g, '#fff', x, 8, 9, 1); r(g, '#8a5a2a', x + 4, 10, 1, 3); r(g, '#ffd34d', x + 4, 6, 1, 2); }
  },
  shop(g) {
    frame(g, '#fff0f4');
    r(g, '#2a9a6a', 1, 1, IW - 2, 2); for (let x = 2; x < IW - 2; x += 4) r(g, '#fff', x, 1, 2, 2);
    r(g, '#8a5a2a', 2, 5, 8, 1); r(g, '#8a5a2a', 2, 9, 8, 1);
    for (let x = 2; x < 10; x += 2) { r(g, ['#e84a5f', '#4a8ae8', '#ffd34d', '#5ac05a'][(x / 2) % 4], x, 3, 1, 2); r(g, ['#5ac05a', '#e84a5f', '#4a8ae8', '#ffd34d'][(x / 2) % 4], x, 7, 1, 2); }
    r(g, '#b0b0b0', 14, 8, 7, 5); r(g, '#666', 14, 8, 7, 1);
    person(g, 12, 7, '#333');
  },
  cinema(g) {
    frame(g, '#1a1a2a');
    r(g, '#e8e8ff', 4, 2, 16, 6); r(g, '#8ab0ff', 6, 4, 5, 3); r(g, '#ffb06a', 13, 3, 4, 4);
    r(g, '#a0202a', 2, 9, 20, 2); r(g, '#a0202a', 2, 12, 20, 1);
    r(g, '#ffd34d', 1, 1, 1, IH - 2); r(g, '#ffd34d', IW - 2, 1, 1, IH - 2);
  },
  partyHall(g) {
    frame(g, '#ffe0f0');
    r(g, '#ffd34d', 10, 1, 4, 1); r(g, '#ffd34d', 9, 2, 6, 2); r(g, '#fff', 10, 4, 1, 1); r(g, '#fff', 13, 4, 1, 1);
    r(g, '#e84a8f', 2, 3, 2, 3); r(g, '#4a8ae8', 19, 3, 2, 3); r(g, '#888', 3, 6, 1, 3); r(g, '#888', 20, 6, 1, 3);
    r(g, '#fff', 5, 9, 14, 2); person(g, 8, 8, '#333'); person(g, 16, 8, '#5a2a5a');
  },
  security(g) {
    frame(g, '#c8d4e4');
    r(g, '#1c2a6b', 8, 2, 8, 2); r(g, '#1c2a6b', 7, 4, 10, 1);
    r(g, '#f2c79a', 9, 5, 6, 3); r(g, K, 10, 6, 1, 1); r(g, K, 13, 6, 1, 1);
    r(g, '#1c2a6b', 8, 8, 8, 5); r(g, '#ffd34d', 11, 9, 2, 2);
  },
  housekeeping(g) {
    frame(g, '#dff2ef');
    r(g, '#4a8ae8', 4, 7, 7, 6); r(g, K, 4, 7, 7, 1); r(g, '#aee3ff', 5, 8, 5, 1);
    r(g, '#8a5a2a', 15, 1, 1, 9); r(g, '#ffd34d', 13, 10, 5, 3);
    r(g, '#fff', 19, 3, 1, 1); r(g, '#fff', 20, 5, 1, 1);
  },
  parking(g) {
    frame(g, '#4a4a52');
    r(g, '#6a6a72', 1, IH - 3, IW - 2, 2);
    r(g, '#2b6cd6', 2, 2, 7, 8); r(g, '#fff', 4, 3, 1, 6); r(g, '#fff', 5, 3, 2, 1); r(g, '#fff', 7, 4, 1, 2); r(g, '#fff', 5, 6, 2, 1);
    r(g, '#d9302a', 11, 7, 10, 3); r(g, '#d9302a', 13, 5, 6, 2); r(g, '#aee3ff', 14, 6, 4, 1);
    r(g, K, 12, 10, 2, 2); r(g, K, 18, 10, 2, 2); r(g, '#ffd34d', 20, 8, 1, 1);
    for (let x = 10; x < 22; x += 6) r(g, '#e8e8e8', x, 12, 1, 1);
  },
  garbage(g) {
    frame(g, '#dfe6d8');
    r(g, '#4a7a3a', 3, 4, 7, 9); r(g, K, 3, 4, 7, 1); r(g, '#2f5a24', 2, 3, 9, 1); r(g, '#6a9a5a', 5, 6, 1, 6); r(g, '#6a9a5a', 7, 6, 1, 6);
    r(g, '#222', 12, 8, 5, 5); r(g, '#3a3a3a', 13, 7, 3, 1); r(g, '#ffd34d', 14, 6, 1, 1);
    r(g, '#e8e8e8', 17, 9, 5, 4); r(g, '#b0b0b0', 18, 8, 3, 1);
    floorLine(g, '#7a7466');
  },
  medical(g) {
    frame(g, '#f4f8fa');
    r(g, '#e0302a', 10, 2, 4, 11); r(g, '#e0302a', 6, 6, 12, 3);
  },

  metro(g) {
    frame(g, '#5a4a3a');
    r(g, '#8a8a8a', 1, IH - 3, IW - 2, 1);
    r(g, '#e8e8e8', 2, 4, 20, 7); r(g, '#2a7ad8', 2, 8, 20, 1);
    for (let x = 4; x < 20; x += 4) r(g, '#7cc0f0', x, 5, 2, 2);
    r(g, K, 5, 11, 2, 1); r(g, K, 16, 11, 2, 1);
  },
  cathedral(g) {
    frame(g, '#e8e0ff');
    r(g, '#fff', 6, 4, 12, 9); r(g, K, 6, 4, 12, 1);
    r(g, '#fff', 10, 1, 4, 3); r(g, '#ffd34d', 11, 1, 2, 1);
    r(g, '#e84a8f', 8, 6, 2, 3); r(g, '#4a8ae8', 14, 6, 2, 3); r(g, '#ffd34d', 11, 6, 2, 3);
    r(g, '#6a4a2a', 11, 10, 2, 3);
  },
};

export function iconURL(key) {
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = IW; c.height = IH;
    const g = c.getContext('2d');
    (DRAW[key] || DRAW.floor)(g);
    url = c.toDataURL();
    c.width = c.height = 0; // 使い終わったキャンバスはすぐ解放
  } catch { /* ignore */ }
  cache.set(key, url);
  return url;
}
