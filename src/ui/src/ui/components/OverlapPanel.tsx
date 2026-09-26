import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { TIERS } from '../../lib/palette'
import { passesListFilters } from '../../lib/overlapFilters'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { useOverlaps, useProjects, useRegions } from '../hooks/useApiData'
import { OverlapRow, type ProjectMap } from './OverlapRow'
import { PanelStats } from './PanelStats'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'
import '../../styles/panel.css'

// max DOM rows in the ranked list — the engine order already surfaces
// the highest-value records first, so the cap never hides better data.
const MAX_LIST_ROWS = 200

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

/** Client-side re-orderings. `rank` is the API/engine order itself — the
 * row's #number stays the engine rank no matter which sort is on. */
type SortKey = 'rank' | 'distance' | 'window' | 'score' | 'savings'

const SORT_OPTIONS: readonly { key: SortKey; label: string; hint: string }[] = [
  { key: 'rank', label: 'rank', hint: 'engine rank — tier, then distance' },
  { key: 'distance', label: 'dist', hint: 'closest first, farthest last' },
  { key: 'window', label: 'window', hint: 'shared/adjacent window start, earliest first' },
  { key: 'score', label: 'score', hint: 'highest score first' },
  { key: 'savings', label: 'save $', hint: 'highest est. savings first' },
]
const SORT_LABELS: Record<SortKey, string> = {
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

const SORTERS: Record<Exclude<SortKey, 'rank'>, (a: OverlapRecord, b: OverlapRecord) => number> = {
  distance: byKey((o) => o.min_distance_km, 1),
  window: byKey((o) => o.shared_window?.start ?? o.adjacent_window?.start, 1),
  score: byKey((o) => o.score, -1),
  savings: byKey((o) => o.cost?.est_savings_usd_high, -1),
}

const Empty = ({ title, note }: { title: ReactNode; note: ReactNode }) => (
  <div className="empty-state">
    <strong>{title}</strong>
    <p>{note}</p>
  </div>
)

interface SegItem { key: string; label: string; hint: string; active: boolean; onClick: () => void }

/** One segmented pill row — used for both the presets row and the sort row. */
const Seg = ({ aria, items }: { aria: string; items: SegItem[] }) => (
  <div className="pnl-seg" role="group" aria-label={aria}>
    {items.map((p) => (
      <button key={p.key} type="button" title={p.hint} aria-pressed={p.active}
        className={cx('pnl-seg-btn', p.active && 'is-active')} onClick={p.onClick}>
        {p.label}
      </button>
    ))}
  </div>
)

/** Left panel: ranked REAL coordination opportunities from /api/overlaps
 * (engine order: tier asc, then distance). Filters share the map's
 * predicates (passesListFilters) — all states honest (AGENTS.md §7). */
export function OverlapPanel() {
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const toggleTier = useAppStore((s) => s.toggleTier)
  const timelineOnly = useAppStore((s) => s.timelineOnly)
  const setTimelineOnly = useAppStore((s) => s.setTimelineOnly)
  const panelOpen = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const hoveredOverlapId = useAppStore((s) => s.hoveredOverlapId)
  const setHoveredOverlap = useAppStore((s) => s.setHoveredOverlap)
  const utilityFilter = useAppStore((s) => s.utilityFilter)
  const toggleUtilityFilter = useAppStore((s) => s.toggleUtilityFilter)
  const clearUtilityFilter = useAppStore((s) => s.clearUtilityFilter)
  const yearFilter = useAppStore((s) => s.yearFilter)
  const setYearFilter = useAppStore((s) => s.setYearFilter)
  const setAgentPromptDraft = useAppStore((s) => s.setAgentPromptDraft)

  const overlaps = useOverlaps()
  const projects = useProjects()
  const regions = useRegions()
  const [zoneFilter, setZoneFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('rank')
  // adjacent is the OPPOSITE of timeline_only (they never intersect) —
  // the two flags are mutually exclusive
  const [adjacentOnly, setAdjacentOnly] = useState(false)
  // one-shot pin: "show anyway" pulls the selected record into `shown`
  // even when it lands past the MAX_LIST_ROWS cap
  const [forceRevealId, setForceRevealId] = useState<string | null>(null)
  const [cursor, setCursor] = useState(-1)
  const listRef = useRef<HTMLUListElement>(null)

  const projectById = useMemo<ProjectMap>(() => {
    const m = new Map<string, ProjectProps>()
    for (const f of projects.data?.features ?? []) m.set(f.properties.project_id, f.properties)
    return m
  }, [projects.data])

  const all = overlaps.data?.overlaps ?? []
  // rank = position in the API order (already tier asc, then distance asc)
  const rankById = useMemo(() => new Map(all.map((o, i) => [o.overlap_id, i + 1])), [all])
  const zones = regions.data?.zones ?? []
  const q = search.trim().toLowerCase() // '' disables the search predicate entirely

  // utilities present in /api/projects (the chip row), alpha-sorted,
  // each with its overlap count from the loaded set
  const utilities = useMemo(() => {
    const present = new Set<string>()
    for (const f of projects.data?.features ?? []) {
      if (f.properties.utility) present.add(f.properties.utility)
    }
    const counts = new Map<string, number>()
    for (const o of all) for (const u of o.utilities ?? []) {
      counts.set(u, (counts.get(u) ?? 0) + 1)
    }
    return [...present].sort().map((u) => ({ utility: u, n: counts.get(u) ?? 0 }))
  }, [projects.data, all])

  // lowercase haystack per record (overlap_id + both project ids/names +
  // utilities) — memoized per data load, not rebuilt per keystroke
  const searchIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of all) {
      const a = projectById.get(o.project_a)
      const b = projectById.get(o.project_b)
      const parts = [o.overlap_id, o.project_a, o.project_b, a?.name ?? '', b?.name ?? '']
      m.set(o.overlap_id, parts.concat(o.utilities ?? []).join(' ').toLowerCase())
    }
    return m
  }, [all, projectById])

  const filtered = useMemo(
    () =>
      all.filter(
        (o) =>
          passesListFilters(o, {
            visibleTiers, zone: zoneFilter, utilityFilter,
            yearRange: yearFilter, timelineOnly,
          }) &&
          (!adjacentOnly || (!!o.timeline_adjacent && !o.timeline_overlap)) &&
          (!q || (searchIndex.get(o.overlap_id) ?? '').includes(q)),
      ),
    [all, visibleTiers, zoneFilter, utilityFilter, yearFilter, timelineOnly, adjacentOnly, q, searchIndex],
  )

  const sorted = useMemo(
    () => (sort === 'rank' ? filtered : [...filtered].sort(SORTERS[sort])),
    [filtered, sort],
  )

  // cap the DOM, never hide the count; a pinned selection past the cap is
  // appended as one extra row so it can always scroll into view
  const shown = useMemo(() => {
    const capped = sorted.slice(0, MAX_LIST_ROWS)
    if (forceRevealId && !capped.some((o) => o.overlap_id === forceRevealId)) {
      const rec = sorted.find((o) => o.overlap_id === forceRevealId)
      if (rec) return [...capped, rec]
    }
    return capped
  }, [sorted, forceRevealId])

  const selectedRec = useMemo(
    () => (selectedOverlapId ? all.find((o) => o.overlap_id === selectedOverlapId) : undefined),
    [all, selectedOverlapId],
  )
  const selectedInShown = !!selectedOverlapId && shown.some((o) => o.overlap_id === selectedOverlapId)
  const showOutsideBanner = !!selectedRec && !selectedInShown && !overlaps.loading && !overlaps.error && all.length > 0
  const allTiersOn = TIERS.every((t) => visibleTiers[t.tier])

  const filtersModified =
    !allTiersOn || !timelineOnly || adjacentOnly || zoneFilter !== '' ||
    utilityFilter.length > 0 || yearFilter != null || q !== '' || sort !== 'rank'
  const allActive =
    allTiersOn && !timelineOnly && !adjacentOnly && zoneFilter === '' &&
    utilityFilter.length === 0 && yearFilter == null && q === ''
  const mustActive =
    visibleTiers[1] && !visibleTiers[2] && !visibleTiers[3] && !visibleTiers[4] &&
    timelineOnly && !adjacentOnly

  // /api/overlaps.csv shares the backend's filter_records() — emit only what
  // it can express: a single tier (a set can't), a single utility (ANY-match
  // of several has no equivalent), zone, timeline_only, adjacent_only.
  const csvHref = useMemo(() => {
    const p = new URLSearchParams()
    const enabled = TIERS.filter((t) => visibleTiers[t.tier])
    if (enabled.length === 1) p.set('tier', String(enabled[0].tier))
    if (zoneFilter) p.set('zone', zoneFilter)
    if (timelineOnly) p.set('timeline_only', 'true')
    if (adjacentOnly) p.set('adjacent_only', 'true')
    if (utilityFilter.length === 1) p.set('utility', utilityFilter[0])
    const qs = p.toString()
    return `/api/overlaps.csv${qs ? `?${qs}` : ''}`
  }, [visibleTiers, zoneFilter, timelineOnly, adjacentOnly, utilityFilter])

  const setTiersOnly = (keep: number | 'all') =>
    TIERS.forEach((t) => {
      const want = keep === 'all' || t.tier === keep
      if (visibleTiers[t.tier] !== want) toggleTier(t.tier)
    })
  const applyAll = () => {
    setTiersOnly('all')
    setTimelineOnly(false); setAdjacentOnly(false); setZoneFilter('')
    clearUtilityFilter(); setYearFilter(null); setSearch('')
  }
  const applyMustCoordinate = () => {
    setTiersOnly(1); setTimelineOnly(true); setAdjacentOnly(false)
  }
  const toggleHandoffs = () => {
    setAdjacentOnly(!adjacentOnly)
    if (!adjacentOnly) setTimelineOnly(false) // adjacent ⇄ overlap are exclusive
  }
  const onTimelineOnlyChange = (v: boolean) => {
    setTimelineOnly(v)
    if (v) setAdjacentOnly(false)
  }
  /** Back to the store's default state (all tiers on, timelineOnly on). */
  const resetFilters = () => {
    applyAll(); setTimelineOnly(true); setSort('rank')
  }
  /** "show anyway" — clear just enough filters for the selected record to
   * pass, then pin it in case it still lands past the DOM cap. */
  const revealSelected = () => {
    if (!selectedRec) return
    setSearch(''); setZoneFilter(''); clearUtilityFilter(); setYearFilter(null)
    if (!visibleTiers[selectedRec.tier]) toggleTier(selectedRec.tier)
    if (!selectedRec.timeline_overlap) setTimelineOnly(false)
    setAdjacentOnly(false)
    setForceRevealId(selectedRec.overlap_id)
  }

  /** Hand the CURRENT view to the analyst — encodes only the filters that
   * are actually set so the agent can reproduce the set with find_overlaps
   * + rollups instead of guessing a different slice (AGENTS.md §7). */
  const askAgentAboutView = () => {
    const f: string[] = []
    const onTiers = TIERS.filter((t) => visibleTiers[t.tier]).map((t) => t.tier)
    if (onTiers.length < TIERS.length) f.push(`tiers=${onTiers.join(',')}`)
    if (zoneFilter) f.push(`zone='${zoneFilter}'`)
    // list semantics: ANY selected utility passes — say so honestly
    if (utilityFilter.length === 1) f.push(`utility=${utilityFilter[0]}`)
    else if (utilityFilter.length > 1) f.push(`utility in (${utilityFilter.join(', ')})`)
    if (yearFilter) f.push(`window=${yearFilter.start}-${yearFilter.end}`)
    if (timelineOnly) f.push('timeline_only')
    if (adjacentOnly) f.push('adjacent_only')
    if (q) f.push(`search='${search.trim()}'`)
    let prompt =
      `Analyze the currently filtered coordination set — ${filtered.length} of ${all.length} records` +
      `; filters: ${f.length > 0 ? f.join(', ') : 'none'}. ` +
      'Use find_overlaps with matching filters + savings_rollup/zone_report as needed; ' +
      'summarize what coordination stands out.'
    if (selectedOverlapId) prompt += ` Focus on selected overlap ${selectedOverlapId} if relevant.`
    setAgentPromptDraft(prompt)
  }

  const presets: SegItem[] = [
    { key: 'all', label: 'all', active: allActive, onClick: applyAll, hint: 'Clear every filter — show all records' },
    { key: 'must', label: 'must coord.', active: mustActive, onClick: applyMustCoordinate, hint: 'Tier 1 touching + concurrent build windows' },
    { key: 'handoffs', label: 'handoffs', active: adjacentOnly, onClick: toggleHandoffs, hint: 'Adjacent build windows — crews hand off site-to-site' },
  ]
  const sortItems: SegItem[] = SORT_OPTIONS.map((s) => ({
    ...s, active: sort === s.key, onClick: () => setSort(s.key),
  }))

  // the reveal pin is a one-shot — it must not outlive its selection
  useEffect(() => setForceRevealId(null), [selectedOverlapId])

  // selection reveal — record already in the DOM, scroll it into view
  useEffect(() => {
    if (!selectedOverlapId || !selectedInShown || !panelOpen) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-ovid="${CSS.escape(selectedOverlapId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedOverlapId, selectedInShown, panelOpen])

  // keep the keyboard cursor inside the displayed range
  useEffect(() => { if (cursor >= shown.length) setCursor(shown.length - 1) }, [cursor, shown.length])

  // j/k + arrows walk the displayed order, Enter toggles, Escape backs out.
  // Inputs/selects/textareas keep their keys (typing 'j' in search, etc.).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!panelOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (!t || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' || t.isContentEditable) return
      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        if (shown.length === 0) return
        e.preventDefault()
        const next = e.key === 'j' || e.key === 'ArrowDown'
          ? Math.min(cursor + 1, shown.length - 1)
          : Math.max(cursor - 1, 0)
        setCursor(next)
        listRef.current?.querySelectorAll<HTMLElement>('.overlap-row')[next]?.focus()
      } else if (e.key === 'Enter') {
        if (cursor < 0 || cursor >= shown.length) return
        // a focused row/control handles its own Enter natively — toggling
        // manually here would double-fire alongside that click
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && ae.closest('button, a, input, select, textarea')) return
        e.preventDefault()
        const rec = shown[cursor]
        selectOverlapInScene(
          selectedOverlapId === rec.overlap_id ? null : rec.overlap_id,
          rec.zone,
        )
      } else if (e.key === 'Escape') {
        if (selectedOverlapId) selectOverlap(null)
        else setPanelOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen, shown, cursor, selectedOverlapId, selectOverlap, setPanelOpen])

  if (!panelOpen) {
    return (
      <button type="button" className="panel-reopen" aria-label="Open coordination opportunities panel"
        onClick={() => setPanelOpen(true)}>overlaps&nbsp;»</button>
    )
  }

  let body: ReactNode
  if (overlaps.loading) {
    body = <Empty title="Loading overlaps…" note="Fetching ranked opportunities from /api/overlaps." />
  } else if (overlaps.error) {
    body = <Empty title="backend offline — start uvicorn :8000" note={<code>{overlaps.error}</code>} />
  } else if (all.length === 0) {
    body = <Empty title="0 overlaps found" note="The spatial engine found no project pairs within 40 km in the current dataset." />
  } else {
    body = (
      <>
        <PanelStats records={filtered} total={all.length} onAskAgent={askAgentAboutView} />
        {showOutsideBanner && (
          <div className="pnl-banner" role="status">
            <span><span className="mono">{selectedOverlapId}</span> selected — outside current filters</span>
            <button type="button" className="pnl-banner-btn" onClick={revealSelected}>show anyway</button>
          </div>
        )}
        <div className="panel-count mono">
          {q && `${filtered.length} match${filtered.length === 1 ? '' : 'es'} · `}
          {filtered.length > MAX_LIST_ROWS
            ? `top ${shown.length} of ${filtered.length}${q ? ' shown' : ` (${all.length} total)`}`
            : `${shown.length} of ${all.length} shown`}
          {sort !== 'rank' && ` · by ${SORT_LABELS[sort]}`}
        </div>
        {shown.length === 0 ? (
          <Empty
            title={q ? `0 matches for '${search.trim()}'.` : `All ${all.length} overlaps filtered out.`}
            note={q ? 'Clear the search or broaden the filters above.'
                    : 'Re-enable a tier above or turn off the timeline filter.'}
          />
        ) : (
          <ul className="overlap-list" ref={listRef}>
            {shown.map((o) => (
              <OverlapRow key={o.overlap_id} overlap={o} projectById={projectById}
                rank={rankById.get(o.overlap_id) ?? 0}
                selected={selectedOverlapId === o.overlap_id}
                hovered={hoveredOverlapId === o.overlap_id}
                onHover={setHoveredOverlap}
                onSelect={() =>
                  selectOverlapInScene(
                    selectedOverlapId === o.overlap_id ? null : o.overlap_id,
                    o.zone,
                  )
                } />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Coordination opportunities</h2>
        <div className="pnl-head-actions">
          <a className="pnl-csv mono" href={csvHref} download title="Download filtered results as CSV">csv</a>
          <button type="button" className="panel-collapse" onClick={() => setPanelOpen(false)} aria-label="Collapse panel">×</button>
        </div>
      </div>

      <div className="panel-filters">
        <input type="search" className="pnl-search" value={search}
          placeholder="search id, project, utility…"
          aria-label="Search overlaps by id, project, or utility"
          onChange={(e) => setSearch(e.target.value)} />

        <Seg aria="Filter presets" items={presets} />

        {TIERS.map((t) => (
          <label key={t.tier} className="filter-row" title={t.hint}>
            <input type="checkbox" checked={visibleTiers[t.tier]} onChange={() => toggleTier(t.tier)} />
            <span className="dot" style={{ background: t.color }} />
            <span className="filter-label">{t.label}</span>
          </label>
        ))}

        <label className="filter-row filter-row--timeline">
          <input type="checkbox" checked={timelineOnly} onChange={(e) => onTimelineOnlyChange(e.target.checked)} />
          <span className="filter-label">Timeline overlap only</span>
        </label>

        {utilities.length > 0 && (
          <div className="pnl-utils" role="group" aria-label="Filter by utility">
            {utilities.map(({ utility, n }) => (
              <button key={utility} type="button" aria-pressed={utilityFilter.includes(utility)}
                className={cx('pnl-chip', utilityFilter.includes(utility) && 'is-active')}
                title={`${n} overlap${n === 1 ? '' : 's'} involve ${utility}`}
                onClick={() => toggleUtilityFilter(utility)}>
                <span className="dot" style={{ background: utilityColor(utility) }} />
                {utility}
                <span className="pnl-chip-n mono">{n}</span>
              </button>
            ))}
            {utilityFilter.length > 0 && (
              <button type="button" className="pnl-chip pnl-chip--clear" onClick={clearUtilityFilter}
                aria-label="Clear utility filter" title="Clear utility filter">×</button>
            )}
          </div>
        )}

        {zones.length > 0 && (
          <label className="filter-row filter-row--zone">
            <span className="filter-label">Region</span>
            <select className="zone-select" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
              <option value="">All regions</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.id.replace(/_/g, ' ')} ({z.overlaps})</option>)}
            </select>
          </label>
        )}

        <div className="pnl-sort">
          <span className="pnl-label">sort</span>
          <Seg aria="Sort order" items={sortItems} />
        </div>

        {(yearFilter || filtersModified) && (
          <div className="pnl-active-row">
            {yearFilter && (
              <span className="pnl-chip pnl-chip--static mono">window {yearFilter.start}–{yearFilter.end}
                <button type="button" className="pnl-chip-x" onClick={() => setYearFilter(null)}
                  aria-label="Clear year window filter" title="Clear year window filter">×</button>
              </span>
            )}
            {filtersModified && <button type="button" className="pnl-reset" onClick={resetFilters}>reset filters</button>}
          </div>
        )}

        <div className="pnl-keys mono">j/k move · enter select · esc back</div>
      </div>

      <div className="panel-body">{body}</div>
    </aside>
  )
}
