import { useMemo } from 'react'
import { TIERS } from '../../lib/palette'
import { useAppStore } from '../../state/store'
import type { OverlapRecord, Tier } from '../../lib/api'
import '../../styles/panel-kpi.css'

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

/**
 * PanelStats — the drawer's KPI block (TomTom congestion-panel style) for
 * the CURRENTLY FILTERED set (see OverlapPanel):
 *
 *   ┌──────────────────────────────┐
 *   │ COORDINATION LOAD  →ask agent │
 *   │ 897  of 1,957 overlaps        │
 *   │ [✓] ● touching           23   │  ← tier legend rows double as the
 *   │ [✓] ● <1.6km shared ROW  102  │     visibleTiers toggles, and their
 *   │ [ ] ● <8km logistics     388  │     counts ignore the tier toggle
 *   │ [✓] ● <40km crews        384  │     itself (an off tier still shows
 *   │ shared 812 · handoffs 85 ·…   │     how many it would contribute)
 *   └──────────────────────────────┘
 *
 * Every number derives from `records`/`tierCounts`, never the DOM-capped
 * list — the block is the view's honest summary (AGENTS.md §7). Renders
 * nothing before data exists (`total === 0`); an empty filter result still
 * renders a real zero.
 */

/** Compact planning-level USD — mirrors HeaderBar's fmtUsd ($29.8M / $450k). */
function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(Math.round((n / 1e6) * 10) / 10).toString()}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}

interface ViewStats {
  /** build windows intersect (the mandatory secondary signal, §8) */
  shared: number
  /** timeline_adjacent && !timeline_overlap — end-to-start handoffs */
  handoffs: number
  /** records carrying a cost model + summed low/high est. savings */
  costN: number
  costLow: number
  costHigh: number
  /** smallest closest-point distance in the set (null when set is empty) */
  nearest: number | null
}

export interface PanelStatsProps {
  /** the filtered set — NOT `shown` (the row cap mustn't skew stats) */
  records: OverlapRecord[]
  /** all.length — the "of M" denominator */
  total: number
  /** per-tier counts of the view WITHOUT the tier toggles applied — an
   *  unchecked tier keeps showing what it would contribute */
  tierCounts: ReadonlyMap<Tier, number>
  /** hands the current filtered view to the analyst (store draft) */
  onAskAgent: () => void
}

export function PanelStats({ records, total, tierCounts, onAskAgent }: PanelStatsProps) {
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const toggleTier = useAppStore((s) => s.toggleTier)

  const s = useMemo<ViewStats>(() => {
    let shared = 0
    let handoffs = 0
    let costN = 0
    let costLow = 0
    let costHigh = 0
    let nearest: number | null = null
    for (const o of records) {
      if (o.timeline_overlap) shared += 1
      else if (o.timeline_adjacent) handoffs += 1 // adjacent ∧ !overlap
      if (o.cost) {
        costN += 1
        costLow += o.cost.est_savings_usd_low
        costHigh += o.cost.est_savings_usd_high
      }
      if (nearest === null || o.min_distance_km < nearest) {
        nearest = o.min_distance_km
      }
    }
    return { shared, handoffs, costN, costLow, costHigh, nearest }
  }, [records])

  if (total === 0) return null

  return (
    <section className="pnl-kpi" aria-label="Coordination load for the current filtered view">
      <div className="pnl-kpi-top">
        <span className="pnl-sec-title">coordination load</span>
        <button type="button" className="pnl-ask" onClick={onAskAgent}
          title="ask the analyst about the current filtered set">
          → ask agent
        </button>
      </div>

      <div className="pnl-kpi-big" title="records passing the current filters">
        <b className="mono">{records.length.toLocaleString('en-US')}</b>
        <span className="pnl-kpi-of">of {total.toLocaleString('en-US')} overlaps</span>
      </div>

      <div className="pnl-kpi-tiers" role="group" aria-label="Toggle tiers">
        {TIERS.map((t) => {
          const on = visibleTiers[t.tier]
          return (
            <label key={t.tier} className={cx('pnl-tier-row', !on && 'is-off')}
              title={`tier ${t.tier} — ${t.hint}`}>
              <input type="checkbox" checked={on} onChange={() => toggleTier(t.tier)} />
              <span className="dot" style={{ background: t.color }} />
              <span className="pnl-tier-name">{t.label}</span>
              <b className="pnl-tier-n mono">
                {(tierCounts.get(t.tier) ?? 0).toLocaleString('en-US')}
              </b>
            </label>
          )
        })}
      </div>

      <div className="pnl-kpi-sub">
        <span className="pnl-kpi-substat" title="build windows intersect — joint work is schedulable">
          <span className="k">shared</span>
          <b className="mono">{s.shared.toLocaleString('en-US')}</b>
        </span>
        <span className="pnl-kpi-substat"
          title="end-to-start adjacent windows — crew handoffs, not overlaps">
          <span className="k">handoffs</span>
          <b className="mono">{s.handoffs.toLocaleString('en-US')}</b>
        </span>
        <span className="pnl-kpi-substat"
          title={s.costN > 0
            ? `summed over records with cost models (${s.costN} of ${records.length} in view)`
            : 'no records in the current view carry a cost model'}>
          <span className="k">savings</span>
          <b className="mono">
            {s.costN > 0 ? `${fmtUsd(s.costLow)}–${fmtUsd(s.costHigh)}` : '—'}
          </b>
        </span>
        <span className="pnl-kpi-substat" title="smallest closest-point distance in view">
          <span className="k">nearest</span>
          <b className="mono">
            {s.nearest === null ? '—' : s.nearest <= 0 ? 'touching' : `${s.nearest.toFixed(1)} km`}
          </b>
        </span>
      </div>
    </section>
  )
}
