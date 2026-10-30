import { cp, mkdir } from 'node:fs/promises';
const out = new URL('./dist/vendor/', import.meta.url);
await mkdir(out, { recursive: true });
await cp(new URL('./node_modules/three/build/', import.meta.url), new URL('three/', out), { recursive: true });
await cp(new URL('./node_modules/three/examples/jsm/', import.meta.url), new URL('addons/', out), { recursive: true });
await cp(new URL('./node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', import.meta.url), new URL('vision_bundle.mjs', out));
await cp(new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('wasm/', out), { recursive: true });
console.log('Browser libraries copied locally.');
