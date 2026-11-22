#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_TARGET = 'http://127.0.0.1:5173/';
const OUT_DIR = path.resolve(process.argv[2] || 'qa_bug_hunt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  async evalJs(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'JS exception');
    return res.result?.value;
  }
  async screenshot(filePath) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(filePath, Buffer.from(data, 'base64'));
  }
  async pressKey(code, key, durationMs = 90) {
    const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : code === 'Space' ? 32 : 16;
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
    await sleep(durationMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neoncove-bughunt-'));
  const port = 9346;
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-first-run',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch { /* wait */ }
      await sleep(200);
    }
    if (!wsUrl) throw new Error('Chrome CDP endpoint failed to start');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    const errors = [];
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.text || 'exception'));
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(p.args?.map((a) => a.value).join(' ')); });

    await cdp.send('Page.navigate', { url: URL_TARGET });
    for (let i = 0; i < 60; i++) {
      const ok = await cdp.evalJs('Boolean(window.__BEACH_DEMO__)');
      if (ok) break;
      await sleep(250);
    }
    await cdp.evalJs('window.__BEACH_DEMO__.unlockAudio()');
    await sleep(1600);

    const failures = [];
    const check = (cond, msg) => {
      if (!cond) { console.error(`  [FAIL] ${msg}`); failures.push(msg); }
      else console.log(`  [PASS] ${msg}`);
    };

    // 1. West Boardwalk Bench side close-up (3rd person)
    console.log('\n[HUNT 1] West Boardwalk Bench Orientation & Seated Alignment...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-42.0, 2.25, -24.75, 1.35, 0.24)');
    await sleep(850);
    const pBench = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pBench.includes('Boardwalk Bench'), `Boardwalk Bench prompt: "${pBench}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(750);
    await cdp.screenshot(path.join(OUT_DIR, '01_boardwalk_bench_side.png'));
    await cdp.pressKey('KeyE', 'e'); // Stand up
    await sleep(350);

    // 2. East Overlook Bench side close-up
    console.log('\n[HUNT 2] East Overlook Bench Orientation & Seated Alignment...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(47.2, 2.65, -28.9, -1.25, 0.22)');
    await sleep(850);
    const pOver = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pOver.includes('Overlook Bench'), `Overlook Bench prompt: "${pOver}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(750);
    await cdp.screenshot(path.join(OUT_DIR, '02_overlook_bench_side.png'));
    await cdp.pressKey('KeyE', 'e');
    await sleep(350);

    // 3. Picnic Table Sit + Backward Stand-Up Exit Verification
    console.log('\n[HUNT 3] Picnic Table Sit Alignment & Clean Backward Stand-Up...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-36.15, 2.75, -27.55, 2.15, 0.28)');
    await sleep(850);
    const pPic = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pPic.includes('Picnic Table'), `Picnic Table prompt: "${pPic}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(750);
    const picSitPos = await cdp.evalJs('window.__BEACH_DEMO__.getState().playerPos');
    await cdp.screenshot(path.join(OUT_DIR, '03_picnic_table_side.png'));
    await cdp.pressKey('KeyE', 'e');
    await sleep(650);
    const picStandPos = await cdp.evalJs('window.__BEACH_DEMO__.getState().playerPos');
    // Bench is at z = -27.91 facing North (yaw=PI), so backward exit MUST move +Z (away from table at -28.75!)
    check(picStandPos[2] > picSitPos[2] + 0.30, `Picnic stand-up stepped cleanly AWAY from table (z: ${picSitPos[2].toFixed(2)} -> ${picStandPos[2].toFixed(2)})`);

    // 4. Empty East Café Table Chair Alignment
    console.log('\n[HUNT 4] East Café Table Empty Chair Alignment...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(8.25, 2.75, -27.6, 2.35, 0.24)');
    await sleep(850);
    const pCafe = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pCafe.includes('Café Table'), `Café Table prompt: "${pCafe}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(750);
    await cdp.screenshot(path.join(OUT_DIR, '04_cafe_table_empty_chair.png'));
    await cdp.pressKey('KeyE', 'e');
    await sleep(350);

    // 5. Ocean Pier Bench Sit Alignment
    console.log('\n[HUNT 5] Ocean Pier Bench Sit Alignment...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(22.4, 2.30, 4.8, -0.55, 0.22)');
    await sleep(850);
    const pPier = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pPier.includes('Pier Bench'), `Pier Bench prompt: "${pPier}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(750);
    await cdp.screenshot(path.join(OUT_DIR, '05_pier_bench_side.png'));
    await cdp.pressKey('KeyE', 'e');
    await sleep(350);

    // 6. Tiki Bar Stools (Patrons seated ON TOP of stools, realistic banana bunch)
    console.log('\n[HUNT 6] Tiki Bar Stools & Counter Props...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-22.0, 2.8, -26.2, Math.PI, 0.06)');
    await sleep(650);
    await cdp.screenshot(path.join(OUT_DIR, '06_tiki_bar_stools_fixed.png'));

    // 7. Shallow Wading Trail Close-Up (verify ZERO electric-blue arc & ZERO milky foam blob!)
    console.log('\n[HUNT 7] Shallow Wading Water Contact & Trail Close-Up...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()'); // back to 3rd person
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-4.5, 0.1, 4.2, 0.45, 0.56)');
    await sleep(500);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(2200);
    await cdp.screenshot(path.join(OUT_DIR, '07_water_wade_trail_closeup.png'));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(250);

    // 8. Swimming Wake Trail Close-Up (verify silky lacy Kelvin V-wake, clear water visible through foam!)
    console.log('\n[HUNT 8] Deep Swimming Wake Trail Close-Up...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-2.5, -0.8, 10.5, 0.35, 0.48)');
    await sleep(500);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
    await sleep(2300);
    await cdp.screenshot(path.join(OUT_DIR, '08_water_swim_wake_closeup.png'));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(250);

    // 9. Actually RIDING the Interactive Swim Ring
    console.log('\n[HUNT 9] Riding Interactive Pink/White Swim Ring...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-14.5, -0.4, 7.6, 0.35, 0.38)');
    await sleep(800);
    const pRing = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pRing.includes('Swim Ring'), `Swim Ring ride prompt: "${pRing}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(800);
    const ringState = await cdp.evalJs('window.__BEACH_DEMO__.getState()');
    check(ringState.mode === 'RELAXING', `Player actively floating in Swim Ring (mode=${ringState.mode})`);
    await cdp.screenshot(path.join(OUT_DIR, '09_swim_ring_riding_closeup.png'));
    await cdp.pressKey('KeyE', 'e');
    await sleep(350);

    // 10. Actually LAUNCHING & DRIVING the Coastal Kayak
    console.log('\n[HUNT 10] Launching & Paddling Drivable Coastal Kayak...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(46.5, 1.2, -5.8, 0.0, 0.25)');
    await sleep(800);
    const pKayak = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(pKayak.includes('Kayak'), `Kayak launch prompt: "${pKayak}"`);
    await cdp.pressKey('KeyE', 'e');
    await sleep(400);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(1900);
    const kState = await cdp.evalJs('window.__BEACH_DEMO__.getState()');
    check(kState.mode === 'KAYAKING', `Player actively kayaking on open waves (mode=${kState.mode})`);
    await cdp.screenshot(path.join(OUT_DIR, '10_kayak_driving_buoyancy.png'));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await cdp.pressKey('KeyE', 'e');
    await sleep(350);

    // 11. Bonfire Ukulele & Camp2 Lounger Close-Up
    console.log('\n[HUNT 11] Bonfire Ukulele & Lounge Chair Sunbather...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-34.8, 2.0, -14.2, -2.55, 0.20)');
    await sleep(600);
    await cdp.screenshot(path.join(OUT_DIR, '11_bonfire_ukulele_and_lounger.png'));

    // 12. Moored Rowboat Sealed Floor & East Kayak Cove
    console.log('\n[HUNT 12] Moored Rowboat Floorboards & East Kayak Cove...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(17.5, 2.4, 8.8, -0.35, 0.34)');
    await sleep(600);
    await cdp.screenshot(path.join(OUT_DIR, '12_moored_rowboat_sealed.png'));

    check(errors.length === 0, `Zero console/page errors during bug hunt (errors=${errors.length})`);

    ws.close();
    if (failures.length > 0) {
      console.error(`\n[BUG-HUNT] FAILED ${failures.length} CHECKS!`);
      process.exitCode = 1;
    } else {
      console.log(`\n[BUG-HUNT] ALL 12 FORENSIC BUG-HUNT CHECKS PASSED! Captures -> ${OUT_DIR}`);
    }
  } finally {
    chrome.kill('SIGKILL');
    await sleep(250);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
