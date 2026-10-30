import { describe, expect, it } from 'vitest'
import { planStemStart, stemBufferOffsetSeconds, stemNodePlaybackRate, type StemSessionTiming } from './stemSchedule'

function timing(overrides: Partial<StemSessionTiming> = {}): StemSessionTiming {
  return {
    songStartSeconds: 2,
    audioStartSeconds: 2,
    audioOffsetSeconds: 0,
    playbackRate: 1,
    latencyCompensationSeconds: 0,
    ...overrides,
  }
}

describe('stemBufferOffsetSeconds', () => {
  it('bufferTempoRatio === playbackRate(서버가 이미 그 배속으로 변환한 파일)면, 결과는 "카운트인 이후 경과 초"와 같다', () => {
    for (const r of [0.5, 1, 1.5]) {
      const t = timing({ songStartSeconds: 2, playbackRate: r })
      // content=7초(카운트인 2초 이후 5초 경과), 버퍼는 그 r배속으로 이미 변환됨.
      expect(stemBufferOffsetSeconds(7, t, r)).toBeCloseTo(5, 10)
    }
  })

  it('bufferTempoRatio=1(원본 버퍼 그대로, 개발용 임시 경로)이면 원곡 위치 그대로 — audioTrackPositionSeconds와 동일', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1.5, audioOffsetSeconds: 0.3 })
    // (7-2)*1.5 + 0.3 = 7.8
    expect(stemBufferOffsetSeconds(7, t, 1)).toBeCloseTo(7.8, 10)
  })

  it('audioOffsetSeconds(T3-72 다운비트 오프셋)를 반영 — content===songStart면 원곡 위치는 정확히 offset', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1, audioOffsetSeconds: 0.42 })
    expect(stemBufferOffsetSeconds(2, t, 1)).toBeCloseTo(0.42, 10)
  })
})

describe('stemNodePlaybackRate', () => {
  it('bufferTempoRatio === playbackRate면 정확히 1(피치 안 바뀜 — REQ-04 핵심)', () => {
    expect(stemNodePlaybackRate(timing({ playbackRate: 0.75 }), 0.75)).toBeCloseTo(1, 10)
  })

  it('bufferTempoRatio=1(원본 버퍼)이면 playbackRate 그대로(개발용 임시 경로 — 피치 바뀜, 의도된 동작)', () => {
    expect(stemNodePlaybackRate(timing({ playbackRate: 1.3 }), 1)).toBeCloseTo(1.3, 10)
  })

  it('permille 양자화로 인한 잔차 보정 — bufferTempoRatio가 playbackRate와 아주 살짝 다르면 그 비율만큼만 보정', () => {
    // 정확히 원하는 배속 0.853, 서버는 0.1% 단위로 양자화해 0.853을 그대로 썼다고 가정(permille=853).
    const exact = 0.853
    const quantized = 853 / 1000
    expect(stemNodePlaybackRate(timing({ playbackRate: exact }), quantized)).toBeCloseTo(exact / quantized, 10)
  })
})

describe('planStemStart', () => {
  it('카운트인 이후(게이트 통과)면 즉시 그 위치에서 시작 — gateOpenedNow=true', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1 })
    const plan = planStemStart({
      eventTime: 10,
      transportSeconds: 7, // 카운트인(2초) 이후 5초 지점
      contextNow: 10,
      gateSeconds: 2,
      timing: t,
      bufferTempoRatio: 1,
    })
    expect(plan.startAt).toBe(10)
    expect(plan.bufferOffset).toBeCloseTo(5, 10)
    expect(plan.gateOpenedNow).toBe(true)
  })

  it('카운트인 중(게이트 이전)이면 게이트 시각까지 미래로 예약 — gateOpenedNow=false', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1 })
    const plan = planStemStart({
      eventTime: 10, // 지금(AudioContext 시각) Transport는 0.5초 지점
      transportSeconds: 0.5,
      contextNow: 10,
      gateSeconds: 2, // 다운비트(게이트)는 Transport 2초
      timing: t,
      bufferTempoRatio: 1,
    })
    // 게이트까지 1.5초 남음 → 10 + 1.5 = 11.5초에 시작, 그 시작 위치는 게이트(=원곡 0초, offset=0).
    expect(plan.startAt).toBeCloseTo(11.5, 10)
    expect(plan.bufferOffset).toBeCloseTo(0, 10)
    expect(plan.gateOpenedNow).toBe(false)
  })

  it('지연 보정(L>0)이 카운트인을 그만큼 일찍 끝낸다', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1, latencyCompensationSeconds: 0.5 })
    const plan = planStemStart({
      eventTime: 10,
      transportSeconds: 1.6, // content = 1.6+0.5 = 2.1 > gate(2) → 이미 게이트 통과
      contextNow: 10,
      gateSeconds: 2,
      timing: t,
      bufferTempoRatio: 1,
    })
    expect(plan.gateOpenedNow).toBe(true)
    expect(plan.bufferOffset).toBeCloseTo(0.1, 10) // content(2.1) - songStart(2)
  })

  it('이벤트 처리가 늦어 startAt이 이미 지난 시각이면 지금 시각으로 당기고 오프셋을 그만큼 보정', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 1 })
    const plan = planStemStart({
      eventTime: 10, // 원래 10초에 시작했어야 했는데
      transportSeconds: 7,
      contextNow: 10.3, // 메인스레드 지연으로 실제 처리는 0.3초 늦게 됨
      gateSeconds: 2,
      timing: t,
      bufferTempoRatio: 1,
    })
    expect(plan.startAt).toBeCloseTo(10.3, 10) // 과거로 예약 불가 → 지금 시각
    expect(plan.bufferOffset).toBeCloseTo(5.3, 10) // 늦은 만큼(0.3초) 버퍼 오프셋도 앞으로
  })

  it('bufferTempoRatio !== 1(서버 변환본)과 지연 보정·카운트인을 함께 써도 일관됨', () => {
    const t = timing({ songStartSeconds: 2, playbackRate: 0.5, latencyCompensationSeconds: 0.2 })
    const plan = planStemStart({
      eventTime: 20,
      transportSeconds: 6, // content = 6+0.2 = 6.2, 게이트(2) 통과
      contextNow: 20,
      gateSeconds: 2,
      timing: t,
      bufferTempoRatio: 0.5, // 서버가 이미 0.5배속으로 변환해둔 버퍼
    })
    // 원곡 기준 경과 = (6.2-2)*0.5 = 2.1, 버퍼는 0.5배속이라 파일 안에서는 2.1/0.5 = 4.2초 지점.
    expect(plan.bufferOffset).toBeCloseTo(4.2, 10)
  })
})
