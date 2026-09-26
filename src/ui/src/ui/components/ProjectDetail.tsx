import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { useOverlaps, useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import '../../styles/detail.css'

/** snake_case filing enums -> readable words ("transmission_line" -> "transmission line") */
function humanize(s: string | null | undefined): string {
  return (s ?? '').replace(/_/g, ' ').trim()
}

/** Honest tooltip text for the filed location-confidence flag.
 * (Mirrors OverlapDetail — private there, so the map lives here too.) */
const CONFIDENCE_TITLE: Record<string, string> = {
  verified: 'verified — geometry traced from a filed map/GIS exhibit',
  endpoint_only: 'endpoint_only — endpoints filed; the path between is approximate',
  approximate: 'approximate — filing describes an area, not a surveyed route',
}

/** Key/value row — mono numbers by default (chips/labels opt out).
 * Same shape as OverlapDetail's Kv. */
function Kv({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  )
}

/** Provenance line: filed sources are "url (note)" — link the domain,
 * keep the filing note verbatim underneath. Non-URL sources render raw.
 * (Copy of OverlapDetail's private SourceLine.) */
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

/** Filed build window — 'not filed' when the filing omits both years,
 * em-dash placeholder for a one-sided window. Never fabricates a year. */
function buildWindow(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return 'not filed'
  return `${start ?? '—'}–${end ?? '—'}`
}

/**
 * Detail card for the clicked project marker — docked above the Legend in
 * the bottom-right rail (rendered by Legend, exclusive with OverlapDetail
 * via store-level selection exclusivity). Every field comes straight from
 * /api/projects; missing values render as "not filed", never fabricated.
 */
export function ProjectDetail() {
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  const selectProject = useAppStore((s) => s.selectProject)
  const setAgentPromptDraft = useAppStore((s) => s.setAgentPromptDraft)
  const projects = useProjects()
  const overlaps = useOverlaps()

  const project = useMemo(() => {
    if (!selectedProjectId) return undefined
    return projects.data?.features.find(
      (f) => f.properties.project_id === selectedProjectId,
    )?.properties
  }, [projects.data, selectedProjectId])

  /** Coordination records touching this project — already engine-ranked
   * (the /api/overlaps array order IS the ranking). */
  const records = useMemo(() => {
    if (!selectedProjectId) return []
    return (overlaps.data?.overlaps ?? []).filter(
      (o) => o.project_a === selectedProjectId || o.project_b === selectedProjectId,
    )
  }, [overlaps.data, selectedProjectId])

  // Escape clears the selection (listener only lives while one exists).
  useEffect(() => {
    if (!selectedProjectId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectProject(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedProjectId, selectProject])

  if (!selectedProjectId) return null

  const color = utilityColor(project?.utility)
  const zones = (project?.zones ?? []).map(humanize).filter(Boolean)

  return (
    <aside className="overlap-detail project-detail" aria-label="Selected project detail">
      <div className="detail-head">
        <div className="pd-headtext">
          <span className="pd-name">{project?.name ?? selectedProjectId}</span>
          {project?.utility ? (
            <span className="ov-tier">
              <span className="dot" style={{ background: color }} />
              {project.utility}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="detail-close"
          onClick={() => selectProject(null)}
          aria-label="Clear selected project"
          title="Clear selection"
        >
          ×
        </button>
      </div>

      {projects.loading ? (
        <p className="detail-expl">Loading project detail…</p>
      ) : projects.error ? (
        <p className="detail-expl">backend offline — start uvicorn :8000</p>
      ) : project ? (
        <>
          <div className="detail-section">
            <div className="detail-sec-title">Filing</div>
            <Kv
              k="utility"
              mono={false}
              v={
                project.utility ? (
                  <span className="pd-util">
                    <span className="dot" style={{ background: color }} />
                    {project.utility}
                  </span>
                ) : (
                  'not filed'
                )
              }
            />
            <Kv k="kind" mono={false} v={humanize(project.kind) || 'not filed'} />
            <Kv
              k="voltage"
              v={project.voltage_kv != null ? `${project.voltage_kv} kV` : 'not filed'}
            />
            <Kv k="build window" v={buildWindow(project.start_year, project.end_year)} />
            <Kv k="status" mono={false} v={humanize(project.status) || 'not filed'} />
            <Kv k="region" mono={false} v={zones.length > 0 ? zones.join(', ') : 'not filed'} />
            <Kv
              k="location confidence"
              mono={false}
              v={
                project.location_confidence ? (
                  <span
                    className={`conf-badge conf-badge--${project.location_confidence}`}
                    title={
                      CONFIDENCE_TITLE[project.location_confidence] ??
                      'filed location confidence'
                    }
                  >
                    {project.location_confidence}
                  </span>
                ) : (
                  'not filed'
                )
              }
            />
            {project.source ? (
              <SourceLine source={project.source} />
            ) : (
              <div className="proj-src">source: not filed</div>
            )}
            {project.notes ? <p className="detail-basis">{project.notes}</p> : null}
          </div>

          <div className="detail-section">
            <div className="detail-sec-title">Coordination records</div>
            {overlaps.loading ? (
              <p className="detail-basis">loading…</p>
            ) : records.length === 0 ? (
              <p className="detail-basis">no coordination records filed for this project</p>
            ) : (
              <>
                <p className="detail-basis">
                  {records.length} coordination record{records.length === 1 ? '' : 's'}
                </p>
                <div className="nb-chips">
                  {records.slice(0, 4).map((o) => (
                    <button
                      key={o.overlap_id}
                      type="button"
                      className="nb-chip mono"
                      title={`${humanize(o.tier_label)} · ${o.min_distance_km.toFixed(1)} km — jump to overlap`}
                      onClick={() => selectOverlapInScene(o.overlap_id, o.zone)}
                    >
                      {o.overlap_id}
                    </button>
                  ))}
                  {records.length > 4 && (
                    <span className="pd-more">+{records.length - 4} more in the ranked list</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="detail-section pd-actions">
            <button
              type="button"
              className="pd-ask"
              aria-label="Ask the analyst about this project"
              title="Ask the analyst about this project"
              onClick={() =>
                setAgentPromptDraft(
                  `Tell me about project ${selectedProjectId} — overlaps, window, and what it could share.`,
                )
              }
            >
              ✦ ask agent
            </button>
          </div>
        </>
      ) : (
        <p className="detail-expl">
          <code>{selectedProjectId}</code> is not in the current /api/projects
          dataset.
        </p>
      )}
    </aside>
  )
}
