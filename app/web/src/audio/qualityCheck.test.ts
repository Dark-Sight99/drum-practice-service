import { describe, expect, it } from 'vitest'
import { analyzeHighFrequencyRatio, realFft } from './qualityCheck'

// jsdom엔 Web Audio API(AudioContext)가 없어(trackPlayer.test.ts와 같은 제약)
// checkHighFrequencyContent() 자체(디코딩 경계)는 여기서 테스트하지 않는다 —
// 순수 함수인 realFft()/analyzeHighFrequencyRatio()만 실제 합성 신호로 검증
// (test_tempo.py의 "진짜 신호로 검증" 원칙과 동일).

const SAMPLE_RATE = 44100
const FFT_SIZE = 4096

function sineWave(frequencyHz: number, length: number, sampleRate: number): Float32Array {
  const signal = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    signal[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate)
  }
  return signal
}

describe('realFft', () => {
  it('순수 1kHz 사인파의 크기 스펙트럼 피크가 1kHz 근방 빈에 있어야 한다', () => {
    const signal = sineWave(1000, FFT_SIZE, SAMPLE_RATE)
    const { magnitudes, frequencies } = realFft(signal, SAMPLE_RATE)

    let peakIndex = 0
    for (let i = 1; i < magnitudes.length; i++) {
      if (magnitudes[i] > magnitudes[peakIndex]) peakIndex = i
    }
    expect(frequencies[peakIndex]).toBeGreaterThan(900)
    expect(frequencies[peakIndex]).toBeLessThan(1100)
  })

  it('길이가 2의 거듭제곱이 아니면 에러를 던진다', () => {
    const signal = new Float32Array(100) // 2^k 아님
    expect(() => realFft(signal, SAMPLE_RATE)).toThrow()
  })
})

describe('analyzeHighFrequencyRatio', () => {
  it('저주파(200Hz)만 있는 신호는 고주파 비율이 낮아 저품질로 판단된다', () => {
    // T3-45 실측(결함 pretender.mp4)과 같은 성격 — 6kHz 이상이 거의 없는 신호.
    const signal = sineWave(200, FFT_SIZE * 4, SAMPLE_RATE)

    const result = analyzeHighFrequencyRatio([signal], SAMPLE_RATE)

    expect(result.highFrequencyRatio).toBeLessThan(0.001)
    expect(result.isLowQuality).toBe(true)
  })

  it('고주파(10kHz) 신호는 고주파 비율이 높아 저품질로 판단되지 않는다', () => {
    const signal = sineWave(10000, FFT_SIZE * 4, SAMPLE_RATE)

    const result = analyzeHighFrequencyRatio([signal], SAMPLE_RATE)

    expect(result.highFrequencyRatio).toBeGreaterThan(0.9)
    expect(result.isLowQuality).toBe(false)
  })

  it('저주파+고주파가 섞인(정상 음원과 비슷한) 신호는 저품질로 판단되지 않는다', () => {
    // T3-45 실측(정상 소스) — 저음이 대부분(킥 등)이지만 고주파도 몇 %는 있는
    // 경우를 흉내: 저주파 성분을 훨씬 크게, 고주파 성분을 작게 섞음.
    const length = FFT_SIZE * 4
    // T3-45 실측(정상 소스, root_cause_found.md) 기준 6kHz 이상 비율이 약
    // 3~3.8%였던 것과 비슷한 수준이 나오게 진폭비를 맞춤(에너지는 진폭의
    // 제곱이라 0.15:0.85 진폭비 ≈ 3% 에너지비).
    const low = sineWave(150, length, SAMPLE_RATE)
    const high = sineWave(8000, length, SAMPLE_RATE)
    const mixed = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      mixed[i] = low[i] * 0.85 + high[i] * 0.15
    }

    const result = analyzeHighFrequencyRatio([mixed], SAMPLE_RATE)

    expect(result.isLowQuality).toBe(false)
  })

  it('FFT 윈도우보다 짧은 신호는 판단 근거 부족으로 저품질 아님(안전한 미탐) 처리', () => {
    const signal = new Float32Array(100)

    const result = analyzeHighFrequencyRatio([signal], SAMPLE_RATE)

    expect(result.isLowQuality).toBe(false)
  })

  it('좌우 채널의 고주파가 서로 반대 위상이어도(모노 합성 시 상쇄) 저품질로 오판하지 않는다', () => {
    // Codex 모드A 지적(Minor C-003, qa-evidence/T3-47) — 옛 구현(시간 영역에서
    // 채널 평균 후 FFT 1회)은 이 경우 고주파 성분이 평균 과정에서 상쇄돼
    // 거의 0이 되므로 저품질로 오판했다. 좌우 채널을 각각 FFT한 뒤 크기(항상
    // 0 이상)를 합산하면 상쇄가 원리적으로 불가능해야 한다.
    const length = FFT_SIZE * 4
    const low = sineWave(150, length, SAMPLE_RATE)
    const high = sineWave(8000, length, SAMPLE_RATE)
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      left[i] = low[i] * 0.85 + high[i] * 0.15
      right[i] = low[i] * 0.85 - high[i] * 0.15 // 고주파 성분만 반대 위상
    }
    // 시간 영역 평균이면 고주파가 상쇄됨을 전제 확인(이 테스트 자체가 틀리지
    // 않았는지 검증) — (left+right)/2 == low만 남아야 함.
    const naiveMono = new Float32Array(length)
    for (let i = 0; i < length; i++) naiveMono[i] = (left[i] + right[i]) / 2
    const naiveResult = analyzeHighFrequencyRatio([naiveMono], SAMPLE_RATE)
    expect(naiveResult.isLowQuality).toBe(true) // 상쇄로 저품질처럼 보임(전제 확인)

    const result = analyzeHighFrequencyRatio([left, right], SAMPLE_RATE)

    expect(result.isLowQuality).toBe(false)
  })
})
