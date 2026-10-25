// シナリオの話し手のアイコン（16x16 ドットをキャンバスで描いて data URL にする）
const cache = new Map();
const P = 16;

const DRAW = {
  // 町長: 白髪まじり、眼鏡、ネクタイ
  町長(g, r) {
    r('#7fb3e6', 0, 0, 16, 16);
    r('#c9c9c9', 4, 2, 8, 3); r('#9a9a9a', 3, 4, 2, 4); r('#9a9a9a', 11, 4, 2, 4);
    r('#f2c79a', 5, 4, 6, 7);
    r('#222', 5, 6, 2, 1); r('#222', 9, 6, 2, 1); r('#222', 7, 6, 2, 1); // 眼鏡
    r('#a0522d', 7, 9, 2, 1); // 口
    r('#2a3a6b', 2, 12, 12, 4); r('#fff', 6, 12, 4, 2); r('#c0202a', 7, 12, 2, 4);
    r('#ffd34d', 3, 13, 2, 1); // 町長のバッジ
  },
  // 民宿のおかみさん: まとめ髪、割烹着
  民宿のおかみさん(g, r) {
    r('#f7c56a', 0, 0, 16, 16);
    r('#2a1a10', 6, 0, 4, 2); r('#2a1a10', 4, 2, 8, 3); r('#2a1a10', 3, 4, 2, 3); r('#2a1a10', 11, 4, 2, 3);
    r('#f2c79a', 5, 4, 6, 7);
    r('#222', 6, 6, 1, 1); r('#222', 9, 6, 1, 1);
    r('#e88', 5, 8, 1, 1); r('#e88', 10, 8, 1, 1); // ほお
    r('#a0522d', 7, 9, 2, 1);
    r('#3b7be0', 2, 12, 12, 4); r('#fff', 5, 12, 6, 4); r('#e8e8e8', 7, 13, 2, 3);
  },
  _default(g, r) {
    r('#9ab', 0, 0, 16, 16);
    r('#556', 5, 2, 6, 7); r('#556', 3, 10, 10, 6);
  },
};

export function portraitURL(speaker) {
  const key = DRAW[speaker] ? speaker : '_default';
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = P;
    const g = c.getContext('2d');
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    DRAW[key](g, r);
    g.fillStyle = '#000'; g.fillRect(0, 0, P, 1); g.fillRect(0, P - 1, P, 1); g.fillRect(0, 0, 1, P); g.fillRect(P - 1, 0, 1, P);
    url = c.toDataURL();
    c.width = c.height = 0;
  } catch { /* */ }
  cache.set(key, url);
  return url;
}
