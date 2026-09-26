/**
 * Transmission lines, two families:
 *
 *  PLANNED (projects.geojson, kind transmission_line/reconductor):
 *   - elevated wire ~30m up rendered as a constant-width drei <Line>;
 *     the wire sags ~8% parabolically inside every ~320m pylon span
 *   - endpoint_only routes are drawn straight + DASHED (route not filed)
 *   - instanced pylons every ~320m along the route, arms perpendicular
 *   - point-sited "line" projects (approximate) get a pylon + utility ring
 *
 *  EXISTING (basemap existing_transmission_line, hundreds of features):
 *   - flattened into TWO constant-width segment sets by voltage tier
 *     (<230kV faint, >=230kV stronger) — one draw call each
 *   - instanced pylons only on >=345kV corridors to keep counts sane
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { Anchor, SceneLine, SceneProject } from './gridData'
import { resampleLine, sagWirePoints, utilityColor } from './gridData'
import { Pylon, PylonInstances } from './Pylon'

const WIRE_H = 30 // planned conductor height (m)
const EXISTING_H = 22 // existing conductor height (m)
const PYLON_SPACING = 320 // between pylons on planned corridors (m)
const EXISTING_PYLON_SPACING = 520

const EXISTING_COLOR = '#6B7280'
const EXISTING_HEAVY_COLOR = '#59606B'
const EXISTING_PYLON_COLOR = '#5B5B63'

type V3 = [number, number, number]

/* ------------------------------------------------------------------ */
/* existing grid (dim, merged)                                         */
/* ------------------------------------------------------------------ */

export function ExistingLines({ lines }: { lines: readonly SceneLine[] }) {
  const { light, heavy, pylonAnchors } = useMemo(() => {
    const light: V3[] = []
    const heavy: V3[] = []
    const pylonAnchors: Anchor[] = []
    const cap2 = 40_000 * 40_000 // towers beyond the fog line aren't worth drawing
    for (const l of lines) {
      const dst = l.voltage >= 230 ? heavy : light
      const pts = l.points
      for (let i = 0; i + 1 < pts.length; i++) {
        dst.push([pts[i][0], EXISTING_H, -pts[i][1]])
        dst.push([pts[i + 1][0], EXISTING_H, -pts[i + 1][1]])
      }
      if (l.voltage >= 345)
        for (const a of resampleLine(pts, EXISTING_PYLON_SPACING))
          if (a.x * a.x + a.y * a.y <= cap2) pylonAnchors.push(a)
    }
    return { light, heavy, pylonAnchors }
  }, [lines])

  return (
    <group>
      {light.length > 0 && (
        <Line
          segments
          points={light}
          lineWidth={1.1}
          color={EXISTING_COLOR}
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      )}
      {heavy.length > 0 && (
        <Line
          segments
          points={heavy}
          lineWidth={2.2}
          color={EXISTING_HEAVY_COLOR}
          transparent
          opacity={0.65}
          depthWrite={false}
        />
      )}
      <PylonInstances anchors={pylonAnchors} color={EXISTING_PYLON_COLOR} scale={0.8} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* planned corridors (utility-colored, sagged)                          */
/* ------------------------------------------------------------------ */

interface PreparedLine {
  project: SceneProject
  /** per-part wire polylines (sagged or straight, already [x,y,z]) */
  wires: V3[][]
  /** all anchors across parts -> pylon placements */
  pylons: Anchor[]
  dashed: boolean
}

/** A single planned corridor: sagging wire + pylons. */
function PlannedCorridor({ prep }: { prep: PreparedLine }) {
  const color = utilityColor(prep.project.utility)
  return (
    <group>
      {prep.wires.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          lineWidth={3.5}
          color={color}
          dashed={prep.dashed}
          dashSize={70}
          gapSize={45}
          transparent
          opacity={0.95}
        />
      ))}
      <PylonInstances anchors={prep.pylons} />
    </group>
  )
}

/**
 * Point-sited line project (location_confidence 'approximate' — no filed
 * route): honest ground marker — one pylon + a soft utility-colored ring.
 */
function ApproximateLineSite({ project }: { project: SceneProject }) {
  const color = utilityColor(project.utility)
  return (
    <group>
      {project.points.map(([x, y], i) => (
        <group key={i} position={[x, 0, -y]}>
          <Pylon position={[0, 0, 0]} scale={0.9} color={color} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
            <ringGeometry args={[420, 480, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function PlannedLines({ projects }: { projects: readonly SceneProject[] }) {
  const prepared = useMemo<PreparedLine[]>(
    () =>
      projects.map((p) => {
        const dashed = p.confidence === 'endpoint_only'
        const partAnchors = p.lines.map((line) => resampleLine(line, PYLON_SPACING))
        const wires = partAnchors
          .filter((a) => a.length >= 2)
          .map((anchors) =>
            dashed
              ? anchors.map((a): V3 => [a.x, WIRE_H, -a.y])
              : sagWirePoints(anchors, WIRE_H),
          )
        return { project: p, wires, pylons: partAnchors.flat(), dashed }
      }),
    [projects],
  )

  return (
    <group>
      {prepared.map((prep) =>
        prep.project.lines.length > 0 ? (
          <PlannedCorridor key={prep.project.id} prep={prep} />
        ) : (
          <ApproximateLineSite key={prep.project.id} project={prep.project} />
        ),
      )}
    </group>
  )
}
