import type { Msg } from './components/md'

/**
 * agentbarShared — pure helpers + the quick-action preset table, split
 * from AgentBar.tsx to keep the component under the 500-line budget
 * (AGENTS.md §1). Nothing here touches React or the store.
 */

export type HealthState = 'loading' | 'ok' | 'failed'

export const QUICK_ACTIONS = [
  { label: 'Exec summary', prompt: 'Give me the headline executive summary — counts, dominant utility pair, peak build season, mandatory joint outages, top opportunity.' },
  { label: 'Top opportunities', prompt: 'List the top 3 coordination opportunities — overlap id, utilities, tier, distance, and whether timelines overlap.' },
  { label: 'Explain selected', prompt: 'Explain the currently selected overlap: what could the two utilities share and when is the shared build window?' },
  { label: 'Staging plan', prompt: 'Where would you put shared staging yards? Use the staging_clusters tool and name the top clusters with their member counts.' },
  { label: 'Timeline view', prompt: 'Summarize build activity per year per utility and flag the busiest coordination windows.' },
  { label: '2027 season', prompt: 'What joint work is schedulable in 2027? Use season_calendar — the top records and their utility pairs.' },
  { label: 'Crew relays', prompt: 'Could one crew relay between projects end-to-start across years? Use handoff_chains and name the longest chains with their project sequence and years.' },
  { label: 'What-if slip', prompt: "If the currently selected overlap's projects slipped two years, which coordination records would lose their timeline relationship? Use what_if_shift on the selected overlap." },
  { label: 'Data health', prompt: 'How much of the dataset is missing timeline dates or location confidence? Be honest about gaps.' },
]

export const abortError = () => new DOMException('aborted', 'AbortError')
export const isAbort = (e: unknown) =>
  typeof e === 'object' && e !== null &&
  (e as { name?: string }).name === 'AbortError'

/** Race a promise against an AbortSignal — lets the /chat fallback share
 * the run's controller even though api.agentChat takes no signal. */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export const errText = (e: unknown) =>
  e instanceof TypeError
    ? 'backend unreachable — is uvicorn running on :8000?'
    : e instanceof Error ? e.message : String(e)

/** analysisBrief failure copy: a dead/missing route means the backend is
 * down; a 503 means it's up but has no LLM key configured. */
export const briefErrCopy = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof TypeError || /HTTP 404/.test(msg))
    return 'backend offline — start uvicorn :8000'
  if (/HTTP 503/.test(msg))
    return 'agent offline — set AGENT_API_KEY in .env for full analysis'
  return `agent error: ${msg}`
}

export const dropProgress = (m: Msg[]): Msg[] =>
  m[m.length - 1]?.progress ? m.slice(0, -1) : m

/** Freeze the transient ⚙ progress line into a muted record of the tools
 * that actually ran — used when a run is cancelled or interrupted. */
export const freezeProgress = (m: Msg[]): Msg[] => {
  const last = m[m.length - 1]
  return last?.progress
    ? [...m.slice(0, -1), { ...last, progress: false, kind: 'note' as const }]
    : m
}
