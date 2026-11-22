#!/usr/bin/env node
/**
 * Neon Cove Comprehensive 26-Point QA World Inspector
 *
 * Launches headless Chrome against the running app, hooks WebGL2 draw/triangle
 * counters and Web Audio AnalyserNode metering, self-calibrates teleport/camera
 * orientation from live state, verifies HUD defaults and wave buoyancy, teleports
 * across 26 close-up and overview viewpoints covering ~99% of props, NPCs,
 * buildings, shorelines, ocean, underwater reef, and lighting presets, and
 * asserts strict Console, Performance, Audio, Buoyancy, and Submersion gates.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const URL_TARGET = process.env.QA_URL || 'http://127.0.0.1:5173/';
const OUT_DIR = path.resolve(
  process.argv[2] || path.join(process.cwd(), 'artifacts', 'qa_inspect')
);
const CHROME_PATH =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const VIEWPORT = { width: 1600, height: 900, deviceScaleFactor: 1.5 };
const MAX_FRAME_DRAWS = 650;
const MAX_FRAME_TRIS = 1_100_000;
const MAX_AUDIO_RMS_DB = -22.0;
const MIN_AUDIO_RMS_DB = -56.0;
const MAX_AUDIO_PEAK_DB = -12.0;
const MIN_WAVE_LIFT_M = 0.20;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
        if (msg.error) {
          reject(new Error(`${msg.error.message} (${msg.error.code})`));
        } else {
          resolve(msg.result);
        }
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
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Unknown evaluation exception';
      throw new Error(`Page eval error: ${desc}`);
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

function getInjectedProbeScript() {
  return `(() => {
    // 1. WebGL2 per-rAF true draw call & triangle accumulator
    const glStats = {
      curDraws: 0,
      curTris: 0,
      history: [],
      wrappedContexts: 0,
    };

    function trisForDraw(mode, count, instances = 1) {
      let base = 0;
      if (mode === 4) base = Math.floor(count / 3); // TRIANGLES
      else if (mode === 5 || mode === 6) base = Math.max(0, count - 2); // TRIANGLE_STRIP / FAN
      else if (mode === 1) base = Math.floor(count / 2); // LINES (diagnostic)
      return base * Math.max(1, instances);
    }

    function wrapGlContext(gl) {
      if (!gl || gl.__qaWrapped) return gl;
      gl.__qaWrapped = true;
      glStats.wrappedContexts++;

      const oDrawElements = gl.drawElements?.bind(gl);
      if (oDrawElements) {
        gl.drawElements = function(mode, count, type, offset) {
          glStats.curDraws++;
          glStats.curTris += trisForDraw(mode, count, 1);
          return oDrawElements(mode, count, type, offset);
        };
      }

      const oDrawArrays = gl.drawArrays?.bind(gl);
      if (oDrawArrays) {
        gl.drawArrays = function(mode, first, count) {
          glStats.curDraws++;
          glStats.curTris += trisForDraw(mode, count, 1);
          return oDrawArrays(mode, first, count);
        };
      }

      const oDrawElementsInst = gl.drawElementsInstanced?.bind(gl);
      if (oDrawElementsInst) {
        gl.drawElementsInstanced = function(mode, count, type, offset, primcount) {
          glStats.curDraws++;
          glStats.curTris += trisForDraw(mode, count, primcount);
          return oDrawElementsInst(mode, count, type, offset, primcount);
        };
      }

      const oDrawArraysInst = gl.drawArraysInstanced?.bind(gl);
      if (oDrawArraysInst) {
        gl.drawArraysInstanced = function(mode, first, count, primcount) {
          glStats.curDraws++;
          glStats.curTris += trisForDraw(mode, count, primcount);
          return oDrawArraysInst(mode, first, count, primcount);
        };
      }
      return gl;
    }

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const ctx = origGetContext.call(this, type, ...args);
      if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
        wrapGlContext(ctx);
      }
      return ctx;
    };

    const origRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function(cb) {
      return origRAF(function(ts) {
        glStats.curDraws = 0;
        glStats.curTris = 0;
        try {
          cb(ts);
        } finally {
          if (glStats.curDraws > 0) {
            glStats.history.push({ draws: glStats.curDraws, tris: glStats.curTris });
            if (glStats.history.length > 20) glStats.history.shift();
          }
        }
      });
    };

    window.__QA_GL__ = {
      getStats() {
        const recent = glStats.history.slice(-6);
        if (!recent.length) return { avgDraws: 0, maxDraws: 0, avgTris: 0, maxTris: 0, contexts: glStats.wrappedContexts };
        const avgDraws = Math.round(recent.reduce((s, x) => s + x.draws, 0) / recent.length);
        const maxDraws = Math.max(...recent.map((x) => x.draws));
        const avgTris = Math.round(recent.reduce((s, x) => s + x.tris, 0) / recent.length);
        const maxTris = Math.max(...recent.map((x) => x.tris));
        return { avgDraws, maxDraws, avgTris, maxTris, contexts: glStats.wrappedContexts };
      },
      resetHistory() {
        glStats.history.length = 0;
      },
    };

    // 2. Web Audio tap at AudioContext.destination
    const audioContexts = [];
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(dest, ...rest) {
      try {
        const ctx = this.context;
        if (ctx && dest === ctx.destination && !this.__qaBypass) {
          if (!ctx.__qaTap) {
            const tap = ctx.createGain();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            tap.__qaBypass = true;
            analyser.__qaBypass = true;
            origConnect.call(tap, analyser);
            origConnect.call(analyser, ctx.destination);
            ctx.__qaTap = tap;
            ctx.__qaAnalyser = analyser;
            audioContexts.push(ctx);
          }
          origConnect.call(this, ctx.__qaTap, ...rest);
          return dest;
        }
      } catch {
        // pass through
      }
      return origConnect.call(this, dest, ...rest);
    };

    window.__QA_AUDIO__ = {
      getContextStates() {
        return audioContexts.map((c) => ({ state: c.state, sampleRate: c.sampleRate }));
      },
      async measure(durationMs = 1100) {
        if (!audioContexts.length) {
          return { contexts: 0, rmsDb: -120, peakDb: -120, samples: 0 };
        }
        const analysers = audioContexts.map((c) => c.__qaAnalyser).filter(Boolean);
        const bufs = analysers.map((a) => new Float32Array(a.fftSize));
        let sumSq = 0;
        let count = 0;
        let maxAbs = 0;
        const end = performance.now() + durationMs;
        while (performance.now() < end) {
          for (let i = 0; i < analysers.length; i++) {
            analysers[i].getFloatTimeDomainData(bufs[i]);
            const arr = bufs[i];
            for (let j = 0; j < arr.length; j++) {
              const v = arr[j];
              sumSq += v * v;
              const av = Math.abs(v);
              if (av > maxAbs) maxAbs = av;
            }
            count += arr.length;
          }
          await new Promise((r) => setTimeout(r, 45));
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        const rmsDb = 20 * Math.log10(Math.max(rms, 1e-6));
        const peakDb = 20 * Math.log10(Math.max(maxAbs, 1e-6));
        return {
          contexts: audioContexts.length,
          states: audioContexts.map((c) => c.state),
          rmsDb: Number(rmsDb.toFixed(2)),
          peakDb: Number(peakDb.toFixed(2)),
          samples: count,
        };
      },
    };
  })();`;
}

async function launchHeadlessChrome(userDataDir) {
  const args = [
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
  ];

  const proc = spawn(CHROME_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Chrome DevTools failed to start within 15s:\n${stderr}`));
    }, 15000);

    const onChunk = (chunk) => {
      const txt = chunk.toString();
      stderr += txt;
      const m = txt.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    proc.stderr.on('data', onChunk);
    proc.stdout.on('data', onChunk);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited prematurely (${code}):\n${stderr}`));
    });
  });

  return { proc, port };
}

/**
 * Calibrate yaw, pitch, and 1st-person eye-height conventions empirically
 * from window.__BEACH_DEMO__.getState() without guessing signs.
 */
async function calibrateCamera(cdp) {
  const cal = await cdp.evalExpr(`(async () => {
    const api = window.__BEACH_DEMO__;
    const waitFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const isFirstPerson = (s) =>
      Math.hypot(s.cameraPos[0] - s.playerPos[0], s.cameraPos[2] - s.playerPos[2]) < 1.2;

    // Ensure 3rd-person temporarily to calibrate forward & yaw vectors from camera-to-player offset
    let st = api.getState();
    if (isFirstPerson(st)) {
      api.toggleFirstPerson();
      await waitFrames();
    }
    api.teleport(0, 12, 0, 0, 0);
    await waitFrames();
    const s0 = api.getState();

    api.teleport(0, 12, 0, Math.PI / 2, 0);
    await waitFrames();
    const sHalfPi = api.getState();

    api.teleport(0, 12, 0, 0, 0.35);
    await waitFrames();
    const sPitchPos = api.getState();

    // Switch to 1st person and measure eyeOffset
    api.toggleFirstPerson();
    await waitFrames();
    api.teleport(0, 12, 0, 0, 0);
    await waitFrames();
    const sFirst = api.getState();

    const normXZ = (a, b) => {
      const dx = a[0] - b[0];
      const dz = a[2] - b[2];
      const len = Math.hypot(dx, dz) || 1;
      return [dx / len, dz / len];
    };

    // In 3rd person, camera looks from cameraPos -> playerPos
    const f0 = normXZ(s0.playerPos, s0.cameraPos);
    const fHalfPi = normXZ(sHalfPi.playerPos, sHalfPi.cameraPos);
    const dyPitchPos = sPitchPos.playerPos[1] - sPitchPos.cameraPos[1];
    // Notice if camera is higher than player on pitch>0, camera looks DOWN; if lower, looks UP.
    const pitchLookUpSign = dyPitchPos >= 0 ? +1 : -1;
    const eyeOffsetY = sFirst.cameraPos[1] - sFirst.playerPos[1];

    return {
      f0,
      fHalfPi,
      pitchLookUpSign,
      eyeOffsetY,
      s0: { p: s0.playerPos, c: s0.cameraPos },
      sFirst: { p: sFirst.playerPos, c: sFirst.cameraPos, mode: sFirst.mode },
    };
  })()`);

  return cal;
}

function computeYawPitch(cal, eye, target) {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const horiz = Math.hypot(dx, dz) || 1e-6;
  const nx = dx / horiz;
  const nz = dz / horiz;

  // Express desired direction as linear combination of orthonormal basis (f0, fHalfPi):
  // forward(yaw) = cos(yaw)*f0 + sin(yaw)*fHalfPi
  const c = nx * cal.f0[0] + nz * cal.f0[1];
  const s = nx * cal.fHalfPi[0] + nz * cal.fHalfPi[1];
  const yaw = Math.atan2(s, c);

  // Elevation angle: positive dy means looking UP
  const elevAngle = Math.atan2(dy, horiz);
  const pitch = elevAngle * cal.pitchLookUpSign;

  return { yaw, pitch };
}

function buildViewpoints() {
  // Coordinates from BeachProps, CoastalLandmarks, CoastalModels, NpcManager, terrainMath
  return [
    {
      id: '01_initial_landing_3rd',
      mode: '3rd',
      rawTeleport: null, // captured before moving, right at natural spawn!
      notes: 'Natural initial spawn (3rd person, HUD volume default 35%)',
      measureAudio: true,
    },
    {
      id: '02_camp1_far_west_props',
      mode: '1st',
      eye: [-38.5, 2.3, -10.5],
      target: [-42.0, 1.3, -13.5],
      notes: 'Far West Camp (-42, -13.5): umbrella, coolers, beach bags, towels',
    },
    {
      id: '03_camp2_loungers_side_closeup',
      mode: '1st',
      eye: [-25.0, 2.1, -14.7],
      target: [-29.0, 1.25, -14.8],
      notes: 'West-Center Camp (-29, -14.8) SIDE close-up: upward backrest (+0.64 rad), rear struts, 4 armrest posts, lounger NPC posture',
    },
    {
      id: '04_camp2_loungers_front_boombox',
      mode: '1st',
      eye: [-28.8, 2.15, -10.4],
      target: [-29.0, 1.2, -14.8],
      notes: 'West-Center Camp (-29, -14.8) FRONT/3Q close-up: cushions, pillows, boombox scale/grounding, drinks, table',
    },
    {
      id: '05_camp3_mid_west_sunbather',
      mode: '1st',
      eye: [-12.5, 2.2, -11.5],
      target: [-16.5, 1.15, -15.5],
      notes: 'West-Mid Camp (-16.5, -15.5): sunbather alignment, towels, bags, cooler, umbrella',
    },
    {
      id: '06_camp4_center_west',
      mode: '1st',
      eye: [-3.2, 2.2, -12.6],
      target: [-6.5, 1.15, -16.8],
      notes: 'Center-West Camp (-6.5, -16.8): props, towels, beach slippers, drinks',
    },
    {
      id: '07_camp5_east_loungers_closeup',
      mode: '1st',
      eye: [18.0, 2.15, -14.3],
      target: [14.2, 1.25, -14.5],
      notes: 'East-Center Camp (14.2, -14.5) SIDE/3Q close-up: empty & occupied lounge chairs, struts, posts, lounger NPCs',
    },
    {
      id: '08_camps_6_7_far_east',
      mode: '1st',
      eye: [37.5, 2.4, -9.8],
      target: [33.5, 1.25, -13.8],
      notes: 'East Camp (33.0, -14.0) & Far East Camp view: umbrellas, towels, tables, props',
    },
    {
      id: '09_camp7_far_east_detail',
      mode: '1st',
      eye: [41.5, 2.25, -9.0],
      target: [45.0, 1.25, -12.5],
      notes: 'Far East Camp (45.0, -12.5) close-up & east cove props',
    },
    {
      id: '10_bonfire_pit_driftwood_west',
      mode: '1st',
      eye: [-33.8, 2.5, -17.5],
      target: [-38.5, 1.65, -19.2],
      notes: 'Bonfire Pit (-38.5, -19.2), log seats, grounded driftwood logs, coastal shrubs',
    },
    {
      id: '11_west_picnic_terrace_headland',
      mode: '1st',
      eye: [-32.0, 3.2, -23.5],
      target: [-36.5, 2.2, -28.75],
      notes: 'West Picnic Terrace (-36.5, -28.75), seated NPCs, boardwalk steps, West headland boulders & palms',
    },
    {
      id: '12_tiki_bar_exterior_shower_rack',
      mode: '1st',
      eye: [-14.0, 3.2, -18.5],
      target: [-21.5, 2.4, -28.2],
      notes: 'Neon Tiki Bar (-22, -30) exterior, barrels (-27.6, -28.7), Beach Rinse Shower (-18.2, -22.6), Surf Rack (-15.0, -27.55)',
    },
    {
      id: '13_tiki_bar_interior_stools',
      mode: '1st',
      eye: [-22.0, 2.75, -24.8],
      target: [-22.0, 2.15, -30.0],
      measureAudio: true,
      notes: 'Neon Tiki Bar (-22, -30) close-up: barstools, counter props, steps, patrons, bartender, island music audio',
    },
    {
      id: '14_center_pergola_terrace',
      mode: '1st',
      eye: [-6.0, 3.2, -23.0],
      target: [-9.6, 2.25, -28.65],
      notes: 'Center Boardwalk Pergola (-9.6, -28.65): diners, lanterns, railings, stairs onto sand',
    },
    {
      id: '15_lifeguard_tower_stairs_signpost',
      mode: '1st',
      eye: [5.5, 3.4, -20.5],
      target: [-0.8, 2.6, -29.2],
      notes: 'Lifeguard Tower (-2.0, -30.8), landing & stairs (x=+0.4), Wayfinding Signpost (3.2, -22.9)',
    },
    {
      id: '16_east_pergola_terrace',
      mode: '1st',
      eye: [11.0, 3.3, -22.5],
      target: [10.6, 2.3, -28.7],
      notes: 'East Pergola Terrace (8.4 & 12.9, -28.7): diners, seating, palm canopy, steps',
    },
    {
      id: '17_far_east_picnic_terrace',
      mode: '1st',
      eye: [28.5, 3.2, -23.0],
      target: [33.0, 2.2, -28.75],
      notes: 'Far East Picnic Terrace (33.0, -28.75): picnic tables, boardwalk, east slope flora',
    },
    {
      id: '18_volleyball_court_action',
      mode: '1st',
      eye: [11.2, 2.6, -12.5],
      target: [5.0, 1.5, -14.5],
      notes: 'Beach Volleyball Court (5.0, -14.5): grounded net posts, boundary lines, active NPC players',
    },
    {
      id: '19_sandcastle_crabs_shoreline',
      mode: '1st',
      eye: [-9.0, 1.7, -4.0],
      target: [-11.6, 0.7, -6.8],
      notes: 'Kids Sandcastle (-11.6, -6.8), buckets/spades, shoreline transition',
    },
    {
      id: '20_pier_entrance_deck_benches',
      mode: '1st',
      eye: [18.5, 3.0, -24.5],
      target: [22.0, 1.5, -12.0],
      notes: 'Ocean Pier entrance (x=22, z=-23.5..0): barrels/crates, boardwalk ramp, bollards, benches, lanterns',
    },
    {
      id: '21_pier_end_fishermen_rowboat',
      mode: '1st',
      eye: [16.5, 2.9, 6.5],
      target: [21.5, 1.2, 19.0],
      notes: 'Ocean Pier seaward end (x=22, z=10..24), 2 fishermen, moored rowboat (17.4, 11.2), buoys',
    },
    {
      id: '22_east_frisbee_headland_boulders',
      mode: '1st',
      eye: [34.0, 2.2, -3.5],
      target: [39.0, 1.2, -8.5],
      notes: 'East Frisbee Pair (33.6..42.4, -7.8), driftwood, East Headland boulders',
    },
    {
      id: '23_shoreline_waves_160_audio',
      mode: '3rd',
      waveIntensity: 1.6,
      rawTeleport: [-6.0, 0.4, 2.0, 0.15, 0.1],
      measureAudio: true,
      notes: 'Shoreline wading at 1.6x wave intensity: audio loudness check, surf kids (-6, 6.8), foam/wet sand',
    },
    {
      id: '24_deep_water_buoyancy_sailboats',
      mode: '3rd',
      waveIntensity: 1.6,
      rawTeleport: [0.0, 0.5, 24.0, 0.0, 0.05],
      measureBuoyancy: true,
      notes: 'Deep water (0, 24) at 1.6x waves: verify wave buoyancy vertical oscillation >= 0.20m & sailboats',
    },
    {
      id: '25_golden_hour_cove_panorama',
      mode: '1st',
      sun: 78,
      eye: [-32.0, 5.2, -18.0],
      target: [12.0, 1.2, 4.0],
      notes: 'Golden Hour (sun=78) sunset lighting check across beach, Tiki lights, bonfire, pier & surf',
    },
    {
      id: '26_high_aerial_overview',
      mode: '1st',
      sun: 48,
      eye: [0.0, 32.0, -48.0],
      target: [0.0, 0.0, 4.0],
      quickCaptureMs: 90,
      notes: 'High aerial overview at midday (sun=48) covering full cove layout, landmarks, and bay shoreline',
    },
    {
      id: '27_underwater_reef_turtle_anchor',
      mode: '1st',
      waveIntensity: 1.0,
      eye: [-4.5, -2.8, 37.5],
      target: [-7.5, -3.4, 41.5],
      quickCaptureMs: 90,
      expectSubmerged: true,
      notes: 'Underwater Coral/Turtle Reef (-4.5, -2.8, 37.5): submerged caustics, coral clusters, sea turtle, fish',
    },
    {
      id: '28_underwater_sunken_anchor',
      mode: '1st',
      waveIntensity: 1.0,
      eye: [14.5, -2.0, 31.0],
      target: [17.5, -2.2, 24.5],
      quickCaptureMs: 90,
      expectSubmerged: true,
      notes: 'Underwater Sunken Anchor (17.5, 24.5) & surrounding reef flora',
    },
    {
      id: '29_water_slide_tower_riders',
      mode: '1st',
      sun: 48,
      waveIntensity: 1.0,
      eye: [-14.0, 3.6, 8.2],
      target: [-22.0, 2.0, 4.2],
      quickCaptureMs: 90,
      notes: 'Water Slide tower (-22.0), bolted wing guardrails, turquoise chute & sliding NPCs',
    },
    {
      id: '30_sunset_lamp_bloom',
      mode: '1st',
      sun: 94,
      waveIntensity: 1.0,
      eye: [2.5, 4.2, -16.5],
      target: [-15.0, 2.4, -27.5],
      notes: 'Sunset (sun=94) radiant HDR bloom & warm halos on Tiki Bar, Pergolas, Lanterns & Torches',
    },
  ];
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-cove-qa-'));
  let chrome = null;
  let cdp = null;

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageExceptions = [];
  const networkFailures = [];

  try {
    console.log(`[QA] Launching headless Chrome (${CHROME_PATH})...`);
    chrome = await launchHeadlessChrome(userDataDir);
    const targets = await waitForHttpJson(`http://127.0.0.1:${chrome.port}/json/list`);
    let pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) {
      throw new Error('No page target found in headless Chrome');
    }

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false,
    });

    cdp.on('Runtime.consoleAPICalled', (p) => {
      const msg = (p.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      if (p.type === 'error') consoleErrors.push(msg);
      else if (p.type === 'warning') consoleWarnings.push(msg);
    });

    cdp.on('Runtime.exceptionThrown', (p) => {
      const desc =
        p.exceptionDetails?.exception?.description ||
        p.exceptionDetails?.text ||
        'Uncaught JS exception';
      pageExceptions.push(desc);
    });

    cdp.on('Network.loadingFailed', (p) => {
      if (!p.canceled) {
        networkFailures.push(`${p.errorText || 'Failed'} (type=${p.type})`);
      }
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: getInjectedProbeScript(),
    });

    console.log(`[QA] Navigating to ${URL_TARGET}...`);
    await cdp.send('Page.navigate', { url: URL_TARGET });

    // Wait for window.__BEACH_DEMO__ and initial models to finish loading
    const readyDeadlineStart = Date.now();
    let initialState = null;
    while (Date.now() - readyDeadlineStart < 35000) {
      initialState = await cdp.evalExpr(`(() => {
        if (!window.__BEACH_DEMO__) return null;
        return window.__BEACH_DEMO__.getState();
      })()`);
      if (initialState && initialState.drawCalls > 0) break;
      await wait(250);
    }
    if (!initialState) {
      throw new Error('window.__BEACH_DEMO__ did not initialize within 35s');
    }

    // Give models / assets a moment to settle
    await wait(2000);

    // Click center & unlock Web Audio + check #volume-slider default
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 800,
      y: 450,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 800,
      y: 450,
      button: 'left',
      clickCount: 1,
    });

    const hudCheck = await cdp.evalExpr(`(async () => {
      window.__BEACH_DEMO__.unlockAudio();
      const deadline = Date.now() + 8000;
      let state = window.__BEACH_DEMO__.getState();
      while (Date.now() < deadline) {
        const l = state.ambientLoops || {};
        if (l.oceanBirds && l.closeWaves && l.underwater && l.palmWind && l.tikiMusic && l.beachChatter) break;
        await new Promise((r) => setTimeout(r, 150));
        state = window.__BEACH_DEMO__.getState();
      }
      const slider = document.getElementById('volume-slider');
      const label = document.getElementById('volume-label');
      return {
        sliderValue: slider ? slider.value : null,
        labelText: label ? label.textContent?.trim() : null,
        state,
      };
    })()`);

    console.log('[QA] HUD Check:', JSON.stringify({
      sliderValue: hudCheck.sliderValue,
      labelText: hudCheck.labelText,
      ambientLoops: hudCheck.state.ambientLoops,
      loadedModels: hudCheck.state.loadedModels,
      npcCount: hudCheck.state.npcCount,
    }));

    // Capture initial 3rd-person landing shot & audio BEFORE calibrating
    const report = {
      url: URL_TARGET,
      viewport: VIEWPORT,
      hudCheck,
      calibration: null,
      viewpoints: [],
      volumeMuteCheck: null,
      buoyancyCheck: null,
      errors: [],
      failures: [],
    };

    const viewpoints = buildViewpoints();

    // Handle viewpoint #01 first (right at initial spawn before teleporting)
    const v1 = viewpoints[0];
    await wait(700);
    const v1Audio = await cdp.evalExpr(`window.__QA_AUDIO__.measure(1100)`);
    const v1State = await cdp.evalExpr(`window.__BEACH_DEMO__.getState()`);
    const v1Gl = await cdp.evalExpr(`window.__QA_GL__.getStats()`);
    const v1Png = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const v1Path = path.join(OUT_DIR, `${v1.id}.png`);
    await fs.writeFile(v1Path, Buffer.from(v1Png.data, 'base64'));
    report.viewpoints.push({
      id: v1.id,
      screenshot: v1Path,
      state: v1State,
      gl: v1Gl,
      audio: v1Audio,
      notes: v1.notes,
    });
    console.log(
      `[QA] ${v1.id} | draws=${v1Gl.avgDraws} (api:${v1State.drawCalls}) tris=${v1Gl.avgTris} (api:${v1State.triangles}) fps=${v1State.fps} audio=${v1Audio.rmsDb}/${v1Audio.peakDb} dBFS`
    );

    // Quick mute check via slider input event -> verify silence -> restore to 35%
    const muteCheck = await cdp.evalExpr(`(async () => {
      const slider = document.getElementById('volume-slider');
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const mutedAudio = await window.__QA_AUDIO__.measure(600);
      slider.value = '35';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      return { mutedAudio, restoredValue: slider.value };
    })()`);
    report.volumeMuteCheck = muteCheck;
    console.log(`[QA] Volume Mute Check (0%): rms=${muteCheck.mutedAudio.rmsDb} dBFS, restored=${muteCheck.restoredValue}%`);

    // Calibrate teleport / camera orientation
    const cal = await calibrateCamera(cdp);
    report.calibration = cal;
    console.log('[QA] Camera Calibration:', JSON.stringify(cal));

    // Visit viewpoints 2..N
    for (let i = 1; i < viewpoints.length; i++) {
      const vp = viewpoints[i];

      // Ensure desired mode (1st vs 3rd) using true camera-to-player horizontal separation
      await cdp.evalExpr(`(async () => {
        const api = window.__BEACH_DEMO__;
        const cur = api.getState();
        const isFirst =
          Math.hypot(cur.cameraPos[0] - cur.playerPos[0], cur.cameraPos[2] - cur.playerPos[2]) < 1.2;
        if (${JSON.stringify(vp.mode)} === '1st' && !isFirst) api.toggleFirstPerson();
        if (${JSON.stringify(vp.mode)} === '3rd' && isFirst) api.toggleFirstPerson();
        if (${vp.sun !== undefined}) api.setSun(${vp.sun ?? 48});
        if (${vp.waveIntensity !== undefined}) api.setWaveIntensity(${vp.waveIntensity ?? 1.0});
      })()`);

      if (vp.rawTeleport) {
        const [x, y, z, yaw, pitch] = vp.rawTeleport;
        await cdp.evalExpr(`(() => {
          window.__QA_GL__.resetHistory();
          window.__BEACH_DEMO__.teleport(${x}, ${y}, ${z}, ${yaw}, ${pitch});
        })()`);
      } else {
        const { yaw, pitch } = computeYawPitch(cal, vp.eye, vp.target);
        const footY = vp.eye[1] - cal.eyeOffsetY;
        await cdp.evalExpr(`(() => {
          window.__QA_GL__.resetHistory();
          window.__BEACH_DEMO__.teleport(${vp.eye[0]}, ${footY}, ${vp.eye[2]}, ${yaw}, ${pitch});
        })()`);
      }

      // Let frames render & stats settle
      await wait(vp.quickCaptureMs || 420);

      // Re-teleport right before capture on elevated/aerial shot in case gravity pulled slightly
      if (vp.quickCaptureMs && !vp.rawTeleport) {
        const { yaw, pitch } = computeYawPitch(cal, vp.eye, vp.target);
        const footY = vp.eye[1] - cal.eyeOffsetY;
        await cdp.evalExpr(`(() => {
          window.__BEACH_DEMO__.teleport(${vp.eye[0]}, ${footY}, ${vp.eye[2]}, ${yaw}, ${pitch});
        })()`);
        await wait(65);
      }

      let audioStats = null;
      if (vp.measureAudio) {
        await wait(450);
        audioStats = await cdp.evalExpr(`window.__QA_AUDIO__.measure(1100)`);
      }

      let buoyancy = null;
      if (vp.measureBuoyancy) {
        buoyancy = await cdp.evalExpr(`(async () => {
          const ys = [];
          for (let k = 0; k < 14; k++) {
            ys.push(window.__BEACH_DEMO__.getState().playerPos[1]);
            await new Promise((r) => setTimeout(r, 200));
          }
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return {
            samples: ys.map((v) => Number(v.toFixed(3))),
            minY: Number(minY.toFixed(3)),
            maxY: Number(maxY.toFixed(3)),
            waveLiftRange: Number((maxY - minY).toFixed(3)),
          };
        })()`);
        report.buoyancyCheck = buoyancy;
      }

      const st = await cdp.evalExpr(`window.__BEACH_DEMO__.getState()`);
      const gl = await cdp.evalExpr(`window.__QA_GL__.getStats()`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const shotPath = path.join(OUT_DIR, `${vp.id}.png`);
      await fs.writeFile(shotPath, Buffer.from(shot.data, 'base64'));

      report.viewpoints.push({
        id: vp.id,
        screenshot: shotPath,
        state: st,
        gl,
        audio: audioStats,
        buoyancy,
        expectSubmerged: Boolean(vp.expectSubmerged),
        notes: vp.notes,
      });

      const extra = [
        audioStats ? `audio=${audioStats.rmsDb}/${audioStats.peakDb} dBFS` : '',
        buoyancy ? `waveLift=${buoyancy.waveLiftRange}m` : '',
        vp.expectSubmerged ? `sub=${st.cameraSubmersion?.toFixed?.(2)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.log(
        `[QA] ${vp.id} | draws=${gl.avgDraws} (api:${st.drawCalls}) tris=${gl.avgTris} (api:${st.triangles}) fps=${st.fps} ${extra}`
      );
    }

    // ==================== PIER-JUMP FALLING PHYSICS TEST ====================
    const pierCam = computeYawPitch(cal, [22.0, 2.2, 23.2], [22.0, 2.2, 30.0]);
    const pierJumpCheck = await cdp.evalExpr(`(async () => {
      const api = window.__BEACH_DEMO__;
      const st0 = api.getState();
      const isFirst = Math.hypot(st0.cameraPos[0] - st0.playerPos[0], st0.cameraPos[2] - st0.playerPos[2]) < 1.2;
      if (isFirst) api.toggleFirstPerson();
      api.setSun(48);
      api.setWaveIntensity(1.0);
      api.teleport(22.0, 2.18, 23.2, ${pierCam.yaw}, 0.25);
      await new Promise((r) => setTimeout(r, 220));

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
      await new Promise((r) => setTimeout(r, 120));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      await new Promise((r) => setTimeout(r, 160));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));

      const samples = [];
      for (let k = 0; k < 24; k++) {
        const s = api.getState();
        samples.push({
          tMs: k * 65,
          mode: s.mode,
          y: Number(s.playerPos[1].toFixed(3)),
          z: Number(s.playerPos[2].toFixed(3)),
        });
        await new Promise((r) => setTimeout(r, 65));
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
      const airborneCount = samples.filter((s) => s.mode === 'JUMPING' || s.mode === 'FALLING').length;
      const reachedWater = samples.some((s) => s.mode === 'SWIMMING' || s.mode === 'DIVING');
      return { airborneCount, reachedWater, maxY: Math.max(...samples.map((s) => s.y)), samples };
    })()`);
    report.pierJumpCheck = pierJumpCheck;
    console.log(`[QA] Pier-Jump Test | airborneSamples=${pierJumpCheck.airborneCount} reachedWater=${pierJumpCheck.reachedWater} maxY=${pierJumpCheck.maxY}`);

    // ==================== 3RD-PERSON SURFACE SWIMMING TEST ====================
    const swimCam = computeYawPitch(cal, [-4.0, -0.5, 30.0], [-4.0, -0.5, 42.0]);
    const thirdPersonSwimCheck = await cdp.evalExpr(`(async () => {
      const api = window.__BEACH_DEMO__;
      const st0 = api.getState();
      const isFirst = Math.hypot(st0.cameraPos[0] - st0.playerPos[0], st0.cameraPos[2] - st0.playerPos[2]) < 1.2;
      if (isFirst) api.toggleFirstPerson();
      api.setWaveIntensity(1.0);
      api.teleport(-4.0, -0.85, 30.0, ${swimCam.yaw}, 0.28);
      await new Promise((r) => setTimeout(r, 550));
      const start = api.getState();

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
      const samples = [];
      for (let k = 0; k < 15; k++) {
        await new Promise((r) => setTimeout(r, 100));
        const s = api.getState();
        samples.push({
          tMs: (k + 1) * 100,
          mode: s.mode,
          y: Number(s.playerPos[1].toFixed(3)),
          z: Number(s.playerPos[2].toFixed(3)),
          camSub: Number((s.cameraSubmersion || 0).toFixed(3)),
        });
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
      const end = samples[samples.length - 1];
      const distMoved = Math.hypot(end.z - start.playerPos[2]);
      const dived = samples.some((s) => s.mode === 'DIVING');
      const minY = Math.min(...samples.map((s) => s.y));
      const maxCamSub = Math.max(...samples.map((s) => s.camSub));
      return { distMoved: Number(distMoved.toFixed(2)), dived, minY, maxCamSub, startMode: start.mode, samples };
    })()`);
    report.thirdPersonSwimCheck = thirdPersonSwimCheck;
    console.log(`[QA] 3rd-Person Swim Test | distMoved=${thirdPersonSwimCheck.distMoved}m dived=${thirdPersonSwimCheck.dived} minY=${thirdPersonSwimCheck.minY} maxCamSub=${thirdPersonSwimCheck.maxCamSub}`);

    // Evaluate all assertions
    const failures = [];

    if (consoleErrors.length) failures.push(`Console errors (${consoleErrors.length}): ${consoleErrors.join(' | ')}`);
    if (consoleWarnings.length) failures.push(`Console warnings (${consoleWarnings.length}): ${consoleWarnings.join(' | ')}`);
    if (pageExceptions.length) failures.push(`Page exceptions (${pageExceptions.length}): ${pageExceptions.join(' | ')}`);
    if (networkFailures.length) failures.push(`Network failures (${networkFailures.length}): ${networkFailures.join(' | ')}`);

    if (hudCheck.sliderValue !== '35' || hudCheck.labelText !== '35%') {
      failures.push(`Default volume HUD mismatch: value=${hudCheck.sliderValue}, label=${hudCheck.labelText}`);
    }

    const loops = hudCheck.state?.ambientLoops || {};
    for (const [k, v] of Object.entries(loops)) {
      if (v !== true) failures.push(`Ambient audio loop '${k}' is false!`);
    }
    if (Object.keys(loops).length < 6) {
      failures.push(`Expected 6 ambient audio loops, got ${Object.keys(loops).join(', ')}`);
    }

    if ((hudCheck.state?.npcCount || 0) < 48) {
      failures.push(`Expected at least 48 autonomous NPCs, got ${hudCheck.state?.npcCount}`);
    }

    if (!muteCheck || muteCheck.mutedAudio.rmsDb > -65) {
      failures.push(`Volume 0% mute check failed: rmsDb=${muteCheck?.mutedAudio?.rmsDb}`);
    }

    for (const vp of report.viewpoints) {
      const draws = Math.max(vp.gl.avgDraws, vp.state.drawCalls || 0);
      const tris = Math.max(vp.gl.avgTris, vp.state.triangles || 0);
      if (draws <= 0) failures.push(`${vp.id}: draws=${draws} (WebGL did not render)`);
      if (draws > MAX_FRAME_DRAWS) {
        failures.push(`${vp.id}: draws=${draws} exceeds limit ${MAX_FRAME_DRAWS}`);
      }
      if (tris > MAX_FRAME_TRIS) {
        failures.push(`${vp.id}: tris=${tris} exceeds limit ${MAX_FRAME_TRIS}`);
      }
      if (vp.audio) {
        if (vp.audio.rmsDb > MAX_AUDIO_RMS_DB || vp.audio.peakDb > MAX_AUDIO_PEAK_DB) {
          failures.push(
            `${vp.id}: audio too loud rms=${vp.audio.rmsDb} dBFS (>${MAX_AUDIO_RMS_DB}) or peak=${vp.audio.peakDb} dBFS (>${MAX_AUDIO_PEAK_DB})`
          );
        }
        if (vp.audio.rmsDb < MIN_AUDIO_RMS_DB) {
          failures.push(`${vp.id}: audio too silent rms=${vp.audio.rmsDb} dBFS (<${MIN_AUDIO_RMS_DB})`);
        }
        if (vp.id === '01_initial_landing_3rd' && vp.audio.rmsDb > -30.0) {
          failures.push(`${vp.id}: calm beach ambient too loud rms=${vp.audio.rmsDb} dBFS (>-30.0)`);
        }
        if (vp.id === '23_shoreline_waves_160_audio' && vp.audio.rmsDb > -28.0) {
          failures.push(`${vp.id}: 1.6x surf audio still too loud rms=${vp.audio.rmsDb} dBFS (>-28.0)`);
        }
        if (vp.id === '13_tiki_bar_interior_stools' && (vp.audio.rmsDb < -44.0 || vp.audio.rmsDb > -22.0)) {
          failures.push(`${vp.id}: Tiki Bar music out of balanced range [-44, -22], got ${vp.audio.rmsDb} dBFS`);
        }
      }
      if (vp.expectSubmerged && !(vp.state.cameraSubmersion > 0.5)) {
        failures.push(`${vp.id}: expected submerged camera (>0.5), got cameraSubmersion=${vp.state.cameraSubmersion}`);
      }
    }

    if (!pierJumpCheck || pierJumpCheck.airborneCount < 2 || !pierJumpCheck.reachedWater) {
      failures.push(`Pier-Jump falling physics failed: airborne=${pierJumpCheck?.airborneCount}, reachedWater=${pierJumpCheck?.reachedWater}`);
    }

    if (!thirdPersonSwimCheck || thirdPersonSwimCheck.distMoved < 2.0 || thirdPersonSwimCheck.dived || thirdPersonSwimCheck.maxCamSub >= 0.25) {
      failures.push(
        `3rd-person surface swim failed: dist=${thirdPersonSwimCheck?.distMoved}m, dived=${thirdPersonSwimCheck?.dived}, maxCamSub=${thirdPersonSwimCheck?.maxCamSub}`
      );
    }

    if (!report.buoyancyCheck || report.buoyancyCheck.waveLiftRange < MIN_WAVE_LIFT_M) {
      failures.push(
        `Deep water wave buoyancy insufficient: waveLiftRange=${report.buoyancyCheck?.waveLiftRange}m (< ${MIN_WAVE_LIFT_M}m)`
      );
    }

    report.errors = { consoleErrors, consoleWarnings, pageExceptions, networkFailures };
    report.failures = failures;

    const reportPath = path.join(OUT_DIR, 'qa_report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[QA] Report saved: ${reportPath}`);

    if (failures.length > 0) {
      console.error('\n[QA] FAILED ASSERTIONS:');
      for (const f of failures) console.error('  - ' + f);
      process.exitCode = 1;
    } else {
      console.log('\n[QA] ALL NUMERIC & TELEMETRY GATES PASSED!');
    }
  } finally {
    if (cdp) cdp.close();
    if (chrome?.proc && !chrome.proc.killed) {
      chrome.proc.kill('SIGKILL');
    }
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('[QA] Fatal error:', err);
  process.exit(1);
});
