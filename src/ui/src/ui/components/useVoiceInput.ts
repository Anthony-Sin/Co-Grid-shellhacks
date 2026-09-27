/**
 * useVoiceInput — dictate into the agent composer via the Web Speech
 * API (Chromium ships it; zero dependencies, nothing leaves the page
 * except the browser's own speech service).
 *
 * Feature-detected: unsupported browsers hide the mic button entirely.
 * Finals append to the draft; interim words render live so the user
 * sees them land. Listening survives until toggled off, a hard error,
 * unmount — or an external draft edit: send() clearing the field (or
 * the user typing mid-utterance) aborts the session — stop() would
 * still deliver the buffered audio as a final result, resurrecting
 * just-sent words; abort() discards it and a dead-session guard drops
 * any late event either way.
 *
 * Every handler — including onresult — is identity-guarded against the
 * rec that installed it: an errored or aborted session's queued events
 * can land after a fresh session already owns the mic, and the
 * component-level deadRef is reset for the new session, so the stale
 * session's rec identity is the only reliable discriminator. Without
 * it a superseded session could null out the live session's
 * bookkeeping (invisible capture) or inject its transcript into the
 * new draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* minimal structural types — the DOM lib doesn't ship them everywhere */
interface SpeechResultItem { isFinal: boolean; 0: { transcript: string } }
interface SpeechResultEvent { resultIndex: number; results: ArrayLike<SpeechResultItem> }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

const SR = (): (new () => SpeechRecognitionLike) | undefined =>
  (window as unknown as Record<string, unknown>).SpeechRecognition as
    | (new () => SpeechRecognitionLike)
    | undefined
  ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition as
    | (new () => SpeechRecognitionLike)
    | undefined

export interface VoiceInput {
  supported: boolean
  listening: boolean
  /** 'denied' when the mic permission was refused — render a hint once */
  denied: boolean
  toggle: () => void
  /** kill the capture with no pending write — rail collapse, teardown */
  hush: () => void
}

export function useVoiceInput(
  draft: string,
  setDraft: (v: string) => void,
): VoiceInput {
  const Ctor = useMemo(SR, [])
  const [listening, setListening] = useState(false)
  const [denied, setDenied] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  /** draft text the user had before dictation — interim words sit on top */
  const baseRef = useRef('')
  const finalsRef = useRef('')
  /** last value this hook wrote via setDraft — any other draft value is
   * an external edit (send() clearing the field, manual typing). Trying
   * to rebase mid-utterance would double-append the in-flight interim,
   * so the session is aborted instead: sent text can never resurrect,
   * and a user edit is never overwritten by the next result. */
  const writtenRef = useRef<string | null>(null)
  /** set before abort() — drops any event that outlives the session */
  const deadRef = useRef(false)

  // start/stop/abort throw InvalidStateError when the engine's real
  // state is past the call — the SpeechRecognitionLike interface can't
  // introspect it, so every termination call gets a try/catch
  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* engine already stopped */
    }
  }, [])

  const hush = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    deadRef.current = true
    // eager teardown — don't trust the queued onend to arrive promptly
    // (or at all): until it does, `listening` would keep the mic dot lit
    // and a second hush() would re-abort the same dead session
    recRef.current = null
    setListening(false)
    try {
      rec.abort()
    } catch {
      /* engine already aborted */
    }
  }, [])

  useEffect(() => {
    if (recRef.current && draft !== writtenRef.current) hush()
  }, [draft, hush])

  const toggle = useCallback(() => {
    if (listening) {
      stop()
      return
    }
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseRef.current = draft
    finalsRef.current = ''
    writtenRef.current = draft
    deadRef.current = false
    rec.onresult = (e) => {
      // same stale-event guard as onend — deadRef alone isn't enough:
      // it's component-scoped and resets when a new session starts, so
      // a late result from a superseded rec could pass it and inject
      // the old transcript into the fresh session's draft
      if (deadRef.current || recRef.current !== rec) return
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalsRef.current += r[0].transcript
        else interim += r[0].transcript
      }
      const spoken = finalsRef.current + interim
      const glue = baseRef.current && spoken && !baseRef.current.endsWith(' ') ? ' ' : ''
      const next = baseRef.current + glue + spoken.trimStart()
      writtenRef.current = next
      setDraft(next)
    }
    rec.onend = () => {
      // a superseded session's terminal event must not touch the live
      // session's bookkeeping — Chrome can queue onend well past onerror
      if (recRef.current !== rec) return
      recRef.current = null
      setListening(false)
    }
    rec.onerror = (e) => {
      if (recRef.current !== rec) return
      // the session is dead by definition here — detach so a fast
      // re-toggle isn't blocked by this rec's still-queued onend
      recRef.current = null
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setDenied(true)
      setListening(false)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
      // a session that actually started clears a stale denied flag — the
      // permission may have been granted since the last refusal
      setDenied(false)
    } catch {
      setListening(false)
    }
  }, [Ctor, draft, listening, setDraft, stop])

  // the mic dies with the component — never leak a live capture session
  useEffect(
    () => () => {
      try {
        recRef.current?.abort()
      } catch {
        /* engine already aborted */
      }
    },
    [],
  )

  return { supported: !!Ctor, listening, denied, toggle, hush }
}
