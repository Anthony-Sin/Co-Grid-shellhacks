import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentHealth, type AgentReply } from '../../lib/api'
import { MsgView, type Msg, type OverlapSelectFn } from './md'
import { useAppStore } from '../../state/store'

/**
 * AgentBar — floating bottom command bar for the CO-GRID analyst agent.
 * Drive-style: a pill input with quick-action chips above it. The backend
 * (/api/agent/chat) runs a tool-calling loop over real pipeline data —
 * this component owns the connection; md.tsx owns reply rendering.
 *
 * Selection-aware: when an overlap is selected on the map, its id is sent
 * as context so "explain this" resolves against the real record.
 *
 * Honest states only: backend-down, unconfigured, cancelled, and
 * interrupted runs all surface visible messages — nothing fails silently.
 */

type HealthState = 'loading' | 'ok' | 'failed'

const QUICK_ACTIONS = [
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

const abortError = () => new DOMException('aborted', 'AbortError')
const isAbort = (e: unknown) =>
  typeof e === 'object' && e !== null &&
  (e as { name?: string }).name === 'AbortError'

/** Race a promise against an AbortSignal — lets the /chat fallback share
 * the run's controller even though api.agentChat takes no signal. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
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

const errText = (e: unknown) =>
  e instanceof TypeError
    ? 'backend unreachable — is uvicorn running on :8000?'
    : e instanceof Error ? e.message : String(e)

/** analysisBrief failure copy: a dead/missing route means the backend is
 * down; a 503 means it's up but has no LLM key configured. */
const briefErrCopy = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof TypeError || /HTTP 404/.test(msg))
    return 'backend offline — start uvicorn :8000'
  if (/HTTP 503/.test(msg))
    return 'agent offline — set AGENT_API_KEY in .env for full analysis'
  return `agent error: ${msg}`
}

const dropProgress = (m: Msg[]): Msg[] =>
  m[m.length - 1]?.progress ? m.slice(0, -1) : m

/** Freeze the transient ⚙ progress line into a muted record of the tools
 * that actually ran — used when a run is cancelled or interrupted. */
const freezeProgress = (m: Msg[]): Msg[] => {
  const last = m[m.length - 1]
  return last?.progress
    ? [...m.slice(0, -1), { ...last, progress: false, kind: 'note' as const }]
    : m
}

export function AgentBar() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
  const promptDraft = useAppStore((s) => s.agentPromptDraft)
  const setPromptDraft = useAppStore((s) => s.setAgentPromptDraft)
  const [health, setHealth] = useState<AgentHealth | null>(null)
  const [healthState, setHealthState] = useState<HealthState>('loading')
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const checkHealth = useCallback(() => {
    api.agentHealth()
      .then((h) => {
        setHealth(h)
        setHealthState('ok')
      })
      .catch(() => {
        setHealth(null)
        setHealthState('failed')
      })
  }, [])

  useEffect(() => checkHealth(), [checkHealth])

  // keep probing while the agent is down/unconfigured so a late-starting
  // backend (or a newly-set API key) comes online without a page reload
  useEffect(() => {
    if (healthState === 'ok' && health?.configured) return
    const t = setInterval(checkHealth, 15_000)
    return () => clearInterval(t)
  }, [healthState, health?.configured, checkHealth])

  // a draft pushed from elsewhere (e.g. "ask about this" on a record)
  // opens the bar, prefills the input, focuses it, then clears
  useEffect(() => {
    if (!promptDraft) return
    setOpen(true)
    setInput(promptDraft)
    setPromptDraft(null)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [promptDraft, setPromptDraft])

  // Escape aborts a running call; otherwise collapses the bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (abortRef.current) abortRef.current.abort()
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  const onSelectOv = useCallback<OverlapSelectFn>(
    (oid, scene) => {
      if (scene === 'savannah' || scene === 'augusta' || scene === 'state') {
        setActiveScene(scene)
      }
      selectOverlap(oid)
    },
    [setActiveScene, selectOverlap],
  )

  /** POST + ReadableStream SSE reader — EventSource can't POST.
   * Returns the `final` reply plus whether ANY event was seen, so the
   * caller can tell a dead connection (safe to retry via /chat) from a
   * stream that died mid-chain (must NOT re-run the paid tool loop). */
  const streamChat = async (
    history: { role: string; content: string }[],
    onTool: (name: string) => void,
    signal: AbortSignal,
  ): Promise<{ reply: AgentReply | null; sawEvents: boolean }> => {
    const res = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, ...(selectedOverlapId ? { overlap_id: selectedOverlapId } : {}) }),
      signal,
    })
    if (!res.ok) {
      // surface the real server reason (400 limit, 429 rate, 503 unconfigured)
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.detail || `stream HTTP ${res.status}`)
    }
    if (!res.body) return { reply: null, sawEvents: false }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let final: AgentReply | null = null
    let sawEvents = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const ev = part.match(/^event: (\w+)\ndata: (.*)$/s)
        if (!ev) continue
        sawEvents = true
        const data = JSON.parse(ev[2] || 'null')
        if (ev[1] === 'tool' && data?.tool) onTool(data.tool)
        if (ev[1] === 'final') final = data
        if (ev[1] === 'error') throw new Error(data?.message || 'stream error')
      }
    }
    return { reply: final, sawEvents }
  }

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return

    // backend unreachable — visible, honest failure instead of a dead click
    if (healthState === 'failed') {
      setMsgs((m) => [
        ...m,
        { role: 'user', content },
        { role: 'assistant', kind: 'error', content: 'agent unavailable — backend offline' },
      ])
      setInput('')
      return
    }
    if (healthState !== 'ok' || !health) return // still checking

    if (!health.configured) {
      // graceful fallback — 'Explain selected' still works via the
      // deterministic /api/analysis/brief route (no LLM key needed)
      if (!selectedOverlapId) return
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setMsgs((m) => [...m, { role: 'user', content }])
      setInput('')
      setBusy(true)
      try {
        const b = await raceAbort(api.analysisBrief(selectedOverlapId), ctrl.signal)
        setMsgs((m) => [...m, { role: 'assistant', content: b.brief }])
      } catch (e) {
        setMsgs((m) => [
          ...m,
          isAbort(e)
            ? { role: 'assistant' as const, kind: 'note' as const, content: 'cancelled' }
            : { role: 'assistant' as const, kind: 'error' as const, content: briefErrCopy(e) },
        ])
      } finally {
        abortRef.current = null
        setBusy(false)
      }
      return
    }

    const next = [...msgs, { role: 'user' as const, content }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const liveTools: string[] = []
    // backend hard-caps history at 40 messages — keep the last 30 so long
    // sessions degrade gracefully instead of dying on HTTP 400
    const history = next.slice(-30).map((m) => ({ role: m.role, content: m.content }))
    try {
      const { reply, sawEvents } = await streamChat(
        history,
        (name) => {
          liveTools.push(name)
          // live progress line under the log while the chain runs
          setMsgs((m) => {
            const last = m[m.length - 1]
            if (last?.progress) {
              return [...m.slice(0, -1),
                      { role: 'assistant', content: `⚙ ${liveTools.join(' · ')}`, progress: true }]
            }
            return [...m, { role: 'assistant', content: `⚙ ${name}`, progress: true }]
          })
        },
        ctrl.signal,
      )

      if (!reply && sawEvents) {
        // tool/error events arrived but no `final` — the paid chain already
        // ran, so do NOT retry; keep what arrived and say it may be partial
        setMsgs((m) => [
          ...freezeProgress(m),
          { role: 'assistant', kind: 'error',
            content: 'stream interrupted — reply may be incomplete' },
        ])
        return
      }

      let final = reply
      if (!final) {
        // zero events — the stream never really started; one safe retry
        // through plain /chat (no tool calls have run yet)
        setMsgs((m) => [
          ...dropProgress(m),
          { role: 'assistant', content: 'reconnecting…', progress: true },
        ])
        final = await raceAbort(api.agentChat(history, selectedOverlapId), ctrl.signal)
      }

      setMsgs((m) => [
        // replace the transient ⚙/reconnecting line with the real answer
        ...dropProgress(m),
        {
          role: 'assistant',
          content: final.reply,
          reasoning: final.reasoning,
          trace: final.tool_trace,
          rounds: final.rounds,
          tokens: final.usage?.total_tokens ?? null,
          stoppedEarly:
            final.finish_reason === 'round_limit' || final.finish_reason === 'error',
        },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...(isAbort(e) ? freezeProgress(m) : dropProgress(m)),
        isAbort(e)
          ? { role: 'assistant' as const, kind: 'note' as const, content: 'cancelled' }
          : { role: 'assistant' as const, kind: 'error' as const,
              content: `agent error: ${errText(e)}` },
      ])
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="agent-bar-toggle"
        aria-label="show analyst bar"
        onClick={() => setOpen(true)}
      >
        analyst ✦
      </button>
    )
  }

  const unconfigured = healthState === 'ok' && !!health && !health.configured
  const offline = healthState === 'failed' || unconfigured
  const inputDisabled = busy || healthState === 'loading' || unconfigured
  const placeholder =
    healthState === 'loading'
      ? 'checking agent…'
      : healthState === 'failed'
        ? 'backend offline — start uvicorn :8000'
        : unconfigured
          ? 'agent offline — set AGENT_API_KEY in .env'
          : health && health.tools.length > 0
            ? `ask the analyst — ${health.tools.length} tools · ${health.model ?? 'agent'}`
            : 'Ask about overlaps, projects, timelines…'

  return (
    <div className={`agent-bar${expanded ? ' is-expanded' : ''}`}>
      <div className="agent-chips">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={
              busy ||
              healthState !== 'ok' ||
              (!!health &&
                !health.configured &&
                !(a.label === 'Explain selected' && selectedOverlapId))
            }
            onClick={() => send(a.prompt)}
          >
            {a.label}
          </button>
        ))}
        {offline && (
          <button
            type="button"
            className="agent-retry"
            aria-label="retry agent health check"
            title="re-check agent status"
            onClick={checkHealth}
          >
            ⟳ retry
          </button>
        )}
        {msgs.length > 0 && (
          <button
            type="button"
            className="agent-expand"
            aria-label={expanded ? 'collapse log' : 'expand log'}
            title={expanded ? 'collapse log' : 'expand log'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '⌃ collapse' : '⌄ expand'}
          </button>
        )}
        <button
          type="button"
          className="agent-hide"
          aria-label="hide agent bar"
          title="hide"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </div>

      {msgs.length > 0 && (
        <div className="agent-log" ref={listRef} role="log" aria-live="polite">
          {msgs.map((m, i) => (
            <MsgView key={i} m={m} onSelect={onSelectOv} />
          ))}
          {busy && <div className="agent-msg assistant agent-thinking">analyzing…</div>}
        </div>
      )}

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          disabled={inputDisabled}
          aria-label="ask the analyst"
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
        />
        {busy ? (
          <button
            type="button"
            className="agent-stop"
            aria-label="stop run"
            title="stop"
            onClick={() => abortRef.current?.abort()}
          >
            ■
          </button>
        ) : (
          <button
            type="submit"
            aria-label="send"
            disabled={!input.trim() || healthState === 'loading' || unconfigured}
          >
            ↑
          </button>
        )}
      </form>
    </div>
  )
}
