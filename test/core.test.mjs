import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'ttfm-fft.html'), 'utf8');
const coreSrc = html.match(/\/\* CORE:BEGIN \*\/([\s\S]*?)\/\* CORE:END \*\//);
assert.ok(coreSrc, 'CORE block markers not found');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(coreSrc[1], sandbox);
const C = sandbox.TTFMCore;
assert.ok(C && typeof C.analyzeSignal === 'function', 'TTFMCore not attached');

/* ---------- helpers ---------- */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSignal({ hr = 75, ratio = 2.5, dt = 0.02, duration = 5, noiseDb = Infinity, seed = 1, phase1 = 0.7 }) {
  const f = hr / 60;
  const n = Math.round(duration / dt);
  const a0 = 40, a1 = a0 / Math.sqrt(ratio);
  const rnd = mulberry32(seed);
  const noiseRms = isFinite(noiseDb) ? (a0 / Math.SQRT2) / Math.pow(10, noiseDb / 20) : 0;
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let g = 0;
    if (noiseRms > 0) {
      const u1 = Math.max(1e-9, rnd()), u2 = rnd();
      g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * noiseRms;
    }
    sig[i] = 100 + a0 * Math.sin(2 * Math.PI * f * t) + a1 * Math.sin(2 * Math.PI * 2 * f * t + phase1) + g;
  }
  return { sig, dt, f };
}

function applyGap(sig, frac) {
  const arr = Array.from(sig);
  const n = arr.length, g = Math.floor(n * frac);
  if (!g) return arr;
  const start = Math.floor(n * 0.42);
  for (let i = start; i < Math.min(n, start + g); i++) arr[i] = NaN;
  for (let i = start; i < Math.min(n, start + g); i++) {
    let a = i - 1; while (a >= 0 && !isFinite(arr[a])) a--;
    let b = i + 1; while (b < n && !isFinite(arr[b])) b++;
    if (a >= 0 && b < n) arr[i] = arr[a] + (arr[b] - arr[a]) * (i - a) / (b - a);
  }
  return arr;
}

function relErr(actual, expected) { return Math.abs(actual - expected) / Math.abs(expected); }

/* ---------- FFT ---------- */
test('fftRadix2 matches naive DFT', () => {
  const n = 64;
  const re = new Float64Array(n), im = new Float64Array(n);
  const rnd = mulberry32(42);
  for (let i = 0; i < n; i++) { re[i] = rnd() * 2 - 1; im[i] = rnd() * 2 - 1; }
  const r2 = Float64Array.from(re), i2 = Float64Array.from(im);
  C.fftRadix2(r2, i2);
  const naive = C.naiveDFT(re, im);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(r2[k] - naive.re[k]) < 1e-9, `re[${k}]`);
    assert.ok(Math.abs(i2[k] - naive.im[k]) < 1e-9, `im[${k}]`);
  }
});

test('single sine occupies one spectral peak', () => {
  const n = 256, f = 0.1;
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) sig[i] = Math.sin(2 * Math.PI * f * i);
  const { P, half } = C.powerSpectrum(sig, 1024);
  let maxK = 0;
  for (let k = 2; k < half; k++) if (P[k] > P[maxK]) maxK = k;
  assert.ok(Math.abs(maxK - Math.round(f * 1024)) <= 2, `peak at ${maxK}`);
});

/* ---------- 合成信号分析 ---------- */
test('synthetic ratios across HR (clean signal, ≤2%)', () => {
  for (const ratio of [0.6, 1.0, 1.5, 2.5]) {
    for (const hr of [55, 75, 95]) {
      const { sig, dt } = makeSignal({ hr, ratio, noiseDb: Infinity, seed: 7 });
      const an = C.analyzeSignal(sig, dt);
      assert.ok(an.ok, 'analyze failed');
      assert.ok(relErr(an.ratio, ratio) <= 0.02, `ratio ${ratio}@${hr}: got ${an.ratio.toFixed(3)}`);
      assert.ok(Math.abs(an.hr - hr) <= 2, `HR ${hr}: got ${an.hr.toFixed(1)}`);
    }
  }
});

test('SNR 10 dB + gaps: tolerance 12%, class stable', () => {
  for (const gap of [0, 0.05, 0.15]) {
    for (const ratio of [2.5, 0.8]) {
      const { sig, dt } = makeSignal({ hr: 75, ratio, noiseDb: 10, seed: 11 });
      const an = C.analyzeSignal(applyGap(sig, gap), dt);
      assert.ok(an.ok, 'analyze failed');
      assert.ok(relErr(an.ratio, ratio) <= 0.12, `ratio ${ratio}, gap ${gap}: got ${an.ratio.toFixed(3)}`);
      if (ratio === 2.5) assert.equal(C.classify(an.ratio).key, 'patent');
      if (ratio === 0.8) assert.equal(C.classify(an.ratio).key, 'suspect');
    }
  }
});

test('SNR 3 dB: ratio 4 stays classified patent', () => {
  const { sig, dt } = makeSignal({ hr: 75, ratio: 4, noiseDb: 3, seed: 11 });
  const an = C.analyzeSignal(sig, dt);
  assert.ok(an.ok);
  assert.ok(relErr(an.ratio, 4) <= 0.5, `got ${an.ratio.toFixed(3)}`); // SNR 3 dB 下 5 s 窗的估计方差大，只要分类稳健
  assert.equal(C.classify(an.ratio).key, 'patent');
});

test('ratio invariant to amplitude scaling; HR follows time scaling', () => {
  const base = makeSignal({ hr: 75, ratio: 2.0, seed: 3 });
  const an0 = C.analyzeSignal(base.sig, base.dt);
  for (const k of [0.3, 3]) {
    const sc = Array.from(base.sig).map(v => 100 + (v - 100) * k);
    const an = C.analyzeSignal(sc, base.dt);
    assert.ok(relErr(an.ratio, an0.ratio) < 0.01, `amp x${k}`);
  }
  const anT = C.analyzeSignal(base.sig, base.dt * 1.2);
  assert.ok(relErr(anT.ratio, an0.ratio) < 0.01, 'time-scaled ratio');
  assert.ok(Math.abs(anT.hr - an0.hr / 1.2) <= 2, `time-scaled HR ${anT.hr}`);
});

test('adaptive band handles HR outside 27–132 bpm default', () => {
  for (const hr of [35, 150]) {
    const { sig, dt } = makeSignal({ hr, ratio: 2.0, noiseDb: 10, seed: 9 });
    const an = C.analyzeSignal(sig, dt);
    assert.ok(an.ok);
    assert.ok(Math.abs(an.hr - hr) <= 3, `HR ${hr}: got ${an.hr.toFixed(1)}`);
    assert.ok(relErr(an.ratio, 2.0) <= 0.12, `ratio got ${an.ratio.toFixed(3)}`);
  }
});

test('uncalibrated mode returns ratio without HR', () => {
  const { sig } = makeSignal({ hr: 75, ratio: 1.5, seed: 5 });
  const an = C.analyzeSignal(sig, null);
  assert.ok(an.ok);
  assert.ok(relErr(an.ratio, 1.5) <= 0.12, `got ${an.ratio.toFixed(3)}`);
  assert.equal(an.hr, null);
});

test('classification boundaries', () => {
  assert.equal(C.classify(1.2).key, 'patent');
  assert.equal(C.classify(1.0).key, 'critical');
  assert.equal(C.classify(0.85).key, 'suspect');
  assert.equal(C.classify(0).key, 'unknown');
});

/* ---------- 合成图像管线 ---------- */
function makeCanvas(W, H) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255; }
  function px(x, y, r, g, b) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  function line(x0, y0, x1, y1, col, wdt = 1) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
      for (let dx = -Math.floor(wdt / 2); dx <= Math.floor(wdt / 2); dx++)
        for (let dy = -Math.floor(wdt / 2); dy <= Math.floor(wdt / 2); dy++)
          px(x + dx, y + dy, col[0], col[1], col[2]);
    }
  }
  function text(str, x, y, scale, col) {
    let cx = x;
    for (const ch of str) {
      const rows = C.FONT5x7[ch];
      if (rows) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
        if ((rows[r] >> (4 - c)) & 1)
          for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) px(cx + c * scale + a, y + r * scale + b, col[0], col[1], col[2]);
      cx += 6 * scale;
    }
  }
  return { rgba, W, H, px, line, text };
}

function buildChart() {
  const W = 760, H = 380;
  const img = makeCanvas(W, H);
  const dark = [68, 81, 93], grid = [227, 234, 239], blue = [22, 104, 179];
  const yAxisX = 55, xAxisY = 300, pxPerSec = 150, pxPerUnit = 2.4;
  for (let x = yAxisX; x <= 655; x += pxPerSec) img.line(x, 60, x, xAxisY, grid, 1);
  for (let v = 0; v <= 100; v += 10) img.line(yAxisX, xAxisY - v * pxPerUnit, 655, xAxisY - v * pxPerUnit, grid, 1);
  img.line(yAxisX, 50, yAxisX, xAxisY, dark, 2);
  img.line(yAxisX, xAxisY, 660, xAxisY, dark, 2);
  for (let v = 0; v <= 100; v += 20) {
    const y = xAxisY - v * pxPerUnit;
    img.line(yAxisX - 7, y, yAxisX, y, dark, 2);
    img.text(String(v), 10, y - 7, 2, dark);
  }
  for (let t = 0; t <= 4; t++) {
    const x = yAxisX + t * pxPerSec;
    img.line(x, xAxisY, x, xAxisY + 7, dark, 2);
    img.text(String(t), x - 3, xAxisY + 12, 2, dark);
  }
  const f = 1.25, ratio = 2.5, a0 = 20, a1 = a0 / Math.sqrt(ratio);
  let prev = null;
  for (let x = yAxisX; x <= 655; x++) {
    const t = (x - yAxisX) / pxPerSec;
    const flow = 55 + a0 * Math.sin(2 * Math.PI * f * t) + a1 * Math.sin(2 * Math.PI * 2 * f * t + 0.7) + 3 * Math.sin(2 * Math.PI * 0.2 * t);
    const y = xAxisY - flow * pxPerUnit;
    if (prev) img.line(prev.x, prev.y, x, y, blue, 3);
    prev = { x, y };
  }
  return { img, meta: { yAxisX, xAxisY, pxPerSec, pxPerUnit, ratio, hr: 75 } };
}

test('synthetic chart: panels, trace, axes and analysis', () => {
  const { img, meta } = buildChart();
  const panels = C.detectPanels(img.rgba, img.W, img.H);
  assert.ok(panels.length > 0, 'no panels');
  const rect = panels[0].rect;
  assert.ok(rect.x <= meta.yAxisX && rect.x + rect.w >= 600, 'panel should cover waveform');

  const tr = C.extractTrace(img.rgba, img.W, img.H, rect, { mode: 'auto' });
  assert.ok(tr.ok, 'trace failed: ' + tr.reason);
  assert.equal(tr.mode, 'colored');
  assert.ok(tr.coverage >= 0.9, `coverage ${tr.coverage}`);
  assert.ok(tr.ppAmp > 60, `ppAmp ${tr.ppAmp}`);

  const ax = C.detectAxes(img.rgba, img.W, img.H, rect, tr);
  assert.ok(ax.calX, 'x calibration missing');
  assert.ok(Math.abs(ax.calX.pxPerSec - meta.pxPerSec) / meta.pxPerSec < 0.03, `pxPerSec ${ax.calX.pxPerSec}`);
  assert.ok(ax.calY, 'y calibration missing');
  const trueSlope = -1 / meta.pxPerUnit;
  assert.ok(Math.abs(ax.calY.a - trueSlope) / Math.abs(trueSlope) < 0.05, `y slope ${ax.calY.a}`);

  const flows = [];
  for (let i = tr.first; i <= tr.last; i++) {
    const y = tr.y[i];
    if (isFinite(y)) flows.push(ax.calY.a * y + ax.calY.b);
  }
  const dt = 1 / ax.calX.pxPerSec;
  const an = C.analyzeSignal(flows, dt);
  assert.ok(an.ok);
  assert.ok(relErr(an.ratio, meta.ratio) <= 0.12, `image ratio ${an.ratio.toFixed(3)}`);
  assert.ok(Math.abs(an.hr - meta.hr) <= 3, `image HR ${an.hr.toFixed(1)}`);
});
