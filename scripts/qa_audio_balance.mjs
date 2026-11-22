#!/usr/bin/env node
/**
 * 9-Spot Per-Channel Audio Mix Audit (`scripts/qa_audio_balance.mjs`)
 *
 * Connects to http://127.0.0.1:5173/, unlocks Web Audio at default 35% volume,
 * visits 9 representative spots across the island + reef, measures every individual
 * sound channel's live RMS & peak dBFS over 1.8s–2.5s via SoundEngine's
 * per-channel AnalyserNode breakdown, prints a full balance table, saves JSON to
 * scratch/audio_audit.json, and enforces strict mix balance assertions.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const URL_TARGET = process.env.QA_URL || 'http://127.0.0.1:5173/';
const OUT_JSON =
  process.env.QA_AUDIO_JSON ||
  'C:\\Users\\aoike\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\0f990142-cbc8-4cfd-ae38-d5103c7a18ea\\scratch\\audio_audit.json';
const CHROME_PATH =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SPOTS = [
  { id: '01_spawn', pos: [0, 0.8, -10], yaw: 0, listenMs: 1800 },
  { id: '02_tiki_bar', pos: [-22.0, 3.6, -27.5], yaw: 0, listenMs: 1800 },
  { id: '03_boardwalk_hub', pos: [-6.0, 2.8, -24.5], yaw: 0, listenMs: 1800 },
  { id: '04_volleyball_court', pos: [2.5, 1.2, -14.2], yaw: 1.5, listenMs: 2800 },
  { id: '05_surf_beachball', pos: [-6.0, 0.4, 4.5], yaw: 0, listenMs: 2800 },
  { id: '06_bonfire_pit', pos: [-37.0, 1.7, -18.0], yaw: -0.4, listenMs: 1900 },
  { id: '07_water_slide', pos: [-22.0, 1.5, 10.5], yaw: Math.PI, listenMs: 1800 },
  { id: '08_pier_end', pos: [22.0, 2.3, 22.0], yaw: 0, listenMs: 1800 },
  { id: '09_underwater_reef', pos: [-4.5, -2.8, 37.5], yaw: 0, listenMs: 1800 },
];

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
  }
  async connect() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalExpr(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }
  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function launchChrome(userDataDir) {
  const proc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome launch timeout')), 15000);
    const onD = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stderr.on('data', onD);
    proc.stdout.on('data', onD);
  });
  return { proc, port };
}

function fmtDb(v) {
  return v <= -90 ? '  off  ' : v.toFixed(1).padStart(6, ' ');
}

async function main() {
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-audio-qa-'));
  let chrome = null;
  let cdp = null;

  try {
    chrome = await launchChrome(userDataDir);
    const targets = await waitForHttpJson(`http://127.0.0.1:${chrome.port}/json`);
    const page = targets.find((t) => t.type === 'page') || targets[0];
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: URL_TARGET });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const ok = await cdp.evalExpr(`Boolean(window.__BEACH_DEMO__?.getAudioBreakdown)`);
      if (ok) break;
      await wait(250);
    }
    await wait(1200);

    // Click center + explicit unlockAudio + wait for MP3 buffers to decode and fade in
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
    await cdp.evalExpr(`window.__BEACH_DEMO__.unlockAudio?.()`);
    await wait(2400);

    const results = [];
    for (const spot of SPOTS) {
      await cdp.evalExpr(`(() => {
        const api = window.__BEACH_DEMO__;
        const s = api.getState();
        const isFP = Math.hypot(s.cameraPos[0] - s.playerPos[0], s.cameraPos[2] - s.playerPos[2]) < 1.2;
        if (!isFP) api.toggleFirstPerson();
        api.teleport(${spot.pos[0]}, ${spot.pos[1]}, ${spot.pos[2]}, ${spot.yaw}, 0.05);
      })()`);
      await wait(450);

      // Keep underwater test spot submerged cleanly if needed
      const sample = await cdp.evalExpr(`(async () => {
        const api = window.__BEACH_DEMO__;
        const agg = {};
        const end = performance.now() + ${spot.listenMs};
        let n = 0;
        while (performance.now() < end) {
          if (${JSON.stringify(spot.id)} === '09_underwater_reef') {
            api.teleport(${spot.pos[0]}, -3.6, ${spot.pos[2]}, ${spot.yaw}, 0.05);
          }
          const b = api.getAudioBreakdown();
          if (b && b.channels) {
            n++;
            for (const [k, ch] of Object.entries(b.channels)) {
              if (!agg[k]) agg[k] = { rmsLinSq: 0, peakMaxDb: -120, gainSum: 0 };
              const lin = ch.rmsDb <= -95 ? 0 : Math.pow(10, ch.rmsDb / 20);
              agg[k].rmsLinSq += lin * lin;
              if (ch.peakDb > agg[k].peakMaxDb) agg[k].peakMaxDb = ch.peakDb;
              agg[k].gainSum += (ch.gain || 0);
            }
          }
          await new Promise((r) => setTimeout(r, 70));
        }
        const out = {};
        for (const [k, v] of Object.entries(agg)) {
          const rmsLin = n > 0 ? Math.sqrt(v.rmsLinSq / n) : 0;
          out[k] = {
            rmsDb: rmsLin <= 1e-5 ? -100 : Number((20 * Math.log10(rmsLin)).toFixed(2)),
            peakDb: Number(v.peakMaxDb.toFixed(2)),
            gain: Number((v.gainSum / Math.max(1, n)).toFixed(3)),
          };
        }
        const st = api.getState();
        return { channels: out, lowPassHz: st.lowPassHz, sub: Number((st.cameraSubmersion || 0).toFixed(2)), audioActive: st.audioActive, ambientLoops: st.ambientLoops };
      })()`);

      results.push({ id: spot.id, pos: spot.pos, ...sample });
    }

    const keys = ['oceanBirds', 'closeWaves', 'palmWind', 'beachChatter', 'tikiMusic', 'bonfireCrackle', 'tropicalBirds', 'sfxBus', 'underwater', 'master'];
    console.log('\n=== 9-SPOT PER-CHANNEL AUDIO BALANCE (RMS / Peak dBFS at 35% default volume) ===');
    console.log('Spot'.padEnd(20) + keys.map((k) => k.slice(0, 9).padStart(14)).join(''));
    for (const r of results) {
      const cols = keys.map((k) => {
        const ch = r.channels[k] || { rmsDb: -100, peakDb: -120 };
        return `${fmtDb(ch.rmsDb)}/${fmtDb(ch.peakDb)}`.padStart(14);
      });
      console.log(r.id.padEnd(20) + cols.join('') + `  LPF=${r.lowPassHz}Hz`);
    }

    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    const failures = [];
    const rmsOf = (spot, ch) => byId[spot]?.channels?.[ch]?.rmsDb ?? -100;
    const peakOf = (spot, ch) => byId[spot]?.channels?.[ch]?.peakDb ?? -120;
    const linPow = (db) => (db <= -90 ? 0 : Math.pow(10, db / 10));
    const sumDb = (a, b) => {
      const p = linPow(a) + linPow(b);
      return p <= 1e-9 ? -100 : 10 * Math.log10(p);
    };

    for (const r of results) {
      if (!r.audioActive) failures.push(`${r.id}: AudioContext not running`);
      if (peakOf(r.id, 'master') > -6.0) failures.push(`${r.id}: master peak too hot (${peakOf(r.id, 'master')} > -6 dBFS)`);
    }

    const oceanCombinedTiki = sumDb(rmsOf('02_tiki_bar', 'oceanBirds'), rmsOf('02_tiki_bar', 'closeWaves'));
    if (rmsOf('02_tiki_bar', 'tikiMusic') <= oceanCombinedTiki) {
      failures.push(`02_tiki_bar: tikiMusic (${rmsOf('02_tiki_bar', 'tikiMusic')}) must exceed ocean combined (${oceanCombinedTiki.toFixed(1)})`);
    }
    if (rmsOf('02_tiki_bar', 'beachChatter') <= rmsOf('02_tiki_bar', 'oceanBirds')) {
      failures.push(`02_tiki_bar: beachChatter (${rmsOf('02_tiki_bar', 'beachChatter')}) must exceed oceanBirds (${rmsOf('02_tiki_bar', 'oceanBirds')})`);
    }
    for (const sp of ['01_spawn', '03_boardwalk_hub']) {
      if (rmsOf(sp, 'beachChatter') <= rmsOf(sp, 'oceanBirds')) {
        failures.push(`${sp}: beachChatter (${rmsOf(sp, 'beachChatter')}) must exceed oceanBirds (${rmsOf(sp, 'oceanBirds')})`);
      }
    }
    if (rmsOf('06_bonfire_pit', 'bonfireCrackle') <= rmsOf('06_bonfire_pit', 'oceanBirds')) {
      failures.push(`06_bonfire_pit: bonfireCrackle (${rmsOf('06_bonfire_pit', 'bonfireCrackle')}) must exceed oceanBirds (${rmsOf('06_bonfire_pit', 'oceanBirds')})`);
    }
    if (peakOf('04_volleyball_court', 'sfxBus') <= rmsOf('04_volleyball_court', 'oceanBirds') + 6.0) {
      failures.push(`04_volleyball_court: sfxBus peak (${peakOf('04_volleyball_court', 'sfxBus')}) must exceed oceanBirds+6dB (${(rmsOf('04_volleyball_court', 'oceanBirds') + 6).toFixed(1)})`);
    }
    if (peakOf('05_surf_beachball', 'sfxBus') <= rmsOf('05_surf_beachball', 'oceanBirds') + 6.0) {
      failures.push(`05_surf_beachball: sfxBus peak (${peakOf('05_surf_beachball', 'sfxBus')}) must exceed oceanBirds+6dB (${(rmsOf('05_surf_beachball', 'oceanBirds') + 6).toFixed(1)})`);
    }
    if (byId['09_underwater_reef'].lowPassHz >= 600 || rmsOf('09_underwater_reef', 'underwater') <= -80) {
      failures.push(`09_underwater_reef: expected underwater LPF<600 (${byId['09_underwater_reef'].lowPassHz}) and active underwater channel (${rmsOf('09_underwater_reef', 'underwater')})`);
    }
    // Spatial separation gates: music & crowd should clearly drop out at the quiet Pier End!
    if (rmsOf('02_tiki_bar', 'tikiMusic') < rmsOf('08_pier_end', 'tikiMusic') + 18.0) {
      failures.push(`Spatial separation: tikiMusic at Tiki Bar (${rmsOf('02_tiki_bar', 'tikiMusic')}) must be >=18 dB louder than at Pier End (${rmsOf('08_pier_end', 'tikiMusic')})`);
    }
    if (rmsOf('02_tiki_bar', 'beachChatter') < rmsOf('08_pier_end', 'beachChatter') + 8.0) {
      failures.push(`Spatial separation: beachChatter at Tiki Bar (${rmsOf('02_tiki_bar', 'beachChatter')}) must be >=8 dB louder than at Pier End (${rmsOf('08_pier_end', 'beachChatter')})`);
    }
    if (rmsOf('01_spawn', 'master') > -34.0) {
      failures.push(`Calm headroom: 01_spawn master RMS (${rmsOf('01_spawn', 'master')}) should be <= -34.0 dBFS at default 35%`);
    }

    await fs.writeFile(OUT_JSON, JSON.stringify({ results, failures }, null, 2));
    console.log(`\nSaved JSON audit -> ${OUT_JSON}`);
    if (failures.length) {
      console.error('\n[AUDIO-QA] FAILED ASSERTIONS:');
      for (const f of failures) console.error('  -', f);
      process.exitCode = 1;
    } else {
      console.log('\n[AUDIO-QA] ALL 9-SPOT AUDIO BALANCE GATES PASSED!');
    }
  } finally {
    if (cdp) cdp.close();
    if (chrome?.proc) chrome.proc.kill('SIGTERM');
    await wait(200);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('[AUDIO-QA] FATAL:', e);
  process.exit(1);
});
