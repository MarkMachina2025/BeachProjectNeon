#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_TARGET = 'http://127.0.0.1:5173/';
const OUT_DIR = path.resolve(process.argv[2] || 'qa_deep_verify');
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
  async pressKey(code, key, durationMs = 80) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 16 });
    await sleep(durationMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 16 });
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neoncove-deepqa-'));
  const port = 9344;
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

    // TEST 1: Weather presets & Wave Slider sync + Rain removed
    console.log('\n[DEEP-QA 1] Weather Presets & Wave Slider Sync...');
    const hasRain = await cdp.evalJs('Boolean(document.querySelector("[data-weather=\'rain\']"))');
    check(!hasRain, 'Broken Rain weather preset removed from HUD');
    for (const [mode, expVal, expLbl] of [['breeze', '145', '1.45×'], ['mist', '75', '0.75×'], ['clear', '100', '1.00×']]) {
      await cdp.evalJs(`document.querySelector("[data-weather='${mode}']")?.click()`);
      await sleep(150);
      const ui = await cdp.evalJs(`({ val: document.getElementById('wave-slider')?.value, lbl: document.getElementById('wave-label')?.textContent })`);
      check(ui.val === expVal && ui.lbl === expLbl, `Weather "${mode}" syncs wave slider -> ${ui.val} / ${ui.lbl}`);
    }

    // TEST 2: NPC Face & Body Close-Ups
    console.log('\n[DEEP-QA 2] Capturing NPC Close-Up Portraits (Face, Rashguard, Hands, Shorts)...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-15.5, 2.5, -23.0, 2.55, 0.08)');
    await sleep(600);
    await cdp.screenshot(path.join(OUT_DIR, '01_npc_face_closeup_tiki.png'));

    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-8.5, 2.3, -26.5, 2.85, 0.14)');
    await sleep(500);
    await cdp.screenshot(path.join(OUT_DIR, '02_npc_face_closeup_patio.png'));

    // TEST 3: Beach Shower Exact Alignment
    console.log('\n[DEEP-QA 3] Verifying Beach Shower Exact Alignment...');
    const tel0 = await cdp.evalJs('window.__BEACH_DEMO__.getNpcTelemetry()');
    if (tel0.showerOccupantPos) {
      const [sx, , sz] = tel0.showerOccupantPos;
      const err = Math.hypot(sx - -18.2, sz - -22.54);
      check(err < 0.40, `Shower NPC stands directly under showerhead (err=${err.toFixed(2)}m at [${sx.toFixed(2)}, ${sz.toFixed(2)}])`);
    } else {
      console.log('  [INFO] Shower finished rinse & transitioned autonomously');
    }
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-15.6, 2.3, -21.8, -1.75, 0.10)');
    await sleep(500);
    await cdp.screenshot(path.join(OUT_DIR, '03_beach_shower_alignment.png'));

    // TEST 4: Boardwalk Bench & Picnic Table [E] Sitting
    console.log('\n[DEEP-QA 4] Testing Boardwalk Bench & Picnic Table [E] Sitting...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()'); // 3rd person to inspect seated body alignment
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-42.0, 2.25, -24.8, 1.35, 0.25)');
    await sleep(900);
    const benchPrompt = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(benchPrompt.includes('Boardwalk Bench'), `Boardwalk Bench prompt active: "${benchPrompt}"`);
    await cdp.pressKey('KeyE', 'e', 80);
    await sleep(650);
    await cdp.screenshot(path.join(OUT_DIR, '04_sit_boardwalk_bench.png'));

    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-36.2, 3.1, -28.0, 2.75, 0.28)');
    await sleep(600);
    const picnicPrompt = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(picnicPrompt.includes('Picnic Table'), `Picnic Table sit prompt active: "${picnicPrompt}"`);
    await cdp.pressKey('KeyE', 'e', 80);
    await sleep(650);
    await cdp.screenshot(path.join(OUT_DIR, '05_sit_picnic_table.png'));

    // TEST 5: Interactive Inflatable Swim Ring
    console.log('\n[DEEP-QA 5] Testing Inflatable Pink/White Swim Ring Horizontal Buoyancy & [E] Ride...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-14.5, -0.5, 7.6, 0.0, 0.35)');
    await sleep(750);
    const ringPrompt = await cdp.evalJs('window.__BEACH_DEMO__.getPlayerPrompt()');
    check(ringPrompt.includes('Swim Ring'), `Swim Ring ride prompt active: "${ringPrompt}"`);
    await cdp.screenshot(path.join(OUT_DIR, '06_float_ring_horizontal.png'));

    // TEST 6: Water Contact Meniscus & Live Swimming Wake Trail
    console.log('\n[DEEP-QA 6] Swimming 2.5s to Capture Subtle Meniscus & Shimmering Wake Trail...');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(-2.5, -0.8, 10.5, 0.0, 0.44)');
    await sleep(450);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
    await sleep(2400);
    await cdp.screenshot(path.join(OUT_DIR, '07_swim_wake_trail_closeup.png'));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(250);

    // TEST 7: 8-Second Live NPC Pathing & Pier Ramp Zero-Stuck Audit
    console.log('\n[DEEP-QA 7] Running Live 8-Second Autonomous NPC Pathing & Zero-Stuck Audit...');
    await cdp.evalJs('window.__BEACH_DEMO__.toggleFirstPerson()');
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(22.0, 6.2, -28.0, 0.0, 0.55)');
    const snapA = await cdp.evalJs('window.__BEACH_DEMO__.getNpcTelemetry()');
    await sleep(4000);
    await cdp.screenshot(path.join(OUT_DIR, '08_pier_ramp_junction_traffic.png'));
    await sleep(4000);
    const snapB = await cdp.evalJs('window.__BEACH_DEMO__.getNpcTelemetry()');

    let stuckTravelers = 0;
    for (const b of snapB.citizens) {
      const a = snapA.citizens.find((c) => c.idx === b.idx);
      if (!a) continue;
      if (a.phase === 'travel' && b.phase === 'travel' && a.slotType === b.slotType) {
        const moved = Math.hypot(b.x - a.x, b.z - a.z);
        if (moved < 0.45) {
          stuckTravelers++;
          console.error(`    Stuck citizen #${b.idx}: slot=${b.slotType} moved=${moved.toFixed(2)}m pos=[${b.x},${b.z}] strikes=${b.strikes}`);
        }
      }
    }
    check(stuckTravelers === 0, `Zero stuck traveling citizens over 8s live audit (stuck=${stuckTravelers}, citizens=${snapB.citizenCount})`);
    check(snapB.kayakerCount >= 4, `Outer-bay autonomous kayaks active across bay (kayakerCount=${snapB.kayakerCount})`);
    check(snapB.offshoreWaterCount >= 14, `Rich offshore maritime activity beyond shoreline (offshoreWaterCount=${snapB.offshoreWaterCount})`);

    // TEST 8: Outer Bay Offshore Panorama
    await cdp.evalJs('window.__BEACH_DEMO__.teleport(0.0, 14.0, 2.0, 0.0, 0.28)');
    await sleep(700);
    await cdp.screenshot(path.join(OUT_DIR, '09_outer_bay_offshore_activity.png'));

    check(errors.length === 0, `Zero console/page errors during deep QA (errors=${errors.length})`);

    ws.close();
    if (failures.length > 0) {
      console.error(`\n[DEEP-QA] FAILED ${failures.length} CHECKS!`);
      process.exitCode = 1;
    } else {
      console.log(`\n[DEEP-QA] ALL DEEP VERIFICATION CHECKS PASSED! Captures -> ${OUT_DIR}`);
    }
  } finally {
    chrome.kill('SIGKILL');
    await sleep(250);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
