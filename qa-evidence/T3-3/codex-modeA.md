> 한 줄 요약: Codex 모드A 코드 검수 1라운드 — Fail(Medium 1건, 실제 버그: `resync()`가 `currentTime`에 `playbackRate`를 중복 적용해 1배속이 아닐 때마다 잘못 보정). 즉시 수정(`resync()` 시그니처에서 `playbackRate` 제거) + 약했던 테스트를 실제 `currentTime` 값 검증으로 재작성.

# T3-3 Codex 모드A 검수 로그

## 라운드 1 — Fail

Target: `main...task/T3-3-multitrack-sync-playback` 코드 변경(`qa-evidence/T3-3/result.md`는 안 읽은 상태로 코드만 검수).

Finding:
- **Medium — `app/web/src/audio/trackPlayer.ts`의 `resync()`가 재생률을 중복 적용**: `track.element.currentTime`은 이미 원곡 파일 기준 초(= `expectedSongPositionSeconds`와 같은 단위, `audioTrackPositionSeconds()`가 이미 그 변환을 끝낸 값)인데, `resync()`가 `currentTime * playbackRate`로 한 번 더 곱해 "실제 위치"를 계산했다. 1배속(연습 BPM=원곡 BPM)일 때는 `*1`이 영향 없어 숨겨져 있었지만, 배속이 다를 때마다(예: 0.5배속에서 완벽히 동기인 `currentTime=0.5`를 `0.25`로 잘못 계산) 드리프트를 오판해 매 폴링마다 불필요하게(또는 틀리게) `currentTime`을 재설정할 수 있음. 부가 지적: `trackPlayer.test.ts`의 기존 `resync()` 테스트는 예외 발생 여부만 확인해 이 버그를 못 잡았음.

## 수정
- `resync()` 시그니처에서 `playbackRate` 매개변수를 **제거**(남겨두면 또 틀리게 쓸 여지가 생김 — 버그 원인 자체를 API에서 없앰). `actualSongPositionSeconds`는 그냥 `track.element.currentTime`.
- 호출부(`PracticeCanvas.tsx`)도 2개 인자로 수정.
- `trackPlayer.test.ts`의 `resync()` 테스트를 전부 재작성: `HTMLMediaElement.prototype.currentTime`의 setter를 직접 스파이(call-through 유지)해 "드리프트 안에선 안 건드림" / "드리프트 밖이면 정확히 기대값으로 보정" / "0.5배속 완벽 동기 시나리오에서 안 건드림(이번 버그의 정확한 회귀 테스트)" / "언락 실패·일시정지 트랙은 건너뜀" 4가지를 실제 값으로 검증(이전엔 "예외 없음"만 확인).

재검증: `vitest` 154개 전부 통과(기존 150 + 리싱크 테스트 재작성으로 +4), `oxlint`·`tsc --noEmit` 0건. 실제 브라우저(Chromium)로 **연습 BPM 60(원곡 120의 50%)**에서 재생해 리싱크 폴링 주기(750ms)를 여러 번 지나도 콘솔 에러 없음을 확인(1배속에서는 숨겨져 있던 버그라 일부러 배속을 바꿔 확인).

## 라운드 2 — APPROVE(나이트픽 1건)
Target: 커밋 `ec4ad53`(`f60d560` 대비) 단독 diff.

- 수정 확인: `resync()`가 `currentTime`을 그대로 쓰고 `playbackRate` 매개변수도 제거됨(호출부 `PracticeCanvas.tsx`도 일치) — **CORRECT**.
- 나이트픽(과장 아님, 즉시 반영): 0.5배속 회귀 테스트가 `playFrom(0.5, 1)`로 **1배속**인 채 이름만 "0.5배속"이라 적었던 약점 지적. `primedUnpausedPlayer`가 playbackRate를 받도록 바꿔 실제로 `playFrom(0.5, 0.5)`로 그 트랙의 playbackRate를 0.5로 두고 재검증(`resync()` 자체는 playbackRate를 더 이상 안 받으므로 버그 재발 가능성은 이미 없지만, 테스트 서술의 정확성을 위해 반영).

재검증: `vitest` 154개 전부 통과, `tsc --noEmit`·`oxlint` 0건.

## 결론
모드A 지적 전부 반영 완료(2라운드 APPROVE). 추가 지적 없음(API 소유권/404/kind 제한, 노트 스케줄·루프 재진입 위치 계산은 이상 없음으로 확인됨).
