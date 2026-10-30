> 한 줄 요약: T6-10 — `trackPlayer.ts`의 `resync()`가 드리프트 보정 시 매번 `currentTime` 강제 점프(seek)를 하는 게 iOS 실기기 fps 저하의 진짜 원인으로 실기기 토글 실험으로 확정됨. 작은 드리프트는 `playbackRate` 미세 조정으로 부드럽게 따라잡고, 큰 드리프트만 기존처럼 즉시 점프시키는 2단계 보정으로 바꿈. **1차 구현(하드 스냅 기준 2.0초)은 실기기 재측정에서 "음원이 계속 늦게 들림" 회귀를 일으켜(초기 오프셋이 2초보다 작으면 느린 소프트 보정만 적용돼 따라잡는 데 수십 초 걸림) 기준을 0.5초로 낮춰 2차 수정함(아래 "2026-10-30 실기기 재측정" 참고).

# T6-10 설계안 — resync() seek을 playbackRate 보정으로 대체

근거: `intent/07-open-questions.md` Q-33, 의뢰인 실기기 토글 실험(2026-10-30).

## 문제 (실기기 토글 실험으로 확정)

`PracticeCanvas.tsx`의 루프 안에 화면에 보이는 범위별로 4개의 진단용 토글 버튼(T6-9)을 추가해 하나씩 분리 테스트:
1. 루프 전체 건너뛰기 → **렉 사라짐(60fps)**
2. `renderer.render()`(+`setActiveHandByPiece`)만 끄기 → 렉 그대로(무죄)
3. 진행바·시간표시 DOM 쓰기만 끄기 → 렉 그대로(무죄)
4. **`tracks.resync()`만 끄기 → 렉 사라짐(60fps)** — 단, 소리가 점점 어긋남(당연 — 보정 자체를 껐으니)

**원인 확정**: `resync()`가 0.75초마다 드리프트(허용오차 0.1초)를 넘으면 `track.element.currentTime = ...`로 강제 점프시키는데, iOS에서 Web Audio 우회 경로(T3-12)를 탄 `<audio>` 엘리먼트의 이 seek 자체가 무거운 것으로 보임(지금까지 확인한 iOS Web Audio 특성과 일치 — 정확한 WebKit 내부 메커니즘까지는 확인 못 함, 모르는 부분은 모른다고 명시).

## 설계

### 2단계 보정(Codex 모드C 1차 C-001/C-002 반영으로 설계 수정)

**(Codex C-002 반영)** `scorePlayer.ts`를 직접 확인한 결과, 루프 경계(A-B 반복 지점)는 `resync()`와 **완전히 별개인 경로**로 이미 정확히 처리되고 있었다 — Transport가 루프 시작 지점에 맞춰 `tracks.playFrom(positionSeconds, playbackRate)`를 직접 스케줄(line 198-217)해서, 그 순간 `currentTime` 점프 + 재생 재시작을 전담한다. 즉 **`resync()`는 루프 점프 같은 "큰 불연속"을 신경 쓸 필요가 아예 없다** — 재생 중 자연적으로 조금씩 쌓이는 "작은 드리프트"만 상대하면 됨. 이걸로 설계가 단순해졌다: 드리프트 크기로 "루프 점프인지 아닌지"를 판단하려던 원래 계획(C-002가 지적한 모호함)을 버리고, 하드 스냅은 "정상적으로는 거의 안 일어나야 할 비정상적으로 큰 드리프트"에 대한 방어선으로만 둔다(임계값을 넉넉하게, 2초).

**(Codex C-001 반영)** 임계값 경계(0.1초)에서 보정이 매 호출(0.75초)마다 켜졌다 꺼졌다 할 수 있다는 지적 — **진입 임계값과 이탈 임계값을 다르게 두는 히스테리시스**로 해결한다. 별도 상태를 새로 안 만들어도 된다 — "지금 보정 중인지"는 `track.element.playbackRate`가 현재 `basePlaybackRate`와 다른지를 보면 바로 알 수 있다(이미 존재하는 값을 그대로 신호로 재사용):
- 보정 중이 **아닐 때**: 드리프트가 **진입 임계값**(`thresholdSeconds`, 기존 0.1초)을 넘어야만 보정을 시작.
- 보정 **중일 때**: 드리프트가 더 작은 **이탈 임계값**(`thresholdSeconds`의 절반, 0.05초)보다 작아져야만 보정을 멈추고 기준 배속으로 복귀. 그 사이(0.05~0.1초)에서는 계속 보정 유지.

이러면 경계값 근처에서 아주 미세하게 흔들려도 보정이 꺼졌다 켜졌다 반복하지 않는다(의도적으로 "꺼지는 조건"을 더 엄격하게 둬서).

### API 변경

`TrackPlayer.resync()`에 `basePlaybackRate` 인자 추가(호출부가 이미 매번 계산해서 들고 있는 값 — `PracticeCanvas.tsx`/`EditorScreen.tsx` 둘 다 `const playbackRate = ...`를 `resync()` 호출보다 먼저 계산 중이라 그대로 넘기기만 하면 됨, 새 계산 불필요 — Codex C-004로 두 호출부 순서 재확인 완료). **누적 보정이 아니라 매 호출마다 `basePlaybackRate` 기준으로 다시 계산**(이전 보정 위에 또 보정을 쌓지 않음).

```ts
const SOFT_CORRECTION_MAX_RATE_DELTA = 0.08 // ±8%
const SOFT_CORRECTION_GAIN = 0.5 // 드리프트(초) → 배속 보정 비율
const RESYNC_EXIT_FACTOR = 0.5 // 이탈 임계값 = 진입 임계값 × 이 값(히스테리시스)
const RATE_EPSILON = 0.001 // "지금 보정 중인가" 판별용 허용오차
const HARD_SNAP_THRESHOLD_SECONDS = 2.0 // 루프 점프는 별도 경로로 처리되므로, 이건
  // 순수 방어선(정상 동작에선 거의 발동 안 해야 함)

function resync(
  expectedSongPositionSeconds: number,
  thresholdSeconds: number,
  basePlaybackRate: number,
): void {
  for (const track of tracks) {
    if (!track.unlocked || track.element.paused) continue
    const actualSongPositionSeconds = track.element.currentTime
    const driftSeconds = actualSongPositionSeconds - expectedSongPositionSeconds
    const absDrift = Math.abs(driftSeconds)
    const isCorrecting = Math.abs(track.element.playbackRate - basePlaybackRate) > RATE_EPSILON
    const effectiveThreshold = isCorrecting ? thresholdSeconds * RESYNC_EXIT_FACTOR : thresholdSeconds

    if (absDrift > HARD_SNAP_THRESHOLD_SECONDS) {
      track.element.currentTime = Math.max(0, expectedSongPositionSeconds)
      track.element.playbackRate = basePlaybackRate
    } else if (absDrift > effectiveThreshold) {
      const delta = Math.min(
        SOFT_CORRECTION_MAX_RATE_DELTA,
        Math.max(-SOFT_CORRECTION_MAX_RATE_DELTA, -driftSeconds * SOFT_CORRECTION_GAIN),
      )
      track.element.playbackRate = basePlaybackRate * (1 + delta)
    } else {
      track.element.playbackRate = basePlaybackRate
    }
  }
}
```

**(Codex C-005 반영)** `preservesPitch = true`는 `playFrom()`/`seekTo()`에서만 설정되고 `resync()` 자체엔 없음 — `resync()`는 이미 재생 중인 엘리먼트의 `playbackRate`만 바꾸는 거라 `preservesPitch`는 그 엘리먼트가 애초에 재생을 시작시킨 `playFrom()`에서 이미 `true`로 설정된 채 유지되고 있을 것으로 보이나(HTMLMediaElement 스펙상 속성은 명시적으로 안 바꾸면 유지됨), **실기기에서 실제로 유지되는지 확인 필요**(아래 테스트 계획에 추가).

**상수값은 전부 추정치** — 수학적으로는 "0.1초 드리프트를 ~2주기(1.5초) 안에 따라잡는다" 정도를 목표로 역산했지만, 실제로 들었을 때 배속 변화가 거슬리는지·동기화가 잘 맞는지·경계에서 진동이 실제로 없는지는 실기기로만 확인 가능(아래 테스트 계획).

### 호출부 변경

- `PracticeCanvas.tsx`: `tracks.resync(expectedSongPositionSeconds, TRACK_RESYNC_THRESHOLD_SECONDS, playbackRate)` — `playbackRate`는 이미 같은 블록에서 계산됨.
- `EditorScreen.tsx`: 동일 패턴, `playbackRate`도 이미 계산돼 있음.

### 되돌릴 수 있어야 함(의뢰인 요청)

이 변경은 `trackPlayer.ts`의 `resync()` 함수 하나와 두 호출부 한 줄씩으로 범위가 좁아 git으로 쉽게 되돌릴 수 있음. 추가로 데스크톱(기존에 아무 문제 없었던 환경)에서 **싱크 품질이 전과 동일한지**(지연·밀림 없이) 반드시 재확인 후에만 최종 반영 — 데스크톱에서 체감이 나빠지면 이 변경 자체를 보류.

## 테스트 계획

- **단위 테스트**(`trackPlayer.test.ts`, Codex C-003 반영해 구체화): 작은 드리프트 → `playbackRate`가 `basePlaybackRate`보다 살짝 높거나 낮게 설정됨(방향 확인 — 뒤처졌으면 더 빠르게, 앞섰으면 더 느리게), `currentTime`은 안 건드림. 큰 드리프트(2초 초과) → 기존처럼 `currentTime` 점프 + `playbackRate`는 `basePlaybackRate`로 복귀. 드리프트가 진입 임계값 이하(보정 중이 아니었을 때) → 보정 시작 안 함. 보정 비율이 `SOFT_CORRECTION_MAX_RATE_DELTA`를 넘지 않는지(클램프 확인). **히스테리시스 상태 전이**(여러 번 연속 `resync()` 호출로 시뮬레이션): (a) 드리프트가 진입~이탈 임계값 사이(0.05~0.1초)일 때 보정 중이 아니었으면 안 켜짐, 보정 중이었으면 안 꺼짐(양쪽 다 확인), (b) 경계값 정확히(0.1초 정각, 0.05초 정각, 2.0초 정각)에서의 분기, (c) 보정으로 드리프트가 점점 줄어들다가 이탈 임계값 아래로 떨어지면 기준 배속으로 복귀하고 그 후 다시 작은 드리프트가 생기면 재진입 임계값(더 큰 쪽)부터 다시 평가하는지.
- 기존 테스트 전부(`vitest`/`tsc`/`oxlint`) 회귀 없음.
- **데스크톱 실측**: 평소처럼 재생해 눈으로 노트-소리 싱크 확인(어긋남 없는지), fps 그대로 60인지.
- **아이폰 실측(핵심)**: T6-9 진단용 토글 전부 끈(정상 모드) 상태로 평소처럼 재생 — fps가 60 근처로 올라오는지, 그리고 **소리가 끊기거나 음정이 흔들리거나 어긋나지 않는지** 전부 확인.
- 확인 끝나면 T6-9의 진단용 토글 4개(`PracticeCanvas.tsx`) 제거.

## 2026-10-30 실기기 재측정 — 1차 구현 회귀 발견·2차 수정

1차 구현(`RESYNC_HARD_SNAP_THRESHOLD_SECONDS = 2.0`) 배포 후 의뢰인 실기기 확인: **fps는 더 이상 안 떨어짐(해결됨)**, 그런데 새 증상 2개 보고 — (1) "음악원본이 되게 늦게 재생되는거 같다"(데스크톱과 동시에 재생했을 때 모바일이 눈에 띄게 늦음), (2) "중간중간 음원이 끊긴다... mute되는거 마냥 가끔 안들림".

**원인 분석**: iOS에서 재생 시작 직후 한 번 발생하는 초기 오프셋(원인 미확인 — Web Audio 우회 경로의 디코딩/언락 지연으로 추정되나 실기기로 그 자체를 측정하진 않음, 추측과 사실 구분)이 보통 1~2초대로 보이는데, 이게 **하드 스냅 기준(2.0초)보다 작으면 소프트 보정만 적용**돼 최대 ±8% 속도 차이로 따라잡아야 함 — 1.5초 격차를 8%로 따라잡으려면 산술적으로 약 19초가 걸림(실기기 체감과 일치). 그동안 계속 늦게 들리는 게 (1)의 원인. (2)의 "가끔 안 들림"은 긴 소프트 보정 구간 동안 정확히 뭐가 어떻게 겹쳐 생기는지까지는 확인 못 했으나(모르는 부분은 모른다고 명시), 하드 스냅 기준을 낮춰 애초에 그 긴 소프트 보정 구간 자체가 거의 안 생기게 하는 게 먼저 시도할 수정.

**2차 수정**: `RESYNC_HARD_SNAP_THRESHOLD_SECONDS`를 2.0 → **0.5**로 낮춤. 이러면 1~2초대의 큰 초기 오프셋은 다시 기존처럼 즉시 1회 점프로 바로잡히고(원래 코드도 이 경우를 즉시 고쳤었음 — 이 부분에선 회귀가 아니라 원래 동작으로 되돌리는 것), 재생 "중" 반복적으로 쌓이는 진짜 작은(0.1~0.5초) 드리프트만 소프트 보정 대상으로 남음 — 애초 오늘 실기기 토글 실험으로 확정된 문제(같은 작은 드리프트가 0.75초마다 계속 재발해 **매번** seek되던 것)는 여전히 해결한 채로.

**확인 필요(다음 실기기 재측정)**: (a) fps가 여전히 안 떨어지는지(0.5초 기준으로 낮춰도 "반복되는 작은 드리프트"는 여전히 소프트 보정이라 seek 빈도는 안 늘어야 함 — 다만 실측 재확인 필요), (b) 음원 시작 타이밍이 데스크톱과 비슷해지는지, (c) "가끔 안 들림" 증상이 사라지는지.
