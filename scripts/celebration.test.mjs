import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, require, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, Intl, Date, Math, ...globals });
  return exports;
}
const seasonal = load('src/halloween.ts');
test('Los Angeles cutoff, independent of browser timezone; event does not repeat', () => {
  for (const [iso, expected] of [
    ['2026-10-29T06:59:59Z', false], ['2026-10-29T07:00:00Z', true],
    ['2026-11-01T06:59:59Z', true], ['2026-11-01T07:00:00Z', false],
    ['2027-10-31T20:00:00Z', false],
  ]) assert.equal(seasonal.isHalloweenCelebration(new Date(iso)), expected, iso);
});
test('64 finite, bounded bat particles; no network or image dependencies', () => {
  const bats = seasonal.createBats(390, 844, 100);
  assert.equal(bats.length, 64);
  for (const b of bats) {
    for (const v of Object.values(b)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
    assert.ok(b.born >= 100 && b.born < 600);
  }
});
function harness() {
  let effect, cleanup, now = '2026-10-31T23:00:00Z', reduced = false, id = 0;
  let bats = 0, papers = 0;
  const frames = new Map();
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillRect' ? () => papers++ : () => {} });
  const canvas = { style: {}, getContext: () => ctx };
  const React = { useRef: () => ({ current: canvas }), useEffect: (fn) => { effect = fn; } };
  let refs = 0;
  React.useRef = () => ({ current: refs++ % 2 === 0 ? canvas : null });
  const Comp = load('src/Confetti.tsx', (name) => name === 'react' ? React : name === 'react/jsx-runtime' ? { jsx: () => null } : {
    ...seasonal, drawBat: () => bats++,
  }, {
    Date: class extends Date { constructor() { super(now); } },
    window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
      matchMedia: () => ({ matches: reduced }) },
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (i) => frames.delete(i),
  }).default;
  return {
    burst: (key) => { cleanup?.(); Comp({ burstKey: key }); cleanup = effect(); },
    frame: (time) => { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn(time)); },
    get counts() { return { bats, papers, queued: frames.size }; },
    canvas,
    setDate: (date) => { now = date; }, setReduced: () => { reduced = true; },
    unmount: () => cleanup?.(),
  };
}
test('per-interaction date check restores confetti across midnight without reload', () => {
  const h = harness(); h.burst(1); h.frame(500); assert.equal(h.counts.bats, 64); assert.equal(h.counts.papers, 0);
  h.setDate('2026-11-01T07:00:00Z'); h.burst(2); h.frame(500); assert.equal(h.counts.papers, 90);
});
test('repeated bursts cancel prior frame; unmount clears canvas and pending animation', () => {
  const h = harness(); h.burst(1); h.burst(2); assert.equal(h.counts.queued, 1);
  h.unmount(); assert.equal(h.counts.queued, 0); assert.equal(h.canvas.style.opacity, '0');
});
test('burst finishes and hides overlay', () => {
  const h = harness(); h.burst(1); h.frame(3000);
  assert.equal(h.counts.queued, 0); assert.equal(h.canvas.style.opacity, '0');
});
test('no animation on mount or when reduced motion is requested', () => {
  const h = harness(); h.burst(0); assert.equal(h.counts.queued, 0);
  h.setReduced(); h.burst(1); assert.equal(h.counts.queued, 0);
});
