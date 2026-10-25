// エントリーポイント。sim（./sim/tower.js）と renderer（./render/renderer.js）を読み込んで UI を起動する。
// 開発用: URL に ?mock を付けると dev/ のモックを使う（本番では使わない）。
//   ?mock … 両方モック / ?mock=sim … sim だけモック / ?mock=render … renderer だけモック
const mock = new URLSearchParams(location.search).get('mock');
const mockSim = mock !== null && mock !== 'render';
const mockRender = mock !== null && mock !== 'sim';
const simPath = mockSim ? '../dev/ui-mock-sim.js' : './sim/tower.js';
const renderPath = mockRender ? '../dev/ui-mock-renderer.js' : './render/renderer.js';
const scnPath = mockSim ? '../dev/ui-mock-scenarios.js' : './sim/scenarios.js';
// シナリオの一覧は無くても遊べる（フリープレイだけになる）
const loadScenarios = () => import(scnPath).catch((e) => { console.warn('scenarios.js を読み込めませんでした', e); return { SCENARIOS: [] }; });

// app.js も動的に読み込む（静的 import だと読み込み失敗時に真っ白になるため）
Promise.all([import('./ui/app.js'), import(simPath), import(renderPath), loadScenarios()])
  .then(([appMod, simMod, renderMod, scnMod]) => {
    const app = new appMod.App({ Tower: simMod.Tower, Renderer: renderMod.Renderer, SCENARIOS: scnMod.SCENARIOS || [] });
    window.__app = app; // デバッグ用
    app.start();
    window.__gameStarted = true;
  })
  .catch((err) => {
    console.error(err);
    if (window.__showFatal) window.__showFatal(err && (err.stack || err.message) || err);
  });
