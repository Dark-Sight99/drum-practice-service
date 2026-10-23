import * as Tone from 'tone'
import type { DrumPiece } from '../score/types'

/** DrumPiece → 실제 드럼 샘플(WAV) 매핑. 원본: Virtuosity Drums(Versilian
 * Studios/Karoryfer, CC0) — 라이선스·출처는 `public/audio/drums/LICENSE.txt`,
 * 음색 교체 배경은 `intent/07-open-questions.md` Q-19, `work/T2-2b/plan.md`. */
export interface DrumVoice {
  /** time: Tone.js Time(초 단위 숫자 권장), velocity: 0~1 정규화값. */
  trigger(time: number, velocity: number): void
  dispose(): void
}

const SAMPLE_URLS: Record<DrumPiece, string> = {
  kick: '/audio/drums/kick.wav',
  snare: '/audio/drums/snare.wav',
  hihat_closed: '/audio/drums/hihat_closed.wav',
  hihat_open: '/audio/drums/hihat_open.wav',
  tom_high: '/audio/drums/tom_high.wav',
  tom_mid: '/audio/drums/tom_mid.wav',
  tom_floor: '/audio/drums/tom_floor.wav',
  crash: '/audio/drums/crash.wav',
  ride: '/audio/drums/ride.wav',
}

/** 정규화 velocity(0~1)를 데시벨 감쇠량으로 변환. velocity=1→0dB, velocity=0→-24dB
 * 선형 매핑(간단한 근사 — 실제 드럼의 벨로시티-음량 곡선은 로그형이지만, 9종
 * 샘플 각각 벨로시티 레이어가 1개뿐이라 정밀한 커브를 맞출 근거가 없음). */
export function velocityToDb(velocity: number): number {
  const clamped = Math.min(1, Math.max(0, velocity))
  return (clamped - 1) * 24
}

function sampleVoice(buffer: Tone.ToneAudioBuffer): DrumVoice {
  return {
    trigger(time, velocity) {
      // Codex 모드A 확인 필요: Tone.Player는 모노포닉(Source)이라 같은 소리가
      // 빠르게 겹쳐 울리면(예: 8분음표 하이햇 연타) 이전 소리를 끊고 재시작함.
      // 드럼 샘플은 매번 새 Player를 만들어 "발사 후 소멸" 방식으로 자연스러운
      // 겹침(디케이)을 허용함 — Tone.js 커뮤니티에서 권장하는 one-shot 패턴.
      const player = new Tone.Player(buffer).toDestination()
      player.volume.value = velocityToDb(velocity)
      player.onstop = () => player.dispose()
      player.start(time)
    },
    dispose() {
      // 버퍼 자체는 createDrumVoices가 소유 — 여기선 트리거마다 생성한
      // Player만 각자 onstop에서 정리한다.
    },
  }
}

export type DrumVoiceMap = Record<DrumPiece, DrumVoice>

/** 9종 분류 각각의 샘플을 불러와 재생 가능한 보이스를 만든다. fetch+디코딩이
 * 필요해 비동기 — AudioContext가 있는 환경(실제 브라우저)에서만 정상 동작한다
 * (jsdom은 Web Audio API가 없어 디코딩이 실패함, work/T2-2/plan.md 동일 사유). */
export async function createDrumVoices(): Promise<DrumVoiceMap> {
  const pieces = Object.keys(SAMPLE_URLS) as DrumPiece[]
  const buffers = await Promise.all(
    pieces.map((piece) => new Tone.ToneAudioBuffer().load(SAMPLE_URLS[piece])),
  )
  const entries = pieces.map((piece, i) => [piece, sampleVoice(buffers[i])] as const)
  return Object.fromEntries(entries) as DrumVoiceMap
}

export function disposeDrumVoices(voices: DrumVoiceMap): void {
  for (const voice of Object.values(voices)) voice.dispose()
}
