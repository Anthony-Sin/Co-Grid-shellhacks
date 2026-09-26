import type { AgentContext } from '../state/store'
import type {
  FeatureCollection,
  OverlapsResponse,
  ProjectProps,
} from './api'
import { peekApiData } from '../ui/hooks/useApiData'

/**
 * agentContext — pin-to-chat context for the agent bar.
 *
 * "Ask agent" buttons across the UI push a prompt draft through the
 * store's `setAgentPromptDraft`; this module infers the matching
 * AgentContext from that draft text (the callers can't set it
 * themselves — they predate the field). Whatever is resolved renders as
 * a removable chip above the input and is prepended to the outgoing
 * message as a compact `[context: …]` line.
 *
 * Labels resolve against the SHARED request cache (peekApiData — never
 * issues a fetch); while the cache is cold the chip falls back to bare
 * ids rather than inventing names.
 */

/** "Jasper – Okatie 230 kV #2 (new line)" -> "Jasper–Okatie" */
function shortName(name: string | undefined, max = 18): string {
  if (!name) return ''
  let s = name.split('(')[0]
  s = s.replace(/\s*\d+(\.\d+)?\s*kV.*$/i, '')
  s = s.replace(/\s*[–—-]\s*/g, '–').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const projectName = (() => {
  let byId: Map<string, ProjectProps> | null = null
  return (pid: string): ProjectProps | undefined => {
    if (!byId) {
      const feats =
        peekApiData<FeatureCollection<ProjectProps>>('projects')?.features
      if (!feats) return undefined
      byId = new Map(feats.map((f) => [f.properties.project_id, f.properties]))
    }
    return byId.get(pid)
  }
})()

/** Draft text -> pinned context. Checks an explicit overlap id first (a
 * "filtered set" prompt can still end with 'Focus on selected overlap
 * OV-xxxx'), then a project id, then the generic filtered-view phrasing. */
export function inferDraftContext(text: string): AgentContext | null {
  const ov = text.match(/\b(OV-\d{3,})\b/)?.[1]
  if (ov) {
    const rec = peekApiData<OverlapsResponse>('overlaps')?.overlaps.find(
      (o) => o.overlap_id === ov,
    )
    let label = ov
    if (rec) {
      const a = projectName(rec.project_a)
      const b = projectName(rec.project_b)
      const util = rec.utilities ?? []
      const sideA = `${util[0] ?? ''} ${shortName(a?.name)}`.trim()
      const sideB = `${util[1] ?? ''} ${shortName(b?.name)}`.trim()
      label = `${ov} · ${sideA}⇄${sideB}`.replace(/ +/g, ' ').trim()
    }
    return { kind: 'overlap', id: ov, label }
  }
  const pid = text.match(/\bproject\s+([A-Za-z][A-Za-z0-9-]{3,})\b/i)?.[1]
  if (pid) {
    const p = projectName(pid)
    const label = p
      ? `${p.utility} ${shortName(p.name, 26)}`.trim()
      : pid
    return { kind: 'project', id: pid, label }
  }
  const filt = text.match(/filtered coordination set — (\d+) of (\d+)/)
  if (filt) {
    return { kind: 'view', label: `filtered set · ${filt[1]}/${filt[2]} records` }
  }
  return null
}

/** Compact context line prepended to the outgoing message — the model
 * sees the canonical id (or view label), not the display chip text. */
export function contextPrefix(ctx: AgentContext): string {
  const what = ctx.id ?? ctx.label
  return `[context: ${ctx.kind} ${what}] `
}
