import { useMemo } from 'react'
import { TIER_COLORS } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import { useImpact, useNearby, useOverlaps, useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'

/** Compact honest USD: $0, $400k, $1.2M */
function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`
  return `$${v}`
}

function fmtLonLat(p: [number, number]): string {
  return `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`
}

function yearsOf(p: ProjectProps | undefined): string {
  const s = p?.start_year
  const e = p?.end_year
  if (s == null && e == null) return 'years n/a'
  return `${s ?? '—'}–${e ?? '—'}`
}

function voltageOf(p: ProjectProps | undefined): string {
  return p?.voltage_kv != null ? `${p.voltage_kv} kV` : 'voltage n/a'
}

function ProjectLine({
  side,
  projectId,
  project,
}: {
  side: 'A' | 'B'
  projectId: string
  project: ProjectProps | undefined
}) {
  return (
    <div className="proj-row">
      <span
        className="proj-letter"
        style={{ background: utilityColor(project?.utility) }}
        aria-hidden
      >
        {side}
      </span>
      <div className="proj-info">
        <div className="proj-name" style={{ color: utilityColor(project?.utility) }}>
          {project?.name ?? projectId}
          {project?.utility ? (
            <span className="proj-utility"> · {project.utility}</span>
          ) : null}
        </div>
        {project ? (
          <>
            <div className="proj-sub">
              {project.kind} · {voltageOf(project)} · {yearsOf(project)}
            </div>
            <div className="proj-src">source: {project.source}</div>
          </>
        ) : (
          <div className="proj-sub">project_id not in /api/projects</div>
        )}
      </div>
    </div>
  )
}

/** Fallback when a record has no stored cost — the analysis API derives
 * shared-ROW acres / savings range from real geometry on demand, so every
 * overlap can show a rough estimate rather than a dead end. */
function ImpactFallback({ overlapId }: { overlapId: string }) {
  const imp = useImpact(overlapId)
  if (imp.loading) return <p className="detail-basis">Deriving estimate…</p>
  const d = imp.data
  if (imp.error || !d || !d.est_savings_usd_range) {
    return <p className="detail-basis">No cost estimate published for this pair.</p>
  }
  const r = d.est_savings_usd_range
  return (
    <>
      {d.shared_row_acres != null && (
        <div className="kv">
          <span className="k">shared ROW</span>
          <span className="v mono">{d.shared_row_acres.toFixed(1)} acres</span>
        </div>
      )}
      {d.crew_share_days != null && (
        <div className="kv">
          <span className="k">crew-share window</span>
          <span className="v mono">{d.crew_share_days} days</span>
        </div>
      )}
      <div className="kv">
        <span className="k">est. savings</span>
        <span className="v mono">
          {r.low != null && r.high != null
            ? `${fmtUsd(r.low)} – ${fmtUsd(r.high)}`
            : 'n/a'}
        </span>
      </div>
      <p className="detail-basis">{r.basis} ({d.confidence})</p>
    </>
  )
}

/** Count of other overlap sites within crew range of this one — from
 * /api/analysis/nearby. Honest: shows nothing until the count lands. */
function NearbyCount({ overlapId }: { overlapId: string }) {
  const nb = useNearby(overlapId, 15)
  if (nb.loading || nb.error || !nb.data) return null
  const n = nb.data.neighbor_count
  return (
    <div className="kv">
      <span className="k">sites within 15 km</span>
      <span className="v mono" title="other coordination sites a shared yard also reaches">
        {n === 0 ? 'none' : n}
      </span>
    </div>
  )
}

function DetailBody({
  o,
  projectById,
}: {
  o: OverlapRecord
  projectById: Map<string, ProjectProps>
}) {
  return (
    <>
      <p className="detail-expl">{o.explanation}</p>

      <div className="detail-section">
        <div className="detail-sec-title">Projects</div>
        <ProjectLine side="A" projectId={o.project_a} project={projectById.get(o.project_a)} />
        <ProjectLine side="B" projectId={o.project_b} project={projectById.get(o.project_b)} />
      </div>

      <div className="detail-section">
        <div className="detail-sec-title">Coordination value</div>
        <div className="kv">
          <span className="k">closest distance</span>
          <span className="v mono">{o.min_distance_km.toFixed(3)} km</span>
        </div>
        <div className="kv">
          <span className="k">region</span>
          <span className="v">{o.zone?.replace(/_/g, ' ') ?? '—'}</span>
        </div>
        <div className="kv">
          <span className="k">score</span>
          <span className="v mono">{o.score.toFixed(1)}</span>
        </div>
        <div className="kv">
          <span className="k">shared window</span>
          <span className="v">
            {o.timeline_overlap && o.shared_window ? (
              <span className="chip-timeline mono">
                {o.shared_window.start}–{o.shared_window.end}
              </span>
            ) : o.timeline_adjacent && o.adjacent_window ? (
              <span className="chip-timeline is-adjacent mono" title="windows roll end-to-start — handoff, not concurrent">
                adjacent {o.adjacent_window.start}–{o.adjacent_window.end}
              </span>
            ) : (
              <span className="chip-timeline is-none">no overlap</span>
            )}
          </span>
        </div>
        <NearbyCount overlapId={o.overlap_id} />
        {o.cost ? (
          <>
            <div className="kv">
              <span className="k">shared ROW</span>
              <span className="v mono">{o.cost.shared_row_acres.toFixed(1)} acres</span>
            </div>
            <div className="kv">
              <span className="k">est. savings</span>
              <span className="v mono">
                {fmtUsd(o.cost.est_savings_usd_low)} – {fmtUsd(o.cost.est_savings_usd_high)}
              </span>
            </div>
            <p className="detail-basis">{o.cost.basis}</p>
          </>
        ) : (
          <ImpactFallback overlapId={o.overlap_id} />
        )}
      </div>

      <div className="detail-section">
        <div className="detail-sec-title">Closest points (lon, lat)</div>
        <div className="coords mono">
          <div>A&nbsp;&nbsp;{fmtLonLat(o.closest_point_a)}</div>
          <div>B&nbsp;&nbsp;{fmtLonLat(o.closest_point_b)}</div>
        </div>
      </div>
    </>
  )
}

/**
 * Detail card for the selected overlap — docked above the Legend in the
 * bottom-right rail (rendered by Legend). All fields come straight from
 * /api/overlaps + /api/projects; nothing is fabricated.
 */
export function OverlapDetail() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const overlaps = useOverlaps()
  const projects = useProjects()

  const projectById = useMemo(() => {
    const m = new Map<string, ProjectProps>()
    for (const f of projects.data?.features ?? []) {
      m.set(f.properties.project_id, f.properties)
    }
    return m
  }, [projects.data])

  if (!selectedOverlapId) return null

  const o = overlaps.data?.overlaps.find((x) => x.overlap_id === selectedOverlapId)
  const tierColor = o ? (TIER_COLORS[o.tier] ?? '#888888') : '#888888'

  return (
    <aside className="overlap-detail" aria-label="Selected overlap detail">
      <div className="detail-head">
        <span className="detail-id mono">{selectedOverlapId}</span>
        {o ? (
          <span className="ov-tier">
            <span className="dot" style={{ background: tierColor }} />
            {o.tier_label}
          </span>
        ) : null}
        <button
          type="button"
          className="detail-close"
          onClick={() => selectOverlap(null)}
          aria-label="Clear selected overlap"
          title="Clear selection"
        >
          ×
        </button>
      </div>

      {overlaps.loading ? (
        <p className="detail-expl">Loading overlap detail…</p>
      ) : overlaps.error ? (
        <p className="detail-expl">backend offline — start uvicorn :8000</p>
      ) : o ? (
        <DetailBody o={o} projectById={projectById} />
      ) : (
        <p className="detail-expl">
          <code>{selectedOverlapId}</code> is not in the current /api/overlaps
          dataset.
        </p>
      )}
    </aside>
  )
}
