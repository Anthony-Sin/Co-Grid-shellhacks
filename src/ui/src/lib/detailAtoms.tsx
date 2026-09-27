/**
 * Shared atoms for the right-rail detail cards (OverlapDetail + ProjectDetail):
 * the kv row, the provenance source line, the location-confidence badge and
 * the mini-Gantt schedule strip. They lived — duplicated — inside the cards;
 * one home keeps the two cards consistent and under the 500-line cap.
 */

import type { ReactNode } from 'react'
import type { OverlapRecord, ProjectProps } from './api'
import { CONFIDENCE_TITLE, parseSource } from './format'
import { utilityColor } from '../ui/components/utilityColors'

/** Key/value row — mono numbers by default (chips/labels opt out). */
export function Kv({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  )
}

/** Provenance line: filed sources are "url (note)" — link the domain,
 * keep the filing note verbatim underneath. Non-URL sources render raw. */
export function SourceLine({ source }: { source: string }) {
  const s = parseSource(source)
  if (!s.url) return <div className="proj-src">source: {s.raw}</div>
  return (
    <div className="proj-src">
      source:{' '}
      <a className="src-link" href={s.url} target="_blank" rel="noreferrer">
        {s.domain}
      </a>
      {s.note ? <div className="src-note">{s.note}</div> : null}
    </div>
  )
}

/** Filed location-confidence pill — dashed/toned variants per confidence. */
export function ConfBadge({ c }: { c: string }) {
  return (
    <span
      className={`conf-badge conf-badge--${c}`}
      title={CONFIDENCE_TITLE[c] ?? 'filed location confidence'}
    >
      {c}
    </span>
  )
}

/**
 * Mini-Gantt: filed build windows for both projects plus the shared (or
 * handoff) window on one padded year axis. Missing filed years render
 * honestly — no fabricated bars.
 */
export function ScheduleStrip({
  a,
  b,
  o,
  tierColor,
}: {
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
    a?.start_year,
    a?.end_year,
    b?.start_year,
    b?.end_year,
    win?.start,
    win?.end,
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
            left: px(win.start),
            width: pw(win.start, win.end),
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
