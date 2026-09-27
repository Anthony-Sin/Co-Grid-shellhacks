/**
 * Copy builders for the overlaps panel — kept out of OverlapPanel.tsx
 * for the 500-line cap (AGENTS.md §1).
 */
import type { YearRange } from '../../state/store'

/** Name the filters that emptied the list — "all filtered out" alone was
 *  misleading when the timeframe slider was the actual culprit. */
export function emptyCauses(f: {
  allTiersOn: boolean
  yearFilter: YearRange | null
  timelineOnly: boolean
  adjacentOnly: boolean
  utilityFilter: string[]
  zoneFilter: string
}): string[] {
  const causes: string[] = []
  if (!f.allTiersOn) causes.push('a hidden tier')
  if (f.yearFilter) causes.push(`the ${f.yearFilter.start}–${f.yearFilter.end} timeframe`)
  if (f.timelineOnly) causes.push('the timeline-overlap filter')
  if (f.adjacentOnly) causes.push('the handoffs filter')
  if (f.utilityFilter.length) causes.push(`the ${f.utilityFilter.join(' + ')} filter`)
  if (f.zoneFilter) causes.push(`the ${f.zoneFilter} region`)
  return causes
}
