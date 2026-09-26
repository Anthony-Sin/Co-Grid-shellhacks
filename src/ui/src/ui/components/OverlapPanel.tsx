import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { TIERS, TIER_COLORS } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import { useOverlaps, useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'

type ProjectMap = Map<string, ProjectProps>

/** Short honest distance: 0 → "touching", else 1-decimal km (exact value lives in the detail card). */
function fmtKm(km: number): string {
  if (km <= 0) return 'touching'
  return `${km.toFixed(1)} km`
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function OverlapRow({
  overlap: o,
  rank,
  selected,
  projectById,
  onSelect,
}: {
  overlap: OverlapRecord
  rank: number
  selected: boolean
  projectById: ProjectMap
  onSelect: () => void
}) {
  const a = projectById.get(o.project_a)
  const b = projectById.get(o.project_b)
  const tierColor = TIER_COLORS[o.tier] ?? '#888888'

  return (
    <li>
      <button
        type="button"
        className={`overlap-row${selected ? ' is-selected' : ''}`}
        onClick={onSelect}
        aria-pressed={selected}
        title={o.explanation}
      >
        <span className="ov-rank mono">#{rank}</span>
        <span className="ov-main">
          <span className="ov-tier">
            <span className="dot" style={{ background: tierColor }} />
            {o.tier_label}
          </span>
          <span className="ov-names">
            <span style={{ color: utilityColor(a?.utility) }}>{a?.name ?? o.project_a}</span>
            <span className="ov-swap" aria-hidden>
              ⇄
            </span>
            <span style={{ color: utilityColor(b?.utility) }}>{b?.name ?? o.project_b}</span>
          </span>
          <span className="ov-meta">
            {o.timeline_overlap && o.shared_window ? (
              <span className="chip-timeline mono">
                {o.shared_window.start}–{o.shared_window.end}
              </span>
            ) : (
              <span className="chip-timeline is-none">no overlap</span>
            )}
            <span className="score-bar" title={`score ${o.score}`}>
              <span
                className="score-fill"
                style={{ width: `${clampScore(o.score)}%`, background: tierColor }}
              />
            </span>
            <span className="score-num mono">{o.score.toFixed(0)}</span>
          </span>
        </span>
        <span className="ov-dist mono">{fmtKm(o.min_distance_km)}</span>
      </button>
    </li>
  )
}

/**
 * Left panel: ranked list of REAL coordination opportunities from
 * /api/overlaps (pre-ranked by the spatial engine: tier asc, then distance).
 * Client-side tier + timeline filters; all states honest (AGENTS.md §7).
 */
export function OverlapPanel() {
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const toggleTier = useAppStore((s) => s.toggleTier)
  const timelineOnly = useAppStore((s) => s.timelineOnly)
  const setTimelineOnly = useAppStore((s) => s.setTimelineOnly)
  const panelOpen = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)

  const overlaps = useOverlaps()
  const projects = useProjects()

  const projectById = useMemo<ProjectMap>(() => {
    const m = new Map<string, ProjectProps>()
    for (const f of projects.data?.features ?? []) {
      m.set(f.properties.project_id, f.properties)
    }
    return m
  }, [projects.data])

  const all = overlaps.data?.overlaps ?? []
  // Rank = position in the API order (already tier asc, then distance asc)
  const rankById = useMemo(
    () => new Map(all.map((o, i) => [o.overlap_id, i + 1])),
    [all],
  )
  const shown = all.filter(
    (o) => visibleTiers[o.tier] && (!timelineOnly || o.timeline_overlap),
  )

  if (!panelOpen) {
    return (
      <button
        type="button"
        className="panel-reopen"
        onClick={() => setPanelOpen(true)}
        aria-label="Open coordination opportunities panel"
      >
        overlaps&nbsp;»
      </button>
    )
  }

  let body: ReactNode
  if (overlaps.loading) {
    body = (
      <div className="empty-state">
        <strong>Loading overlaps…</strong>
        <p>Fetching ranked opportunities from /api/overlaps.</p>
      </div>
    )
  } else if (overlaps.error) {
    body = (
      <div className="empty-state">
        <strong>backend offline — start uvicorn :8000</strong>
        <p>
          <code>{overlaps.error}</code>
        </p>
      </div>
    )
  } else if (all.length === 0) {
    body = (
      <div className="empty-state">
        <strong>0 overlaps found</strong>
        <p>
          The spatial engine found no project pairs within 40 km in the current
          dataset.
        </p>
      </div>
    )
  } else {
    body = (
      <>
        <div className="panel-count mono">
          {shown.length} of {all.length} shown
        </div>
        {shown.length === 0 ? (
          <div className="empty-state">
            <strong>All {all.length} overlaps filtered out.</strong>
            <p>Re-enable a tier above or turn off the timeline filter.</p>
          </div>
        ) : (
          <ul className="overlap-list">
            {shown.map((o) => (
              <OverlapRow
                key={o.overlap_id}
                overlap={o}
                rank={rankById.get(o.overlap_id) ?? 0}
                selected={selectedOverlapId === o.overlap_id}
                projectById={projectById}
                onSelect={() => selectOverlap(selectedOverlapId === o.overlap_id ? null : o.overlap_id)}
              />
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
        <button
          type="button"
          className="panel-collapse"
          onClick={() => setPanelOpen(false)}
          aria-label="Collapse panel"
        >
          ×
        </button>
      </div>

      <div className="panel-filters">
        {TIERS.map((t) => (
          <label key={t.tier} className="filter-row" title={t.hint}>
            <input
              type="checkbox"
              checked={visibleTiers[t.tier]}
              onChange={() => toggleTier(t.tier)}
            />
            <span className="dot" style={{ background: t.color }} />
            <span className="filter-label">{t.label}</span>
          </label>
        ))}

        <label className="filter-row filter-row--timeline">
          <input
            type="checkbox"
            checked={timelineOnly}
            onChange={(e) => setTimelineOnly(e.target.checked)}
          />
          <span className="filter-label">Timeline overlap only</span>
        </label>
      </div>

      <div className="panel-body">{body}</div>
    </aside>
  )
}
