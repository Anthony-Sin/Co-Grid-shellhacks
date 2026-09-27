import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { TIER_COLORS } from '../../lib/palette'
import { sceneForZone } from '../../lib/projection'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { miniMapSvg, overlapMapSpec } from '../../lib/miniMap'
import { downloadHtml, overlapReportHtml } from '../../lib/report'
import { fmtLonLat, fmtUsd, safeFileName, voltageOf, yearsOf } from '../../lib/format'
import { ConfBadge, Kv, ScheduleStrip, SourceLine } from '../../lib/detailAtoms'
import { useAppStore } from '../../state/store'
import {
  deduped,
  useApiData,
  useImpact,
  useNearby,
  useOverlaps,
  useProjects,
} from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import type { GeoFeature, OverlapRecord, ProjectProps } from '../../lib/api'
import '../../styles/detail.css'

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
      <span className="proj-letter" style={{ background: utilityColor(project?.utility) }} aria-hidden>
        {side}
      </span>
      <div className="proj-info">
        <div className="proj-name" style={{ color: utilityColor(project?.utility) }}>
          {project?.name ?? projectId}
          {project?.utility ? <span className="proj-utility"> · {project.utility}</span> : null}
        </div>
        {project ? (
          <>
            <div className="proj-sub">
              {project.kind} · {voltageOf(project)} · {yearsOf(project)}
              {project.location_confidence ? (
                <ConfBadge c={project.location_confidence} />
              ) : null}
            </div>
            <SourceLine source={project.source} />
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
      {d.shared_corridor_km != null && (
        <Kv k="shared corridor" v={`${d.shared_corridor_km.toFixed(1)} km`} />
      )}
      {d.shared_row_acres != null && (
        <Kv k="shared ROW" v={`${d.shared_row_acres.toFixed(1)} acres`} />
      )}
      {d.shared_window_months != null && (
        <Kv k="shared window" v={`${d.shared_window_months} months`} />
      )}
      {d.crew_share_days != null && (
        <Kv k="crew-share window" v={`${d.crew_share_days} days`} />
      )}
      <Kv
        k="est. savings"
        v={
          r.low != null && r.high != null && r.high > 0
            ? `${fmtUsd(r.low)} – ${fmtUsd(r.high)}`
            : 'n/a'
        }
      />
      <p className="detail-basis">
        {r.basis} ({d.confidence})
      </p>
      {d.assumptions.length > 0 && (
        <details className="detail-basis">
          <summary>assumptions ({d.assumptions.length})</summary>
          {d.assumptions.map((x, i) => (
            <div key={i}>· {x}</div>
          ))}
        </details>
      )}
    </>
  )
}

/** Count of other overlap sites within crew range of this one — from
 * /api/analysis/nearby — plus jump chips for the nearest few so a shared
 * yard's neighbors are one click apart. Honest: nothing until data lands. */
function NearbyCount({ overlapId }: { overlapId: string }) {
  const nb = useNearby(overlapId, 15)
  if (nb.loading || nb.error || !nb.data) return null
  const n = nb.data.neighbor_count
  const neighbors = nb.data.neighbors.slice(0, 6)
  return (
    <>
      <Kv k="sites within 15 km" v={n === 0 ? 'none' : n} />
      {neighbors.length > 0 && (
        <div className="nb-chips">
          {neighbors.map((x) => (
            <button
              key={x.overlap_id}
              type="button"
              className="nb-chip mono"
              title={`tier ${x.tier} · ${x.distance_km.toFixed(1)} km away — jump to site`}
              onClick={() => selectOverlapInScene(x.overlap_id)}
            >
              {x.overlap_id}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function DetailBody({
  o,
  projectById,
  featureById,
  features,
}: {
  o: OverlapRecord
  projectById: Map<string, ProjectProps>
  featureById: Map<string, GeoFeature<ProjectProps>>
  features: GeoFeature<ProjectProps>[]
}) {
  const tierColor = TIER_COLORS[o.tier] ?? '#888888'
  // Tier 3–4 logistics records carry a zeroed cost struct — "$0–$0 / 0.0
  // acres" would be a lie, so land-savings kvs only render when real.
  const hasSavings = (o.cost?.est_savings_usd_high ?? 0) > 0
  // snapshot backdrops — state bounds + existing grid share the deduped
  // request cache ('state-bounds'/'basemap'), never refetched per card
  const states = useApiData('state-bounds', api.stateBounds)
  const basemap = useApiData('basemap', api.basemap)
  const fa = featureById.get(o.project_a)
  const fb = featureById.get(o.project_b)
  const snapSvg = useMemo(
    () =>
      miniMapSvg(
        overlapMapSpec(o, fa, fb, [], states.data, {
          allProjects: features,
          basemap: basemap.data,
        }),
      ),
    [o, fa, fb, features, states.data, basemap.data],
  )
  return (
    <>
      <p className="detail-expl">{o.explanation}</p>

      <div className="detail-section">
        <div className="detail-sec-title">Area snapshot</div>
        <div className="snap" dangerouslySetInnerHTML={{ __html: snapSvg }} />
      </div>

      <div className="detail-section">
        <div className="detail-sec-title">Projects</div>
        <ProjectLine side="A" projectId={o.project_a} project={projectById.get(o.project_a)} />
        <ProjectLine side="B" projectId={o.project_b} project={projectById.get(o.project_b)} />
      </div>

      <div className="detail-section">
        <div className="detail-sec-title">Schedule</div>
        <ScheduleStrip
          a={projectById.get(o.project_a)}
          b={projectById.get(o.project_b)}
          o={o}
          tierColor={tierColor}
        />
      </div>

      <div className="detail-section">
        <div className="detail-sec-title">Coordination value</div>
        <Kv k="closest distance" v={`${o.min_distance_km.toFixed(3)} km`} />
        <Kv k="region" v={o.zone?.replace(/_/g, ' ') ?? '—'} mono={false} />
        <Kv k="score" v={o.score.toFixed(1)} />
        <Kv
          k="shared window"
          mono={false}
          v={
            o.timeline_overlap && o.shared_window ? (
              <span className="chip-timeline mono">
                {o.shared_window.start}–{o.shared_window.end}
              </span>
            ) : o.timeline_adjacent && o.adjacent_window ? (
              <span className="chip-timeline is-adjacent mono" title="windows roll end-to-start — handoff, not concurrent">
                adjacent {o.adjacent_window.start}–{o.adjacent_window.end}
              </span>
            ) : (
              <span className="chip-timeline is-none">no overlap</span>
            )
          }
        />
        <NearbyCount overlapId={o.overlap_id} />
        {o.cost ? (
          <>
            {o.cost.shared_row_km > 0 && (
              <Kv k="shared corridor" v={`${o.cost.shared_row_km.toFixed(1)} km`} />
            )}
            {hasSavings ? (
              <>
                <Kv k="shared ROW" v={`${o.cost.shared_row_acres.toFixed(1)} acres`} />
                <Kv
                  k="est. savings"
                  v={`${fmtUsd(o.cost.est_savings_usd_low)} – ${fmtUsd(o.cost.est_savings_usd_high)}`}
                />
              </>
            ) : (
              <p className="detail-basis">
                crew/logistics coordination — no land savings quantified
              </p>
            )}
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
  const setAgentPromptDraft = useAppStore((s) => s.setAgentPromptDraft)
  const overlaps = useOverlaps()
  const projects = useProjects()
  const states = useApiData('state-bounds', api.stateBounds)
  const [copied, setCopied] = useState(false)
  const [reporting, setReporting] = useState(false)

  const { projectById, featureById, features } = useMemo(() => {
    const projectById = new Map<string, ProjectProps>()
    const featureById = new Map<string, GeoFeature<ProjectProps>>()
    const features = projects.data?.features ?? []
    for (const f of features) {
      featureById.set(f.properties.project_id, f)
      projectById.set(f.properties.project_id, f.properties)
    }
    return { projectById, featureById, features }
  }, [projects.data])

  /** Engine rank order = the raw /api/overlaps array order. */
  const orderedIds = useMemo(
    () => (overlaps.data?.overlaps ?? []).map((x) => x.overlap_id),
    [overlaps.data],
  )

  // Escape clears the selection (listener only lives while one exists).
  useEffect(() => {
    if (!selectedOverlapId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectOverlap(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedOverlapId, selectOverlap])

  if (!selectedOverlapId) return null

  const o = overlaps.data?.overlaps.find((x) => x.overlap_id === selectedOverlapId)
  const tierColor = o ? (TIER_COLORS[o.tier] ?? '#888888') : '#888888'
  const rank = orderedIds.indexOf(selectedOverlapId) + 1
  const total = overlaps.data?.total ?? orderedIds.length

  const flashCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const copyLink = () => {
    // deep link encodes the overlap's own scene — not whichever scene the
    // viewer happens to be in — so the link never opens the wrong corridor
    const url = `${window.location.origin}/?scene=${sceneForZone(o?.zone)}` +
      `&select=${selectedOverlapId}&panel=0`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(flashCopied).catch(() => {
        window.prompt('Copy link:', url)
      })
    } else {
      window.prompt('Copy link:', url)
    }
  }

  /** Export the self-contained HTML report. Neighbors (and the derived
   * impact estimate when the record carries no cost struct) come from the
   * same deduped request cache the card sections use — one fetch total. */
  const onReport = async () => {
    if (!o || reporting) return
    setReporting(true)
    try {
      const [neighbors, impact] = await Promise.all([
        deduped(`nearby:${o.overlap_id}:15`, () => api.nearby(o.overlap_id, 15)).catch(
          () => null,
        ),
        o.cost
          ? Promise.resolve(null)
          : deduped(`impact:${o.overlap_id}`, () => api.impact(o.overlap_id)).catch(
              () => null,
            ),
      ])
      downloadHtml(
        `co-grid-${safeFileName(o.overlap_id)}.html`,
        overlapReportHtml({
          o,
          projectById,
          featureById,
          features,
          states: states.data,
          neighbors,
          impact,
          rank,
          total,
        }),
      )
    } finally {
      setReporting(false)
    }
  }

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
        {rank > 0 && (
          <span className="detail-nav">
            <button
              type="button" className="detail-navbtn" disabled={rank <= 1}
              aria-label="Previous overlap by rank" title={rank > 1 ? `#${rank - 1}` : 'first'}
              onClick={() => selectOverlapInScene(orderedIds[rank - 2])}
            >‹</button>
            <span className="detail-rank mono" title="rank in the engine-ordered list">
              #{rank} of {total.toLocaleString('en-US')}
            </span>
            <button
              type="button" className="detail-navbtn" disabled={rank >= orderedIds.length}
              aria-label="Next overlap by rank" title={rank < orderedIds.length ? `#${rank + 1}` : 'last'}
              onClick={() => selectOverlapInScene(orderedIds[rank])}
            >›</button>
          </span>
        )}
        <button
          type="button"
          className="detail-share mono"
          aria-label="Copy link to this overlap"
          title="Copy a ?select= link — the same deep_link the agent hands back"
          onClick={copyLink}
        >
          {copied ? 'copied' : 'link'}
        </button>
        {o ? (
          <button
            type="button"
            className="detail-report mono"
            disabled={reporting}
            aria-label="Download a self-contained HTML report for this overlap"
            title="Download a self-contained HTML report — snapshot, filing table, schedule, ranked neighbors"
            onClick={onReport}
          >
            {reporting ? '…' : '⤓ report'}
          </button>
        ) : null}
        {o ? (
          <button
            type="button"
            className="detail-ask"
            aria-label="Ask the analyst about this overlap"
            title="Ask the analyst about this overlap"
            onClick={() =>
              setAgentPromptDraft(
                `Tell me about overlap ${o.overlap_id} — what can these two utilities share, and when?`,
              )
            }
          >
            ✦
          </button>
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
        <DetailBody
          o={o}
          projectById={projectById}
          featureById={featureById}
          features={features}
        />
      ) : (
        <p className="detail-expl">
          <code>{selectedOverlapId}</code> is not in the current /api/overlaps
          dataset.
        </p>
      )}
    </aside>
  )
}
