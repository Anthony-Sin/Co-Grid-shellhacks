/**
 * VoiceButton — the mic toggle inside the agent composer. Presentational
 * only: all speech plumbing lives in ./useVoiceInput. Renders an
 * outlined ink mic that fills tier-1 red and breathes while listening;
 * a denied permission reads as a tooltip hint, not a dead button.
 */
import type { VoiceInput } from './useVoiceInput'

export function VoiceButton({ voice }: { voice: VoiceInput }) {
  if (!voice.supported) return null
  return (
    <button
      type="button"
      className={`agent-mic${voice.listening ? ' on' : ''}`}
      aria-label={voice.listening ? 'stop dictation' : 'dictate a question'}
      aria-pressed={voice.listening}
      title={
        voice.denied
          ? 'microphone blocked — allow mic access to dictate'
          : voice.listening
            ? 'listening… click to stop'
            : 'dictate a question'
      }
      onClick={voice.toggle}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-2.06A8 8 0 0 0 20 12h-2z"
        />
      </svg>
    </button>
  )
}
