/**
 * Shared overlap-record predicates — consumed by BOTH the ranked list
 * (OverlapPanel) and the map layer (OverlapZones) so "what passes the
 * filters" can never diverge between surfaces (the kepler.gl rule:
 * filters apply to all layers).
 *
 * Semantics contract (kept honest per AGENTS.md §7):
 *   - tier / utility / zone / yearRange are HARD filters — excluded
 *     records vanish from list and map alike.
 *   - timelineOnly is SOFT on the map (non-matching records render as
 *     dashed outlines — context, not erasure) but HARD in the list —
 *     see OverlapZones outlineOnly flag vs the list predicate below.
 *
 * passesProjectFilters extends the same hard contract to a single planned
 * project (utility / zone / build-window / search) so the map's project
 * LINES obey the panel exactly like zones do — excluded = honest absence.
 */
import type { OverlapRecord } from './api'
import type { YearRange } from '../state/store'

export interface RecordFilters {
  visibleTiers: Record<number, boolean>
  zone?: string // substring match on rec.zone
  utilityFilter?: string[] // empty/undefined = all utilities
  yearRange?: YearRange | null
}

/** True when a record's shared OR adjacent window intersects the range.
 * Records with no window at all can't be placed in time → excluded
 * whenever a year filter is active (honest, never assumed). */
export function inYearRange(rec: OverlapRecord, yr: YearRange): boolean {
  const windows = [rec.shared_window, rec.adjacent_window]
  return windows.some(
    (w) => w != null && w.start <= yr.end && w.end >= yr.start,
  )
}

/** Hard-filter predicate — identical for list rows and rendered zones. */
export function passesHardFilters(
  rec: OverlapRecord,
  f: RecordFilters,
): boolean {
  if (!f.visibleTiers[rec.tier]) return false
  if (
    f.zone &&
    !(rec.zone || '').toLowerCase().includes(f.zone.toLowerCase())
  )
    return false
  if (
    f.utilityFilter &&
    f.utilityFilter.length > 0 &&
    !(rec.utilities || []).some((u) => f.utilityFilter!.includes(u))
  )
    return false
  if (f.yearRange && !inYearRange(rec, f.yearRange)) return false
  return true
}

/** List predicate — timelineOnly hides non-intersecting records. */
export function passesListFilters(
  rec: OverlapRecord,
  f: RecordFilters & { timelineOnly: boolean },
): boolean {
  if (!passesHardFilters(rec, f)) return false
  if (f.timelineOnly && !rec.timeline_overlap) return false
  return true
}

/** Map predicate — timelineOnly never hides (zones render outlineOnly). */
export function passesMapFilters(
  rec: OverlapRecord,
  f: RecordFilters,
): boolean {
  return passesHardFilters(rec, f)
}

/* ------------------------------------------------------------------ */
/* planned-project predicate (map lines / markers)                     */
/* ------------------------------------------------------------------ */

/** What the shared predicate needs from a planned project — satisfied by
 * SceneProject (projected scene rows) and ProjectProps (raw GeoJSON props
 * after renaming) alike. */
export interface ProjectShape {
  id: string
  name: string
  utility: string
  /** filed construction window — null when the filing omits a year */
  startYear: number | null
  endYear: number | null
  /** region-zone ids the filing assigns (matched like rec.zone) */
  zones?: readonly string[]
}

/** The same filter bag the record predicates take (all fields optional).
 * `visibleTiers` is a deliberate no-op for solo projects: tiers belong to
 * overlap PAIRS — a project has no tier of its own, and inventing one from
 * its neighbors would fork the list semantics. `timelineOnly` isn't part
 * of the bag either — see passesProjectFilters. */
export type ProjectFilters = Partial<RecordFilters> & {
  /** substring match on the `id name utility` haystack — the same fields
   * the panel's search index covers for each side of a record. */
  search?: string
}

/** True when a project's filed build window intersects the range. Same
 * honesty contract as inYearRange: no filed window → excluded whenever a
 * year filter is active (never assumed); a one-sided filing is open-ended
 * ("build by 2029" reaches every earlier year). */
export function projectInYearRange(p: ProjectShape, yr: YearRange): boolean {
  if (p.startYear == null && p.endYear == null) return false
  const start = p.startYear ?? Number.NEGATIVE_INFINITY
  const end = p.endYear ?? Number.POSITIVE_INFINITY
  return start <= yr.end && end >= yr.start
}

/** Hard map predicate for ONE planned project — the project-side analogue
 * of passesMapFilters: utility membership, region zone, build-window
 * intersection, and search text behave exactly as the list's row test.
 * A filtered-out project vanishes from the map entirely (honest absence).
 *
 * timelineOnly deliberately does NOT hide projects: on the map that flag
 * is SOFT (zones render outlineOnly rather than vanish), and a solo
 * project has no pair window to test — hiding its line would invent an
 * absence the filing doesn't state. */
export function passesProjectFilters(
  p: ProjectShape,
  f: ProjectFilters,
): boolean {
  if (
    f.utilityFilter &&
    f.utilityFilter.length > 0 &&
    !f.utilityFilter.includes(p.utility)
  )
    return false
  if (f.zone) {
    const z = f.zone.toLowerCase()
    if (!(p.zones ?? []).some((pz) => pz.toLowerCase().includes(z)))
      return false
  }
  if (f.yearRange && !projectInYearRange(p, f.yearRange)) return false
  const q = f.search?.trim().toLowerCase()
  if (q && !`${p.id} ${p.name} ${p.utility}`.toLowerCase().includes(q))
    return false
  return true
}

/** Data extent of filed windows — drives the year-range slider bounds.
 * Returns null when the dataset carries no window data at all. */
export function yearExtent(
  recs: OverlapRecord[],
): YearRange | null {
  let lo = Infinity
  let hi = -Infinity
  for (const r of recs) {
    for (const w of [r.shared_window, r.adjacent_window]) {
      if (!w) continue
      lo = Math.min(lo, w.start)
      hi = Math.max(hi, w.end)
    }
  }
  return lo === Infinity ? null : { start: lo, end: hi }
}
