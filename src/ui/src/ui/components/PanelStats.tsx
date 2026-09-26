import { useMemo } from 'react'
import { TIERS, TIER_COLORS } from '../../lib/palette'
import type { OverlapRecord, Tier } from '../../lib/api'

/**
 * PanelStats — congestion-dashboard KPI strip for the CURRENTLY FILTERED
 * set (see OverlapPanel). Every number derives from `records`, never the
 * DOM-capped list and never the unfiltered total — the strip is the view's
 * honest summary (AGENTS.md §7). Renders nothing before data exists
 * (`total === 0`); an empty filter result still renders real zeros.
 */

/** Compact planning-level USD — mirrors HeaderBar's fmtUsd ($29.8M / $450k). */
function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(Math.round((n / 1e6) * 10) / 10).toString()}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}

interface ViewStats {
  /** records per tier — only tiers with count > 0 render a key segment */
  tiers: Map<Tier, number>
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
  /** the filtered set — NOT `shown` (the 200-row cap mustn't skew stats) */
  records: OverlapRecord[]
  /** all.length — the "of M" denominator */
  total: number
  /** hands the current filtered view to the analyst (store draft) */
  onAskAgent: () => void
}

export function PanelStats({ records, total, onAskAgent }: PanelStatsProps) {
  const s = useMemo<ViewStats>(() => {
    const tiers = new Map<Tier, number>()
    let shared = 0
    let handoffs = 0
    let costN = 0
    let costLow = 0
    let costHigh = 0
    let nearest: number | null = null
    for (const o of records) {
      tiers.set(o.tier, (tiers.get(o.tier) ?? 0) + 1)
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
    return { tiers, shared, handoffs, costN, costLow, costHigh, nearest }
  }, [records])

  if (total === 0) return null

  return (
    <div className="pnl-stats" aria-label="Stats for the current filtered view">
      <span className="pnl-stat pnl-stat--count" title="records passing the current filters">
        <b className="mono">{records.length}</b>
        <span className="pnl-stat-k">of</span>
        <b className="mono">{total}</b>
      </span>

      {TIERS.map((t) => {
        const n = s.tiers.get(t.tier) ?? 0
        if (n === 0) return null
        return (
          <span key={t.tier} className="pnl-stat pnl-stat--tier"
            title={`tier ${t.tier} — ${t.hint}`}>
            <i className="pnl-tierkey" style={{ background: TIER_COLORS[t.tier] }} aria-hidden />
            <span className="pnl-stat-k">t{t.tier}</span>
            <b className="mono">{n}</b>
          </span>
        )
      })}

      <span className="pnl-stat" title="build windows intersect — joint work is schedulable">
        <span className="pnl-stat-k">shared windows</span>
        <b className="mono">{s.shared}</b>
      </span>
      <span className="pnl-stat" title="end-to-start adjacent windows — crew handoffs, not overlaps">
        <span className="pnl-stat-k">handoffs</span>
        <b className="mono">{s.handoffs}</b>
      </span>
      <span className="pnl-stat"
        title={s.costN > 0
          ? `summed over records with cost models (${s.costN} of ${records.length} in view)`
          : 'no records in the current view carry a cost model'}>
        <span className="pnl-stat-k">est. savings</span>
        <b className="mono">
          {s.costN > 0 ? `${fmtUsd(s.costLow)}–${fmtUsd(s.costHigh)}` : '—'}
        </b>
      </span>
      <span className="pnl-stat" title="smallest closest-point distance in view">
        <span className="pnl-stat-k">nearest</span>
        <b className="mono">
          {s.nearest === null ? '—' : s.nearest <= 0 ? 'touching' : `${s.nearest.toFixed(1)} km`}
        </b>
      </span>

      <button type="button" className="pnl-ask" onClick={onAskAgent}
        title="ask the analyst about the current filtered set">
        → ask agent
      </button>
    </div>
  )
}
