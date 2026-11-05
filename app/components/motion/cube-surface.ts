import * as THREE from "three";
import { createWave } from "./cube-wave";

// Loaded only on an eligible mouse interaction, never during server rendering.
export function mountCubes(host: HTMLElement, fail: () => void) {
  const style = getComputedStyle(host);
  const root = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: number) => Number(root.getPropertyValue(name).trim()) || fallback;
  const tilePixels = token("--motion-tile-width", 150);
  const spacing = 1 + token("--motion-cube-gap", .025);
  const amplitude = token("--motion-wave-amplitude", .7);
  const speed = token("--motion-wave-speed", 7);
  const retention = token("--motion-wave-retention", .08);
  const glow = token("--motion-cube-glow", .5);
  let renderer: THREE.WebGLRenderer | undefined;
  let geometry: THREE.BoxGeometry | undefined;
  let materials: THREE.MeshBasicMaterial[] = [];
  let observer: ResizeObserver | undefined;
  let releaseMesh: (() => void) | undefined;
  let frame = 0;
  let disposed = false;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    observer?.disconnect();
    renderer?.domElement.removeEventListener("webglcontextlost", lost);
    releaseMesh?.();
    geometry?.dispose();
    materials.forEach(material => material.dispose());
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  };
  const lost = (event: Event) => { event.preventDefault(); console.warn("Decorative graphics unavailable; using static banner."); dispose(); fail(); };
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0, 0);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 100);
    camera.position.set(12, 12, 12);
    camera.lookAt(0, 0, 0);
    const colors = ["--color-border", "--color-surface-muted", "--color-surface-raised", "--color-surface-muted", "--color-surface-muted", "--color-border"];
    materials = colors.map(name => new THREE.MeshBasicMaterial({ color: new THREE.Color(style.getPropertyValue(name).trim()) }));
    geometry = new THREE.BoxGeometry(1, .5, 1);
    // Extra rows cover the orthographic camera edges when a wave displaces tiles.
    const columns = Math.min(32, Math.ceil(host.clientWidth / tilePixels) * 2 + 8);
    const rows = Math.min(32, Math.ceil(host.clientHeight / tilePixels) * 2 + 10);
    const count = columns * rows;
    const mesh = new THREE.InstancedMesh(geometry, materials, count);
    releaseMesh = () => mesh.dispose();
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new THREE.Color(root.getPropertyValue("--color-text-muted").trim());
    for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    scene.add(mesh);
    const wave = createWave(columns, rows, { amplitude, speed, retention });
    const { heights, velocities } = wave;
    const object = new THREE.Object3D();
    const color = new THREE.Color();
    const white = new THREE.Color(1, 1, 1);
    const resize = () => {
      if (disposed || !renderer) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const worldWidth = width / tilePixels;
      const worldHeight = worldWidth * height / width;
      camera.left = -worldWidth / 2; camera.right = worldWidth / 2;
      camera.top = worldHeight / 2; camera.bottom = -worldHeight / 2;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      schedule();
    };
    let previousTime = 0;
    let accumulator = 0;
    function render() {
      for (let i = 0; i < count; i++) {
        object.position.set((i % columns - (columns - 1) / 2) * spacing, THREE.MathUtils.lerp(wave.previous[i], heights[i], accumulator * 120), (Math.floor(i / columns) - (rows - 1) / 2) * spacing);
        object.updateMatrix();
        mesh.setMatrixAt(i, object.matrix);
        color.copy(white).lerp(base, Math.min(.3, Math.abs(velocities[i]) * glow * .1));
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      renderer!.render(scene, camera);
    }
    function tick(time: number) {
      frame = 0;
      if (disposed || document.hidden) return;
      try {
        accumulator = Math.min(accumulator + (previousTime ? (time - previousTime) / 1000 : 1 / 60), .05);
        previousTime = time;
        while (accumulator >= 1 / 120) {
          wave.step();
          accumulator -= 1 / 120;
        }
        render();
        if (wave.active()) schedule();
        else { previousTime = 0; accumulator = 0; }
      } catch {
        console.warn("Decorative motion stopped; using static banner.");
        dispose(); fail();
      }
    }
    function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(tick); }
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let previous: THREE.Vector3 | null = null;
    const pointer = (x: number, y: number) => {
      if (disposed) return;
      const bounds = host.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const start = previous ?? hit;
      const samples = Math.min(24, Math.max(1, Math.ceil(start.distanceTo(hit) / .2)));
      for (let sample = 1; sample <= samples; sample++) {
        const px = THREE.MathUtils.lerp(start.x, hit.x, sample / samples);
        const pz = THREE.MathUtils.lerp(start.z, hit.z, sample / samples);
        for (let i = 0; i < count; i++) {
          const dx = (i % columns - (columns - 1) / 2) * spacing - px;
          const dz = (Math.floor(i / columns) - (rows - 1) / 2) * spacing - pz;
          const distance = dx * dx + dz * dz;
          if (distance < 2) velocities[i] = Math.max(-3, velocities[i] - 2 * Math.exp(-distance * 2) / samples);
        }
      }
      previous = hit.clone();
      schedule();
    };
    observer = new ResizeObserver(() => { try { resize(); } catch { console.warn("Decorative graphics unavailable; using static banner."); dispose(); fail(); } });
    observer.observe(host);
    resize();
    // No idle impulses: the initial render remains static until real input arrives.
    return { pointer, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
