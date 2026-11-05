import assert from "node:assert/strict";
import { test } from "node:test";
import { createWave } from "../app/components/motion/cube-wave.ts";
const options = { amplitude: .7, speed: 7, retention: .08 };

test("the decorative surface stays still without pointer input", () => {
  const wave = createWave(16, 16, options);
  for (let i = 0; i < 240; i++) wave.step();
  assert.equal(wave.active(), false);
  assert.ok(wave.heights.every(value => value === 0));
});

test("pointer energy spreads locally, remains bounded, and settles so rendering can stop", () => {
  const wave = createWave(16, 16, options);
  wave.velocities[136] = -3;
  for (let i = 0; i < 24; i++) wave.step();
  assert.notEqual(wave.heights[135], 0);
  assert.ok(wave.active());
  for (let frame = 0; frame < 1800; frame++) {
    if (frame < 60) wave.velocities[136] = -3;
    wave.step();
    assert.ok(wave.heights.every(value => Number.isFinite(value) && Math.abs(value) <= .700001));
  }
  assert.equal(wave.active(), false);
});
