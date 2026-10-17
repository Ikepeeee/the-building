// UI 開発用の最小モック Renderer。本番では使わない。
import { TILE_W, FLOOR_H, W, MIN_F, MAX_F, floorName } from '../js/sim/constants.js';

export class Renderer {
  constructor(canvas, sim) { this.c = canvas; this.g = canvas.getContext('2d'); this.sim = sim; this.w = 1; this.h = 1; }
  setSim(s) { this.sim = s; }
  resize(w, h) {
    const d = window.devicePixelRatio || 1;
    this.d = d; this.w = w; this.h = h;
    this.c.width = Math.round(w * d); this.c.height = Math.round(h * d);
  }
  render(view) {
    const { g, sim } = this;
    const { cam } = view;
    const z = cam.zoom;
    g.setTransform(this.d, 0, 0, this.d, 0, 0);
    g.imageSmoothingEnabled = false;
    const hr = sim.hour + sim.minute / 60;
    const day = hr > 6 && hr < 18;
    g.fillStyle = day ? '#7ec3f0' : '#141a3a';
    g.fillRect(0, 0, this.w, this.h);
    const sx = (wx) => (wx - cam.x) * z, sy = (wy) => (wy - cam.y) * z;
    g.fillStyle = '#6b4f33';
    g.fillRect(0, sy(0), this.w, this.h);
    g.fillStyle = '#4c8f3a';
    g.fillRect(0, sy(0), this.w, 3 * z);
    const f0 = Math.max(MIN_F, Math.floor(-(cam.y + this.h / z) / FLOOR_H));
    const f1 = Math.min(MAX_F, Math.ceil(-cam.y / FLOOR_H));
    const colors = { lobby: '#d8c9a3', office: '#9fb7d6', condo: '#e8c99a', fastfood: '#f0a050', elevator: '#888', express: '#a55', stairs: '#bbb' };
    for (let f = f0; f <= f1; f++) {
      const row = sim.grid[f];
      if (!row) continue;
      for (let x = 0; x < W; x++) {
        const v = row[x];
        if (!v) continue;
        g.fillStyle = v === -1 ? '#cfcfcf' : colors[sim.objs.get(v)?.type] || '#c9a';
        g.fillRect(sx(x * TILE_W), sy(-(f + 1) * FLOOR_H), TILE_W * z + 0.5, FLOOR_H * z + 0.5);
      }
      g.fillStyle = '#000';
      g.fillRect(0, sy(-f * FLOOR_H), this.w, 1);
    }
    for (const o of sim.objs.values()) {
      g.strokeStyle = o.id === view.selectedId ? '#ff0' : '#000';
      g.lineWidth = o.id === view.selectedId ? 3 : 1;
      const f = o.f, h = o.h;
      g.strokeRect(sx(o.x * TILE_W), sy(-(f + h) * FLOOR_H), o.w * TILE_W * z, h * FLOOR_H * z);
    }
    g.fillStyle = '#fff'; g.font = '11px sans-serif';
    for (let f = f0; f <= f1; f++) g.fillText(floorName(f), 4, sy(-f * FLOOR_H) - 4);
    const gh = view.ghost;
    if (gh) {
      const lo = gh.lo ?? gh.f, hi = gh.hi ?? gh.f + (gh.h || 1) - 1;
      g.fillStyle = gh.ok ? 'rgba(80,160,255,.45)' : 'rgba(255,60,60,.45)';
      const X = sx(gh.x * TILE_W), Y = sy(-(hi + 1) * FLOOR_H);
      g.fillRect(X, Y, gh.w * TILE_W * z, (hi - lo + 1) * FLOOR_H * z);
      if (gh.label) { g.fillStyle = '#000'; g.fillRect(X, Y - 16, g.measureText(gh.label).width + 8, 16); g.fillStyle = gh.ok ? '#fff' : '#f88'; g.fillText(gh.label, X + 4, Y - 4); }
    }
  }
}
