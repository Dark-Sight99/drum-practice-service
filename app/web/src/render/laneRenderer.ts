// Canvas 2D 레인 렌더러 — jsdom은 2D 컨텍스트가 없어(`getContext('2d')`가 null,
// 실제 실행으로 확인) 실제 브라우저에서만 동작·검증 가능(work/T2-3/plan.md).
import type { DrumNote, DrumPiece, DrumScore, Hand } from '../score/types'
import {
  barBeatLines,
  LANES,
  noteYPosition,
  pixelsPerSecond,
  type NoteShape,
} from './layout'
import { ticksToSeconds } from '../audio/timing'

interface VisibleNote {
  laneCenterX: number
  shape: NoteShape
  shapeY: number
  topEdgeY: number
  color: string
  label: string | null
  handSource: DrumNote['handSource']
}

function handLabel(hand: Hand): string | null {
  return hand === 'R' || hand === 'L' || hand === 'RF' || hand === 'LF' ? hand : null
}

export interface LaneRendererOptions {
  /** DrumPiece별 색을 돌려주는 함수 — 호출자가 CSS 변수(`--piece-*`)를 읽어 전달
   * (Canvas는 CSS 변수를 모름, intent/08-design.md §3). */
  pieceColor: (piece: DrumNote['piece']) => string
  laneBorderColor: string
  laneBarColor: string
  laneBeatColor: string
  hitLineColor: string
  /** 스티킹 R/L 글자 색(REQ-12, intent/08-design.md §3 "노트 위 R/L 글자(--text)").
   * T3-11 게이트 피드백(2026-10-25) — 노트 도형 halo 테두리에도 같은 밝은 색을
   * 재사용(아래 `drawNoteShape` 참고): 처음엔 `laneHeaderBackgroundColor`(어두운
   * 배경색)를 썼는데, 캔버스 배경도 어두워 구분이 안 된다는 의뢰인 지적으로
   * 밝은 색으로 교체. */
  stickingTextColor: string
  /** 레인 머리글(HH/CR/SN/...) 뒤에 까는 배경색 — 캔버스 배경과 같은 색을 넘기면
   * 떨어지는 노트가 글자 뒤를 지나가도 가독성이 안 깨진다(T2-10, Phase 2 게이트
   * 3차 피드백: "처음에 내려오는 노트가 어느 부분을 치라는건지 와닿지 않는다" —
   * intent/04-ui-ux.md §3 와이어프레임엔 "HH CR SN T1 T2 FT RD KK ← 레인 머리글"이
   * 명시돼 있었는데 T2-3 구현에서 빠뜨렸던 것을 뒤늦게 발견 — 탐 레인 글자는 이후
   * T2-15에서 T1/T2 → HT/MT로 변경. 이후 T3-7(2026-10-25, 의뢰인 피드백)에서
   * 킥을 스네어 바로 다음으로 옮겨 현재 순서는 `layout.ts`의 `LANES` 배열이
   * 유일한 기준 — 이 주석은 역사적 맥락일 뿐 최신 순서를 나타내지 않음). */
  laneHeaderBackgroundColor: string
  /** 판정선 근처 노트를 "히트"로 보는 허용범위(초) — work/T2-3/plan.md §가정. */
  hitWindowSeconds: number
}

export interface LaneRenderResult {
  activePieces: Set<DrumPiece>
  /** 판정선 근처 피스별 손/발(REQ-12) — 킷 점등 테두리 실선/점선 트리거. */
  activeHandByPiece: Map<DrumPiece, Hand>
}

export interface LaneRenderer {
  /** `songStartSeconds`는 호출자가 `scorePlayer.ts`의 `computePlaybackSchedule()`과
   * 똑같이 계산해 넘겨야 한다(카운트인 마디 길이) — 실제 오디오가 이 시각부터
   * 노트를 트리거하므로, 화면도 같은 기준으로 그려야 판정선 통과 시점과 소리가
   * 맞는다(T2-8, Phase 2 게이트 피드백으로 발견: 이 값을 빼먹어서 노트가 카운트인
   * 길이만큼 일찍 보이고 소리는 늦게 들리는 버그가 있었음).
   * `playbackBpm` 생략 시 `score.meta.bpm`(원곡 그대로) 사용 — 연습 BPM(T2-4,
   * REQ-04)으로 재생 중이면 낙하 속도·노트 위치가 그 속도를 따라가도록 넘긴다.
   * `showSticking`(REQ-12, 기본 true)이 꺼지면 노트 위 R/L 글자를 그리지 않는다. */
  render(
    score: DrumScore,
    currentTimeSeconds: number,
    songStartSeconds: number,
    barsVisible: number,
    playbackBpm?: number,
    showSticking?: boolean,
  ): LaneRenderResult
  dispose(): void
}

const LOOKBEHIND_SECONDS = 0.15
const LANE_HEADER_HEIGHT = 20

/** 도형 중심에서 실제로 그려지는 가장 아래쪽 픽셀까지의 거리 — `drawNoteShape`가
 * 그리는 도형마다 다르다(예: `x-ring`은 `half*1.5` 반지름 원까지 그려 다른
 * 도형보다 더 아래까지 내려감). 판정 순간(하단 모서리가 판정선에 닿는 시각)을
 * 모든 도형에서 똑같이 맞추려면 이 값으로 그리는 위치를 올려야 한다(T2-9,
 * Codex 모드A P2 지적 — 처음엔 모든 도형에 `noteSize/2`를 똑같이 썼는데
 * `x-ring`만 그보다 더 아래까지 그려져 판정 순간이 더 일찍 보였음). */
function shapeBottomExtent(shape: NoteShape, size: number): number {
  const half = size / 2
  switch (shape) {
    case 'x':
      return half
    case 'x-large':
      return half * 1.3
    case 'x-ring':
      return half * 1.5 // 링(half*1.5 반지름)이 X(half)보다 더 아래까지 그려짐
    case 'diamond':
      return half
    case 'rounded-rect':
      return (size * 0.7) / 2
    case 'rect-ring':
      return half * 1.5 // x-ring과 같은 반지름의 테두리 원이 둥근 사각형보다 더 아래까지 그려짐
    case 'circle':
      return half
    case 'circle-large':
      return half * 1.2
    case 'bar':
      return (size * 0.4) / 2
    case 'bar-ring':
      return half * 1.5 // x-ring과 같은 반지름의 테두리 원이 막대보다 더 아래까지 그려짐
  }
}

/** 겹친/인접한 노트끼리 경계가 보이게 두르는 halo 테두리 두께(T3-11,
 * 의뢰인 피드백 1차: "RL 없애서 여러 개 붙어 나올 때 몇 번을 쳐야 하는지 잘 안
 * 보인다" → 2차: "배경도 검은색인데 외곽선도 검은색이라 안 구분된다" — 처음엔
 * 배경색(어두움)으로 둘렀다가, 캔버스 배경도 어두워 안 보인다는 지적으로 밝은
 * 색(`stickingTextColor`, --text)으로 교체함, 아래 호출부 참고).
 * R/L 텍스트에 이미 쓰던 "먼저 깔고 그 위에 그리기" halo 기법을 도형에도 재사용
 * — 도형별 분기 없이 "같은 도형을 halo색으로 살짝 더 크게 먼저 그리고, 그 위에
 * 원래 크기·색으로 다시 그린다"만으로 모든 도형(채워진 도형은 더 큰 실루엣이
 * 테두리처럼 비어져 나옴, X자 같은 선 도형은 더 두껍고 큰 선이 테두리로 비어져
 * 나옴)에 동일하게 적용됨. */
const NOTE_HALO_PADDING = 2

/** T6-7(성능, Q-33) — 실기기 Safari 프로파일러로 직접 확인(메인 스레드의
 * 86.9%가 "페인트"): `drawNoteShapePass()`를 halo용·본체용 두 번 **완전히
 * 따로** 호출하던 예전 방식은 노트 1개당 경로(path) 구성을 두 번(halo
 * 크기로 한 번, 본체 크기로 한 번) 새로 하고 있었다 — 화면에 동시에 보이는
 * 노트가 많을 때(수백 개) 캔버스 명령이 그만큼 배로 불어나 페인트 비용이
 * 커짐(재생 버튼을 누르기도 전, 화면에 노트가 처음 그려지는 순간부터 CPU가
 * 치솟는 걸 실기기로 확인 — 오디오와 무관).
 *
 * 경로는 **한 번만** 구성하고, 그 위에 "테두리색으로 굵게 칠하기(halo
 * 크기 자체는 더 안 만듦) → 그 위에 본체색으로 칠하기"만 추가해 같은 시각
 * 효과(테두리가 비어져 나오는 halo)를 낸다 — 스트로크는 경로를 중심으로
 * 안팎에 걸쳐 그려지므로(스펙 동작), 바깥쪽 절반만 테두리처럼 남고 안쪽
 * 절반은 이어지는 채우기가 덮는다. 선으로만 이뤄진 'x' 계열은 채우기가
 * 없으므로 같은 경로를 굵은 선(halo색) → 가는 선(본체색) 순서로 두 번
 * 긋는다(경로 재구성은 한 번뿐). 'bar' 계열은 원래도 `fillRect()`(경로
 * 없는 최소 비용 호출)였으므로 그대로 유지 — 경로 기반으로 바꾸면 오히려
 * 손해.
 *
 * 'x-ring'/'rect-ring'/'bar-ring'의 추가 원(halo 표시용)도 같은 원리로
 * 경로를 한 번만 만들고 굵은 선→가는 선 순서로 두 번 긋는다.
 *
 * 시각적으로 완전히 동일하진 않다(기존 방식은 halo가 본체보다 순수하게
 * "더 큰 도형"이었는데, 이 방식은 "경로 중심 스트로크"라 테두리 두께가
 * 약간 다르게 보일 수 있음) — 구현 후 데스크톱 스크린샷으로 비교 확인
 * 필요(아래 테스트 계획). */
function drawNoteShapeToContext(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  y: number,
  size: number,
  color: string,
  haloColor: string,
): void {
  const half = size / 2
  const haloWidth = NOTE_HALO_PADDING * 2

  function strokeHaloThenMain(mainLineWidth: number): void {
    ctx.strokeStyle = haloColor
    ctx.lineWidth = mainLineWidth + haloWidth
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = mainLineWidth
    ctx.stroke()
  }

  function strokeHaloThenFill(): void {
    ctx.strokeStyle = haloColor
    ctx.lineWidth = haloWidth
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fill()
  }

  function ringHalo(): void {
    ctx.beginPath()
    ctx.arc(x, y, half * 1.5, 0, Math.PI * 2)
    strokeHaloThenMain(2)
  }

  switch (shape) {
    case 'x':
    case 'x-large':
    case 'x-ring': {
      const s = shape === 'x-large' ? half * 1.3 : half
      ctx.beginPath()
      ctx.moveTo(x - s, y - s)
      ctx.lineTo(x + s, y + s)
      ctx.moveTo(x + s, y - s)
      ctx.lineTo(x - s, y + s)
      strokeHaloThenMain(2)
      if (shape === 'x-ring') ringHalo()
      break
    }
    case 'diamond': {
      ctx.beginPath()
      ctx.moveTo(x, y - half)
      ctx.lineTo(x + half, y)
      ctx.lineTo(x, y + half)
      ctx.lineTo(x - half, y)
      ctx.closePath()
      strokeHaloThenFill()
      break
    }
    case 'rounded-rect':
    case 'rect-ring': {
      const w = size
      const h = size * 0.7
      ctx.beginPath()
      ctx.roundRect(x - w / 2, y - h / 2, w, h, 4)
      strokeHaloThenFill()
      if (shape === 'rect-ring') ringHalo()
      break
    }
    case 'circle':
    case 'circle-large': {
      const r = shape === 'circle-large' ? half * 1.2 : half
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      strokeHaloThenFill()
      break
    }
    case 'bar':
    case 'bar-ring': {
      const w = size * 1.8
      const h = size * 0.4
      ctx.fillStyle = haloColor
      ctx.fillRect(x - w / 2 - NOTE_HALO_PADDING, y - h / 2 - NOTE_HALO_PADDING, w + haloWidth, h + haloWidth)
      ctx.fillStyle = color
      ctx.fillRect(x - w / 2, y - h / 2, w, h)
      if (shape === 'bar-ring') ringHalo()
      break
    }
  }
}

// T6-8(성능, Q-33) — T6-7(halo 경로 1회화)로도 실기기 페인트 비중이 여전히
// 압도적(77~87%)이었음 — 벡터 경로를 매 프레임 수백 개씩 다시 rasterize하는
// 비용 자체가 문제였다는 뜻. 웹 기반 "작은 도형 다수를 매 프레임 그리는"
// 상황의 표준 해법(스프라이트 캐싱) 적용: 모양·색(둘 다 유한한 조합 —
// `NoteShape` 10종 × `pieceColor()`가 돌려주는 피스별 색 9종 안팎)별로
// 오프스크린 캔버스에 **딱 한 번만** 벡터로 그려두고, 매 프레임은 그 결과
// 이미지를 `drawImage()`로 복사해 붙이기만 한다 — 벡터 rasterize가 아니라
// 이미지 블릿이라 WebKit 캔버스에서 훨씬 쌈(업계 표준 기법, 특히 iOS
// Safari처럼 캔버스 rasterize 비용이 큰 엔진에서 효과가 큼). 모든 도형·링
// 변형을 포함해도 안전하게 담을 수 있는 정사각형 한 칸에 중앙 정렬해 그린다
// (바 모양 가로폭 size*1.8이 가장 넓은 경우라 size*2+여유로 전부 커버).
// 모듈 스코프 캐시 — 모양·색 조합은 곡과 무관하게 앱 전체에서 유한하므로
// `readPieceColor()`의 `pieceColorCache`와 같은 수명(계속 유지, 메모리 부담
// 무시할 수준 — 최대 수십 개의 작은 비트맵).
const noteSpriteCache = new Map<string, HTMLCanvasElement>()

function getNoteSprite(
  shape: NoteShape,
  size: number,
  color: string,
  haloColor: string,
): HTMLCanvasElement {
  const key = `${shape}|${size}|${color}|${haloColor}`
  const cached = noteSpriteCache.get(key)
  if (cached) return cached
  const side = Math.ceil(size * 2 + NOTE_HALO_PADDING * 2 + 4)
  const sprite = document.createElement('canvas')
  sprite.width = side
  sprite.height = side
  const sctx = sprite.getContext('2d')
  if (sctx) {
    drawNoteShapeToContext(sctx, shape, side / 2, side / 2, size, color, haloColor)
  }
  noteSpriteCache.set(key, sprite)
  return sprite
}

/** 정렬된 배열에서 `keyOf(item) >= target`인 첫 인덱스를 이진탐색으로 찾는다
 * (표준 lower_bound). `sorted`가 `keyOf` 기준 오름차순이어야 올바름 — 호출부
 * (아래 `ensureLaneIndex`)가 `score.notes`의 원래 순서를 믿지 않고 직접 틱으로
 * 정렬해서 넘기므로 이 전제가 항상 성립(Codex 모드A C-001, `ensureLaneIndex`
 * 주석 참고 — 편집기가 배열 순서는 그대로 두고 tick 값만 바꾸는 경로가 있어
 * `score.notes` 자체는 항상 정렬돼 있다고 믿으면 안 됨). */
function lowerBoundIndex<T>(sorted: readonly T[], target: number, keyOf: (item: T) => number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (keyOf(sorted[mid]) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 레인 렌더러를 만든다. `render()`를 매 프레임(requestAnimationFrame) 호출하면
 * 레인·마디/박선·판정선·노트를 그리고, 판정선 근처(히트) 피스 집합을 반환한다
 * (하단 드럼킷 점등 트리거용, 호출자가 KitIllustration에 넘김). */
export function createLaneRenderer(
  canvas: HTMLCanvasElement,
  options: LaneRendererOptions,
): LaneRenderer {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context를 가져올 수 없습니다(브라우저가 Canvas를 지원해야 함)')
  }

  // T3-15(성능, 2026-10-26) — 의뢰인이 Safari 웹 속성 관리자(실기기 프로파일러)로
  // 직접 잡아낸 실측 병목: `render()`가 매 프레임(최대 60회/초) 보이는 노트 수만큼
  // 새 객체를 담은 새 배열을 만들고 있었음 — "부분 가비지 모음"이 프레임마다 몇
  // ms씩 찍히는 걸 확인(가비지 생성 → GC가 메인 스레드를 막음 → 캔버스 그리기 지연
  // → "몇 프레임 멈췄다 건너뛰는" 체감 버벅임, 정확히 일치). 배열을 매번 새로
  // 만드는 대신, 객체를 재사용하는 풀(아래 `visibleNotePool`)을 만들어 프레임마다
  // `visibleNoteCount`만 리셋하고 기존 객체를 덮어쓴다 — 노트 수가 늘어도(이번에
  // 풀이 커진 뒤로는) 가비지가 전혀 안 생긴다. 이 풀은 render() 호출 밖으로 절대
  // 안 나가므로(React state 등에 저장 안 됨) 재사용해도 안전함.
  const visibleNotePool: VisibleNote[] = []
  let visibleNoteCount = 0

  // T6-1(성능, 2026-10-30, Q-33 재착수) — `render()`가 매 프레임 레인 8개 × 전체
  // 노트(실측 1,809개)를 전부 순회하고 있었음(score.notes가 이미 틱 오름차순인데도
  // 인덱싱 없이 매 프레임 재스캔) — 8×1809≈14,472회/프레임. 곡이 바뀔 때만(참조
  // 비교) 레인별로 한 번 필터링해 캐싱해두고, render()에서는 이진탐색으로 보이는
  // 시간창(+ 판정 허용범위)만 순회한다.
  //
  // Codex 모드A 1차 지적(C-001, 실제 버그로 확인·반영) — "score.notes는 틱
  // 오름차순"이라는 전제를 그대로 믿고 필터링 결과를 바로 썼는데, 이 전제가
  // *항상* 보장되지 않음: `EditorScreen.tsx`가 노트를 수정할 때 배열 내 위치는
  // 그대로 두고 해당 원소의 tick 값만 바꾸는 경로가 있어(`toDrumScore()`가 그
  // 배열 순서를 그대로 보존), 편집 후 저장된 DrumScore가 틱 오름차순이 아닐 수
  // 있다. 기존(T6-1 이전) 전체 스캔 코드는 순서에 의존하지 않아 문제없었지만,
  // 이번에 추가한 이진탐색+조기 종료는 정렬을 전제로 하므로 깨진다. 원본
  // `score.notes`의 순서를 믿는 대신, 레인별 배열을 만들 때 틱 기준으로 직접
  // 정렬해 이 함수가 그 전제를 스스로 보장하게 한다(곡이 바뀔 때 한 번만 하는
  // O(n log n) 정렬이라 비용 미미, 매 프레임 비용과 무관).
  let cachedScore: DrumScore | null = null
  let notesByLaneIndex: DrumNote[][] = []
  function ensureLaneIndex(score: DrumScore): void {
    if (score === cachedScore) return
    notesByLaneIndex = LANES.map((lane) =>
      score.notes.filter((note) => lane.pieces.includes(note.piece)).sort((a, b) => a.tick - b.tick),
    )
    cachedScore = score
  }

  function nextPooledNote(): VisibleNote {
    if (visibleNoteCount >= visibleNotePool.length) {
      visibleNotePool.push({
        laneCenterX: 0,
        shape: 'x',
        shapeY: 0,
        topEdgeY: 0,
        color: '',
        label: null,
        handSource: undefined,
      })
    }
    return visibleNotePool[visibleNoteCount++]
  }

  return {
    render(
      score,
      currentTimeSeconds,
      songStartSeconds,
      barsVisible,
      playbackBpm = score.meta.bpm,
      showSticking = true,
    ) {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.clearRect(0, 0, width, height)

      const hitLineY = height - 24
      const laneWidth = width / LANES.length
      const speed = pixelsPerSecond(hitLineY, barsVisible, score.meta.timeSignature, playbackBpm)
      const lookaheadSeconds = hitLineY / speed

      // 2026-10-29(T3-72, REQ-02, Q-43) — 예전엔 여기도 `+ score.audioOffsetMs
      // / 1000`이 있었다(Phase 3 전까지 그 값이 항상 0이라 실행된 적 없던
      // 코드, Codex 모드C 1차 C-001 지적). 서버의 다운비트 자동 보정이 노트
      // 틱 자체를 이미 재앵커해서 저장하므로(work/T3-72/plan.md §1), 여기서
      // 또 더하면 판정선 도달 시각이 이중으로 밀린다 — `scorePlayer.ts`와
      // 같은 이유로 제거.
      const noteTimeOf = (note: DrumNote) =>
        songStartSeconds + ticksToSeconds(note.tick, score.ppq, playbackBpm)

      // 레인 구분선
      ctx.strokeStyle = options.laneBorderColor
      ctx.lineWidth = 1
      for (let i = 1; i < LANES.length; i++) {
        const x = i * laneWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }

      // 마디선·박선
      const windowStart = currentTimeSeconds - LOOKBEHIND_SECONDS
      const windowEnd = currentTimeSeconds + lookaheadSeconds
      for (const line of barBeatLines(
        score.meta.timeSignature,
        playbackBpm,
        windowStart,
        windowEnd,
      )) {
        const y = noteYPosition(line.timeSeconds, currentTimeSeconds, speed, hitLineY)
        ctx.strokeStyle = line.isBar ? options.laneBarColor : options.laneBeatColor
        ctx.lineWidth = line.isBar ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // 노트 — 2-pass로 그린다: 먼저 레인 전체의 도형을 전부 그리고, 그 다음에
      // R/L 글자를 전부 그린다(T2-11, Phase 2 게이트 4차 피드백 "R/L이 연속
      // 노트에서 안 보임" — 영상으로 재현 확인). `score.notes`는 틱 오름차순이고
      // 같은 레인에서 틱이 늦은(미래) 노트일수록 화면 위쪽(작은 y)에 그려지므로,
      // 노트 단위로 "도형→글자"를 번갈아 그리던 기존 방식은 간격이 글자 높이보다
      // 좁으면 다음 노트의 도형이 직전 노트의 글자를 그대로 덮어 지워버렸다.
      // 글자를 항상 모든 도형보다 나중(위 레이어)에 그리면 이 문제가 없다.
      // T6-8 — 정수로 반올림(스프라이트 캐시 키에 쓰임, 아래 getNoteSprite 참고).
      // `canvas.clientWidth` 기반 계산이라 프레임마다 소수점 단위로 미세하게
      // 흔들릴 수 있는데, 반올림 없이 그대로 캐시 키에 쓰면 거의 매 프레임
      // 캐시가 깨져(사실상 항상 miss) 캔버스를 계속 새로 만드는 역효과가 남
      // (실기기 이전에 데스크톱에서 먼저 실측 확인됨 — 실측 없이 넘어가지 않음).
      const noteSize = Math.round(Math.min(laneWidth * 0.5, 28))
      visibleNoteCount = 0
      // T3-15(성능) — 원래 `activePieces()`/`activeHandByPiece()`(layout.ts)를
      // 따로 호출해 `score.notes` 전체(이 레인 루프와 별개로, 그리기 가시창
      // 제약 없이)를 두 번 더 훑었음 — 매 프레임 994개 노트 스캔을 최대 3번
      // (그리기용 1번 + 이 2번) 하던 셈. 이 루프 안에서 같이 체크하되, **판정
      // 허용범위 체크는 반드시 그리기 가시창(windowStart~windowEnd) continue
      // 전에** 둔다(아래 실제 체크 지점 주석 참고) — 가시창이 보통은 판정
      // 허용범위보다 넓지만(T3-15 1차 구현은 이걸 가정하고 가시창 continue
      // 뒤에 체크해 모드A가 실제 버그로 지적함: 극단적으로 빠른 BPM·짧은
      // 박자표에선 가시창이 판정 허용범위보다 좁아질 수 있어 노트를 놓칠 수
      // 있었음), 가시창 앞에 두면 그 가정 자체가 필요 없어져 원래
      // activePieces/activeHandByPiece(가시창 제약이 아예 없었음)와 항상
      // 완전히 같은 의미가 된다. 이 결과(Set/Map)는 호출자가 React state에
      // 저장하므로(PracticeCanvas.tsx) 위 `visibleNotePool`과 달리 프레임마다
      // 새로 만든다(재사용하면 이미 state로 넘어간 이전 프레임 결과까지
      // 뒤늦게 바뀌어버림 — React의 불변성 전제를 깨는 버그가 됨).
      const activePiecesResult = new Set<DrumPiece>()
      const activeHandResult = new Map<DrumPiece, Hand>()
      // T6-1(성능) — 레인별 인덱스 구축(곡이 바뀔 때만, 위 ensureLaneIndex 참고).
      ensureLaneIndex(score)
      // 이진탐색 경계는 "그리기 가시창"과 "판정 허용범위" 중 더 넓은 쪽을 둘 다
      // 포함해야 한다(바로 위 모드A 지적과 동일한 이유 — 둘 중 하나만 쓰면 극단적
      // BPM에서 판정창 안인데 가시창 밖인 노트를 놓칠 수 있음). min/max로 감싸
      // 원래 전체 스캔과 결과가 항상 동일하도록 보장.
      const searchLowerBound = Math.min(windowStart, currentTimeSeconds - options.hitWindowSeconds)
      const searchUpperBound = Math.max(windowEnd, currentTimeSeconds + options.hitWindowSeconds)
      for (let laneIndex = 0; laneIndex < LANES.length; laneIndex++) {
        const lane = LANES[laneIndex]
        const laneCenterX = laneIndex * laneWidth + laneWidth / 2
        const laneNotes = notesByLaneIndex[laneIndex]
        const startIndex = lowerBoundIndex(laneNotes, searchLowerBound, noteTimeOf)
        for (let ni = startIndex; ni < laneNotes.length; ni++) {
          const note = laneNotes[ni]
          const t = noteTimeOf(note)
          // laneNotes는 틱(=이 호출의 고정 playbackBpm에서는 시간) 오름차순이므로
          // 경계를 넘으면 이후 노트도 전부 범위 밖 — 안전하게 break.
          if (t > searchUpperBound) break
          // 모드A 지적(실제 버그, T3-15) — 판정 허용범위 체크를 그리기 가시창
          // continue보다 먼저 둬야 한다. 가시창(windowEnd=lookaheadSeconds)이
          // 보통은 판정 허용범위(hitWindowSeconds=0.06초 등)보다 넓지만,
          // `lookaheadSeconds`는 `barDurationSeconds × barsVisible`이라
          // 극단적으로 빠른 BPM·짧은 박자표·보이는 마디 수 1에선 0.06초보다
          // 작아질 수 있음(검증기가 BPM 상한을 강제하지 않음) — 그러면 가시창
          // 밖인데 판정창 안인 노트를 기존(score.notes 전체를 가시창 제약 없이
          // 쓰던 activePieces/activeHandByPiece)과 달리 놓치게 됨. 가시창
          // continue 전에 먼저 체크해 원래 동작과 완전히 동일하게 맞춘다.
          if (Math.abs(t - currentTimeSeconds) <= options.hitWindowSeconds) {
            activePiecesResult.add(note.piece)
            activeHandResult.set(note.piece, note.hand)
          }
          if (t < windowStart || t > windowEnd) continue
          const yCenter = noteYPosition(t, currentTimeSeconds, speed, hitLineY)
          const shape = lane.shapeByPiece[note.piece]
          if (!shape) continue
          // T2-9(Phase 2 게이트 피드백) — 노트는 위→아래로 떨어지므로 "닿는" 순간은
          // 도형의 하단 모서리가 판정선에 닿는 순간이어야 소리와 맞는다(리듬게임
          // 관례). `noteYPosition`은 도형 "중심"이 판정선에 오는 시각을 기준으로
          // 계산하므로, 그리는 위치를 도형별 실제 하단 돌출 거리만큼 위로 올려
          // 하단이 정확히 그 시각에 판정선에 닿게 한다 — 도형마다 그려지는 범위가
          // 달라(예: x-ring은 더 아래까지) `noteSize/2` 하나로 통일하면 안 됨.
          const extent = shapeBottomExtent(shape, noteSize)
          const shapeY = yCenter - extent
          const v = nextPooledNote()
          v.laneCenterX = laneCenterX
          v.shape = shape
          v.shapeY = shapeY
          v.topEdgeY = shapeY - extent
          v.color = options.pieceColor(note.piece)
          v.label = showSticking ? handLabel(note.hand) : null
          v.handSource = note.handSource
        }
      }
      // T3-11 피드백 2차(2026-10-25, 의뢰인 질문) — 같은 레인에서 노트끼리
      // 겹치면 "나중에 칠(미래, 화면 위쪽)" 노트가 위 레이어라 "곧 칠(판정선에
      // 가까운)" 노트의 halo 일부가 가려졌음(`visibleNotePool`은 틱 오름차순
      // 순서로 채워지고 배열 뒤쪽일수록 미래 노트 — 위 setup 주석 참고). 지금
      // 당장 쳐야 하는 노트가 더 중요하므로, 거꾸로 돌아 "곧 칠" 노트를
      // 나중에(=위 레이어) 그린다 — 리듬게임에서 판정선에 가까운 노트가 시각
      // 우선권을 갖는 통념과도 일치.
      for (let i = visibleNoteCount - 1; i >= 0; i--) {
        const v = visibleNotePool[i]
        const sprite = getNoteSprite(v.shape, noteSize, v.color, options.stickingTextColor)
        ctx.drawImage(sprite, v.laneCenterX - sprite.width / 2, v.shapeY - sprite.height / 2)
      }
      // REQ-12 — 노트 위 R/L(/RF/LF) 글자. 자동 추천 값은 반투명
      // (intent/08-design.md §3 "자동 추천 값은 50% 투명도"), 사용자 지정은 불투명.
      for (let i = 0; i < visibleNoteCount; i++) {
        const v = visibleNotePool[i]
        if (v.label === null) continue
        const prevAlpha = ctx.globalAlpha
        ctx.globalAlpha = v.handSource === 'user' ? 1 : 0.5
        // T2-10(Phase 2 게이트 3차 피드백 "RL이 잘 안보임") — 최소 크기를
        // 10px→13px로 키움. 투명도(auto=50%)는 intent/08-design.md §3의
        // 의뢰인 결정 수치라 임의로 안 건드림(바꾸려면 별도 확인 필요).
        ctx.font = `bold ${Math.max(13, noteSize * 0.55)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        // T2-13(Phase 2 게이트 6차 피드백 "HH의 R이 잘 안보임") — 하이햇처럼
        // 노트가 연속으로 촘촘히 떨어지는 레인은 글자 주변에 다른 노트의 도형
        // (X자 획)이 겹쳐 글자가 배경 잡음에 묻혔다. 색 자체를 바꾸는 대신
        // 캔버스 배경색으로 글자 테두리(halo)를 먼저 그려 어떤 배경 위에서도
        // 글자 윤곽이 도드라지게 함 — 기존 색·투명도 규칙은 그대로 둔 채
        // 가독성만 보강(라이브러리 표준 기법: 윤곽선 먼저, 채우기 나중).
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3
        ctx.strokeStyle = options.laneHeaderBackgroundColor
        ctx.strokeText(v.label, v.laneCenterX, v.topEdgeY - 2)
        ctx.fillStyle = options.stickingTextColor
        ctx.fillText(v.label, v.laneCenterX, v.topEdgeY - 2)
        ctx.globalAlpha = prevAlpha
      }

      // 판정선
      ctx.strokeStyle = options.hitLineColor
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, hitLineY)
      ctx.lineTo(width, hitLineY)
      ctx.stroke()

      // 레인 머리글(HH/CR/SN/...) — 판정선 바로 아래(캔버스 맨 하단)에 그린다.
      // T2-10에선 캔버스 최상단에 그렸는데, 의뢰인이 실사용 중 상단 글자를 전혀
      // 인지하지 못했다가 보고서를 읽고서야 알았다고 재보고(T2-11, Phase 2 게이트
      // 4차 피드백) — 실제 시선은 낙하 노트를 눈으로 좇다 판정선 근처에 머무르므로
      // 그 바로 아래가 더 눈에 띈다는 실사용 피드백을 그대로 반영(의뢰인 본인의
      // 요청 = intent/ 문서 변경 승인, `intent/04-ui-ux.md` §3도 함께 갱신 예정).
      // 맨 마지막에 그려 낙하하는 노트가 뒤로 지나가도 항상 위에 보이게 하고,
      // 뒤에 배경 띠를 깔아 노트와 겹쳐도 글자가 묻히지 않게 함(T2-10에서 도입).
      const laneHeaderY = height - LANE_HEADER_HEIGHT
      ctx.fillStyle = options.laneHeaderBackgroundColor
      ctx.fillRect(0, laneHeaderY, width, LANE_HEADER_HEIGHT)
      ctx.fillStyle = options.stickingTextColor
      ctx.font = 'bold 14px sans-serif' // intent/08-design.md §4 "레인 머리글 18px 700" 기준에서,
      // 레인 폭이 좁을 수 있어 14px로 축소(가로 겹침 방지) — 폭이 넓으면 자동으로 여유 생김.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let laneIndex = 0; laneIndex < LANES.length; laneIndex++) {
        const laneCenterX = laneIndex * laneWidth + laneWidth / 2
        ctx.fillText(LANES[laneIndex].label, laneCenterX, laneHeaderY + LANE_HEADER_HEIGHT / 2)
      }

      return {
        activePieces: activePiecesResult,
        activeHandByPiece: activeHandResult,
      }
    },
    dispose() {
      // Canvas 자체는 DOM 요소 소유자(React)가 정리 — 여기선 내부 상태가 없어 no-op.
    },
  }
}
