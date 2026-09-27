import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { TIER_COLORS } from '../../lib/palette'
import { buildWindow, humanize, safeFileName } from '../../lib/format'
import { ConfBadge, Kv, SourceLine } from '../../lib/detailAtoms'
import { miniMapSvg, projectMapSpec, projectPartnerIds } from '../../lib/miniMap'
import type { ZoneSpec } from '../../lib/miniMap'
import { downloadHtml, projectReportHtml } from '../../lib/report'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { useApiData, useOverlaps, useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import type { GeoFeature, ProjectProps } from '../../lib/api'
import '../../styles/detail.css'

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
  // snapshot backdrops — state bounds + existing grid share the deduped
  // request cache ('state-bounds'/'basemap'), never refetched per card
  const states = useApiData('state-bounds', api.stateBounds)
  const basemap = useApiData('basemap', api.basemap)
  const [reporting, setReporting] = useState(false)

  const { feature, featureById, features } = useMemo(() => {
    const featureById = new Map<string, GeoFeature<ProjectProps>>()
    const features = projects.data?.features ?? []
    for (const f of features) featureById.set(f.properties.project_id, f)
    const feature = selectedProjectId ? featureById.get(selectedProjectId) : undefined
    return { feature, featureById, features }
  }, [projects.data, selectedProjectId])
  const project = feature?.properties

  /** Coordination records touching this project — already engine-ranked
   * (the /api/overlaps array order IS the ranking). */
  const records = useMemo(() => {
    if (!selectedProjectId) return []
    return (overlaps.data?.overlaps ?? []).filter(
      (o) => o.project_a === selectedProjectId || o.project_b === selectedProjectId,
    )
  }, [overlaps.data, selectedProjectId])

  /** Mini-map snapshot — real-geography crop: this project emphasized in
   * its utility color, coordination partners in theirs, its overlaps'
   * zones as tier-colored overlays, and every filed line + existing-grid
   * work passing through the crop as ink context. */
  const snapSvg = useMemo(() => {
    if (!feature) return null
    const partnerIds = projectPartnerIds(records, feature.properties.project_id)
    const partners = [...partnerIds]
      .map((id) => featureById.get(id))
      .filter((f): f is GeoFeature<ProjectProps> => Boolean(f))
    const zones: ZoneSpec[] = records.flatMap((o) =>
      o.zone_geometry
        ? [{ geom: o.zone_geometry, color: TIER_COLORS[o.tier] ?? '#2B2B2B' }]
        : [],
    )
    return miniMapSvg(
      projectMapSpec(feature, partners, [], states.data, {
        allProjects: features,
        basemap: basemap.data,
        zones,
      }),
    )
  }, [feature, records, featureById, features, states.data, basemap.data])

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

  /** Lighter sibling of the overlap card's report — same self-contained
   * HTML file, scoped to this project + its coordination records. */
  const onReport = () => {
    if (!feature || reporting) return
    setReporting(true)
    try {
      downloadHtml(
        `co-grid-${safeFileName(selectedProjectId)}.html`,
        projectReportHtml({ feature, features, featureById, records, states: states.data }),
      )
    } finally {
      setReporting(false)
    }
  }

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
          {snapSvg ? (
            <div className="detail-section">
              <div className="detail-sec-title">Area snapshot</div>
              <div className="snap" dangerouslySetInnerHTML={{ __html: snapSvg }} />
            </div>
          ) : null}

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
              v={project.location_confidence ? (
                <ConfBadge c={project.location_confidence} />
              ) : (
                'not filed'
              )}
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
                {/* the whole ranked list as chips — scrolls past ~8 rows
                    rather than growing the card */}
                <div className="nb-chips pd-recs">
                  {records.map((o) => (
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
                </div>
              </>
            )}
          </div>

          <div className="detail-section pd-actions">
            <button
              type="button"
              className="pd-report mono"
              disabled={reporting}
              aria-label="Download a self-contained HTML report for this project"
              title="Download a self-contained HTML report — snapshot, filing, coordination records"
              onClick={onReport}
            >
              {reporting ? '…' : '⤓ report'}
            </button>
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
