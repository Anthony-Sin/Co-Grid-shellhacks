import * as THREE from 'three'
import type { Vec2 } from '../lib/projection'

/** Closed THREE.Shape from a ring of local-meter points */
export function polygonShape(points: readonly Vec2[]): THREE.Shape {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  return shape
}

/**
 * Flat ribbon (a road, a river) as a THREE.Shape — a polyline expanded to
 * `width` by offsetting each point along its local perpendicular.
 * Miter joins are sufficient for our gentle map curves.
 */
export function ribbonShape(line: readonly Vec2[], width: number): THREE.Shape {
  const half = width / 2
  const left: Vec2[] = []
  const right: Vec2[] = []

  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    let dx = next[0] - prev[0]
    let dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const [px, py] = line[i]
    left.push([px - dy * half, py + dx * half])
    right.push([px + dy * half, py - dx * half])
  }

  return polygonShape([...left, ...right.reverse()])
}
