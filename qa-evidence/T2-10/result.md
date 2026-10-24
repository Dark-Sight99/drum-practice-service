> 한 줄 요약: T2-10 QA — 프론트(tsc/oxlint/vitest 131/131) 통과. 레인 머리글(HH/CR/SN/...)이 `intent/04-ui-ux.md` 와이어프레임에 명시돼 있었는데 T2-3 구현이 빠뜨렸던 실제 누락임을 코드로 확인해 추가, 실제 브라우저로 스크롤 중에도 항상 보임을 확인. R/L 글자 최소 크기를 키움(투명도는 의뢰인 결정 수치라 불변).

# T2-10 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 프론트 타입체크 | `npx tsc -b` | PASS |
| 프론트 lint | `npx oxlint` | PASS |
| 프론트 단위 테스트 | `npx vitest run` | PASS (131/131, 회귀 없음 — `laneRenderer.ts`는 Canvas 전용 테스트 대상 아님) |

전체 로그: `raw_log.txt`

## 레인 머리글 누락 확인(코드로)
`grep -n "lane.label" app/web/src/render/laneRenderer.ts`로 확인 — `LaneDef.label`(HH/CR/SN/T1/T2/FT/RD/KK)을 그리는 코드가 전혀 없었음. `intent/04-ui-ux.md` §3 와이어프레임("HH CR SN T1 T2 FT RD KK ← 레인 머리글")과 `intent/08-design.md` §4("레인 머리글 18px 700")에 명시된 요구사항이 T2-3 구현 시 빠졌던 것 — 추측이 아니라 두 문서와 실제 코드를 직접 대조해 확인.

## 수동 QA(실제 브라우저)
MusicDelta_Grunge 연습 화면에서 확인(스크린샷 `screenshot-lane-headers.jpg`, 확대 `screenshot-lane-headers-zoom.png`):
- 레인 머리글(HH CR SN T1 T2 FT RD KK)이 캔버스 최상단에 항상 고정 표시됨 — 매 프레임 맨 마지막에 그려(노트 위에 덮어씀) 노트가 지나가도 가려지지 않음.
- R/L 글자가 이전보다 크고 굵게(`bold`, 최소 13px) 표시돼 가독성 개선 확인.
- 실제 화면에서 스네어 레인에 연속된 "R"만 보이는 구간을 확인 — `score/sticking.ts`의 "필인 구간(간격 좁음)만 교대, 그 외 고립 노트는 기본손"이라는 설계가 실제 데이터에서 그대로 동작함을 확인(간격이 넓어 "필인"으로 안 묶인 구간은 전부 기본값 R).
