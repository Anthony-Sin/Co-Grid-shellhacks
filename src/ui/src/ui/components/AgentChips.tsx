/**
 * AgentChips — the quick-action suggestion row in the agent footer.
 * Extracted from AgentBar for the 500-line cap (AGENTS.md §1).
 *
 * One-shot by design: a press consumes the chip for the session so the
 * rail doesn't re-suggest already-answered prompts; ⟲ restores them.
 * The row stays mounted while a run streams (buttons disable) — hiding
 * it collapsed the footer ~96px and read as "suggestions vanished".
 */
import type { AgentHealth } from '../../lib/api'
import { QUICK_ACTIONS, type HealthState } from '../agentbarShared'

interface AgentChipsProps {
  busy: boolean
  health: AgentHealth | null
  healthState: HealthState
  selectedOverlapId: string | null
  usedChips: Set<string>
  onUse: (label: string, prompt: string) => void
  onRestore: () => void
}

export function AgentChips({
  busy, health, healthState, selectedOverlapId, usedChips, onUse, onRestore,
}: AgentChipsProps) {
  const freshChips = QUICK_ACTIONS.filter((a) => !usedChips.has(a.label))
  if (freshChips.length === 0 && usedChips.size === 0) return null
  return (
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
              !(a.label === 'Explain selected' && selectedOverlapId)) ||
            (a.label === 'Explain selected' && !selectedOverlapId)
          }
          onClick={() => onUse(a.label, a.prompt)}
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
          onClick={onRestore}
        >
          ⟲ suggestions
        </button>
      )}
    </div>
  )
}
