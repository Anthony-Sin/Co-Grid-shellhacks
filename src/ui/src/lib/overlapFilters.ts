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
