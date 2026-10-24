> 한 줄 요약: Codex 모드C(설계 검수, 3회차=최대) — needs-attention. "현재 audioOffsetMs를 0이 아닌 값으로 설정하는 경로가 없다"는 2차 대응의 보류 근거가 틀렸음을 지적(업로드·저장 API가 유한하기만 하면 통과시켜 직접 JSON 조작으로 0이 아닌 값 유입 가능, C-001 high). `06-pipeline.md` §1-1 "최대 3회" 규칙에 따라 Codex 재호출 없이 검증 단계에서 0을 강제하는 실제 코드 수정으로 반영 후 종료.

# T2-8 Codex 모드C 원문 (2026-10-24, 3차=최대)

대상: `work/T2-8/plan.md`(2차 반영분), `intent/07-open-questions.md` Q-23

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

보류 근거가 약합니다. 비영점 오프셋을 가진 유효한 DrumScore가 들어오는 경로를 차단하지 않아, 루프 경계 결함을 '현재 도달 불가'로 간주하기 어렵습니다.

Findings:
- [high] C-001: 비영점 오프셋 점수의 유입을 막지 않으면서 루프 결함을 보류함 (work/T2-8/plan.md:30)
  계획은 MIDI import가 0을 생성하고 편집 UI가 없다는 점만으로 현재 발생 경로가 없다고 결론 내립니다. 그러나 `validate.ts`는 `audioOffsetMs`가 유한한 숫자인지만 확인하며 비영점 값을 거부하지 않고, `EditorScreen.tsx`도 점수의 오프셋을 전달하고 저장 상태에서 돌려줍니다. 따라서 비영점 값을 가진 유효한 DrumScore가 로드되거나 전달되면 이 제한에 걸리지 않습니다. 이 경우 노트 시각만 이동하고 A-B 루프 경계는 그대로라 경계 밖 노트가 루프에서 누락되거나 구간 밖에 예약될 수 있습니다. 현재 import가 0이라는 사실만으로는 해당 경로를 차단했다고 볼 수 없어, 문서화만 하고 보류하는 판단은 안전하지 않습니다.
  Recommendation: 비영점 `audioOffsetMs` 점수를 받아들이는 실제 로드·저장 경로를 확인하고, 그 경로가 없다면 검증 단계에서 0만 허용하도록 제한하세요. 비영점 값이 유효하게 유입될 수 있다면 T2-8에서 루프 경계 동작을 정의하고 경계 근처 노트의 회귀 검증을 추가하세요.

Next steps:
- DrumScore 로드·검증 경로에서 비영점 오프셋이 허용되는지 확인하고, 차단 또는 루프 경계 처리 중 하나를 이번 변경의 완료 조건으로 정하세요.
```

## 재검토 — 2차 대응의 근거가 왜 틀렸는지
2차 대응은 "import·편집 UI가 0이 아닌 값을 만들지 않는다"는 것만 확인하고, **업로드·저장 API 자체의 검증**은 재확인하지 않았다. 실제로 `app/web/src/score/validate.ts`와 `app/server/api/schemas.py`를 다시 보니 둘 다 `audioOffsetMs`에 대해 "유한한 숫자인가"만 검사하고 있었음 — UI를 거치지 않고 `PUT /songs/{id}/drumscore`나 `POST /songs`에 직접 0이 아닌 값을 가진 JSON을 보내면 그대로 통과·저장됐을 것이다. "지금은 발생 안 한다"는 2차 판단은 **UI 부재**만 확인했지 **API 자체의 방어**를 확인하지 않은 실수였다 — Codex 3차 지적이 맞다.

## `06-pipeline.md` §1-1에 따른 처리
모드C가 3회(최대) 연속 needs-attention을 냈다. 매 회차 실제 결함(1차: audioOffsetMs 비대칭 자체, 2차→3차: 그 수정이 만드는 새 위험과 보류 근거의 허점)을 짚었고, 이번 3차 Recommendation 자체가 실행 가능한 구체적 해법("검증 단계에서 0만 허용")을 제시하고 있어 — 규칙에 따라 Codex 재호출 없이 마스터가 그 해법을 그대로 구현한다.

## 반영
Recommendation 그대로 채택 — `score/validate.ts`·`api/schemas.py` 둘 다 `audioOffsetMs` 검증을 "유한한 숫자"에서 **"정확히 0"**으로 강화(Phase 3 오디오-MIDI 정렬 UI가 생기기 전까지 임시 제한, `intent/07-open-questions.md` Q-23에 근거 명시). 업로드·편집기 저장 양쪽 API에 거부 테스트 추가(`test_upload_rejects_nonzero_audio_offset`, `test_save_rejects_invalid_drumscore_invariants`의 새 파라미터), 프론트 `validate.test.ts`에도 거부 테스트 추가. 이제 "0이 아닌 값이 들어올 수 없다"는 주장은 우연한 현재 상태가 아니라 세 겹(프론트 검증·백엔드 업로드 검증·백엔드 저장 검증)으로 강제되는 불변식이다.

## 결론
3회차 이후 종료 → Codex가 제시한 구체적 해법을 그대로 구현해 반영. 이번 모드C 3라운드의 교훈: "지금은 그 경로가 없다"는 보류 판단을 할 때는 **그 필드가 통과하는 모든 쓰기 경로**(이번 경우 업로드 API, 저장 API, 둘 다 프론트 검증과 백엔드 검증이 별도로 존재)를 전부 확인해야 한다 — UI가 없다는 것과 API가 막는다는 것은 다른 주장이고, 전자만 확인하고 후자를 "당연히 막혀있겠지"라고 넘겨짚은 게 이번 실수였다.
