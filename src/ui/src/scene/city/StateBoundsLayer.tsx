import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { api } from '../../lib/api'
import type { FeatureCollection, StateBoundsProps } from '../../lib/api'
import { PALETTE } from '../../lib/palette'
import { lonLatToLocal, SCENE_CENTERS } from '../../lib/projection'
import type { SceneId, Vec2 } from '../../lib/projection'
import { useAppStore } from '../../state/store'
import { useApiData } from '../../ui/hooks/useApiData'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose } from './cityUtils'

/**
 * GA + SC state boundary — real Census 2024 500k cartographic polygons
 * (public domain, served as WGS84 GeoJSON by /api/state-bounds). The
 * thing that makes the map read as two defined states instead of roads
 * floating on blank paper.
 *
 * Two renders from ONE ring set (both projected lon/lat → scene-local
 * meters via the same lonLatToLocal every other layer uses):
 *
 *  1. LAND FILL — merged ShapeGeometry just above the shadow-catcher
 *     (y=0.05, under parks/water/roads). Flat mode only: the states get
 *     a solid warm-tan sheet and the surrounding paper stays blank —
 *     the web-map convention. In sketch mode the paper shows through
 *     instead (the sketch look wants no fills).
 *
 *  2. BORDER STROKE — screen-space lines via drei <Line segments> (real
 *     pixel widths; WebGL ignores lineWidth on plain LineSegments).
 *     Two stacked passes — a wide paper-tone halo casing then a thin
 *     firm ink rule, the classic cartographic boundary convention —
 *     drawn in BOTH modes at y≈0.18: above parks/water/minor roads,
 *     under major-road strokes and the data layer.
 *
 * Fetch failure renders nothing — honest absence, never a hand-drawn
 * fake border (AGENTS.md §7).
 */

/** Heights picked to sit inside the existing stack: parks ~0.10,
 *  water ~0.12, minor roads ~0.15, majors up to ~0.38. */
const FILL_Y = 0.05
const INK_Y = 0.18
/** Halo casing rides a hair below the ink rule. */
const HALO_LIFT = -0.012

type Pt3 = [number, number, number]

interface BuiltBounds {
  /** Merged land fill for all state polygons (null when nothing parses). */
  fill: THREE.ShapeGeometry | null
  /** Border segment endpoint pairs at INK_Y — [x,y,z] tuples for drei Line. */
  border: Pt3[]
  disposables: THREE.BufferGeometry[]
}

function buildBounds(
  fc: FeatureCollection<StateBoundsProps>,
  scene: SceneId,
): BuiltBounds {
  const center = SCENE_CENTERS[scene]
  const shapes: THREE.Shape[] = []
  const border: Pt3[] = []

  const pushRingStroke = (ring: readonly Vec2[]) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      border.push([a[0], INK_Y, -a[1]], [b[0], INK_Y, -b[1]])
    }
  }

  for (const f of fc.features) {
    const g = f.geometry
    // Pipeline emits Polygon features only; guard for MultiPolygon anyway —
    // nested rings normalize to the same [exterior, ...holes] loop below.
    const polys =
      g.type === 'Polygon'
        ? [g.coordinates as number[][][]]
        : g.type === 'MultiPolygon'
          ? (g.coordinates as number[][][][])
          : []
    for (const rings of polys) {
      if (!Array.isArray(rings) || !rings.length) continue
      const project = (ringLL: number[][]): Vec2[] | null =>
        cleanRing(ringLL.map(([lon, lat]) => lonLatToLocal(lon, lat, center)))

      const exterior = project(rings[0])
      if (!exterior) continue
      const shape = polygonShape(exterior)
      pushRingStroke(exterior)

      // Interior rings (holes) — Census 500k emits none, but real GeoJSON
      // semantics keep this correct if a future extract includes them.
      for (const holeLL of rings.slice(1)) {
        const hole = project(holeLL)
        if (!hole) continue
        shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
        pushRingStroke(hole)
      }
      shapes.push(shape)
    }
  }

  let fill: THREE.ShapeGeometry | null = null
  if (shapes.length) {
    fill = new THREE.ShapeGeometry(shapes)
    fill.rotateX(-Math.PI / 2) // +y north -> -z world
    fill.deleteAttribute('uv')
    fill.translate(0, FILL_Y, 0)
  }
  return { fill, border, disposables: fill ? [fill] : [] }
}

export function StateBoundsLayer({ flat }: { flat: boolean }) {
  const activeScene = useAppStore((s) => s.activeScene)
  const { data } = useApiData('state-bounds', api.stateBounds)

  // Rebuild only when the fetch lands or the scene (projection center)
  // changes — the toggle itself just mounts/unmounts the fill mesh.
  const built = useMemo(
    () => (data ? buildBounds(data, activeScene) : null),
    [data, activeScene],
  )
  useDispose(built?.disposables ?? null)

  if (!built) return null

  return (
    <group>
      {flat && built.fill ? (
        // meshBasicMaterial — flat mode wants the palette hex verbatim
        // (a lit StandardMaterial would shade the "flat" land fill with
        // the sun rig, drifting it ~40 lightness off the web-map read).
        <mesh geometry={built.fill}>
          <meshBasicMaterial color={PALETTE.flat.land} />
        </mesh>
      ) : null}
      {built.border.length > 1 && (
        // renderOrder 2: the transparent pass otherwise sorts equal-origin
        // objects by creation order, which would let the near-opaque water
        // fill (drawn later) wash out the rule wherever a water polygon
        // overlaps the boundary — the GA/SC line runs down the Savannah
        // River, so that's exactly where it must stay crisp. Still far
        // under the data layer (selection beacon = renderOrder 9).
        <>
          {/* wide soft casing — a lifted paper-tone halo under the rule */}
          <Line
            segments
            points={built.border}
            position={[0, HALO_LIFT, 0]}
            renderOrder={2}
            lineWidth={4.5}
            color={PALETTE.flat.borderHalo}
            transparent
            opacity={0.9}
            depthWrite={false}
          />
          {/* thin firm ink rule — crisp at every zoom (pixel width) */}
          <Line
            segments
            points={built.border}
            renderOrder={2}
            lineWidth={1.75}
            color={PALETTE.ink}
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </>
      )}
    </group>
  )
}
