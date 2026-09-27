import { useEffect, useMemo, useState } from 'react'
import { api, type MetaResponse } from '../../lib/api'
import { TIERS } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import { useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import { OverlapDetail } from './OverlapDetail'
import { ProjectDetail } from './ProjectDetail'

/**
 * Bottom-right rail: selected-overlap detail card docked above the legend.
 * The legend doubles as filter chrome — tier rows toggle `visibleTiers`
 * (mirroring the panel checkboxes), utility rows toggle `utilityFilter`
 * (dimmed = filtered out; empty filter = everything active). Counts are
 * real /api/projects feature counts; the sources fold lists artifact
 * build timestamps from /api/meta. Nothing fabricated.
 */
export function Legend() {
  const projects = useProjects()
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const toggleTier = useAppStore((s) => s.toggleTier)
  const utilityFilter = useAppStore((s) => s.utilityFilter)
  const toggleUtilityFilter = useAppStore((s) => s.toggleUtilityFilter)
  const clearUtilityFilter = useAppStore((s) => s.clearUtilityFilter)
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  // narrow viewports start collapsed — the open legend would cover the
  // left rail with no escape (QA: 430px had x161–416 painting over x0–334).
  // <860 keeps the right side free for the shifted map-tools card too.
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 859.98px)').matches,
  )

  // One-shot freshness fetch — artifact build dates for the sources fold.
  // On error we simply render no freshness line.
  useEffect(() => {
    let alive = true
    api
      .meta()
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const utilityCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of projects.data?.features ?? []) {
      const u = f.properties.utility || 'unknown'
      m.set(u, (m.get(u) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [projects.data])

  const metaLines = useMemo(
    () =>
      Object.entries(meta?.processed ?? {})
        .filter(([, m]) => Boolean(m?.built_utc))
        .sort(([a], [b]) => a.localeCompare(b)),
    [meta],
  )

  return (
    <div className="right-rail">
      {/* selections are store-exclusive — at most one detail card renders */}
      <OverlapDetail />
      <ProjectDetail />

      <div className={collapsed ? 'legend legend--collapsed' : 'legend'}>
        <button
          type="button"
          className="legend-fold"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? 'show the legend' : 'hide the legend'}
        >
          {collapsed ? '≡ legend' : '×'}
        </button>
        <div className="legend-title">Overlap tiers · click to filter</div>
        <ul className="legend-list">
          {TIERS.map((t) => {
            const on = visibleTiers[t.tier]
            return (
              <li key={t.tier}>
                <button
                  type="button"
                  className={`legend-toggle${on ? '' : ' is-off'}`}
                  onClick={() => toggleTier(t.tier)}
                  aria-pressed={on}
                  title={`${t.hint} — click to ${on ? 'hide' : 'show'}`}
                >
                  <span className="dot" style={{ background: t.color }} />
                  <span className="legend-label">{t.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="legend-title legend-title--sub">
          Utilities · click to filter
          {utilityFilter.length > 0 && (
            <button
              type="button"
              className="legend-reset"
              onClick={clearUtilityFilter}
              title="clear the utility filter"
            >
              reset
            </button>
          )}
        </div>
        <ul className="legend-list">
          {utilityCounts.length === 0 ? (
            <li className="legend-muted">
              {projects.loading ? 'loading…' : 'no project data'}
            </li>
          ) : (
            utilityCounts.map(([u, n]) => {
              const on = utilityFilter.length === 0 || utilityFilter.includes(u)
              return (
                <li key={u}>
                  <button
                    type="button"
                    className={`legend-toggle${on ? '' : ' is-off'}`}
                    onClick={() => toggleUtilityFilter(u)}
                    aria-pressed={on}
                    title={
                      utilityFilter.includes(u)
                        ? `${u} — click to remove from filter`
                        : `${u} — click to filter map + list`
                    }
                  >
                    <span className="dot" style={{ background: utilityColor(u) }} />
                    <span className="legend-label">{u}</span>
                    <span className="utility-count mono">{n}</span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <p className="legend-note" title="the ranked list holds every record">
          map renders top 40 zones · full list in panel
        </p>

        <details className="legend-sources">
          <summary>Data sources</summary>
          <p>HIFLD · OpenStreetMap · SCRTP/SERTP &amp; GA/SC PSC filings</p>
          {metaLines.map(([name, m]) => (
            <p key={name} className="legend-meta mono">
              {name} built {m.built_utc.slice(0, 10)}
            </p>
          ))}
        </details>
      </div>
    </div>
  )
}
