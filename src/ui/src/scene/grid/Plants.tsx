/**
 * Power plants (basemap existing_power_plant + projects kind=plant).
 *
 * Procedural compound at the plant's Point:
 *   - main block ~40x25x20m (silhouette #8A8F98)
 *   - signature element by fuel: NUC/WAT/unknown -> tapered cooling tower
 *     (#C9CDD3 ~35m); combustible fuels (NG, coal, oil, biomass...) ->
 *     slender ~48m stack; SUN -> low tilted panel rows
 *   - 1-2 small transformer boxes
 *   - PLANNED plants additionally get a utility-color accent stripe band
 *
 * Counts are small (~15-17 per scene) so compounds compose as groups —
 * no merging needed.
 */
import type { ScenePlant, SceneProject } from './gridData'
import { utilityColor } from './gridData'

const BLOCK_COLOR = '#8A8F98'
const TOWER_COLOR = '#C9CDD3'
const STACK_COLOR = '#B8BDC6'
const BOX_COLOR = '#5B6770'
const PANEL_COLOR = '#6E7680'

/** fuels that read as a smokestack silhouette rather than a cooling tower */
const STACK_FUELS = new Set(['NG', 'DFO', 'BIT', 'SUB', 'PC', 'RC', 'WDS', 'BLQ', 'LFG', 'OG'])
const TOWER_FUELS = new Set(['NUC', 'WAT'])

interface PlantSpec {
  x: number
  y: number
  fuel: string | null
  /** utility accent color (planned plants only) */
  accent?: string
}

function CoolingTower({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} castShadow>
      <cylinderGeometry args={[5.5, 8, 35, 10]} />
      <meshStandardMaterial color={TOWER_COLOR} roughness={1} flatShading />
    </mesh>
  )
}

function Stack({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} castShadow>
      <cylinderGeometry args={[2.2, 3.4, 48, 7]} />
      <meshStandardMaterial color={STACK_COLOR} roughness={1} flatShading />
    </mesh>
  )
}

/** low rows of tilted collector slabs for solar sites */
function SolarRows() {
  return (
    <group>
      {[-12, 0, 12].map((z) => (
        <mesh key={z} position={[0, 3, z]} rotation={[-0.32, 0, 0]} castShadow>
          <boxGeometry args={[46, 1.2, 9]} />
          <meshStandardMaterial color={PANEL_COLOR} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function PlantCompound({ spec }: { spec: PlantSpec }) {
  const fuel = (spec.fuel ?? '').toUpperCase()
  const solar = fuel === 'SUN'
  return (
    <group position={[spec.x, 0, -spec.y]}>
      {/* main block */}
      <mesh position={[0, 12.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[40, 25, 20]} />
        <meshStandardMaterial color={BLOCK_COLOR} roughness={1} flatShading />
      </mesh>
      {/* fuel-specific signature element */}
      {solar ? (
        <SolarRows />
      ) : STACK_FUELS.has(fuel) ? (
        <Stack position={[14, 24, 4]} />
      ) : (
        <CoolingTower position={[-14, 17.5, 5]} />
      )}
      {TOWER_FUELS.has(fuel) && <Stack position={[15, 20, -5]} />}
      {/* transformer boxes */}
      <mesh position={[12, 2.5, 13]} castShadow>
        <boxGeometry args={[2, 3, 4]} />
        <meshStandardMaterial color={BOX_COLOR} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[16.5, 2.5, 13]} castShadow>
        <boxGeometry args={[2, 3, 4]} />
        <meshStandardMaterial color={BOX_COLOR} roughness={0.9} flatShading />
      </mesh>
      {/* planned accent: utility-colored stripe band around the block */}
      {spec.accent && (
        <mesh position={[0, 21, 0]}>
          <boxGeometry args={[41, 2.4, 21]} />
          <meshStandardMaterial color={spec.accent} roughness={0.85} flatShading />
        </mesh>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */

export function ExistingPlants({ plants }: { plants: readonly ScenePlant[] }) {
  return (
    <group>
      {plants.map((p, i) => (
        <PlantCompound
          key={`${p.name}-${i}`}
          spec={{ x: p.x, y: p.y, fuel: p.fuel }}
        />
      ))}
    </group>
  )
}

/**
 * Infer a plant silhouette from the filing language (no fake data — just
 * picks which real compound shape to draw): combustion-turbine /
 * combined-cycle wording -> stack; nuclear/solar keywords -> tower/panels.
 */
function inferredFuel(p: SceneProject): string | null {
  const text = `${p.name}`.toLowerCase()
  if (text.includes('nuclear') || text.includes('vogtle')) return 'NUC'
  if (text.includes('solar') || text.includes('pv')) return 'SUN'
  if (
    text.includes('combined-cycle') ||
    text.includes('combined cycle') ||
    text.includes('combustion') ||
    text.includes('ct ') ||
    text.includes(' ct') ||
    text.includes('gas')
  )
    return 'NG'
  return null
}

export function PlannedPlants({ projects }: { projects: readonly SceneProject[] }) {
  return (
    <group>
      {projects.flatMap((p) =>
        p.points.map((pt, i) => (
          <PlantCompound
            key={`${p.id}-${i}`}
            spec={{
              x: pt[0],
              y: pt[1],
              fuel: inferredFuel(p),
              accent: utilityColor(p.utility),
            }}
          />
        )),
      )}
    </group>
  )
}
