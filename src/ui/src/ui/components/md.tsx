import { memo, useMemo, type ReactNode } from 'react'
import type { AgentTrace } from '../../lib/api'
import type { MapUiAction } from '../../lib/mapActions'

/**
 * md.tsx — dependency-free reply rendering for the agent bar: a mini
 * markdown renderer plus the message bubble (tool trace, reasoning,
 * run footer). Handles exactly what the model emits: **bold**, -/*
 * bullets, | pipe | tables |, ## headers, and plain paragraphs.
 * Anything else passes through as text — never trusts the model
 * with raw HTML.
 *
 * `onSelect` turns overlap references into live chips: a markdown link
 * or deep-link token carrying select=OV-NNNN (optionally scene=X) jumps
 * scene + selects; a bare OV-NNNN id selects in the current scene.
 * Other [label](url) markdown links render as real <a> elements —
 * http(s) links open in a new tab, same-origin paths (/api/exports/…)
 * stay in place; unsafe schemes (javascript:…) degrade to plain text.
 */

export type OverlapSelectFn = (overlapId: string, scene?: string) => void

/** One follow-up chip under a selection-summary message. `prompt` rides
 * the normal send() path (model call, shows as a user bubble); `focus`
 * applies a map_focus-style ui_action locally — no model needed.
 * `explain` marks the chip eligible for the deterministic-brief fallback
 * when the agent is unconfigured (the brief route resolves the LIVE
 * selected overlap, so it only stays honest while sel.id is selected). */
export interface SelChip {
  label: string
  prompt?: string
  focus?: MapUiAction
  explain?: boolean
}

/** Payload of a `kind: 'selection'` message — the assistant-role summary
 * posted into the log when a NEW record is selected. `headline` is the
 * flat one-liner also used as `content` (so chat history sent to the
 * backend carries the same summary); `fired` holds labels of the
 * one-shot chips already consumed on THIS message. */
export interface SelectionMsg {
  recordKind: 'overlap' | 'project'
  id: string
  headline: string
  title: string
  sub?: string
  tags: string[]
  chips: SelChip[]
  fired: string[]
}

/** One agent-log message. `kind` drives honest-state styling
 * (error = dashed ⚠ box, note = muted, selection = record summary);
 * `progress` marks the transient live-tool line the real reply replaces. */
export interface Msg {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string | null
  trace?: AgentTrace[]
  rounds?: number
  tokens?: number | null
  stoppedEarly?: boolean
  kind?: 'error' | 'note' | 'selection'
  sel?: SelectionMsg
  progress?: boolean
}

/** Display names for the backend tool-calling loop — the raw name stays
 * in each expanded row's title tooltip; unknown tools fall back to raw. */
const TOOL_LABELS: Record<string, string> = {
  stats: 'stats', exec_summary: 'exec summary', list_projects: 'list projects',
  get_project: 'get project', top_overlaps: 'top overlaps',
  get_overlap: 'get overlap', projects_near: 'projects near',
  timeline_summary: 'timeline summary', impact_estimate: 'impact estimate',
  gazetteer: 'gazetteer', data_health: 'data health',
  staging_clusters: 'staging clusters', playbook: 'playbook',
  utility_matrix: 'utility matrix', outage_conflicts: 'outage conflicts',
  find_overlaps: 'find overlaps', project_overlaps: 'project overlaps',
  no_overlap_reason: 'no-overlap reason', compare_overlaps: 'compare overlaps',
  why_ranked: 'why ranked', zone_report: 'zone report',
  savings_rollup: 'savings rollup', overlap_neighbors: 'overlap neighbors',
  season_calendar: 'season calendar', what_if_shift: 'what-if shift',
  handoff_chains: 'handoff chains', voltage_match: 'voltage match',
  utility_profile: 'utility profile',
  what_if_drop_utility: 'what-if drop utility', define: 'define',
  export_data: 'export data',
}
const toolLabel = (t: string) => TOOL_LABELS[t] ?? t

/** `tool(json)` with args compacted to ≤80 chars. */
const fmtCall = (t: AgentTrace) => {
  const j = JSON.stringify(t.args ?? {})
  return `${toolLabel(t.tool)}(${!j || j === '{}' ? '' : j.length > 80 ? `${j.slice(0, 77)}…` : j})`
}

/** One log line — memoized so typing in the input never re-parses
 * markdown for earlier messages. */
export const MsgView = memo(function MsgView({
  m,
  onSelect,
}: {
  m: Msg
  onSelect: OverlapSelectFn
}) {
  const body = useMemo(
    () => (m.role === 'assistant' && !m.progress
      ? renderMarkdown(m.content, onSelect)
      : null),
    [m.role, m.progress, m.content, onSelect],
  )
  return (
    <div
      className={`agent-msg ${m.role}${m.progress ? ' agent-progress' : ''}${m.kind ? ` ${m.kind}` : ''}`}
    >
      {m.trace && m.trace.length > 0 && (
        <details className="agent-trace">
          <summary className="agent-tools">
            ⚙ {m.trace.map((t) => toolLabel(t.tool)).join(' · ')}
          </summary>
          {m.trace.map((t, i) => (
            <div key={i} className="agent-trace-row">
              <code title={t.tool}>{fmtCall(t)}</code>
              {t.preview && <div className="agent-trace-preview">{t.preview}</div>}
            </div>
          ))}
        </details>
      )}
      {m.role === 'assistant' && !m.progress ? body : m.content}
      {m.reasoning && (
        <details className="agent-reasoning">
          <summary>thinking</summary>
          <div className="agent-reasoning-body">{m.reasoning}</div>
        </details>
      )}
      {(m.rounds != null || (m.trace?.length ?? 0) > 0) && (
        <div className="agent-meta">
          {m.rounds ?? 0} rounds · {m.trace?.length ?? 0} tool calls
          {m.tokens != null && ` · ${m.tokens} tokens`}
        </div>
      )}
      {m.stoppedEarly && (
        <div className="agent-flag">stopped early — try a narrower question</div>
      )}
    </div>
  )
})

/**
 * Overlap-reference tokens — matched BEFORE bold-splitting so ids inside
 * `**…**` spans still become chips and stray `**` wrappers never leak:
 *   [label](…select=OV-xxxx…)   markdown link  → OV chip only
 *   **OV-xxxx**                 bold id        → OV chip
 *   ?scene=X&select=OV-xxxx…    deep link      → OV chip (+ scene jump)
 *   OV-xxxx                     bare id        → OV chip
 * Trailing . , ; : ' " are excluded so sentence punctuation isn't eaten.
 */
/* The model (glm) emits ids with U+2011 non-breaking hyphens — `OV‑0001`
 * looks identical to `OV-0001` but never matched TOKEN_RE, so chips were
 * dead text. Accept the unicode dash range then normalize back to ASCII
 * before the id hits the store. */
const DASH = '[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015-]'
const TOKEN_RE = new RegExp(
  `\\[([^\\]]*)\\]\\(([^)\\]\\n]*?select=(OV${DASH}\\d+)[^)\\]\\n]*)\\)` +
  `|\\*\\*(OV${DASH}\\d{3,})\\*\\*` +
  `|\\/?\\?scene=(savannah|augusta|state)&select=(OV${DASH}\\d+)[^ )\\].,;:'"]*` +
  `|\\b(OV${DASH}\\d{3,})\\b` +
  `|\\[([^\\]]+)\\]\\(([^)\\]\\n]+)\\)`, // generic [label](url) — LAST: OV links win
  'g',
)
const normalizeOid = (s: string | undefined) =>
  s?.replace(/[\u2010-\u2015]/g, '-')

/** Same-origin relative path or http(s) only — anything else
 * (javascript:, data:, vbscript:, protocol-relative //) is refused so a
 * model-emitted link can't smuggle script into the reply. */
const safeHref = (url: string | undefined): string | null => {
  const u = (url ?? '').trim().split(/\s+/)[0] // drop optional "title"
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/') && !u.startsWith('//')) return u
  if (u.startsWith('./') || u.startsWith('../')) return u
  return null
}

/** Dashed-underline link styling — consistent with the app's other
 * inline links (src-link provenance underlines, legend hovers). */
const LINK_STYLE = {
  color: '#7db8ff',
  textDecoration: 'underline',
  textDecorationStyle: 'dashed',
  textUnderlineOffset: '2px',
} as const

const SCENE_RE = /scene=(savannah|augusta|state)/

/**
 * One plain-text run between OV tokens. `**bold**` pairs render <strong>;
 * a stray `**` toggles a pending-bold state carried across chips (so
 * `**OV-0042 — DESC×GPC**` renders bold text + chip with no litter);
 * lone `*` markers that can't pair inside the run are dropped.
 * Returns the pending-bold state for the next run.
 */
function textRun(run: string, out: ReactNode[], keyBase: string,
                 boldOpen: boolean): boolean {
  const subs = run.split(/\*\*([^*]+)\*\*/g)
  let bold = boldOpen
  let n = 0
  const emit = (text: string, strong: boolean) => {
    if (!text) return
    out.push(
      strong
        ? <strong key={`${keyBase}-s${n++}`}>{text}</strong>
        : <span key={`${keyBase}-s${n++}`}>{text}</span>,
    )
  }
  subs.forEach((s, j) => {
    if (j % 2 === 1) {
      emit(s, true) // properly paired **…** span
      return
    }
    // unpaired leftovers — scan for stray `**` toggles, drop single `*`
    let buf = ''
    for (let p = 0; p < s.length; p++) {
      if (s.startsWith('**', p)) {
        emit(buf, bold)
        buf = ''
        bold = !bold
        p++
      } else if (s[p] !== '*') {
        buf += s[p]
      }
    }
    emit(buf, bold)
  })
  return bold
}

function inline(text: string, keyBase: string,
                onSelect?: OverlapSelectFn): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  let bold = false
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > last) {
      bold = textRun(text.slice(last, m.index), out, `${keyBase}-${n}`, bold)
    }
    const oid = normalizeOid(m[3] ?? m[4] ?? m[6] ?? m[7])
    if (oid) {
      const scene = m[5] ?? m[2]?.match(SCENE_RE)?.[1]
      out.push(
        <button
          key={`${keyBase}-ov${n}`}
          type="button"
          className="md-ovlink mono"
          title={scene ? `jump to ${scene} scene + select ${oid}` : `select ${oid}`}
          onClick={() => onSelect?.(oid, scene || undefined)}
        >
          {oid}
        </button>,
      )
      last = m.index + m[0].length
      n++
      continue
    }
    // generic markdown link — the last TOKEN_RE alternative (m[8]/m[9]).
    // An unsafe scheme renders the label as plain text, never a link.
    if (m[8] != null && m[9] != null) {
      const href = safeHref(m[9])
      if (href) {
        const external = /^https?:/i.test(href)
        out.push(
          <a
            key={`${keyBase}-a${n}`}
            href={href}
            style={LINK_STYLE}
            title={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {m[8]}
          </a>,
        )
      } else {
        out.push(<span key={`${keyBase}-a${n}`}>{m[8]}</span>)
      }
      last = m.index + m[0].length
      n++
    }
  }
  if (last < text.length) {
    textRun(text.slice(last), out, `${keyBase}-${n}`, bold)
  }
  return out
}

function isSepRow(line: string): boolean {
  // trailing pipe optional — `| --- | ---` must still close a table header
  return /^\|[\s:|-]+\|?$/.test(line.trim())
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  // leading pipe + at least one more pipe (a lone `| foo` stays prose);
  // a bare separator like `| ---` counts too
  return t.startsWith('|') && (t.indexOf('|', 1) !== -1 || isSepRow(t))
}

function rowCells(line: string): string[] {
  let t = line.trim().slice(1) // leading |
  if (t.endsWith('|')) t = t.slice(0, -1) // trailing | optional
  return t.split('|').map((c) => c.trim())
}

export function renderMarkdown(text: string,
                               onSelect?: OverlapSelectFn): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // table block
    if (isTableRow(line)) {
      const rows: string[][] = []
      let header: string[] | null = null
      while (i < lines.length && isTableRow(lines[i])) {
        if (isSepRow(lines[i])) {
          header = rows.pop() ?? null // previous row was the header
        } else {
          rows.push(rowCells(lines[i]))
        }
        i++
      }
      out.push(
        <div key={`t${key++}`} className="md-table-wrap">
          <table className="md-table">
            {header && (
              <thead>
                <tr>{header.map((c, j) => <th key={j}>{inline(c, `h${key}-${j}`, onSelect)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `c${key}-${ri}-${j}`, onSelect)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(
        <div key={`h${key++}`} className={`md-h md-h${h[1].length}`}>
          {inline(h[2], `h${key}`, onSelect)}
        </div>,
      )
      i++
      continue
    }

    // bullet list (consecutive - / * / numbered lines)
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ''))
        i++
      }
      out.push(
        <ul key={`l${key++}`} className="md-list">
          {items.map((it, j) => <li key={j}>{inline(it, `li${key}-${j}`, onSelect)}</li>)}
        </ul>,
      )
      continue
    }

    // blank line -> paragraph break (skip)
    if (!line.trim()) {
      i++
      continue
    }

    // plain paragraph (merge consecutive non-empty lines)
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*•]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    out.push(
      <p key={`p${key++}`} className="md-p">
        {inline(para.join(' '), `p${key}`, onSelect)}
      </p>,
    )
  }
  return out
}
