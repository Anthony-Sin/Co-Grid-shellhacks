/**
 * Floating label chips + hover hit-areas for EVERY planned project.
 *
 * Each project gets:
 *  - a drei <Html> chip ~90m over its geometry centroid — dark pill,
 *    name truncated to 30 chars, utility-colored dot. pointerEvents:none
 *    so chips never block map panning.
 *  - an invisible hit sphere at the centroid wired to the store:
 *    hover -> setHoveredProject(id), click -> selectProject(id)
 *    (opens the right-rail project detail card; store exclusivity also
 *    clears any selected overlap — zones keep priority via stopPropagation)
 *  - ONE hover tooltip chip (hoveredProjectId from the store) floating
 *    above the name chip with the filed kind/voltage/window details —
 *    null-safe: missing fields are omitted, never rendered as "undefined"
 */
import { useEffect, useMemo } from 'react'
import { Html } from '@react-three/drei'
import { PALETTE } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import { utilityColor as tooltipUtilityColor } from '../../ui/components/utilityColors'
import type { SceneProject } from './gridData'
import { utilityColor } from './gridData'

const CHIP_ALTITUDE = 90
/** Tooltip floats well above the always-on name chip so they don't stack. */
const TOOLTIP_ALTITUDE = 170
const HIT_RADIUS = 150
/** Max text chips on the statewide scene — beyond this they overlap unreadably. */
const MAX_STATE_CHIPS = 14

function truncate(name: string, max = 30): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function ProjectChip({ project }: { project: SceneProject }) {
  const color = utilityColor(project.utility)
  return (
    <div className="label-chip">
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          alignSelf: 'center',
          flexShrink: 0,
          boxShadow: '0 0 0 2px rgba(255,255,255,0.15)',
        }}
      />
      <span className="label-chip-text">{truncate(project.name)}</span>
    </div>
  )
}

/**
 * Hover detail chip — the ConnectorLink pill restyled as a readout:
 * name (bold) / dot + `kind · voltage · window` / honesty sub-line when
 * the filing's location confidence isn't 'verified'. Every segment is
 * conditional so missing fields simply vanish (never "undefined").
 */
function ProjectTooltip({ project }: { project: SceneProject }) {
  const color = tooltipUtilityColor(project.utility)
  const years = [project.startYear, project.endYear]
    .filter((y): y is number => y != null)
    .join('–')
  const meta = [
    project.kind || null,
    project.voltageKv > 0 ? `${project.voltageKv} kV` : null,
    years || null,
  ]
    .filter(Boolean)
    .join(' · ')
  const confidence = project.confidence
  const showConfidence = !!confidence && confidence !== 'verified'

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 3,
        padding: '7px 14px',
        background: PALETTE.chipBg,
        color: PALETTE.chipText,
        borderLeft: `4px solid ${color}`,
        borderRadius: 999,
        boxShadow: '2px 3px 0 rgba(43, 43, 43, 0.25)',
        whiteSpace: 'nowrap',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span style={{ fontWeight: 800 }}>{truncate(project.name, 44)}</span>
      {(meta || project.utility) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {project.utility && (
            <span
              title={project.utility}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }}
            />
          )}
          {meta}
        </span>
      )}
      {showConfidence && (
        <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.72 }}>
          location: {confidence.replace(/_/g, ' ')}
        </span>
      )}
    </div>
  )
}

export function ProjectMarkers({ projects }: { projects: readonly SceneProject[] }) {
  const setHoveredProject = useAppStore((s) => s.setHoveredProject)
  const selectProject = useAppStore((s) => s.selectProject)
  const activeScene = useAppStore((s) => s.activeScene)
  const hoveredProjectId = useAppStore((s) => s.hoveredProjectId)

  // don't leave a stale hover behind when the layer remounts per scene
  useEffect(() => () => setHoveredProject(null), [setHoveredProject])

  // On the ~830km state scene one text chip per project collapses into
  // unreadable overlap; hit-spheres still cover every project and the
  // ranked panel lists them all. Corridor scenes show every chip.
  const chipIds =
    activeScene === 'state'
      ? new Set(projects.slice(0, MAX_STATE_CHIPS).map((p) => p.id))
      : null

  // The one hovered project (hit spheres own the id) — may be absent from
  // this scene's slice, in which case no tooltip renders (honest, no crash).
  const hovered = useMemo(
    () => projects.find((p) => p.id === hoveredProjectId) ?? null,
    [projects, hoveredProjectId],
  )

  return (
    <group>
      {projects.map((p) => (
        <group key={p.id}>
          {/* invisible hover/click target */}
          <mesh
            position={[p.centroid[0], 24, -p.centroid[1]]}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredProject(p.id)
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              // only clear if WE still own the hover — overlapping hit
              // spheres can fire out-of-order and clobber a newer hover
              if (useAppStore.getState().hoveredProjectId === p.id) {
                setHoveredProject(null)
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              selectProject(p.id)
            }}
          >
            <sphereGeometry args={[HIT_RADIUS, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* floating label chip */}
          {(!chipIds || chipIds.has(p.id)) && (
            <Html
              position={[p.centroid[0], CHIP_ALTITUDE, -p.centroid[1]]}
              center
              zIndexRange={[20, 0]}
              style={{ pointerEvents: 'none' }}
            >
              <ProjectChip project={p} />
            </Html>
          )}
        </group>
      ))}

      {/* single hover tooltip — non-interactive, floats above the name chip */}
      {hovered && (
        <Html
          position={[hovered.centroid[0], TOOLTIP_ALTITUDE, -hovered.centroid[1]]}
          center
          zIndexRange={[70, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <ProjectTooltip project={hovered} />
        </Html>
      )}
    </group>
  )
}
