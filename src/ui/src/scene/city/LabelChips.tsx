import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { PALETTE } from '../../lib/palette'
import type { CityScene } from '../../lib/api'
import { LabelChip } from '../../ui/components/LabelChip'
import { ringCentroid } from './cityUtils'

/**
 * Floating dark pill chips over real named features.
 *
 * Primary source is `data.pois` — optional in the scene schema and currently
 * absent from both exported scenes. When it yields too few labels we top up
 * from named *buildings* — still 100% real OSM names, never fabricated.
 * Every chip sits on a thin ink leader line rising from the ground point.
 */

const POI_PRIORITY: Record<string, number> = {
  place: 4,
  place_city: 6,
  place_town: 4,
  place_suburb: 2,
  place_village: 1,
  historic: 3,
  tourism: 2,
  amenity: 1,
  natural: 2,
  waterway: 3,
  leisure: 1,
}
/** Fallback ranking for named buildings when POIs are sparse/absent. */
const BUILDING_PRIORITY: Record<string, number> = {
  civic: 4,
  church: 3,
  commercial: 2,
  industrial: 1,
  default: 1,
  residential: 0,
}
const MAX_LABELS = 14
const MAX_NAME_LEN = 26
const LEADER_H = 54
const CHIP_Y = 62

interface Label {
  key: string
  text: string
  x: number
  y: number
}

function pickLabels(data: CityScene): Label[] {
  const labels: Label[] = []
  const seen = new Set<string>()
  const push = (key: string, text: string, x: number, y: number) => {
    const dedupe = text.trim().toLowerCase()
    if (labels.length >= MAX_LABELS || seen.has(dedupe)) return
    seen.add(dedupe)
    labels.push({ key, text, x, y })
  }

  if (data.pois?.length) {
    const sorted = [...data.pois]
      .filter((p) => p.name && p.name.length < MAX_NAME_LEN)
      .sort(
        (a, b) =>
          (POI_PRIORITY[b.kind] ?? 0) - (POI_PRIORITY[a.kind] ?? 0) ||
          (b.pop ?? 0) - (a.pop ?? 0),
      )
    for (const p of sorted) push(`poi-${p.name}-${p.x}`, p.name, p.x, p.y)
  }

  // Top up from named buildings — real OSM `name` tags only.
  if (labels.length < MAX_LABELS) {
    const named = data.buildings
      .filter((b) => b.name && b.name.length < MAX_NAME_LEN)
      .sort(
        (a, b) =>
          (BUILDING_PRIORITY[b.kind] ?? 0) - (BUILDING_PRIORITY[a.kind] ?? 0) ||
          b.height - a.height,
      )
    for (const b of named) {
      if (labels.length >= MAX_LABELS) break
      const [cx, cy] = ringCentroid(b.footprint)
      push(`b-${b.id}`, b.name as string, cx, cy)
    }
  }

  return labels
}

export function LabelChips({ data }: { data: CityScene }) {
  const labels = useMemo(() => pickLabels(data), [data])

  return (
    <group>
      {labels.map((l) => (
        <group key={l.key} position={[l.x, 0, -l.y]}>
          {/* thin leader line from the ground point up to the chip */}
          <mesh position={[0, LEADER_H / 2, 0]}>
            <cylinderGeometry args={[0.9, 0.9, LEADER_H, 5]} />
            <meshBasicMaterial color={PALETTE.ink} transparent opacity={0.45} />
          </mesh>
          <Html
            position={[0, CHIP_Y, 0]}
            center
            zIndexRange={[30, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <LabelChip text={l.text} />
          </Html>
        </group>
      ))}
    </group>
  )
}
