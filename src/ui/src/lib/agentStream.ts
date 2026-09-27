import type { AgentReply, AgentTrace } from './api'

/**
 * POST + ReadableStream SSE reader for /api/agent/chat/stream —
 * EventSource can't POST. `onTool` fires once per completed tool call
 * with the full trace entry ({tool, args, preview}) so callers can show
 * live progress AND react to tool results (e.g. map_focus ui_actions).
 *
 * Returns the `final` reply plus whether ANY event was seen, so the
 * caller can tell a dead connection (safe to retry via /chat) from a
 * stream that died mid-chain (must NOT re-run the paid tool loop).
 */
export async function streamAgentChat(
  history: { role: string; content: string }[],
  overlapId: string | null,
  onTool: (name: string, entry: AgentTrace) => void,
  signal: AbortSignal,
): Promise<{ reply: AgentReply | null; sawEvents: boolean }> {
  const res = await fetch('/api/agent/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: history,
      ...(overlapId ? { overlap_id: overlapId } : {}),
    }),
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
      if (ev[1] === 'tool' && data?.tool) onTool(data.tool, data)
      if (ev[1] === 'final') final = data
      if (ev[1] === 'error') throw new Error(data?.message || 'stream error')
    }
  }
  return { reply: final, sawEvents }
}
