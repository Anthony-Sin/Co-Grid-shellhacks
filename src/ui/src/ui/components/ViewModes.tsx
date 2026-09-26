import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../state/store'
import type { LayerFlags, YearRange } from '../../state/store'
import type { SceneId } from '../../lib/projection'
import { yearExtent } from '../../lib/overlapFilters'
import { useOverlaps, useRegions } from '../hooks/useApiData'

/**
 * Bottom-left "map tools" card — layer toggles, the build-window year
 * filter, and a compact scene switcher (a reachable duplicate of the
 * header switch for when the header is crowded).
 *
 * Every control binds to the shared store (layers / yearFilter /
 * activeScene) so the list, map and chrome can never disagree — and
 * every state is reported honestly (AGENTS.md §7): a missing scene
 * artifact renders a disabled button, empty window data renders
 * "no filed windows", and the year filter shows an explicit off state.
 */

const LAYERS: { key: keyof LayerFlags; label: string; hint: string }[] = [
  { key: 'basemap', label: 'basemap', hint: 'existing grid + city context' },
  { key: 'projects', label: 'planned projects', hint: 'filed utility builds' },
  { key: 'zones', label: 'overlap zones', hint: 'coordination opportunity footprints' },
  { key: 'labels', label: 'labels', hint: 'place + zone name chips' },
]

const SCENES: { id: SceneId; label: string }[] = [
  { id: 'state', label: 'GA+SC' },
  { id: 'savannah', label: 'Savannah' },
  { id: 'augusta', label: 'Augusta' },
]

/** Debounce window for year-range writes while a thumb is dragging. */
const YEAR_DEBOUNCE_MS = 120

/** Eye-style layer toggles — one row per LayerFlags key. */
function LayersSection() {
  const layers = useAppStore((s) => s.layers)
  const toggleLayer = useAppStore((s) => s.toggleLayer)
  return (
    <div className="vm-layers">
      {LAYERS.map((l) => {
        const on = layers[l.key]
        return (
          <button
            key={l.key}
            type="button"
            className={`vm-layer${on ? ' is-on' : ''}`}
            aria-pressed={on}
            title={l.hint}
            onClick={() => toggleLayer(l.key)}
          >
            <span className="vm-eye mono" aria-hidden>
              {on ? '✓' : '—'}
            </span>
            <span className="vm-layer-label">{l.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Build-window range: two thumbs over the data extent (yearExtent of the
 * overlap records' shared + adjacent windows). Dragging a thumb turns the
 * filter ON — off is the default (yearFilter === null) and "× clear"
 * returns there. Store writes are debounced so a drag doesn't spam the
 * map/list re-filter.
 *
 * Honest edge: an active filter excludes records with NO window data at
 * all (they can't be placed in time), which is why off ≠ full-range —
 * the readout distinguishes "all filed years" from "building A–B".
 */
function BuildWindow() {
  const yearFilter = useAppStore((s) => s.yearFilter)
  const setYearFilter = useAppStore((s) => s.setYearFilter)
  const overlaps = useOverlaps()
  const extent = useMemo(
    () => yearExtent(overlaps.data?.overlaps ?? []),
    [overlaps.data],
  )
  const [draft, setDraft] = useState<YearRange | null>(null)
  const timer = useRef<number | null>(null)

  // cancel a pending debounced write if the card unmounts mid-drag
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  if (overlaps.loading && !overlaps.data) {
    return <div className="vm-empty">reading filed windows…</div>
  }
  if (!extent) {
    // also covers the error state — there is no window data to range over
    return <div className="vm-empty">no filed windows</div>
  }

  const shown = draft ?? yearFilter ?? extent
  const active = draft !== null || yearFilter !== null

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
    <div className="vm-window">
      <div className={`vm-readout${active ? '' : ' is-off'}`}>
        {active ? (
          <span>
            building{' '}
            <b className="mono">
              {shown.start}–{shown.end}
            </b>
          </span>
        ) : (
          <span>all filed years — drag to filter</span>
        )}
        {active && (
          <button
            type="button"
            className="vm-clear"
            onClick={clear}
            aria-label="Clear build-window filter"
          >
            × clear
          </button>
        )}
      </div>

      <div className="vm-range">
        <span className="vm-range-tag">from</span>
        <span className="vm-tick mono">{extent.start}</span>
        <input
          type="range"
          min={extent.start}
          max={extent.end}
          step={1}
          value={shown.start}
          aria-label="Build window from year"
          onChange={(e) =>
            commit({
              start: Math.min(Number(e.target.value), shown.end),
              end: shown.end,
            })
          }
        />
        <span className="vm-tick mono">{extent.end}</span>
      </div>
      <div className="vm-range">
        <span className="vm-range-tag">to</span>
        <span className="vm-tick mono">{extent.start}</span>
        <input
          type="range"
          min={extent.start}
          max={extent.end}
          step={1}
          value={shown.end}
          aria-label="Build window to year"
          onChange={(e) =>
            commit({
              start: shown.start,
              end: Math.max(Number(e.target.value), shown.start),
            })
          }
        />
        <span className="vm-tick mono">{extent.end}</span>
      </div>

      <div className="vm-note">list + map filter together</div>
    </div>
  )
}

/**
 * Mini scene switcher — the same SceneIds the header uses, but gated by
 * /api/regions: only scenes whose artifact is `built` are enabled.
 */
function SceneSection() {
  const activeScene = useAppStore((s) => s.activeScene)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
  const regions = useRegions()
  const regionById = useMemo(
    () => new Map((regions.data?.regions ?? []).map((r) => [r.id, r])),
    [regions.data],
  )

  const sceneTitle = (id: SceneId): string => {
    const reg = regionById.get(id)
    if (reg?.built) return reg.label
    if (regions.error) return 'scene index unavailable — backend offline'
    if (regions.loading) return 'checking scene data…'
    return reg ? `${reg.label} — scene data not built` : 'not listed in /api/regions'
  }

  return (
    <div className="vm-scenes" role="group" aria-label="Scene switcher">
      {SCENES.map((s) => {
        const built = regionById.get(s.id)?.built === true
        return (
          <button
            key={s.id}
            type="button"
            className={`vm-scene${s.id === activeScene ? ' is-active' : ''}`}
            disabled={!built}
            title={sceneTitle(s.id)}
            aria-pressed={s.id === activeScene}
            onClick={() => setActiveScene(s.id)}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

export function ViewModes() {
  // starts collapsed — the card shares the bottom-left corner with the
  // overlaps panel, so it only overlays that space while the user has it open
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="viewmodes-wrap">
        <button
          type="button"
          className="viewmodes-reopen"
          onClick={() => setOpen(true)}
          aria-label="Open map view controls"
        >
          map view »
        </button>
      </div>
    )
  }

  return (
    <div className="viewmodes-wrap">
      <div className="viewmodes" role="group" aria-label="Map view controls">
        <div className="vm-head">
          <h2>Map view</h2>
          <button
            type="button"
            className="vm-collapse"
            onClick={() => setOpen(false)}
            aria-label="Collapse map view controls"
          >
            ×
          </button>
        </div>

        <details className="vm-sec" open>
          <summary className="vm-sec-title">Layers</summary>
          <LayersSection />
        </details>
        <details className="vm-sec" open>
          <summary className="vm-sec-title">Build window</summary>
          <BuildWindow />
        </details>
        <details className="vm-sec" open>
          <summary className="vm-sec-title">Scene</summary>
          <SceneSection />
        </details>
      </div>
    </div>
  )
}
