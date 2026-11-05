export function createWave(columns: number, rows: number, options: { amplitude: number; speed: number; retention: number }) {
  const count = columns * rows;
  const heights = new Float32Array(count);
  const previous = new Float32Array(count);
  const velocities = new Float32Array(count);
  const accelerations = new Float32Array(count);
  const dt = 1 / 120;
  const damping = Math.pow(options.retention, dt);
  return {
    heights, previous, velocities,
    step() {
      previous.set(heights);
      for (let i = 0; i < count; i++) {
        const x = i % columns, z = Math.floor(i / columns), h = heights[i];
        const neighbors = (x > 0 ? heights[i - 1] : 0) + (x < columns - 1 ? heights[i + 1] : 0) + (z > 0 ? heights[i - columns] : 0) + (z < rows - 1 ? heights[i + columns] : 0);
        accelerations[i] = options.speed * options.speed * (neighbors - 4 * h) - h;
      }
      for (let i = 0; i < count; i++) {
        velocities[i] = (velocities[i] + accelerations[i] * dt) * damping;
        heights[i] = Math.max(-options.amplitude, Math.min(options.amplitude, heights[i] + velocities[i] * dt));
      }
    },
    active() { return heights.some((height, i) => Math.abs(height) + Math.abs(velocities[i]) > .004); },
  };
}
