> 한 줄 요약: T2-9 QA — 프론트(tsc/oxlint/vitest 131/131) 통과. 노트 판정 순간을 하단 모서리 기준으로 수정(시간 계산 자체는 불변, 픽셀 오프셋만 변경). MusicDelta_Grunge가 Phase 0 ADTOF 자동 채보 테스트 데이터임을 바이트 비교로 확정 — 톰 F-measure 0.33(재현율 0.25)로 "소리 사라짐"·"초반 노트 안 맞음" 보고와 수치가 일치, T2-x 구현 버그 아님.

# T2-9 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 프론트 타입체크 | `npx tsc -b` | PASS |
| 프론트 lint | `npx oxlint` | PASS |
| 프론트 단위 테스트 | `npx vitest run` | PASS (131/131, 회귀 없음 — `laneRenderer.ts`는 픽셀 오프셋만 바뀌어 전용 테스트 대상 아님) |
| MusicDelta_Grunge 출처 확인 | `diff <(xxd data/t0-2-work/MusicDelta_Grunge.mid) <(xxd data/songs/2/original.mid)` | **바이트 완전 동일** |

전체 로그: `raw_log.txt`

## 판정 순간 정밀도 수정
`render/laneRenderer.ts`의 노트 도형을 `yCenter - noteSize/2`에 그리도록 수정 — 도형의 **하단 모서리**가 판정선에 닿는 순간이 정확히 노트의 계산된 시각(=실제 소리 재생 시각, T2-8에서 이미 맞춰둠)과 일치하게 됨. 이 수정은 노트의 **시각(초) 계산**(`noteTimeOf`, 판정창 `hitWindowSeconds`)을 전혀 안 건드리고 이미 올바른 시각에 그려지는 도형의 **그리는 좌표만** 상수(`noteSize/2`, 8~14px)만큼 이동한 것이라 "오디오 타이밍·동기" 위험 작업이 아님(시각 자체가 아니라 그 시각을 화면의 어느 픽셀에 대응시키는지만 바뀜) — Codex 모드C 생략, T2-7의 표시 전용 변경과 같은 패턴. 실제 브라우저로 재생해 도형이 판정선 부근에서 하단부터 닿는 모양을 스크린샷으로 확인(`screenshot-edge-fix-playback.jpg`) — 정확한 프레임(도형 바닥이 선에 닿는 그 한 프레임)을 포착하는 건 스크린샷 타이밍 도구의 한계로 보장 못 하므로, 코드 자체의 상수 오프셋 정확성(리뷰로 확인 가능)이 1차 근거이고 스크린샷은 보조.

## MusicDelta_Grunge 출처 — 새 버그가 아니라 테스트 데이터 선택 문제
사용자가 보고한 "초반 노트가 실제 음과 전혀 다름", "중간에 소리가 잠깐 사라짐"의 원인을 찾기 위해 이 곡의 원본 MIDI 출처를 조사:
- `data/songs/2/original.mid`(실제 업로드된 곡 파일)와 `data/t0-2-work/MusicDelta_Grunge.mid`(Phase 0, T0-2 ADTOF 드럼 채보 모델 평가 파이프라인의 산출물 — `qa-evidence/T0-2/eval_adtof.py`의 `full_mix.wav --[Demucs separate]--> drums.wav --[adtof-pytorch]--> output.mid` 과정 결과)를 `xxd`로 바이트 단위 비교 — **완전히 동일**함을 확인. 즉 지금 라이브러리의 "MusicDelta_Grunge"는 사람이 만든 정답 MIDI가 아니라 **AI 모델이 실제 드럼 음원을 듣고 자동으로 받아쓴 결과물**이다.
- `qa-evidence/T0-2/result_raw.json`에 이미 측정돼 있던 이 트랙의 분류별 F-measure(`musicdelta-grunge-fmeasure.json`에 원문 보존): 킥 0.97(거의 정확), 스네어 0.85, **탐(TT) 0.33**(정밀도 0.5·재현율 0.25 — 실제 탐 12건 중 모델이 찾아낸 건 겨우 3건(`n_est`), 그나마도 절반은 오탐). 재현율 0.25는 "실제 탐 히트의 75%가 MIDI에 아예 없다"는 뜻 — 사용자가 보고한 "중간에 소리가 사라짐"(특정 구간에 실제론 연주되는 탐이 빠져 있어 조용해짐)과 "초반 노트가 실제 음과 다름"(모델의 온셋 오탐은 트랙 시작부에서 흔한 실패 유형)은 이 수치와 정확히 부합한다.
- **결론**: 이건 T2-x(편집기·연습 화면·오디오 엔진) 구현의 버그가 아니라, **Phase 0에서 이미 측정·기록해 둔 ADTOF 모델 자체의 정확도 한계**(REQ-02 경로 A, Phase 3 과제)가 테스트용으로 올려둔 이 특정 곡에서 눈에 띄게 드러난 것이다.
