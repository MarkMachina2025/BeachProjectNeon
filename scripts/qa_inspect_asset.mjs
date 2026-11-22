#!/usr/bin/env node
/**
 * Multi-Angle Close-Up Asset Inspector (`scripts/qa_inspect_asset.mjs`)
 *
 * Usage:
 *   node scripts/qa_inspect_asset.mjs <slug> <x> <y> <z> <radius> [targetYOffset=0]
 *
 * Captures 4 exact angles (front, side_east, rear, elevated_34) in headless Chrome
 * so every newly placed downloaded asset can be verified immediately for texture,
 * scaling, grounding, and clipping before placing the next asset batch.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const URL_TARGET = process.env.QA_URL || 'http://127.0.0.1:5173/';
const CHROME_PATH =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const BASE_SCRATCH =
  process.env.QA_ASSET_OUT_BASE ||
  'C:\\Users\\aoike\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\0f990142-cbc8-4cfd-ae38-d5103c7a18ea\\scratch\\asset_checks';

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1.5 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , slug, rawX, rawY, rawZ, rawR, rawYOff = '0'] = process.argv;
if (!slug || [rawX, rawY, rawZ, rawR].some((v) => v === undefined || !Number.isFinite(Number(v)))) {
  console.error('Usage: node scripts/qa_inspect_asset.mjs <slug> <x> <y> <z> <radius> [targetYOffset=0]');
  process.exit(1);
}

const TX = Number(rawX);
const TY = Number(rawY) + Number(rawYOff);
const TZ = Number(rawZ);
const RADIUS = Math.max(0.5, Number(rawR));
const DIST = Math.max(2.8, RADIUS * 2.2);
const OUT_DIR = path.join(BASE_SCRATCH, slug);

async function waitForHttpJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    await wait(150);
  }
  throw new Error(`Timed out waiting for CDP endpoint ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) fn(msg.params);
      }
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalExpr(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'Eval failed'
      );
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function launchChrome(userDataDir) {
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--autoplay-policy=no-user-gesture-required',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const port = await new Promise((resolve, reject) => {
    let errBuf = '';
    const timer = setTimeout(() => reject(new Error(`Chrome start timeout:\n${errBuf}`)), 15000);
    const onData = (c) => {
      errBuf += c.toString();
      const m = errBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    proc.stderr.on('data', onData);
    proc.stdout.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code})`));
    });
  });

  return { proc, port };
}

function getGlHookScript() {
  return `(() => {
    const glStats = { curDraws: 0, curTris: 0, history: [] };
    function trisForDraw(mode, count, inst = 1) {
      let base = 0;
      if (mode === 4) base = Math.floor(count / 3);
      else if (mode === 5 || mode === 6) base = Math.max(0, count - 2);
      return base * Math.max(1, inst);
    }
    const origGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = origGet.call(this, type, ...args);
      if (gl && !gl.__assetWrapped && (type === 'webgl2' || type === 'webgl')) {
        gl.__assetWrapped = true;
        const dE = gl.drawElements?.bind(gl);
        if (dE) gl.drawElements = function(m, c, t, o) { glStats.curDraws++; glStats.curTris += trisForDraw(m, c, 1); return dE(m, c, t, o); };
        const dA = gl.drawArrays?.bind(gl);
        if (dA) gl.drawArrays = function(m, f, c) { glStats.curDraws++; glStats.curTris += trisForDraw(m, c, 1); return dA(m, f, c); };
        const dEI = gl.drawElementsInstanced?.bind(gl);
        if (dEI) gl.drawElementsInstanced = function(m, c, t, o, p) { glStats.curDraws++; glStats.curTris += trisForDraw(m, c, p); return dEI(m, c, t, o, p); };
        const dAI = gl.drawArraysInstanced?.bind(gl);
        if (dAI) gl.drawArraysInstanced = function(m, f, c, p) { glStats.curDraws++; glStats.curTris += trisForDraw(m, c, p); return dAI(m, f, c, p); };
      }
      return gl;
    };
    const origRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function(cb) {
      return origRAF(function(ts) {
        glStats.curDraws = 0;
        glStats.curTris = 0;
        try { cb(ts); } finally {
          if (glStats.curDraws > 0) {
            glStats.history.push({ draws: glStats.curDraws, tris: glStats.curTris });
            if (glStats.history.length > 10) glStats.history.shift();
          }
        }
      });
    };
    window.__QA_GL__ = {
      getStats() {
        const r = glStats.history.slice(-4);
        if (!r.length) return { avgDraws: 0, avgTris: 0 };
        return {
          avgDraws: Math.round(r.reduce((s, x) => s + x.draws, 0) / r.length),
          avgTris: Math.round(r.reduce((s, x) => s + x.tris, 0) / r.length),
        };
      },
      resetHistory() { glStats.history.length = 0; },
    };
  })();`;
}

async function calibrate(cdp) {
  return cdp.evalExpr(`(async () => {
    const api = window.__BEACH_DEMO__;
    const waitF = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const isFP = (s) => Math.hypot(s.cameraPos[0] - s.playerPos[0], s.cameraPos[2] - s.playerPos[2]) < 1.2;
    if (isFP(api.getState())) { api.toggleFirstPerson(); await waitF(); }
    api.teleport(0, 14, 0, 0, 0); await waitF(); const s0 = api.getState();
    api.teleport(0, 14, 0, Math.PI / 2, 0); await waitF(); const sH = api.getState();
    api.teleport(0, 14, 0, 0, 0.35); await waitF(); const sP = api.getState();
    api.toggleFirstPerson(); await waitF();
    api.teleport(0, 14, 0, 0, 0); await waitF(); const s1 = api.getState();
    const normXZ = (a, b) => {
      const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    return {
      f0: normXZ(s0.playerPos, s0.cameraPos),
      fHalfPi: normXZ(sH.playerPos, sH.cameraPos),
      pitchLookUpSign: (sP.playerPos[1] - sP.cameraPos[1]) >= 0 ? 1 : -1,
      eyeOffsetY: s1.cameraPos[1] - s1.playerPos[1],
    };
  })()`);
}

function aim(cal, eye, target) {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const h = Math.hypot(dx, dz) || 1e-6;
  const nx = dx / h;
  const nz = dz / h;
  const c = nx * cal.f0[0] + nz * cal.f0[1];
  const s = nx * cal.fHalfPi[0] + nz * cal.fHalfPi[1];
  return {
    yaw: Math.atan2(s, c),
    pitch: Math.atan2(dy, h) * cal.pitchLookUpSign,
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-asset-qa-'));
  let chrome = null;
  let cdp = null;
  const errors = [];
  const warnings = [];

  try {
    chrome = await launchChrome(userDataDir);
    const targets = await waitForHttpJson(`http://127.0.0.1:${chrome.port}/json`);
    const page = targets.find((t) => t.type === 'page') || targets[0];
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false,
    });

    cdp.on('Runtime.consoleAPICalled', (p) => {
      const msg = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (p.type === 'error') errors.push(msg);
      else if (p.type === 'warning') warnings.push(msg);
    });
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.text || 'Exception'));

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: getGlHookScript() });
    await cdp.send('Page.navigate', { url: URL_TARGET });

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const st = await cdp.evalExpr(`window.__BEACH_DEMO__?.getState?.()`);
      if (st && st.loadedModels > 0 && st.drawCalls > 0) break;
      await wait(250);
    }
    await wait(2200);

    const cal = await calibrate(cdp);
    await cdp.evalExpr(`window.__BEACH_DEMO__.setSun(48)`);

    const angles = [
      { id: '01_front', eye: [TX, TY + DIST * 0.22, TZ + DIST] },
      { id: '02_side_east', eye: [TX + DIST, TY + DIST * 0.20, TZ] },
      { id: '03_rear', eye: [TX, TY + DIST * 0.24, TZ - DIST] },
      { id: '04_elevated_34', eye: [TX + DIST * 0.72, TY + DIST * 0.62, TZ + DIST * 0.72] },
    ];

    console.log(`[ASSET-QA] Inspecting "${slug}" at target=[${TX}, ${TY}, ${TZ}] r=${RADIUS} (dist=${DIST.toFixed(2)}m)`);
    for (const a of angles) {
      const { yaw, pitch } = aim(cal, a.eye, [TX, TY, TZ]);
      const footY = a.eye[1] - cal.eyeOffsetY;
      await cdp.evalExpr(`(() => {
        window.__QA_GL__.resetHistory();
        window.__BEACH_DEMO__.teleport(${a.eye[0]}, ${footY}, ${a.eye[2]}, ${yaw}, ${pitch});
      })()`);
      await wait(160);
      await cdp.evalExpr(`window.__BEACH_DEMO__.teleport(${a.eye[0]}, ${footY}, ${a.eye[2]}, ${yaw}, ${pitch})`);
      await wait(70);

      const gl = await cdp.evalExpr(`window.__QA_GL__.getStats()`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const outFile = path.join(OUT_DIR, `${a.id}.png`);
      await fs.writeFile(outFile, Buffer.from(shot.data, 'base64'));
      console.log(`  [PNG] ${a.id}.png | draws=${gl.avgDraws} tris=${gl.avgTris} -> ${outFile}`);
    }

    console.log(`[ASSET-QA] Console errors=${errors.length}, warnings=${warnings.length}`);
    if (errors.length) console.error('ERRORS:', errors);
    if (warnings.length) console.warn('WARNINGS:', warnings);
    if (errors.length > 0 || warnings.length > 0) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (chrome?.proc) chrome.proc.kill('SIGTERM');
    await wait(200);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('[ASSET-QA] FATAL:', err);
  process.exit(1);
});
