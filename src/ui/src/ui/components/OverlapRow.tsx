import { TIERS, TIER_COLORS } from '../../lib/palette'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'

export type ProjectMap = Map<string, ProjectProps>

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

/** tier number → human label (`o.tier_label` is the raw schema token). */
const TIER_LABEL = new Map<number, string>(TIERS.map((t) => [t.tier, t.label]))

/** Dense-column km: `0` means touching (tier 1 carries that signal); the
 *  full-precision value lives in the tooltip + detail card. */
const fmtKm = (km: number) => (km <= 0 ? '0' : km >= 99.95 ? km.toFixed(0) : km.toFixed(1))

/** '27–'29 compact window readout — full years live in the detail card. */
const fmtWindow = (w: { start: number; end: number }) =>
  `'${String(w.start).slice(-2)}–'${String(w.end).slice(-2)}`

/** Compact planning-level USD for the tooltip ($29.8M / $450k). */
const fmtUsd = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(Math.round((n / 1e6) * 10) / 10).toString()}M`
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n)}`
}

export interface RowProps {
  overlap: OverlapRecord; rank: number; selected: boolean; hovered: boolean
  projectById: ProjectMap; onSelect: () => void; onHover: (id: string | null) => void
}

/**
 * One dense ranked-table row — a single line: engine rank, tier dot + T#,
 * utility-colored project names (A ⇄ B, ellipsis-truncated), closest-point
 * km, build window chip (adjacent windows get the `→` handoff glyph), and
 * a tier-colored score badge. Hover/focus brushes the map
 * (setHoveredOverlap); click toggles selection via selectOverlapInScene.
 */
export function OverlapRow({ overlap: o, rank, selected, hovered, projectById, onSelect, onHover }: RowProps) {
  const a = projectById.get(o.project_a)
  const b = projectById.get(o.project_b)
  const tierColor = TIER_COLORS[o.tier] ?? '#888888'
  const tierLabel = TIER_LABEL.get(o.tier) ?? o.tier_label.replace(/_/g, ' ')

  const win =
    o.timeline_overlap && o.shared_window
      ? { text: fmtWindow(o.shared_window), cls: 'is-shared' }
      : o.timeline_adjacent && o.adjacent_window
        ? { text: `→${fmtWindow(o.adjacent_window)}`, cls: 'is-adjacent' }
        : null

  const title = [
    `${o.overlap_id} — rank #${rank} · tier ${o.tier} (${tierLabel})`,
    o.explanation,
    o.cost
      ? `est. savings ${fmtUsd(o.cost.est_savings_usd_low)}–${fmtUsd(o.cost.est_savings_usd_high)}`
      : '',
  ].filter(Boolean).join('\n')

  return (
    <li>
      <button type="button" title={title} aria-pressed={selected} data-ovid={o.overlap_id}
        className={cx('overlap-row', 'ovr', selected && 'is-selected', hovered && 'is-hovered')}
        onClick={onSelect}
        onMouseEnter={() => onHover(o.overlap_id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(o.overlap_id)}
        onBlur={() => onHover(null)}>
        <span className="ovr-rank mono">{rank}</span>
        <span className="ovr-tier" title={`tier ${o.tier} — ${tierLabel}`}>
          <span className="dot" style={{ background: tierColor }} />
          <span className="ovr-t mono">T{o.tier}</span>
        </span>
        <span className="ovr-names">
          <span className="ovr-name" style={{ color: utilityColor(a?.utility) }}>
            {a?.name ?? o.project_a}
          </span>
          <span className="ov-swap" aria-hidden>⇄</span>
          <span className="ovr-name" style={{ color: utilityColor(b?.utility) }}>
            {b?.name ?? o.project_b}
          </span>
        </span>
        <span className="ovr-dist mono">{fmtKm(o.min_distance_km)}</span>
        <span
          className={cx('ovr-win mono', win ? win.cls : 'is-none')}
          title={
            win?.cls === 'is-adjacent'
              ? 'windows roll end-to-start — handoff, not a concurrent overlap'
              : win == null
                ? 'no shared or adjacent window'
                : 'shared build window'
          }>
          {win?.text ?? '—'}
        </span>
        <span className="ovr-score mono" style={{ color: tierColor }}
          title={`score ${o.score.toFixed(0)}`}>
          {o.score.toFixed(0)}
        </span>
      </button>
    </li>
  )
}
