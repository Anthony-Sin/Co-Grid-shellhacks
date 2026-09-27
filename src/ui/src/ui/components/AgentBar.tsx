import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentHealth, type AgentTrace } from '../../lib/api'
import { streamAgentChat } from '../../lib/agentStream'
import { contextPrefix, inferDraftContext } from '../../lib/agentContext'
import { applyMapAction, mapActionFromTrace } from '../../lib/mapActions'
import { MsgView, type Msg } from './md'
import { AgentRailSelection } from './AgentRailSelection'
import { selectOvFromLog, useSelectionMessages } from './SelectionMessage'
import { useVoiceInput } from './useVoiceInput'
import { VoiceButton } from './VoiceButton'
import { useAppStore } from '../../state/store'
import {
  QUICK_ACTIONS, briefErrCopy, dropProgress, errText, freezeProgress,
  isAbort, raceAbort, type HealthState,
} from '../agentbarShared'

/**
 * AgentBar — the analyst agent DOCKED as a full-height right rail
 * (mirrors the left rail: opaque paper, one ink edge against the map).
 * Column: [rail head] → [detail card region — only while a selection
 * exists; the cards it hosts come straight from the store] → [pinned
 * "selected" context header naming the record] → [agent log, grows]
 * → [quick chips + input pinned to the bottom].
 *
 * Selection-aware: when an overlap is selected on the map, its id is sent
 * as context so "explain this" resolves against the real record.
 *
 * Pin-to-chat: "ask agent" buttons pin a removable CONTEXT CHIP above the
 * input (store.agentContext); each submitted message repeats it as a
 * compact `[context: …]` prefix. Input is an auto-growing textarea —
 * Enter submits, Shift+Enter newline. Quick chips hide once used (a
 * "⟲ suggestions" ghost restores them) and the whole chip row collapses
 * while a run is streaming. The agent's `map_focus` tool drives the map —
 * its ui_action is applied live from the tool trace.
 *
 * Honest states only: backend-down, unconfigured, cancelled, and
 * interrupted runs all surface visible messages — nothing fails silently.
 */

export function AgentBar() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
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

  // Escape aborts a running call; otherwise collapses the rail. Bail
  // while a selection exists and let the detail card / left rail consume
  // the keypress (one Esc = one dismissal, not two). The listener MUST
  // run in the capture phase: OverlapPanel's own Esc handler is on
  // `document` (bubble), so a bubble-phase listener here would observe
  // the store AFTER the selection was already cleared and wrongly
  // collapse the rail on the same keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useAppStore.getState()
      if (s.selectedOverlapId || s.selectedProjectId) return
      if (!open) return
      // the rail handled this keypress — stop it before OverlapPanel's
      // document-level bubble listener also collapses the left rail
      e.stopPropagation()
      if (abortRef.current) abortRef.current.abort()
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // a selection surfaces its detail card inside this rail — reopen the
  // rail so a map/list click is never answered by hidden chrome
  useEffect(() => {
    if (selectedOverlapId || selectedProjectId) setOpen(true)
  }, [selectedOverlapId, selectedProjectId])

  // a pinned record id that no longer matches the live selection is
  // stale — without this, send() prepends the old pin while the POST body
  // carries the new selection and the model sees two different ids
  useEffect(() => {
    const ctx = useAppStore.getState().agentContext
    if (ctx?.id && ctx.id !== selectedOverlapId && ctx.id !== selectedProjectId) {
      clearAgentContext()
    }
  }, [selectedOverlapId, selectedProjectId, clearAgentContext])

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
    // the model sees the canonical id; the pin stays for follow-ups.
    // Skip it when the pin IS the live selection — the POST body already
    // injects that record; the prefix would be a duplicate.
    const pinnedIsLive =
      agentContext?.kind === 'overlap' && agentContext.id === selectedOverlapId
    const content =
      agentContext && !pinnedIsLive ? contextPrefix(agentContext) + typed : typed

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

  // a NEW selection posts an assistant summary + one-shot follow-up
  // chips into this same log — posting, dedupe, and chip firing live in
  // ./SelectionMessage (kept out of this file for the 500-line cap)
  const renderSelMsg = useSelectionMessages({ setMsgs, send, busy, healthState, health })

  // speech-to-text dictation — Web Speech API, hidden when unsupported
  const voice = useVoiceInput(input, setInput)

  // collapsing the rail must end the capture — the hook is mounted above
  // the early-return, so without this a dictation session keeps recording
  // into a hidden textarea with no on-screen indicator (invisible hot mic)
  useEffect(() => {
    if (!open) voice.hush()
  }, [open, voice.hush])

  if (!open) {
    return (
      <button
        type="button"
        className="agent-bar-toggle"
        aria-label="show analyst rail"
        onClick={() => setOpen(true)}
      >
        <span className="agent-bar-toggle-label">✦ analyst</span>
      </button>
    )
  }

  const unconfigured = healthState === 'ok' && !!health && !health.configured
  const offline = healthState === 'failed' || unconfigured
  const inputDisabled = busy || healthState === 'loading' || unconfigured
  const freshChips = QUICK_ACTIONS.filter((a) => !usedChips.has(a.label))
  const showChips = !busy && (freshChips.length > 0 || usedChips.size > 0)
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
    <aside className="agent-rail" aria-label="Analyst rail">
      <div className="agent-rail-head">
        <h2 className="agent-rail-title">✦ analyst</h2>
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
        <button
          type="button"
          className="agent-hide"
          aria-label="hide analyst rail"
          title="hide"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </div>

      {/* selection region — detail card (scrollable) + pinned context
          header naming the record; own component (AGENTS.md 500-line cap) */}
      <AgentRailSelection />

      {msgs.length > 0 ? (
        <div className="agent-log" ref={listRef} role="log" aria-live="polite">
          {msgs.map((m, i) => renderSelMsg(m, i) ?? (
            <MsgView key={i} m={m} onSelect={selectOvFromLog} />
          ))}
          {/* skip the generic spinner while a ⚙ progress line already
              shows which tool is running — one indicator, not two */}
          {busy && !msgs[msgs.length - 1]?.progress && (
            <div className="agent-msg assistant agent-thinking">analyzing…</div>
          )}
        </div>
      ) : (
        <div className="agent-rail-empty" aria-hidden>
          {healthState === 'ok' && health?.configured
            ? 'no messages yet — pick a suggestion or ask below'
            : 'the analyst log lives here once the agent answers'}
        </div>
      )}

      <div className="agent-foot">
        {/* one-shot chips: a press consumes the chip for the session, and
            the whole row hides while a run streams — ⟲ restores them */}
        {showChips && (
          <div className="agent-chips">
            {freshChips.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={
                  healthState !== 'ok' ||
                  (!!health &&
                    !health.configured &&
                    !(a.label === 'Explain selected' && selectedOverlapId))
                }
                onClick={() => {
                  // only consume the chip when send() will actually run —
                  // marking it used on a no-op (mid-health-check, busy race)
                  // eats the suggestion without ever asking the model
                  if (busy || healthState === 'loading' || !health) return
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
          <VoiceButton voice={voice} />
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
    </aside>
  )
}
