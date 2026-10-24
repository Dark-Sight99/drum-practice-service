> 한 줄 요약: Codex 모드C(설계 검수, 1회차) — needs-attention. 카운트인 오프셋 누락 진단은 맞지만, audioOffsetMs가 렌더러에만 반영되고 실제 오디오 스케줄링엔 없어 비영점 값에서 동기가 계속 어긋난다는 필수 지적(C-001, high). 스케줄 식에 audioOffsetMs 추가로 대칭화해 반영.

# T2-8 Codex 모드C 원문 (2026-10-24, 1차)

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

진단은 카운트인 오프셋 누락을 뒷받침하지만, 제안만 적용해도 audioOffsetMs가 설정된 곡에서는 화면과 소리의 동기가 어긋납니다.

Findings:
- [high] C-001: audioOffsetMs 불일치가 수정 후에도 남음 (app/web/src/render/laneRenderer.ts:155-156)
  렌더러는 노트 시각에 `score.audioOffsetMs`를 더하지만, 재생기는 `songStartSeconds + ticksToSeconds(...)`만 예약합니다. 따라서 제안대로 `songStartSeconds`를 렌더러에 전달해도 audioOffsetMs가 0이 아닌 점수에서는 화면과 소리가 그 값만큼 계속 어긋납니다. 이는 카운트인 오프셋 수정이 곡 전체의 동기를 복구한다는 계획의 핵심 주장에 한계가 있음을 뜻합니다.
  Recommendation: 오프셋의 기준과 부호를 확정하고, 렌더링과 오디오 스케줄링 양쪽에서 같은 유효 노트 시각을 사용하도록 설계를 보완하세요. 구현 전 audioOffsetMs가 0이 아닌 점수의 동기 사례를 QA 항목에 추가하세요.

Next steps:
- C-001을 반영해 렌더러와 재생기 사이의 공통 노트 시각 기준 및 비영점 audioOffsetMs 검증을 설계에 명시한 뒤 구현을 진행하세요.
```

## 재현 확인
`grep -rn "audioOffsetMs"`로 실제 코드 확인 — `laneRenderer.ts`는 `noteTimeOf`에서 `+ score.audioOffsetMs / 1000`을 더하지만, `scorePlayer.ts`의 노트 스케줄 식(`schedule.songStartSeconds + ticksToSeconds(...)`)에는 이 필드가 전혀 없음. 현재 `score/import/midiEvents.ts`가 항상 `audioOffsetMs: 0`으로 생성해 Phase 2 실제 데이터로는 영향이 드러나지 않지만(0을 더해봐야 0), 이 필드는 Phase 3(T3-5, 오디오-MIDI 오프셋 정렬)에서 비영점 값으로 쓰일 예정이라 지금 고쳐두지 않으면 나중에 같은 종류의 버그가 재발한다 — Codex 지적이 맞음.

## 반영
`work/T2-8/plan.md`에 "수정 1-2" 섹션 추가 — `scorePlayer.ts`의 노트 스케줄 식에도 `+ score.audioOffsetMs / 1000`을 더해 렌더러와 대칭을 맞춤(카운트인 클릭은 악보 노트가 아니라 메트로놈 프리롤이라 영향 없음, 그대로 둠). 테스트 계획에 "audioOffsetMs 비영점 사례" 항목 추가 — 실제 데이터로 재현은 불가능(현재 전부 0)하므로 코드 대칭성 리뷰로 대체함을 명시.
