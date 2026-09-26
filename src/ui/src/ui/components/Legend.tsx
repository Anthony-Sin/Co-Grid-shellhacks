import { useMemo } from 'react'
import { TIERS } from '../../lib/palette'
import { useProjects } from '../hooks/useApiData'
import { utilityColor } from './utilityColors'
import { OverlapDetail } from './OverlapDetail'

/**
 * Bottom-right rail: selected-overlap detail card docked above the legend.
 * Legend shows distance tiers (DATA_SCHEMA §5), utility colors with real
 * /api/projects feature counts, and a collapsible data-source note.
 */
export function Legend() {
  const projects = useProjects()

  const utilityCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of projects.data?.features ?? []) {
      const u = f.properties.utility || 'unknown'
      m.set(u, (m.get(u) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [projects.data])

  return (
    <div className="right-rail">
      <OverlapDetail />

      <div className="legend">
        <div className="legend-title">Overlap tiers</div>
        <ul className="legend-list">
          {TIERS.map((t) => (
            <li key={t.tier}>
              <span className="dot" style={{ background: t.color }} />
              <span className="legend-label">{t.label}</span>
            </li>
          ))}
        </ul>

        <div className="legend-title legend-title--sub">Utilities</div>
        <ul className="legend-list">
          {utilityCounts.length === 0 ? (
            <li className="legend-muted">
              {projects.loading ? 'loading…' : 'no project data'}
            </li>
          ) : (
            utilityCounts.map(([u, n]) => (
              <li key={u}>
                <span className="dot" style={{ background: utilityColor(u) }} />
                <span className="legend-label">{u}</span>
                <span className="utility-count mono">{n}</span>
              </li>
            ))
          )}
        </ul>

        <details className="legend-sources">
          <summary>Data sources</summary>
          <p>HIFLD · OpenStreetMap · SCRTP/SERTP &amp; GA/SC PSC filings</p>
        </details>
      </div>
    </div>
  )
}
