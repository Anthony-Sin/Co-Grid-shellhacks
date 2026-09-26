import { useMemo } from 'react'
import { useAppStore } from '../../state/store'
import { useApiData, useStats } from '../hooks/useApiData'
import { api } from '../../lib/api'
import type { SceneId } from '../../lib/projection'

const SCENES: { id: SceneId; label: string; sub: string }[] = [
  { id: 'state', label: 'GA + SC', sub: 'Georgia + South Carolina' },
  { id: 'savannah', label: 'Savannah', sub: 'Savannah River Corridor' },
  { id: 'augusta', label: 'Augusta', sub: 'Augusta / Central Savannah River' },
]

const fmtInt = (n: number): string => n.toLocaleString('en-US')

/** Compact planning-level USD for the KPI pill — $29.8M / $85.4M / $450k. */
function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(Math.round((n / 1e6) * 10) / 10).toString()}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}

/** Separator dot between stat segments (flex child of the pill). */
function Sep() {
  return (
    <span className="header-stats-sep" aria-hidden>
      ·
    </span>
  )
}

export function HeaderBar() {
  const activeScene = useAppStore((s) => s.activeScene)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
  const stats = useStats()
  // own cache key — the savings sum needs the FULL impact list, never a
  // truncated ?top=N variant another consumer might cache under 'impacts'
  const impacts = useApiData('impacts:all', api.impacts)

  // Sum est_savings over ONLY the records that carry a cost model —
  // the count scopes the tooltip honestly (never implies all rows priced).
  const savings = useMemo(() => {
    let low = 0
    let high = 0
    let n = 0
    for (const r of impacts.data?.impacts ?? []) {
      const rng = r.est_savings_usd_range
      if (!rng) continue
      const lo = typeof rng.low === 'number' ? rng.low : null
      const hi = typeof rng.high === 'number' ? rng.high : null
      if (lo === null && hi === null) continue
      low += lo ?? 0
      high += hi ?? 0
      n += 1
    }
    return n > 0 ? { low, high, n } : null
  }, [impacts.data])

  const s = stats.data
  // api.ts types peak_season as {season}; the backend actually sends
  // {year, site_count, ...} — read either label honestly, never invent one.
  const peak = s?.peak_season as
    | { season?: string; year?: number; site_count?: number }
    | null
    | undefined
  const peakLabel = peak?.season ?? peak?.year
  const tierBits = s?.by_tier
    ? (['1', '2', '3', '4'] as const)
        .filter((t) => typeof s.by_tier[t] === 'number')
        .map((t) => `t${t} ${fmtInt(s.by_tier[t])}`)
    : []

  return (
    <header className="header-bar">
      <div className="brand">
        <span className="brand-title">CO-GRID</span>
        <span className="brand-sep" aria-hidden>
          —
        </span>
        <span className="brand-sub">
          {SCENES.find((s) => s.id === activeScene)?.sub ?? 'Georgia + South Carolina'}
        </span>
      </div>

      <nav className="scene-switch" aria-label="Scene switcher">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`scene-btn${s.id === activeScene ? ' is-active' : ''}`}
            aria-pressed={s.id === activeScene}
            onClick={() => setActiveScene(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Live counts from /api/stats — hidden while loading or when the
          backend is unreachable (panel surfaces the offline state).
          Optional segments (sep wrapped inside .kpi-optional so nothing
          dangles) drop below ~1100px; every figure renders only when the
          field is actually present. */}
      {s ? (
        <div className="header-stats" title="Live counts from /api/stats + /api/analysis/impacts">
          <span>
            <b className="mono">{fmtInt(s.projects)}</b> projects
          </span>
          <Sep />
          <span>
            <b className="mono">{fmtInt(s.overlaps)}</b> overlaps
          </span>
          <Sep />
          <span title="overlaps whose filed build windows intersect">
            <b className="mono">{fmtInt(s.timeline_matches)}</b> shared window
            {s.timeline_matches === 1 ? '' : 's'}
          </span>
          {savings ? (
            <>
              <Sep />
              <span
                title={`sum over the ${fmtInt(savings.n)} records with cost models — planning-level estimate`}
              >
                ~
                <b className="mono">
                  {fmtUsd(savings.low)}–{fmtUsd(savings.high)}
                </b>{' '}
                est. savings
              </span>
            </>
          ) : null}
          {typeof s.staging_yards === 'number' ? (
            <>
              <Sep />
              <span title="estimated staging yards — 40 km disk-cover over all overlaps">
                <b className="mono">{fmtInt(s.staging_yards)}</b> yards
              </span>
            </>
          ) : null}
          {typeof s.staging_corridors === 'number' ? (
            <span className="kpi-optional">
              <Sep />
              <span title="staging corridors linking yard clusters">
                <b className="mono">{fmtInt(s.staging_corridors)}</b> corridors
              </span>
            </span>
          ) : null}
          {typeof s.timeline_adjacent === 'number' ? (
            <span className="kpi-optional">
              <Sep />
              <span title="windows roll end-to-start — crew handoff, not a shared window">
                <b className="mono">{fmtInt(s.timeline_adjacent)}</b> adjacent
              </span>
            </span>
          ) : null}
          {peakLabel != null && typeof peak?.site_count === 'number' ? (
            <span className="kpi-optional">
              <Sep />
              <span title="busiest single build season across staging clusters">
                peak <b className="mono">{peakLabel}</b> (
                <b className="mono">{fmtInt(peak.site_count)}</b> sites)
              </span>
            </span>
          ) : null}
          {tierBits.length > 0 ? (
            <span className="kpi-optional">
              <Sep />
              <span title="overlap counts by distance tier (t1 touching → t4 <40km crews)">
                <b className="mono">{tierBits.join(' / ')}</b>
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
