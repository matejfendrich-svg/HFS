// Spojení jednoduchých (neindexovaných) BufferGeometry do jedné — pro instancované stromy.
import * as THREE from 'three';

export function mergeNonIndexed(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  for (const name of attrs) {
    const arrays: Float32Array[] = [];
    let total = 0;
    for (const g of geoms) {
      const a = g.getAttribute(name);
      if (!a) continue;
      arrays.push(new Float32Array((a as THREE.BufferAttribute).array as Float32Array));
      total += (a as THREE.BufferAttribute).count;
    }
    if (arrays.length === 0) continue;
    const out = new Float32Array(total * (name === 'uv' ? 2 : 3));
    let offset = 0;
    for (const arr of arrays) {
      out.set(arr, offset);
      offset += arr.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, name === 'uv' ? 2 : 3));
  }
  return merged;
}

export function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}
