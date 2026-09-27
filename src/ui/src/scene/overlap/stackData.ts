/**
 * Overlap "stacks" — records whose midpoints sit on top of each other
 * (several filed overlaps share a corridor crossing or a yard site).
 * Individually they would all fight for the same screen spot; instead the
 * group renders as one `Σ N` chip, and clicking it opens a real list of
 * every member — plus a "+N more — zoom in" affordance that flies the
 * camera in so the members separate visually.
 *
 * Pure view-state grouping: every member is a real rendered record, the
 * count is honest (AGENTS.md §7 — nothing is merged or invented).
 */
import type { Vec2 } from '../../lib/projection'
import type { Tier } from '../../lib/api'
import type { ZoneDatum } from './zoneData'

/** Midpoints closer than this collapse into one stack chip. Two radii:
 *  collisions are a SCREEN-space problem, so the radius tracks the
 *  camera — at statewide zoom (~0.0022) 44px ≈ 18km of world; at corridor
 *  zoom (≥0.05) a tight 2.5km keeps only genuinely coincident records. */
export const STACK_RADIUS_FAR_M = 24_000
export const STACK_RADIUS_NEAR_M = 2_500
/** Popup rows shown before the "+N more" footer kicks in. */
export const STACK_VISIBLE = 6

export interface OverlapStack {
  /** Stable-ish key: best (lowest) overlap id in the stack. */
  key: string
  /** Stack centroid in scene-local meters. */
  centroid: Vec2
  /** All member datums, best score first. */
  members: ZoneDatum[]
  /** Most severe tier among members (drives the chip accent color). */
  bestTier: Tier
}

export function buildStacks(datums: ZoneDatum[], radiusM = STACK_RADIUS_FAR_M): OverlapStack[] {
  // union-find over proximity pairs — O(n²) is fine at ≤MAX_RENDERED=200
  const parent = datums.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const r2 = radiusM * radiusM
  for (let i = 0; i < datums.length; i++) {
    for (let j = i + 1; j < datums.length; j++) {
      const dx = datums[i].midLocal[0] - datums[j].midLocal[0]
      const dy = datums[i].midLocal[1] - datums[j].midLocal[1]
      if (dx * dx + dy * dy <= r2) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, ZoneDatum[]>()
  for (let i = 0; i < datums.length; i++) {
    const root = find(i)
    const g = groups.get(root)
    if (g) g.push(datums[i]); else groups.set(root, [datums[i]])
  }
  const stacks: OverlapStack[] = []
  for (const members of groups.values()) {
    members.sort((a, b) => b.rec.score - a.rec.score)
    const cx = members.reduce((s, m) => s + m.midLocal[0], 0) / members.length
    const cy = members.reduce((s, m) => s + m.midLocal[1], 0) / members.length
    stacks.push({
      key: members[0].rec.overlap_id,
      centroid: [cx, cy],
      members,
      bestTier: Math.min(...members.map((m) => m.rec.tier)) as Tier,
    })
  }
  // deterministic order for React keys / testing
  stacks.sort((a, b) => a.key.localeCompare(b.key))
  return stacks
}
