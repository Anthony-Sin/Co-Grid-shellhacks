import { useEffect, useRef, useState } from 'react'
import { api, type AgentHealth, type AgentReply } from '../../lib/api'
import { renderMarkdown } from './md'
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
  progress?: boolean // transient live-tool line — replaced by the real reply
}

const QUICK_ACTIONS = [
  { label: 'Exec summary', prompt: 'Give me the headline executive summary — counts, dominant utility pair, peak build season, mandatory joint outages, top opportunity.' },
  { label: 'Top opportunities', prompt: 'List the top 3 coordination opportunities — overlap id, utilities, tier, distance, and whether timelines overlap.' },
  { label: 'Explain selected', prompt: 'Explain the currently selected overlap: what could the two utilities share and when is the shared build window?' },
  { label: 'Staging plan', prompt: 'Where would you put shared staging yards? Use the staging_clusters tool and name the top clusters with their member counts.' },
  { label: 'Timeline view', prompt: 'Summarize build activity per year per utility and flag the busiest coordination windows.' },
  { label: '2027 season', prompt: 'What joint work is schedulable in 2027? Use season_calendar — the top records and their utility pairs.' },
  { label: 'Crew relays', prompt: 'Could one crew relay between projects end-to-start across years? Use handoff_chains and name the longest chains with their project sequence and years.' },
  { label: 'What-if slip', prompt: 'If the currently selected project slipped two years, which coordination records would lose their timeline relationship? Use what_if_shift on the selected overlap.' },
  { label: 'Data health', prompt: 'How much of the dataset is missing timeline dates or location confidence? Be honest about gaps.' },
]

export function AgentBar() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectOverlap = useAppStore((s) => s.selectOverlap)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
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

  /** POST + ReadableStream SSE reader — EventSource can't POST. Falls back
   * to plain /chat if the stream errors mid-flight. */
  const streamChat = async (
    history: { role: string; content: string }[],
    onTool: (name: string) => void,
  ): Promise<AgentReply | null> => {
    const res = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, ...(selectedOverlapId ? { overlap_id: selectedOverlapId } : {}) }),
    })
    if (!res.ok) {
      // surface the real server reason (400 limit, 429 rate, 503 unconfigured)
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.detail || `stream HTTP ${res.status}`)
    }
    if (!res.body) return null
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let final: AgentReply | null = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const ev = part.match(/^event: (\w+)\ndata: (.*)$/s)
        if (!ev) continue
        const data = JSON.parse(ev[2] || 'null')
        if (ev[1] === 'tool' && data?.tool) onTool(data.tool)
        if (ev[1] === 'final') final = data
        if (ev[1] === 'error') throw new Error(data?.message || 'stream error')
      }
    }
    return final
  }

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return
    if (!health?.configured) {
      // graceful fallback — 'Explain selected' still works via the
      // deterministic /api/analysis/brief route (no LLM key needed)
      if (selectedOverlapId) {
        setMsgs((m) => [...m, { role: 'user' as const, content }])
        setBusy(true)
        try {
          const b = await api.analysisBrief(selectedOverlapId)
          setMsgs((m) => [...m, { role: 'assistant' as const, content: b.brief }])
        } catch {
          setMsgs((m) => [...m, {
            role: 'assistant' as const,
            content: 'agent offline — set AGENT_API_KEY in .env for full analysis',
          }])
        } finally {
          setBusy(false)
        }
      }
      return
    }
    const next = [...msgs, { role: 'user' as const, content }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    const liveTools: string[] = []
    // backend hard-caps history at 40 messages — keep the last 30 so long
    // sessions degrade gracefully instead of dying on HTTP 400
    const history = next.slice(-30).map((m) => ({ role: m.role, content: m.content }))
    try {
      const res = await streamChat(
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
      )
      const reply = res ?? (await api.agentChat(history, selectedOverlapId))
      setMsgs((m) => [
        // replace the transient ⚙ progress line with the real answer
        ...(m[m.length - 1]?.progress ? m.slice(0, -1) : m),
        {
          role: 'assistant',
          content: reply.reply,
          reasoning: reply.reasoning,
          tools: reply.tool_trace.map((t) => t.tool),
        },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...(m[m.length - 1]?.progress ? m.slice(0, -1) : m),
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
            disabled={
              busy ||
              (health?.configured === false &&
                !(a.label === 'Explain selected' && selectedOverlapId))
            }
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
            <div key={i} className={`agent-msg ${m.role}${m.progress ? ' agent-progress' : ''}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="agent-tools">⚙ {m.tools.join(' · ')}</div>
              )}
              {m.role === 'assistant' && !m.progress
                ? renderMarkdown(m.content, (oid, scene) => {
                    if (scene === 'savannah' || scene === 'augusta' ||
                        scene === 'state') {
                      setActiveScene(scene)
                    }
                    selectOverlap(oid)
                  })
                : m.content}
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
