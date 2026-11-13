// Demo build: replaces the ElevenLabs Scribe hook (which needs a server-minted token) with a keyless voice.
// Same options and return shape, so the Teach page is unchanged. The voice is picked in the demo bar:
//  - 'script' speaks a sample lecture word by word (interim text, then a committed utterance);
//  - 'mic' uses the browser's built-in speech recognition (webkitSpeechRecognition).
// Final utterances go through the same partitioning as the real hook, so smart annotations and PDF pages
// capture speech exactly as they do in the full app.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getData } from '../demo/db'
import { annotationLine, scriptFor } from '../demo/scripts'
import { micSupported, useVoiceMode } from '../demo/voice'
import { partitionTimestampedTranscript, type AnnotationCaptureInterval } from './scribeModel'
import {
  calculateSpeechMetrics,
  countWords,
  type SpeechMetrics,
  type SpeechSample,
  type TranscriptionContext,
  type TranscriptionResultHandler,
} from './transcriptionModel'

const EMPTY_METRICS: SpeechMetrics = { rollingWpm: null, averageConfidence: null, baselineWpm: null }
const WORD_MS = 290
const PAUSE_MS = 1_400

export interface UseScribeTranscriptionOptions {
  enabled: boolean
  sessionId: string
  onFinal: TranscriptionResultHandler
  captureContext?: () => TranscriptionContext
  captureAnnotationIntervals?: () => AnnotationCaptureInterval[]
  capturePageAt?: (ms: number) => string | null | undefined
  scopeKey?: string
}

interface Capture {
  context: TranscriptionContext | null
  startedAt: string
}

// Minimal typing for the browser's speech recognition.
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string; confidence: number }
}
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function createRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function useScribeTranscription({
  enabled,
  sessionId,
  onFinal,
  captureContext,
  captureAnnotationIntervals,
  capturePageAt,
  scopeKey,
}: UseScribeTranscriptionOptions) {
  const mode = useVoiceMode()
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<SpeechMetrics>(EMPTY_METRICS)

  const opts = useRef({ onFinal, captureContext, captureAnnotationIntervals, capturePageAt, sessionId })
  opts.current = { onFinal, captureContext, captureAnnotationIntervals, capturePageAt, sessionId }
  const samples = useRef<SpeechSample[]>([])
  const startedAt = useRef<number | null>(null)
  /** Live voice: commit what's been said so far (used by Smart ✓ and stop). */
  const flushRef = useRef<() => void>(() => {})
  const stopRef = useRef<() => void>(() => {})

  const refreshMetrics = useCallback((now = Date.now()) => {
    setMetrics(calculateSpeechMetrics(samples.current, now, startedAt.current))
  }, [])

  /** Same path as the real hook: split by annotation interval and PDF page, then hand to the board. */
  const save = useCallback(
    (captured: Capture, text: string) => {
      const clean = text.trim()
      if (!clean) return
      const endedAt = new Date().toISOString()
      const { onFinal: emit, captureAnnotationIntervals: intervals, capturePageAt: pageAt } = opts.current
      const parts = partitionTimestampedTranscript(clean, undefined, null, captured.startedAt, endedAt, intervals?.() ?? [], {
        at: (ms) => pageAt?.(ms),
        fallback: captured.context?.pageBlockId ?? null,
      })
      for (const part of parts) {
        const context = captured.context ? { ...captured.context, annotationId: part.annotationId, pageBlockId: part.pageBlockId } : null
        emit(part.text, null, part.tStart, part.tEnd, context)
      }
      const now = Date.now()
      samples.current = [...samples.current, { completedAt: now, wordCount: countWords(clean), confidence: null }]
      refreshMetrics(now)
    },
    [refreshMetrics],
  )

  const capture = (): Capture => ({ context: opts.current.captureContext?.() ?? null, startedAt: new Date().toISOString() })

  useLayoutEffect(() => {
    samples.current = []
    startedAt.current = null
    setInterim('')
    setListening(false)
    setError(null)
    setMetrics(EMPTY_METRICS)
  }, [scopeKey])

  useEffect(() => {
    if (!listening) return
    const t = window.setInterval(refreshMetrics, 1_000)
    return () => window.clearInterval(t)
  }, [listening, refreshMetrics])

  useEffect(() => {
    if (!enabled) {
      setInterim('')
      setListening(false)
      return
    }
    let alive = true
    if (startedAt.current === null) startedAt.current = Date.now()
    setError(null)

    if (mode === 'mic' && micSupported()) {
      // ------------------------------------------------ browser speech recognition
      const rec = createRecognition()!
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      let current: Capture | null = null
      let pending = ''
      rec.onstart = () => alive && setListening(true)
      rec.onresult = (e) => {
        let partial = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          current ??= capture()
          if (r.isFinal) {
            save(current, r[0].transcript)
            current = null
          } else partial += r[0].transcript
        }
        pending = partial
        setInterim(partial)
      }
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        alive = false
        setListening(false)
        setError(
          e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'The browser blocked the microphone. Allow it for this site, or switch the demo voice to the sample lecture.'
            : `Speech recognition stopped (${e.error}). Turn recording off and on, or use the sample lecture.`,
        )
      }
      // Browsers end recognition after a silence: keep it going while recording is on.
      rec.onend = () => {
        if (alive) {
          try {
            rec.start()
          } catch {
            /* already restarting */
          }
        }
      }
      flushRef.current = () => {
        if (current && pending) save(current, pending)
        current = null
        pending = ''
        setInterim('')
      }
      stopRef.current = () => {
        alive = false
        flushRef.current()
        rec.abort()
        setListening(false)
      }
      try {
        rec.start()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t start speech recognition.')
      }
      return () => stopRef.current()
    }

    // ------------------------------------------------ sample lecture, word by word
    const session = getData().sessions.find((s) => s.id === sessionId)
    const lecture = getData().lectures.find((l) => l.id === session?.lecture_id)
    const lines = scriptFor(String(session?.title ?? lecture?.title ?? ''))
    const progressKey = `aside-demo-line:${sessionId}`
    const remember = (n: number) => {
      try {
        sessionStorage.setItem(progressKey, String(n))
      } catch {
        /* private mode */
      }
    }
    let line = 0
    try {
      line = Number(sessionStorage.getItem(progressKey) ?? 0) || 0
    } catch {
      /* private mode */
    }
    let circles = 0
    let lastAnn: string | null = null
    let annSentence = 0
    let timer: number | undefined
    let current: Capture | null = null
    let words: string[] = []
    let said = 0

    const nextSentence = () => {
      if (!alive) return
      current = capture()
      const annId = current.context?.annotationId
      if (annId) {
        // A lasso is open: talk about the circled image.
        const ann = getData().annotations.find((a) => a.id === annId)
        const block = getData().blocks.find((b) => b.id === ann?.block_id)
        const asset = getData().assets.find((a) => a.id === block?.asset_id)
        if (annId !== lastAnn) {
          if (lastAnn !== null) circles += 1
          lastAnn = annId
          annSentence = 0
        }
        words = annotationLine((asset?.key_terms as string[] | null) ?? [], circles, annSentence++).split(' ')
      } else if (line < lines.length) {
        words = lines[line].split(' ')
        line += 1
        remember(line)
      } else {
        // The sample lecture is over: stay quiet (recording stays on), but keep answering new circles.
        current = null
        setInterim('')
        timer = window.setTimeout(nextSentence, 1_000)
        return
      }
      said = 0
      speak()
    }
    const speak = () => {
      if (!alive) return
      said += 1
      setInterim(words.slice(0, said).join(' '))
      if (said < words.length) timer = window.setTimeout(speak, WORD_MS + Math.random() * 120)
      else timer = window.setTimeout(commit, 350)
    }
    const commit = () => {
      if (!alive || !current) return
      save(current, words.slice(0, said).join(' '))
      current = null
      setInterim('')
      timer = window.setTimeout(nextSentence, PAUSE_MS)
    }
    flushRef.current = () => {
      if (!current || said === 0) return
      window.clearTimeout(timer)
      save(current, words.join(' '))
      current = null
      setInterim('')
      if (alive) timer = window.setTimeout(nextSentence, PAUSE_MS)
    }
    stopRef.current = () => {
      if (current && said >= 3) save(current, words.slice(0, said).join(' '))
      current = null
      alive = false
      window.clearTimeout(timer)
      setInterim('')
      setListening(false)
    }
    setListening(true)
    timer = window.setTimeout(nextSentence, 600)
    return () => stopRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scopeKey, mode, sessionId, save])

  const stop = useCallback(async () => {
    stopRef.current()
  }, [])
  const flush = useCallback(async () => {
    flushRef.current()
  }, [])

  return { interim, listening, supported: true, error, metrics, confidenceSupported: false, stop, flush }
}
