import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../state/store'
import type { YearRange } from '../../state/store'
import { yearExtent } from '../../lib/overlapFilters'
import { useOverlaps } from '../hooks/useApiData'
import '../../styles/panel-tf.css'

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

/** Debounce window for year-range writes while a thumb is dragging. */
const YEAR_DEBOUNCE_MS = 120

/**
 * TIMEFRAME — the drawer's top section: a compact dual-thumb build-window
 * range over the filed-years extent of the overlap records (shared +
 * adjacent windows via `yearExtent`).
 *
 * Same store contract as the ViewModes "Build window" card: both controls
 * read/write `store.yearFilter`, so they can never disagree (dragging a
 * thumb turns the filter ON — `yearFilter === null` is the off state and
 * "×" clears back to it). Store writes are debounced so a drag doesn't
 * spam the map/list re-filter.
 *
 * Honest edges (AGENTS.md §7): an active filter excludes records with no
 * window data at all — the readout distinguishes "all filed years" from
 * "building A–B"; missing window data renders an explicit empty state.
 */
export function TimeframeSlider() {
  const yearFilter = useAppStore((s) => s.yearFilter)
  const setYearFilter = useAppStore((s) => s.setYearFilter)
  const overlaps = useOverlaps()
  const extent = useMemo(
    () => yearExtent(overlaps.data?.overlaps ?? []),
    [overlaps.data],
  )
  const [draft, setDraft] = useState<YearRange | null>(null)
  const timer = useRef<number | null>(null)

  // cancel a pending debounced write if the drawer unmounts mid-drag
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  if (overlaps.loading && !overlaps.data) {
    return (
      <div className="tf">
        <div className="tf-head">
          <span className="pnl-sec-title">timeframe</span>
        </div>
        <div className="tf-empty">reading filed windows…</div>
      </div>
    )
  }
  if (!extent) {
    // also covers the error state — there is no window data to range over
    return (
      <div className="tf">
        <div className="tf-head">
          <span className="pnl-sec-title">timeframe</span>
        </div>
        <div className="tf-empty">no filed windows</div>
      </div>
    )
  }

  const shown = draft ?? yearFilter ?? extent
  const active = draft !== null || yearFilter !== null
  const span = Math.max(1, extent.end - extent.start)
  const pct = (v: number) => ((v - extent.start) / span) * 100

  const commit = (r: YearRange) => {
    setDraft(r)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setYearFilter(r)
      setDraft(null)
      timer.current = null
    }, YEAR_DEBOUNCE_MS)
  }

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setDraft(null)
    setYearFilter(null)
  }

  return (
    <div className={cx('tf', active && 'is-active')}>
      <div className="tf-head">
        <span className="pnl-sec-title">timeframe</span>
        <span className={cx('tf-readout mono', !active && 'is-off')}
          title={active ? 'build-window filter is on' : 'drag a thumb to filter by build window'}>
          {active ? `${shown.start}–${shown.end}` : 'all filed years'}
        </span>
        {active && (
          <button type="button" className="tf-clear" onClick={clear}
            aria-label="Clear timeframe filter" title="Clear timeframe filter">
            × clear
          </button>
        )}
      </div>

      <div className="tf-slider">
        <div className="tf-track" aria-hidden />
        <div className="tf-fill" aria-hidden
          style={{ left: `${pct(shown.start)}%`, right: `${100 - pct(shown.end)}%` }} />
        <input type="range" className="tf-thumb"
          min={extent.start} max={extent.end} step={1}
          value={shown.start} aria-label="Timeframe from year"
          onChange={(e) =>
            commit({ start: Math.min(Number(e.target.value), shown.end), end: shown.end })
          } />
        <input type="range" className="tf-thumb tf-thumb--hi"
          min={extent.start} max={extent.end} step={1}
          value={shown.end} aria-label="Timeframe to year"
          onChange={(e) =>
            commit({ start: shown.start, end: Math.max(Number(e.target.value), shown.start) })
          } />
      </div>
      <div className="tf-ticks mono" aria-hidden>
        <span>{extent.start}</span>
        <span>{extent.end}</span>
      </div>
    </div>
  )
}
