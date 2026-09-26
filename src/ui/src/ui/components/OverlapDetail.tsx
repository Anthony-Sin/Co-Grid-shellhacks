import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { TIER_COLORS } from '../../lib/palette'
import { sceneForZone } from '../../lib/projection'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { useImpact, useNearby, useOverlaps, useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'
import '../../styles/detail.css'

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

/** Honest tooltip text for the filed location-confidence flag. */
const CONFIDENCE_TITLE: Record<string, string> = {
  verified: 'verified — geometry traced from a filed map/GIS exhibit',
  endpoint_only: 'endpoint_only — endpoints filed; the path between is approximate',
  approximate: 'approximate — filing describes an area, not a surveyed route',
}

/** Key/value row — mono numbers by default (chips/labels opt out). */
function Kv({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  )
}

/** Provenance line: filed sources are "url (note)" — link the domain,
 * keep the filing note verbatim underneath. Non-URL sources render raw. */
function SourceLine({ source }: { source: string }) {
  const m = source.match(/^https?:\/\/\S+/)
  if (!m) return <div className="proj-src">source: {source}</div>
  const url = m[0]
  const note = source.slice(url.length).trim()
  let domain = url
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* leave the raw URL as the link label */
  }
  return (
    <div className="proj-src">
      source:{' '}
      <a className="src-link" href={url} target="_blank" rel="noreferrer">{domain}</a>
      {note ? <div className="src-note">{note}</div> : null}
    </div>
  )
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
                <span
                  className={`conf-badge conf-badge--${project.location_confidence}`}
                  title={CONFIDENCE_TITLE[project.location_confidence] ?? 'filed location confidence'}
                >
                  {project.location_confidence}
                </span>
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

/** Mini-Gantt: filed build windows for both projects plus the shared (or
 * handoff) window on one padded year axis. Missing filed years render
 * honestly — no fabricated bars. */
function ScheduleStrip({ a, b, o, tierColor }: {
  a: ProjectProps | undefined
  b: ProjectProps | undefined
  o: OverlapRecord
  tierColor: string
}) {
  const win =
    o.timeline_overlap && o.shared_window
      ? { ...o.shared_window, adjacent: false }
      : o.timeline_adjacent && o.adjacent_window
        ? { ...o.adjacent_window, adjacent: true }
        : null
  const pts = [
    a?.start_year, a?.end_year, b?.start_year, b?.end_year, win?.start, win?.end,
  ].filter((y): y is number => typeof y === 'number')
  if (pts.length === 0) return <div className="gantt-empty">filed years n/a</div>
  const lo = Math.min(...pts) - 1
  const span = Math.max(1, Math.max(...pts) + 1 - lo)
  const px = (y: number) => `${(((y - lo) / span) * 100).toFixed(2)}%`
  const pw = (s: number, e: number) => `${Math.max(((e - s) / span) * 100, 1.5).toFixed(2)}%`
  const projBar = (p: ProjectProps | undefined, tag: string) => {
    const s = p?.start_year ?? p?.end_year
    const e = p?.end_year ?? p?.start_year
    if (s == null || e == null) return <span className="gantt-na">filed years n/a</span>
    return (
      <span
        className="gantt-bar"
        style={{ left: px(s), width: pw(s, e), background: utilityColor(p?.utility) }}
        title={`${tag} filed ${s}–${e}`}
      />
    )
  }
  const rows: { tag: string; bar: ReactNode }[] = [
    { tag: 'A', bar: projBar(a, 'project A') },
    { tag: 'B', bar: projBar(b, 'project B') },
    {
      tag: win?.adjacent ? '→' : '∩',
      bar: win ? (
        <span
          className={`gantt-bar gantt-bar--win${win.adjacent ? ' is-adjacent' : ''}`}
          style={{
            left: px(win.start), width: pw(win.start, win.end),
            ...(win.adjacent ? { borderColor: tierColor } : { background: tierColor }),
          }}
          title={
            win.adjacent
              ? `handoff window ${win.start}–${win.end} — not concurrent`
              : `shared build window ${win.start}–${win.end}`
          }
        />
      ) : (
        <span className="gantt-na">no shared window</span>
      ),
    },
  ]
  return (
    <div className="gantt" role="img" aria-label="filed build-window schedule">
      {rows.map((r) => (
        <div className="gantt-row" key={r.tag}>
          <span className="gantt-tag mono">{r.tag}</span>
          <div className="gantt-track">{r.bar}</div>
        </div>
      ))}
      <div className="gantt-axis mono">
        <span>{lo}</span>
        <span>{lo + span}</span>
      </div>
      {win?.adjacent && <div className="gantt-caption">handoff window — not concurrent</div>}
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
}: {
  o: OverlapRecord
  projectById: Map<string, ProjectProps>
}) {
  const tierColor = TIER_COLORS[o.tier] ?? '#888888'
  // Tier 3–4 logistics records carry a zeroed cost struct — "$0–$0 / 0.0
  // acres" would be a lie, so land-savings kvs only render when real.
  const hasSavings = (o.cost?.est_savings_usd_high ?? 0) > 0
  return (
    <>
      <p className="detail-expl">{o.explanation}</p>

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
  const [copied, setCopied] = useState(false)

  const projectById = useMemo(() => {
    const m = new Map<string, ProjectProps>()
    for (const f of projects.data?.features ?? []) {
      m.set(f.properties.project_id, f.properties)
    }
    return m
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
