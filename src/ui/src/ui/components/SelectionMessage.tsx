import { useCallback, useEffect, useRef, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { AgentHealth, OverlapRecord, ProjectProps } from '../../lib/api'
import { buildWindow, humanize } from '../../lib/format'
import { applyMapAction } from '../../lib/mapActions'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import type { HealthState } from '../agentbarShared'
import { useOverlaps, useProjects } from '../hooks/useApiData'
import type { Msg, OverlapSelectFn, SelChip, SelectionMsg } from './md'

/**
 * SelectionMessage — selection surfaces in the agent LOG as an
 * assistant-role summary ("the analyst just told me about this")
 * instead of living only as the pinned detail card. Built from real
 * /api/overlaps + /api/projects records; missing data degrades to an
 * honest id-only stub, never a fabricated summary.
 *
 * This module owns the whole slice so AgentBar stays under the
 * 500-line cap (AGENTS.md §1):
 *   overlapSelMsg / projectSelMsg — pure summary builders
 *   SelectionMessage              — the bespoke bubble + one-shot chips
 *   useSelectionMessages          — posts summaries on NEW selection,
 *                                   fires chips (focus = local map
 *                                   action, prompt = normal send())
 *   selectOvFromLog               — OV-chip select handler shared with
 *                                   the markdown renderer
 */

/** "Jasper – Okatie 230 kV #2 (new line)" -> compact log-line label */
const clip = (s: string | undefined, n = 30): string => {
  if (!s) return ''
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** join display parts, skipping empties — "OV-0004 · DESC × GPC" */
const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ')

/** OV-id chips in log text — deep-link form carries its own scene; a
 * bare id resolves its zone via the shared overlaps cache. Identical to
 * the handler AgentBar used to inline (moved here with the log slice). */
export const selectOvFromLog: OverlapSelectFn = (oid, scene) => {
  const s = useAppStore.getState()
  if (scene === 'savannah' || scene === 'augusta' || scene === 'state') {
    s.setActiveScene(scene)
    s.selectOverlap(oid)
  } else {
    selectOverlapInScene(oid)
  }
}

/* ---- summary builders ------------------------------------------------- */

/** Overlap record -> summary. `pname` resolves member-project names from
 * the shared projects cache (never fetches); ids stand in when absent. */
export function overlapSelMsg(
  id: string,
  o: OverlapRecord | undefined,
  pname: (pid: string) => string | undefined,
): SelectionMsg {
  if (!o) {
    return {
      recordKind: 'overlap', id, headline: id, title: id,
      sub: 'not in the current overlaps dataset', tags: [], chips: [], fired: [],
    }
  }
  const utils = o.utilities.join(' × ')
  const dist = o.min_distance_km === 0 ? '0 km' : `${o.min_distance_km.toFixed(1)} km`
  const tier = `tier ${o.tier} ${humanize(o.tier_label)}`
  const win =
    o.timeline_overlap && o.shared_window
      ? `window ${o.shared_window.start}–${o.shared_window.end}`
      : o.timeline_adjacent && o.adjacent_window
        ? `adjacent ${o.adjacent_window.start}–${o.adjacent_window.end}`
        : 'no shared window'
  return {
    recordKind: 'overlap',
    id: o.overlap_id,
    headline: join(o.overlap_id, utils, tier, dist),
    title: join(o.overlap_id, utils),
    sub: `${clip(pname(o.project_a) ?? o.project_a)} ⇄ ${clip(pname(o.project_b) ?? o.project_b)}`,
    tags: [tier, dist, win, ...(o.zone ? [humanize(o.zone)] : [])],
    chips: [
      {
        label: 'Explain this overlap',
        explain: true,
        prompt:
          `Explain overlap ${o.overlap_id} — what could the two utilities ` +
          `share, and when is the shared build window?`,
      },
      {
        // same focus path the agent's map_focus tool drives — local only
        label: 'Zoom to site',
        focus: { focus_view: { lon: o.midpoint[0], lat: o.midpoint[1] } },
      },
      {
        label: 'Export overlap CSV',
        prompt:
          `Export the ${utils || 'selected'} coordination overlaps` +
          `${o.zone ? ` in zone "${o.zone}"` : ''} to CSV — use export_data ` +
          `(kind=overlaps${o.utilities.length ? `, utilities=${JSON.stringify(o.utilities)}` : ''}` +
          `${o.zone ? `, zone="${o.zone}"` : ''}) and give me the download link.`,
      },
    ],
    fired: [],
  }
}

/** Project record -> summary: name headline + utility/kv/window tags.
 * Tags that were never filed are omitted rather than rendered "n/a". */
export function projectSelMsg(
  id: string,
  p: ProjectProps | undefined,
): SelectionMsg {
  if (!p) {
    return {
      recordKind: 'project', id, headline: id, title: id,
      sub: 'not in the current projects dataset', tags: [], chips: [], fired: [],
    }
  }
  const kv = p.voltage_kv != null ? `${p.voltage_kv} kV` : null
  const win =
    p.start_year != null || p.end_year != null
      ? `window ${buildWindow(p.start_year, p.end_year)}`
      : null
  const tags = [p.utility || null, kv, win, humanize(p.kind) || null].filter(
    (t): t is string => Boolean(t),
  )
  return {
    recordKind: 'project',
    id: p.project_id,
    headline: join(p.name, p.utility, kv, win?.replace('window ', '')),
    title: clip(p.name, 46) || p.project_id,
    sub: join(p.project_id, humanize(p.kind)),
    tags,
    chips: [
      {
        label: 'Explain this project',
        prompt:
          `Explain project ${p.project_id} — ${clip(p.name, 60)} — what is ` +
          `being built, the build window, and which coordination records touch it?`,
      },
      {
        label: 'Export projects CSV',
        prompt:
          `Export ${p.utility ? `${p.utility}'s ` : ''}filed projects to CSV — ` +
          `use export_data (kind=projects${p.utility ? `, utility="${p.utility}"` : ''}) ` +
          `and give me the download link.`,
      },
    ],
    fired: [],
  }
}

/* ---- message bubble ---------------------------------------------------- */

/** One selection-summary bubble: compact head + sub + tag row, then the
 * follow-up chips (one-shot — fired labels leave the row for good). */
export function SelectionMessage({
  sel,
  disabled,
  onChip,
}: {
  sel: SelectionMsg
  disabled: (chip: SelChip) => boolean
  onChip: (chip: SelChip) => void
}) {
  const chips = sel.chips.filter((c) => !sel.fired.includes(c.label))
  return (
    <div className="agent-msg assistant selection">
      <div className="selmsg-head mono">{sel.title}</div>
      {sel.sub && <div className="selmsg-sub">{sel.sub}</div>}
      {sel.tags.length > 0 && (
        <div className="selmsg-tags">
          {sel.tags.map((t) => (
            <span key={t} className="selmsg-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="sel-chips">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={disabled(c)}
              title={
                c.focus
                  ? 'fly the map to this site — no model call'
                  : c.prompt
              }
              onClick={() => onChip(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- rail wiring -------------------------------------------------------- */

export interface SelectionRailDeps {
  setMsgs: Dispatch<SetStateAction<Msg[]>>
  send: (text: string) => void
  busy: boolean
  healthState: HealthState
  health: AgentHealth | null
}

/**
 * AgentBar hook — returns a per-message renderer: selection entries get
 * the bespoke bubble, everything else returns null (caller falls back
 * to MsgView). The posting effect dedupes by record id: re-selecting
 * the same record never double-posts, a DIFFERENT record always
 * appends, and clearing the selection never removes history.
 */
export function useSelectionMessages({
  setMsgs,
  send,
  busy,
  healthState,
  health,
}: SelectionRailDeps) {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  const overlaps = useOverlaps()
  const projects = useProjects()
  const lastSelRef = useRef<string | null>(null)

  // post once the shared datasets settle — a backend failure falls
  // through to the honest "not in dataset" stub instead of waiting
  useEffect(() => {
    const id = selectedOverlapId ?? selectedProjectId
    if (!id || id === lastSelRef.current) return
    // overlap summaries embed member-project names too — wait for both
    if (selectedOverlapId ? overlaps.loading || projects.loading : projects.loading)
      return
    const names = new Map(
      (projects.data?.features ?? []).map((f) => [
        f.properties.project_id,
        f.properties.name,
      ]),
    )
    const sel = selectedOverlapId
      ? overlapSelMsg(
          id,
          overlaps.data?.overlaps.find((o) => o.overlap_id === id),
          (pid) => names.get(pid),
        )
      : projectSelMsg(
          id,
          projects.data?.features.find((f) => f.properties.project_id === id)
            ?.properties,
        )
    lastSelRef.current = id
    setMsgs((m) => {
      const entry: Msg = {
        role: 'assistant',
        kind: 'selection',
        content: sel.headline,
        sel,
      }
      // keep a live ⚙ progress line LAST — a mid-flight run must still
      // replace its own progress row, not strand it above this entry
      const last = m[m.length - 1]
      return last?.progress ? [...m.slice(0, -1), entry, last] : [...m, entry]
    })
  }, [selectedOverlapId, selectedProjectId, overlaps, projects, setMsgs])

  /** Chip gating — mirrors the main quick chips: dead while busy or
   * while the agent can't answer. Focus chips are local so they only
   * respect busy; prompt chips also need the agent (unconfigured keeps
   * ONLY a live-overlap explain — the deterministic brief resolves
   * selectedOverlapId, anything else would answer the wrong record). */
  const chipDisabled = useCallback(
    (sel: SelectionMsg, c: SelChip) => {
      if (busy) return true
      if (c.focus) return false
      return (
        healthState !== 'ok' ||
        !health ||
        (!health.configured && !(c.explain && sel.id === selectedOverlapId))
      )
    },
    [busy, healthState, health, selectedOverlapId],
  )

  const fireChip = useCallback(
    (idx: number, sel: SelectionMsg, c: SelChip) => {
      if (chipDisabled(sel, c)) return // one-shot: never consume on a no-op
      // send() rewrites msgs from its render-time closure — fire it
      // FIRST so the fired-mark (functional update) lands on top of its
      // replace, not underneath where it would be overwritten
      if (c.focus) applyMapAction(c.focus)
      else if (c.prompt) send(c.prompt)
      setMsgs((m) =>
        m.map((x, j) =>
          j === idx && x.sel
            ? { ...x, sel: { ...x.sel, fired: [...x.sel.fired, c.label] } }
            : x,
        ),
      )
    },
    [chipDisabled, send, setMsgs],
  )

  /** msgs.map entry point — SelectionMessage bubble for sel entries,
   * null otherwise (caller renders MsgView). */
  return useCallback(
    (m: Msg, i: number): ReactNode => {
      const s = m.sel
      if (!s) return null
      return (
        <SelectionMessage
          key={i}
          sel={s}
          disabled={(c) => chipDisabled(s, c)}
          onChip={(c) => fireChip(i, s, c)}
        />
      )
    },
    [chipDisabled, fireChip],
  )
}
