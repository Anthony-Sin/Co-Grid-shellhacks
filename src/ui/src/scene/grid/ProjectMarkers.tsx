/**
 * Floating label chips + hover hit-areas for EVERY planned project.
 *
 * Each project gets:
 *  - a drei <Html> chip ~90m over its geometry centroid — dark pill,
 *    name truncated to 30 chars, utility-colored dot. pointerEvents:none
 *    so chips never block map panning.
 *  - an invisible hit sphere at the centroid wired to the store:
 *    hover -> setHoveredProject(id), click -> selectOverlap(null)
 *    (clicks on empty project space just dismiss the overlap selection)
 */
import { useEffect } from 'react'
import { Html } from '@react-three/drei'
import { useAppStore } from '../../state/store'
import type { SceneProject } from './gridData'
import { utilityColor } from './gridData'

const CHIP_ALTITUDE = 90
const HIT_RADIUS = 150
/** Max text chips on the statewide scene — beyond this they overlap unreadably. */
const MAX_STATE_CHIPS = 28

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

export function ProjectMarkers({ projects }: { projects: readonly SceneProject[] }) {
  const setHoveredProject = useAppStore((s) => s.setHoveredProject)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const activeScene = useAppStore((s) => s.activeScene)

  // don't leave a stale hover behind when the layer remounts per scene
  useEffect(() => () => setHoveredProject(null), [setHoveredProject])

  // On the ~830km state scene one text chip per project collapses into
  // unreadable overlap; hit-spheres still cover every project and the
  // ranked panel lists them all. Corridor scenes show every chip.
  const chipIds =
    activeScene === 'state'
      ? new Set(projects.slice(0, MAX_STATE_CHIPS).map((p) => p.id))
      : null

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
              selectOverlap(null)
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
    </group>
  )
}
