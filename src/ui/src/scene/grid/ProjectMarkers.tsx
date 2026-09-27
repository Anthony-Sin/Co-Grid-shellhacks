/**
 * Floating label chips + hover hit-areas for EVERY planned project that
 * survives the panel filters (GridOverlay feeds the shared
 * passesProjectFilters-filtered set — excluded projects render nothing,
 * honest absence rather than a dimmed ghost).
 *
 * Each project gets:
 *  - a name chip ~90m over its geometry centroid via the shared DOM
 *    LabelOverlay (scene/labelOverlay.tsx) — dark pill, name truncated
 *    to 30 chars, utility-colored dot + ink leader line to the ground.
 *    The overlay owns screen-space declutter: candidates arrive in
 *    PRIORITY order (selected > hovered > highest filed voltage) and the
 *    overlay drops a chip when its measured box overlaps an already-
 *    placed one or the zoom-scaled cap is reached. `layers.labels`
 *    unmounts the whole chip overlay; hit spheres + tooltip stay live.
 *  - an invisible hit sphere at the centroid wired to the store:
 *    hover -> setHoveredProject(id), click -> selectProject(id)
 *    (opens the right-rail project detail card; store exclusivity also
 *    clears any selected overlap — zones keep priority via stopPropagation)
 *  - ONE hover tooltip chip (hoveredProjectId from the store) floating
 *    above the name chip with the filed kind/voltage/window details —
 *    rendered through a second single-slot LabelOverlay so it inherits
 *    the same honest screen geometry instead of drei's behind-camera
 *    heuristic; missing fields are omitted, never rendered as "undefined"
 */
import { useEffect, useMemo } from 'react'
import { PALETTE } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import { utilityColor as tooltipUtilityColor } from '../../ui/components/utilityColors'
import { LabelOverlay, type OverlayLabel } from '../labelOverlay'
import type { SceneProject } from './gridData'
import { utilityColor } from './gridData'

const CHIP_ALTITUDE = 90
/** Tooltip floats well above the always-on name chip so they don't stack. */
const TOOLTIP_ALTITUDE = 170
const HIT_RADIUS = 150

interface ProjectLabel extends OverlayLabel {
  project: SceneProject
}

/** Zoom-scaled chip cap for the overlay — the measured-box declutter does
 * the real culling; this is just the safety rail. ZERO project pills at
 * statewide overview (zoom < ~0.006): at that scale names are noise —
 * the city chips carry orientation and the lines tell the story. Pills
 * ramp in with zoom (region view ~8, city ~17, street up to 48). */
const chipCap = (zoom: number) =>
  zoom < 0.006 ? 0 : Math.min(48, 4 + Math.round((zoom - 0.006) * 300))

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
  const hoveredProjectId = useAppStore((s) => s.hoveredProjectId)
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  // `labels` gates name chips only — hit spheres and the hover tooltip
  // stay live (a deliberate hover still answers, like the zone layer's
  // contract that labels cascade to chips without hiding geometry).
  const showLabels = useAppStore((s) => s.layers.labels)

  // don't leave a stale hover behind when the layer remounts per scene
  useEffect(() => () => setHoveredProject(null), [setHoveredProject])

  /**
   * Overlay candidates in PRIORITY order — index 0 wins declutter ties:
   * selected > hovered > highest filed voltage, id as the stable
   * tiebreak. Every filtered project is a candidate; the overlay itself
   * decides which measured boxes fit (honest screen-space crowding —
   * nothing is pre-hidden in React state, just `visibility:hidden`ed).
   */
  const chipLabels = useMemo<ProjectLabel[]>(() => {
    const priority = (p: SceneProject) =>
      p.id === selectedProjectId ? 0 : p.id === hoveredProjectId ? 1 : 2
    return [...projects]
      .sort(
        (a, b) =>
          priority(a) - priority(b) ||
          b.voltageKv - a.voltageKv ||
          a.id.localeCompare(b.id),
      )
      .map((p) => ({
        key: p.id,
        project: p,
        anchor: [p.centroid[0], CHIP_ALTITUDE, -p.centroid[1]] as const,
        ground: [p.centroid[0], 0, -p.centroid[1]] as const,
      }))
  }, [projects, hoveredProjectId, selectedProjectId])

  // The one hovered project (hit spheres own the id) — may be filtered
  // out or absent from this scene's slice, in which case no tooltip
  // renders (honest, no crash).
  const tooltipLabels = useMemo<ProjectLabel[]>(() => {
    const p = projects.find((x) => x.id === hoveredProjectId)
    return p
      ? [
          {
            key: `tip-${p.id}`,
            project: p,
            anchor: [p.centroid[0], TOOLTIP_ALTITUDE, -p.centroid[1]] as const,
          },
        ]
      : []
  }, [projects, hoveredProjectId])

  return (
    <group>
      {projects.map((p) => (
        /* invisible hover/click target */
        <mesh
          key={p.id}
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
      ))}

      {/* name chips — shared DOM overlay owns projection + declutter;
          gated by the `labels` layer toggle */}
      {showLabels && (
        <LabelOverlay
          labels={chipLabels}
          maxVisible={chipCap}
          gap={8}
          render={(l) => <ProjectChip project={l.project} />}
        />
      )}

      {/* single hover tooltip — its own single-slot overlay so it always
          places (cap 1 = nothing else competes for the slot) */}
      <LabelOverlay
        labels={tooltipLabels}
        maxVisible={1}
        margin={1.5}
        render={(l) => <ProjectTooltip project={l.project} />}
      />
    </group>
  )
}
