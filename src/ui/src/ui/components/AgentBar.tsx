import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentHealth, type AgentTrace } from '../../lib/api'
import { streamAgentChat } from '../../lib/agentStream'
import { contextPrefix, inferDraftContext } from '../../lib/agentContext'
import { applyMapAction, mapActionFromTrace } from '../../lib/mapActions'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { MsgView, type Msg, type OverlapSelectFn } from './md'
import { useAppStore } from '../../state/store'
import {
  QUICK_ACTIONS, briefErrCopy, dropProgress, errText, freezeProgress,
  isAbort, raceAbort, type HealthState,
} from '../agentbarShared'

/**
 * AgentBar — floating bottom command bar for the CO-GRID analyst agent.
 * Drive-style: a pill input with quick-action chips above it. The backend
 * (/api/agent/chat) runs a tool-calling loop over real pipeline data —
 * this component owns the connection; md.tsx owns reply rendering.
 *
 * Selection-aware: when an overlap is selected on the map, its id is sent
 * as context so "explain this" resolves against the real record.
 *
 * Pin-to-chat: "ask agent" buttons pin a removable CONTEXT CHIP above the
 * input (store.agentContext); each submitted message repeats it as a
 * compact `[context: …]` prefix. Input is an auto-growing textarea —
 * Enter submits, Shift+Enter newline. Quick chips hide once used (a
 * "⟲ suggestions" ghost restores them). The agent's `map_focus` tool
 * drives the map — its ui_action is applied live from the tool trace.
 *
 * Honest states only: backend-down, unconfigured, cancelled, and
 * interrupted runs all surface visible messages — nothing fails silently.
 */

export function AgentBar() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
  const promptDraft = useAppStore((s) => s.agentPromptDraft)
  const setPromptDraft = useAppStore((s) => s.setAgentPromptDraft)
  const agentContext = useAppStore((s) => s.agentContext)
  const setAgentContext = useAppStore((s) => s.setAgentContext)
  const clearAgentContext = useAppStore((s) => s.clearAgentContext)
  const [health, setHealth] = useState<AgentHealth | null>(null)
  const [healthState, setHealthState] = useState<HealthState>('loading')
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  // quick chips are one-shot suggestions — once used they hide for the
  // session; the ⟲ ghost restores them
  const [usedChips, setUsedChips] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
  // opens the bar, prefills the input, pins its context chip, then clears
  useEffect(() => {
    if (!promptDraft) return
    setOpen(true)
    setInput(promptDraft)
    // resolve the chip BEFORE clearing — clearing the draft also clears
    // any context the caller pinned explicitly alongside it
    const ctx =
      useAppStore.getState().agentContext ?? inferDraftContext(promptDraft)
    setPromptDraft(null)
    setAgentContext(ctx)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [promptDraft, setPromptDraft, setAgentContext])

  // Escape aborts a running call; otherwise collapses the bar. This
  // listener mounts at app start — BEFORE any detail card's listener —
  // so it runs first: bail while a selection exists and let the detail
  // card consume the keypress (one Esc = one dismissal, not two).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useAppStore.getState()
      if (s.selectedOverlapId || s.selectedProjectId) return
      if (abortRef.current) abortRef.current.abort()
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  // auto-grow the textarea to ~4 rows (CSS max-height caps it; beyond
  // that the field scrolls — normal chat behavior)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input, open])

  const onSelectOv = useCallback<OverlapSelectFn>(
    (oid, scene) => {
      if (scene === 'savannah' || scene === 'augusta' || scene === 'state') {
        // deep-link form carries its own authoritative scene
        setActiveScene(scene)
        selectOverlap(oid)
      } else {
        // bare OV-id — resolve the record's zone → scene
        selectOverlapInScene(oid)
      }
    },
    [setActiveScene, selectOverlap],
  )

  /** A map_focus tool event anywhere in the run drives the map — the
   * SSE tool event carries the result preview, so the action lands live
   * while the model is still composing its answer. */
  const applyTraceMapAction = (t: AgentTrace) => {
    const act = mapActionFromTrace(t)
    if (act) applyMapAction(act)
  }

  const send = async (text: string) => {
    const typed = text.trim()
    if (!typed || busy) return
    // the pinned chip rides the message as a compact context prefix —
    // the model sees the canonical id; the pin stays for follow-ups
    const content = agentContext ? contextPrefix(agentContext) + typed : typed

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
      const { reply, sawEvents } = await streamAgentChat(
        history,
        selectedOverlapId,
        (name, entry) => {
          liveTools.push(name)
          applyTraceMapAction(entry)
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
        // the non-SSE path delivers the whole trace at once — apply its
        // map actions now (live events never fired)
        for (const t of final.tool_trace ?? []) applyTraceMapAction(t)
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
  const freshChips = QUICK_ACTIONS.filter((a) => !usedChips.has(a.label))
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
        {freshChips.map((a) => (
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
            onClick={() => {
              // a click on an enabled chip always starts a run — mark it
              // used so the suggestion collapses out of the way
              setUsedChips((s) => new Set(s).add(a.label))
              send(a.prompt)
            }}
          >
            {a.label}
          </button>
        ))}
        {usedChips.size > 0 && (
          <button
            type="button"
            className="agent-suggest"
            aria-label="restore suggestion chips"
            title="bring the suggestion chips back"
            onClick={() => setUsedChips(new Set())}
          >
            ⟲ suggestions
          </button>
        )}
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
          {/* skip the generic spinner while a ⚙ progress line already
              shows which tool is running — one indicator, not two */}
          {busy && !msgs[msgs.length - 1]?.progress && (
            <div className="agent-msg assistant agent-thinking">analyzing…</div>
          )}
        </div>
      )}

      {agentContext && (
        <div className="agent-context" aria-label="pinned context">
          <span
            className="agent-context-chip"
            title={agentContext.id ?? agentContext.label}
          >
            ◎ <span className="agent-context-label">{agentContext.label}</span>
            <button
              type="button"
              aria-label="remove pinned context"
              title="unpin"
              onClick={clearAgentContext}
            >
              ×
            </button>
          </span>
        </div>
      )}

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          disabled={inputDisabled}
          aria-label="ask the analyst"
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter newline; don't submit mid-IME
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
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
