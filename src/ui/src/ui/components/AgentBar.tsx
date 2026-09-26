import { useEffect, useRef, useState } from 'react'
import { api, type AgentHealth } from '../../lib/api'
import { useAppStore } from '../../state/store'

/**
 * AgentBar — floating bottom command bar for the CO-GRID analyst agent.
 * Drive-style: a pill input with quick-action chips above it. The backend
 * (/api/agent/chat) runs a tool-calling loop over real pipeline data —
 * this component only renders replies + tool traces.
 *
 * Selection-aware: when an overlap is selected on the map, its id is sent
 * as context so "explain this" resolves against the real record.
 */

interface Msg {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string | null
  tools?: string[]
}

const QUICK_ACTIONS = [
  { label: 'Top opportunities', prompt: 'List the top 3 coordination opportunities — overlap id, utilities, tier, distance, and whether timelines overlap.' },
  { label: 'Explain selected', prompt: 'Explain the currently selected overlap: what could the two utilities share and when is the shared build window?' },
  { label: 'Timeline view', prompt: 'Summarize build activity per year per utility and flag the busiest coordination windows.' },
  { label: 'Data health', prompt: 'How much of the dataset is missing timeline dates or location confidence? Be honest about gaps.' },
]

export function AgentBar() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const [health, setHealth] = useState<AgentHealth | null>(null)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.agentHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy || !health?.configured) return
    const next = [...msgs, { role: 'user' as const, content }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const res = await api.agentChat(
        next.map((m) => ({ role: m.role, content: m.content })),
        selectedOverlapId,
      )
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          reasoning: res.reasoning,
          tools: res.tool_trace.map((t) => t.tool),
        },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: 'assistant', content: `agent error: ${e instanceof Error ? e.message : e}` },
      ])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="agent-bar-toggle" onClick={() => setOpen(true)}>
        analyst ✦
      </button>
    )
  }

  return (
    <div className="agent-bar">
      <div className="agent-chips">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={busy || !health?.configured}
            onClick={() => send(a.prompt)}
          >
            {a.label}
          </button>
        ))}
        <button type="button" className="agent-hide" onClick={() => setOpen(false)} title="hide">
          ×
        </button>
      </div>

      {msgs.length > 0 && (
        <div className="agent-log" ref={listRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`agent-msg ${m.role}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="agent-tools">⚙ {m.tools.join(' · ')}</div>
              )}
              {m.content}
              {m.reasoning && (
                <details className="agent-reasoning">
                  <summary>thinking</summary>
                  {m.reasoning}
                </details>
              )}
            </div>
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
          type="text"
          value={input}
          disabled={busy || !health?.configured}
          placeholder={
            health === null
              ? 'checking agent…'
              : health.configured
                ? 'Ask about overlaps, projects, timelines…'
                : 'agent offline — set AGENT_API_KEY in .env'
          }
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim() || !health?.configured}>
          {busy ? '…' : '↑'}
        </button>
      </form>
    </div>
  )
}
