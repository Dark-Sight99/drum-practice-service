// 2026-10-28(의뢰인 요청) — 업로드 전(서버로 보내기 전) 브라우저에서 바로 오디오
// 파일의 고주파(하이햇·심벌이 사는 대역) 함유량을 확인해, 너무 적으면 경고한다.
//
// 근거: qa-evidence/T3-45-hihat-detection-experiment/root_cause_found.md — 실제로
// 하이햇이 전혀 검출 안 됐던 pretender.mp4 사고 원인이 "비트레이트가 낮아서"가
// 아니라(192kbps로 스펙상 멀쩡했음) **실제 6kHz 이상 에너지가 거의 0**이었던
// 것으로 확인됨(정상 소스 대비 약 100분의 1). 그래서 비트레이트/샘플레이트
// 메타데이터가 아니라 **실제 디코딩한 오디오의 주파수 스펙트럼**을 직접 본다.

/** 6kHz 이상 대역 에너지가 전체의 이 비율 미만이면 "고주파가 거의 없다"고 판단.
 * work/T3-45-hihat-detection-experiment/compare_spectrum.py 실측 기준 — 결함
 * 파일(pretender.mp4)은 6kHz 이상 비율이 약 0.03%, 정상 소스 2개는 약 3~3.8%였음.
 * 그 사이(둘 다에서 충분히 떨어진) 1%를 기준으로 — 오판 여지가 있는 휴리스틱임을
 * 명시(표본 1곡 기준, Q-40/Q-42와 같은 성격의 경험적 값).
 */
export const LOW_HIGH_FREQUENCY_RATIO_THRESHOLD = 0.01

const HIGH_FREQUENCY_THRESHOLD_HZ = 6000
const FFT_SIZE = 4096
const MAX_ANALYSIS_WINDOWS = 24

export interface HighFrequencyCheckResult {
  /** 분석한 전체 윈도우의 평균 스펙트럼 중 6kHz 이상이 차지하는 에너지 비율(0~1). */
  highFrequencyRatio: number
  /** highFrequencyRatio < LOW_HIGH_FREQUENCY_RATIO_THRESHOLD. */
  isLowQuality: boolean
}

/** 길이 `n`(2의 거듭제곱)인 실수 신호의 FFT를 구해 크기 스펙트럼(전반부, 0~Nyquist)과
 * 해당 주파수(Hz)를 반환한다 — 표준 radix-2 iterative Cooley-Tukey(앨리어싱 방지용
 * Hann 윈도우 적용). Web Audio `AnalyserNode`는 실시간 스트림 전용이라 디코딩해둔
 * 버퍼 전체를 임의 구간에서 바로 분석하기엔 안 맞아 직접 구현한다. */
export function realFft(
  signal: Float32Array,
  sampleRate: number,
): { magnitudes: Float64Array; frequencies: Float64Array } {
  const n = signal.length
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`realFft: 길이가 2의 거듭제곱이어야 함(받은 길이: ${n})`)
  }
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const hann = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1
    re[i] = signal[i] * hann
  }

  // 비트 반전(bit-reversal) 순열
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wLenR = Math.cos(ang)
    const wLenI = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curR = 1
      let curI = 0
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j]
        const ui = im[i + j]
        const vr = re[i + j + len / 2] * curR - im[i + j + len / 2] * curI
        const vi = re[i + j + len / 2] * curI + im[i + j + len / 2] * curR
        re[i + j] = ur + vr
        im[i + j] = ui + vi
        re[i + j + len / 2] = ur - vr
        im[i + j + len / 2] = ui - vi
        const nextR = curR * wLenR - curI * wLenI
        const nextI = curR * wLenI + curI * wLenR
        curR = nextR
        curI = nextI
      }
    }
  }

  const half = n / 2
  const magnitudes = new Float64Array(half)
  const frequencies = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    magnitudes[k] = Math.hypot(re[k], im[k])
    frequencies[k] = (k * sampleRate) / n
  }
  return { magnitudes, frequencies }
}

/** 채널별 PCM 신호 전체에서 `FFT_SIZE` 길이 윈도우를 여러 개(최대
 * `MAX_ANALYSIS_WINDOWS`개, 곡 전체에 고르게 분산) 뽑아 채널마다 따로 FFT를
 * 구한 뒤, 그 크기 스펙트럼(제곱 = 에너지)을 채널끼리 합산해 6kHz 이상 에너지
 * 비율을 계산한다 — 순수 함수라 테스트하기 쉽게 `decodeAudioData` 호출과
 * 분리해둠(아래 `checkHighFrequencyContent`가 그 경계).
 *
 * Codex 모드A 지적(Minor C-003, 반영, qa-evidence/T3-47) — 이전엔 채널을 먼저
 * 시간 영역에서 평균 내 모노로 합친 뒤(옛 mixToMono) FFT를 한 번만 구했는데,
 * 좌우 채널의 고주파 성분이 서로 위상이 반대(out-of-phase)면 평균 과정에서
 * 그 성분이 상쇄돼 실제론 하이햇/심벌 소리가 들리는 음원인데도 저품질로
 * 오판할 수 있었다. 채널마다 따로 FFT를 구해 "크기(절댓값)"를 합산하는
 * 방식은 크기가 항상 0 이상이라 상쇄가 원리적으로 불가능 — 기준값
 * (LOW_HIGH_FREQUENCY_RATIO_THRESHOLD)은 그대로 둠(비율 자체의 계산 방식만
 * 바뀌었을 뿐 T3-45 실측값의 자릿수 범위는 동일하게 유지됨). */
export function analyzeHighFrequencyRatio(
  channels: Float32Array[],
  sampleRate: number,
): HighFrequencyCheckResult {
  const totalSamples = channels[0]?.length ?? 0
  if (totalSamples < FFT_SIZE) {
    // 너무 짧은 오디오(예: 테스트용 1초 미만 조각)는 판단 근거가 부족 — 경고하지
    // 않는 쪽(오탐보다 미탐이 안전 — 업로드를 막을 근거가 불충분하면 막지 않는다).
    return { highFrequencyRatio: 1, isLowQuality: false }
  }
  const windowCount = Math.min(
    MAX_ANALYSIS_WINDOWS,
    Math.max(1, Math.floor(totalSamples / FFT_SIZE)),
  )

  let highEnergySum = 0
  let totalEnergySum = 0
  for (let w = 0; w < windowCount; w++) {
    const maxStart = totalSamples - FFT_SIZE
    const start = windowCount > 1 ? Math.floor((w / (windowCount - 1)) * maxStart) : 0
    for (const channel of channels) {
      const frame = channel.subarray(start, start + FFT_SIZE)
      const { magnitudes, frequencies } = realFft(frame, sampleRate)
      for (let k = 0; k < magnitudes.length; k++) {
        const energy = magnitudes[k] * magnitudes[k]
        totalEnergySum += energy
        if (frequencies[k] >= HIGH_FREQUENCY_THRESHOLD_HZ) highEnergySum += energy
      }
    }
  }

  const ratio = totalEnergySum > 0 ? highEnergySum / totalEnergySum : 0
  return { highFrequencyRatio: ratio, isLowQuality: ratio < LOW_HIGH_FREQUENCY_RATIO_THRESHOLD }
}

/** 업로드 전 파일 선택 시 호출 — 파일을 브라우저에서 바로 디코딩해(서버로 보내기
 * 전) 고주파 함유량을 확인한다. 디코딩 자체가 실패하면(지원 안 하는 코덱 등)
 * 판단 근거가 없다는 뜻이므로 경고 없이 통과시킨다(서버 업로드 자체는 이 결과와
 * 무관하게 항상 진행 가능 — 이건 보조 경고일 뿐 업로드 가능 여부를 막는 관문이
 * 아니다). */
export async function checkHighFrequencyContent(file: File): Promise<HighFrequencyCheckResult> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    return { highFrequencyRatio: 1, isLowQuality: false }
  }
  const audioContext = new AudioContextCtor()
  try {
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const channels: Float32Array[] = []
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch))
    }
    return analyzeHighFrequencyRatio(channels, audioBuffer.sampleRate)
  } catch {
    return { highFrequencyRatio: 1, isLowQuality: false }
  } finally {
    void audioContext.close()
  }
}
