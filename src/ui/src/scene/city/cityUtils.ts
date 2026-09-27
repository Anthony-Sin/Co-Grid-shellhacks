import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Vec2 } from '../../lib/projection'

/**
 * Shared helpers for the real-OSM city layers (scene-local meters,
 * +y = north, rendered as -z world).
 */

/** Squared radius of the high-detail "core" around scene center: 13 km. */
export const CORE_RADIUS_SQ = 169e6

interface Disposable {
  dispose(): void
}

/**
 * Dispose three.js resources produced by a useMemo when they are replaced
 * or the layer unmounts. Disposing an object that is still referenced is
 * safe — three.js re-uploads buffers on the next draw — so this is
 * StrictMode double-effect safe.
 */
export function useDispose(target: Disposable | Disposable[] | null) {
  useEffect(
    () => () => {
      if (!target) return
      if (Array.isArray(target)) target.forEach((t) => t.dispose())
      else target.dispose()
    },
    [target],
  )
}

/**
 * The shadow map renders on demand only (autoUpdate=false in CityCanvas).
 * Callers poke this once when shadow-casting geometry has mounted/changed
 * so the one-shot bake picks it up — instead of re-baking every frame.
 */
export function useShadowRefresh(dep: unknown) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.shadowMap.needsUpdate = true
  }, [gl, dep])
}

/**
 * Boolean zoom threshold with hysteresis — reads camera.zoom inside
 * useFrame (cheap under frameloop="demand"; the callback only runs on
 * rendered frames) and flips a boolean when a threshold is crossed so
 * idle frames cost ~0. `show` above `at`, hides again below `at*ratio`.
 */
export function useZoomAtLeast(at: number, ratio = 0.75): boolean {
  const camera = useThree((s) => s.camera)
  const [on, setOn] = useState(
    () => 'zoom' in camera && (camera as { zoom: number }).zoom >= at,
  )
  useFrame(() => {
    const z = 'zoom' in camera ? (camera as { zoom: number }).zoom : 1
    setOn((v) => (v ? z >= at * ratio : z >= at))
  })
  return on
}

/** Absolute shoelace area of a ring in m² (winding-agnostic). */
export function ringArea(ring: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a) / 2
}

/** Even-odd point-in-ring test, local meters. */
export function pointInRing(x: number, y: number, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Centroid of a ring (mean of vertices — fine for label/inside-core tests). */
export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p[0]
    cy += p[1]
  }
  return [cx / ring.length, cy / ring.length]
}

/**
 * Normalize an OSM polygon ring for triangulation: drop a duplicated closing
 * point and reject rings that cannot form a visible polygon.
 * Returns null for degenerate input (< 3 distinct points or ~zero area).
 */
export function cleanRing(ring: readonly Vec2[], minArea = 1): Vec2[] | null {
  if (!ring || ring.length < 3) return null
  let pts = ring as Vec2[]
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    pts = ring.slice(0, -1) as Vec2[]
  }
  if (pts.length < 3 || ringArea(pts) < minArea) return null
  return pts
}

/** Remove consecutive duplicate points from a polyline (keeps endpoints). */
export function dedupeLine(line: readonly Vec2[]): Vec2[] {
  if (line.length === 0) return []
  const out: Vec2[] = [line[0] as Vec2]
  for (let i = 1; i < line.length; i++) {
    const p = line[i]
    const q = out[out.length - 1]
    if (p[0] !== q[0] || p[1] !== q[1]) out.push(p)
  }
  return out
}
