// Demo build only. A "Demo" badge that reveals Guide and Reset to its right on hover (tap on touch screens).
// On the dashboard it sits next to the aside logo (#demo-badge-slot); elsewhere it floats in the bottom-right
// corner, and on the Teach screen it also carries the voice picker. The guide opens once on the first visit.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { resetDemo } from './boot'
import { micSupported, setVoiceMode, useVoiceMode } from './voice'
import '../styles/dialogs.css'
import './demo.css'

const WELCOMED = 'aside-demo-welcomed'

function seen(): boolean {
  try {
    return localStorage.getItem(WELCOMED) === '1'
  } catch {
    return false
  }
}

function DemoBadge({ onGuide, onReset }: { onGuide: () => void; onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Touch screens have no hover: a tap opens it, a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} className={`demo-badge${open ? ' open' : ''}`}>
      <button
        className="demo-tag"
        aria-expanded={open}
        aria-label="Demo mode: show demo options"
        onClick={() => setOpen((o) => !o)}
      >
        Demo
      </button>
      <div className="demo-actions">
        <button
          onClick={() => {
            setOpen(false)
            onGuide()
          }}
        >
          Guide
        </button>
        <button
          onClick={() => {
            setOpen(false)
            onReset()
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Teach a lecture',
    body: (
      <>
        Press <b>Start</b> on “Cellular respiration”, tap the lecture title at the top of the sidebar, and choose{' '}
        <b>Start recording</b>. A sample lecture plays; pick <b>My mic</b> in the corner to use your own voice.
      </>
    ),
  },
  {
    title: 'Use the board',
    body: (
      <>
        Drag images in from the sidebar and draw on them. Switch to <b>Smart annotate</b>, circle part of a diagram
        while it talks, then press <b>✓</b> to link those words to that spot.
      </>
    ),
  },
  {
    title: 'Get the study notes',
    body: (
      <>
        Choose <b>End session</b> in the title menu. Or open a recorded session on the dashboard to see finished notes and
        the transcript.
      </>
    ),
  },
  {
    title: 'Prepare a lecture',
    body: <>Press <b>New lecture</b> and add images, PDFs or typed notes.</>,
  },
]

function Guide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog demo-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-guide-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="demo-guide-title">Welcome to the aside demo</h2>
        <p className="demo-guide-lede">
          aside is an iPad whiteboard for a teacher with ALS: he talks, and the board writes it down. This demo runs entirely in
          your browser with sample content. There’s no account and nothing is uploaded, and the AI is simulated.
        </p>
        <ol className="demo-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="demo-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="demo-step-title">{s.title}</p>
                <p className="demo-step-body">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="demo-guide-foot">
          Students follow along at <b>/join</b>: open it in a second tab and type the code shown while teaching. Hover the{' '}
          <b>Demo</b> badge any time to reopen this guide or reset the demo.
        </p>
        <div className="dialog-actions">
          <button className="primary" autoFocus onClick={onClose}>
            Let’s go
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DemoBar() {
  const { pathname } = useLocation()
  const voice = useVoiceMode()
  const [guide, setGuide] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const teaching = pathname.startsWith('/teach/')
  const student = pathname.startsWith('/live/') || pathname.startsWith('/join')

  useEffect(() => {
    if (!seen() && !student) setGuide(true)
  }, [student])

  const closeGuide = () => {
    setGuide(false)
    try {
      localStorage.setItem(WELCOMED, '1')
    } catch {
      /* ignore */
    }
  }

  // Next to the logo when the page has a slot for it (checked right after each route renders).
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setSlot(document.getElementById('demo-badge-slot'))
    const t = window.setTimeout(() => setSlot(document.getElementById('demo-badge-slot')), 300)
    return () => window.clearTimeout(t)
  }, [pathname])

  // Screens with a bottom composer (lecture prep): float just above it, following its height as it grows.
  const [lift, setLift] = useState(0)
  useEffect(() => {
    setLift(0)
    let observer: ResizeObserver | null = null
    const find = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>('.pp-composer-wrap')
      if (!el) return
      window.clearInterval(find)
      const update = () => setLift(Math.max(0, window.innerHeight - el.getBoundingClientRect().top))
      observer = new ResizeObserver(update)
      observer.observe(el)
      update()
    }, 250)
    const stopLooking = window.setTimeout(() => window.clearInterval(find), 5_000)
    return () => {
      window.clearInterval(find)
      window.clearTimeout(stopLooking)
      observer?.disconnect()
    }
  }, [pathname])

  if (student) {
    return (
      <div className="demo-float no-print" role="note">
        <span className="demo-tag static">Demo</span>
        <span className="demo-text">Student view, synced from the teacher’s tab</span>
      </div>
    )
  }

  const badge = <DemoBadge onGuide={() => setGuide(true)} onReset={() => setConfirmReset(true)} />

  return (
    <>
      {slot && !teaching ? (
        createPortal(badge, slot)
      ) : (
        <div className="demo-float no-print" role="region" aria-label="Demo controls" style={lift ? { bottom: lift + 4 } : undefined}>
          {teaching && (
            <div className="demo-voice" role="radiogroup" aria-label="Voice used while recording">
              <span className="demo-text">Voice</span>
              <button role="radio" aria-checked={voice === 'script'} className={voice === 'script' ? 'on' : ''} onClick={() => setVoiceMode('script')}>
                Sample lecture
              </button>
              <button
                role="radio"
                aria-checked={voice === 'mic'}
                className={voice === 'mic' ? 'on' : ''}
                disabled={!micSupported()}
                title={micSupported() ? 'Use your microphone (browser speech recognition)' : 'This browser has no built-in speech recognition'}
                onClick={() => setVoiceMode('mic')}
              >
                My mic
              </button>
            </div>
          )}
          {badge}
        </div>
      )}

      {guide && <Guide onClose={closeGuide} />}

      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo?"
        confirmLabel="Reset"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void resetDemo()}
      >
        Everything you made or changed in this demo is removed, and the sample lectures and sessions come back.
      </ConfirmDialog>
    </>
  )
}
