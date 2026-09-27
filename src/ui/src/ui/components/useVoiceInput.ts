/**
 * useVoiceInput — dictate into the agent composer via the Web Speech
 * API (Chromium ships it; zero dependencies, nothing leaves the page
 * except the browser's own speech service).
 *
 * Feature-detected: unsupported browsers hide the mic button entirely.
 * Finals append to the draft; interim words render live so the user
 * sees them land. Listening state survives until toggled off, a hard
 * error, or unmount — send() does not steal the mic mid-dictation.
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

  const stop = useCallback(() => {
    recRef.current?.stop()
  }, [])

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
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalsRef.current += r[0].transcript
        else interim += r[0].transcript
      }
      const spoken = finalsRef.current + interim
      const glue = baseRef.current && spoken && !baseRef.current.endsWith(' ') ? ' ' : ''
      setDraft(baseRef.current + glue + spoken.trimStart())
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setDenied(true)
      setListening(false)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [Ctor, draft, listening, setDraft, stop])

  // the mic dies with the component — never leak a live capture session
  useEffect(() => () => recRef.current?.abort(), [])

  return { supported: !!Ctor, listening, denied, toggle }
}
