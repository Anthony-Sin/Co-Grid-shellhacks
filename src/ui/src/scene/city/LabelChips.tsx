import { useMemo } from 'react'
import type { CityScene } from '../../lib/api'
import { LabelChip } from '../../ui/components/LabelChip'
import { LabelOverlay, type OverlayLabel } from '../labelOverlay'
import { ringCentroid } from './cityUtils'

/**
 * Floating dark pill chips over real named features — rendered by the
 * shared DOM label overlay (scene/labelOverlay.tsx), which keeps chips
 * mounted while their anchor is within ~1.2× the viewport and greedily
 * declutters overlapping screen positions in priority order.
 *
 * Primary source is `data.pois` — optional in the scene schema. When it
 * yields too few labels we top up from named *buildings* — still 100%
 * real OSM names, never fabricated. Every chip gets a thin ink leader
 * line down to its ground point (drawn by the overlay, same pass).
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
/** Candidate pool — the overlay's declutter + zoom cap pick the visible
 *  subset each frame, so a deep pool costs only hidden DOM nodes while a
 *  shallow one would starve local labels at city/street zoom (the global
 *  top-N is all big cities hundreds of km away). */
const MAX_LABELS = 48
const MAX_NAME_LEN = 26
/** Chip hover height (m) — the leader line spans chip → ground point. */
const CHIP_Y = 62

/**
 * On-screen chip cap by ortho zoom: a handful at statewide overview,
 * more as the view tightens (fewer anchors share the screen, and the
 * declutter alone can't keep a dense overview readable).
 */
const capForZoom = (zoom: number): number =>
  zoom >= 0.03 ? 20 : zoom >= 0.006 ? 12 : 6

interface Label extends OverlayLabel {
  text: string
}

function pickLabels(data: CityScene): Label[] {
  const labels: Label[] = []
  const seen = new Set<string>()
  const push = (key: string, text: string, x: number, y: number) => {
    const dedupe = text.trim().toLowerCase()
    if (labels.length >= MAX_LABELS || seen.has(dedupe)) return
    seen.add(dedupe)
    labels.push({ key, text, anchor: [x, CHIP_Y, -y], ground: [x, 0, -y] })
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
    <LabelOverlay
      labels={labels}
      maxVisible={capForZoom}
      margin={1.2}
      gap={4}
      render={(l) => <LabelChip text={l.text} />}
    />
  )
}
