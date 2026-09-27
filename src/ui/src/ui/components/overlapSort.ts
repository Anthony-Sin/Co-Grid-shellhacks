import type { OverlapRecord } from '../../lib/api'

/** Client-side re-orderings for the ranked table. `rank` is the
 *  API/engine order itself — a row's #number stays the engine rank no
 *  matter which sort is on. Shared by OverlapPanel (sort seg) and
 *  OverlapTable (column headers). */
export type SortKey = 'rank' | 'distance' | 'window' | 'score' | 'savings'

export const SORT_OPTIONS: readonly { key: SortKey; label: string; hint: string }[] = [
  { key: 'rank', label: 'rank', hint: 'engine rank — tier, then distance' },
  { key: 'distance', label: 'dist', hint: 'closest first, farthest last' },
  { key: 'window', label: 'window', hint: 'shared/adjacent window start, earliest first' },
  { key: 'score', label: 'score', hint: 'highest score first' },
  { key: 'savings', label: 'save $', hint: 'highest est. savings first' },
]

export const SORT_LABELS: Record<SortKey, string> = {
  rank: 'rank', distance: 'distance', window: 'window start',
  score: 'score', savings: 'est. savings',
}

/** Row comparator — missing/non-finite keys always sort last; dir 1 asc, -1 desc. */
function byKey(get: (o: OverlapRecord) => number | null | undefined, dir: 1 | -1) {
  return (a: OverlapRecord, b: OverlapRecord): number => {
    const va = get(a)
    const vb = get(b)
    if (va == null || !Number.isFinite(va)) return vb == null || !Number.isFinite(vb) ? 0 : 1
    return vb == null || !Number.isFinite(vb) ? -1 : dir * (va - vb)
  }
}

export const SORTERS: Record<Exclude<SortKey, 'rank'>, (a: OverlapRecord, b: OverlapRecord) => number> = {
  distance: byKey((o) => o.min_distance_km, 1),
  window: byKey((o) => o.shared_window?.start ?? o.adjacent_window?.start, 1),
  score: byKey((o) => o.score, -1),
  savings: byKey((o) => o.cost?.est_savings_usd_high, -1),
}

/** Dense-table header cells — `sort` maps to a SortKey (click = sort);
 *  cells without one are static labels. Order = the .ovr grid columns. */
export const HEAD_CELLS: readonly {
  key: string; label: string; sort?: SortKey; hint?: string; right?: boolean
}[] = [
  { key: 'rank', label: '#', sort: 'rank', hint: 'sort by engine rank — tier, then distance' },
  { key: 'tier', label: 'tier', hint: 'coordination tier (see legend)' },
  { key: 'projects', label: 'projects', hint: 'the two overlapping filed projects' },
  { key: 'km', label: 'km', sort: 'distance', right: true, hint: 'sort by closest-point distance' },
  { key: 'window', label: 'window', sort: 'window', right: true, hint: 'sort by window start, earliest first' },
  { key: 'score', label: 'scr', sort: 'score', right: true, hint: 'sort by coordination score' },
]
