import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ensureIOSAudioContextSampleRate } from './audio'

// T6-5(REQ-06, Q-33) — 어떤 컴포넌트도 마운트되기 전, Tone.js를 처음 건드리는 모든
// 코드(audio/trackPlayer.ts, audio/drumVoices.ts, audio/scorePlayer.ts 등)보다 먼저
// 실행돼야 함(work/T6-5/plan.md "어디서 설정하나"). iOS가 아니면 즉시 반환 — 이
// 코드 경로 자체가 안 바뀜.
ensureIOSAudioContextSampleRate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
