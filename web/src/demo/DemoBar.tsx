// Demo build only: a small floating bar on every screen. It says this is a demo, opens the guide (shown once
// automatically), picks the voice used while recording on the Teach screen, and resets the demo.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { resetDemo } from './boot'
import { micSupported, setVoiceMode, useVoiceMode } from './voice'
import './demo.css'

const WELCOMED = 'aside-demo-welcomed'

function seen(): boolean {
  try {
    return localStorage.getItem(WELCOMED) === '1'
  } catch {
    return false
  }
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
  const style = lift ? { bottom: lift + 4 } : undefined

  const closeGuide = () => {
    setGuide(false)
    try {
      localStorage.setItem(WELCOMED, '1')
    } catch {
      /* ignore */
    }
  }

  if (student) {
    return (
      <div className="demo-bar no-print" role="note">
        <span className="demo-tag">Demo</span>
        <span className="demo-text">Student view, synced from the teacher’s tab</span>
      </div>
    )
  }

  return (
    <>
      <div className="demo-bar no-print" role="region" aria-label="Demo controls" style={style}>
        <span className="demo-tag">Demo</span>
        {teaching ? (
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
        ) : (
          <span className="demo-text">Runs in your browser. Nothing is uploaded.</span>
        )}
        <button className="demo-link" onClick={() => setGuide(true)}>
          Guide
        </button>
        <button className="demo-link" onClick={() => setConfirmReset(true)}>
          Reset
        </button>
      </div>

      <ConfirmDialog open={guide} title="Welcome to the aside demo" confirmLabel="Let’s go" onCancel={closeGuide} onConfirm={closeGuide}>
        <p className="demo-guide-lede">
          aside is an iPad whiteboard for a teacher with ALS: he talks, and the board writes it down. This demo runs entirely in
          your browser with sample content. No account, no uploads, and the AI is simulated.
        </p>
        <ol className="demo-steps">
          <li>
            <b>Teach:</b> press <b>Start</b> on “Cellular respiration”. Then tap the lecture title at the top of the sidebar and
            choose <b>Start recording</b>. A sample lecture plays, or pick <b>My mic</b> in the demo bar to use your voice.
          </li>
          <li>
            <b>Use the board:</b> drag images in from the sidebar and draw on them. Switch to <b>Smart annotate</b> and circle part of a
            diagram while it talks, then press ✓ to link the speech to that spot.
          </li>
          <li>
            <b>Get the notes:</b> choose <b>End session</b> in the title menu for study notes and the transcript. Or open a
            recorded session on the dashboard to see finished ones.
          </li>
          <li>
            <b>Prepare:</b> make a new lecture and add images, PDFs or typed notes.
          </li>
        </ol>
        <p className="demo-guide-foot">
          Students follow along at <b>/join</b>: open it in a second tab and type the code shown while teaching. <b>Reset</b> in the
          demo bar starts over.
        </p>
      </ConfirmDialog>

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
