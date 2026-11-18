// Smoke test: otevře dist/index.html přes file:// v headless Chromium, klikne na start,
// nastartuje motor (E), zvedne kolektiv (W) a ověří, že vrtulník vzlétl.
// Spuštění: node test/smoke.mjs  (vyžaduje: npm run build + playwright chromium)
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, '..', 'dist', 'index.html');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url);
await page.waitForTimeout(2500);
const hasGame = await page.evaluate(() => !!window.__rotorLogger);
console.log('game object:', hasGame);

// WebGL2 běží?
const webgl2 = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return !!c.getContext('webgl2');
});
console.log('webgl2:', webgl2);

await page.click('#startBtn');
await page.waitForTimeout(500);
await page.keyboard.press('KeyE'); // studený start
await page.waitForTimeout(21000); // sekvence startu ~19 s
const st1 = await page.evaluate(() => {
  const g = window.__rotorLogger;
  return { engine: g.heli.engine, omegaFrac: g.heli.telemetry.omegaFrac };
});
console.log('after start:', JSON.stringify(st1));

// kolektiv nahoru ~2,5 s → vztlak → vzlet
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(6000);
const st2 = await page.evaluate(() => {
  const g = window.__rotorLogger;
  return {
    y: g.heli.pos.y, agl: g.heli.telemetry.agl, omegaFrac: g.heli.telemetry.omegaFrac,
    crashed: g.heli.crashed, collective: g.heli.collective, fps: g.fps,
  };
});
console.log('after collective:', JSON.stringify(st2));

// naviják vysunout
await page.keyboard.down('KeyR');
await page.waitForTimeout(2000);
await page.keyboard.up('KeyR');
const ropeLen = await page.evaluate(() => window.__rotorLogger.rope.length);
console.log('rope length after R:', ropeLen);

console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
const ok = hasGame && webgl2 && st1.engine === 'running' && st1.omegaFrac > 0.9 && st2.agl > 1 && !st2.crashed && ropeLen > 3.5 && errors.length === 0;
console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
