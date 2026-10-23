> 한 줄 요약: T2-2b QA — tsc/oxlint/vitest 전부 통과(50/50: 기존 46개 + 신규 4개 velocity→dB 단위 테스트). 실제 브라우저에서 9종 드럼 샘플(Virtuosity Drums, CC0) 전부 로드·재생 확인, 연타 시 끊기지 않음.

# T2-2b QA 결과(2026-10-23)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npx tsc -b` | PASS |
| lint | `npx oxlint` | PASS |
| 포맷 | `npx prettier --check src/audio` | PASS |
| test(단위) | `npx vitest run` | PASS (50/50, T2-2b 신규 4개 — `velocityToDb` 순수 함수만) |
| test(수동, 브라우저) | Claude Browser pane에서 실제 샘플 재생 | PASS — 아래 참고 |

전체 로그: `raw_log.txt`

## 샘플 선정 내역
Virtuosity Drums(Versilian Studios/Karoryfer, **CC0**, https://versilian-studios.com/virtuosity-drums/) 팩(SFZ+FLAC, 1.1GB)에서 `Samples/mid/`(대표 마이크 포지션) 아래 9종을 골라 WAV로 변환(Python `soundfile`, 피치/템포 가공 없음 — CLAUDE.md 규칙1):

| DrumPiece | 원본 파일 | 비고 |
|---|---|---|
| kick | `mid_kick_snon_vl4_rr1.flac` | 스네어 울림 On, 최대 벨로시티 |
| snare | `mid_snare_center_vl36.flac` | center hit, 최대 벨로시티(36단계 중) |
| hihat_closed | `mid_hh_closed_vl4_rr1.flac` | |
| hihat_open | `mid_hh_open_vl4_rr1.flac` | |
| tom_high | `mid_htom_center_vl16.flac` | High Tom |
| tom_mid | `mid_ltom_center_vl16.flac` | **Low Tom** center hit |
| tom_floor | `mid_ltom_offcenter_vl12.flac` | **Low Tom** off-center hit — tom_mid과 같은 드럼이지만 다른 실제 타법으로 구분(가공 없이 구분하기 위함, `work/T2-2b/plan.md` §샘플 선정 기준 참고) |
| crash | `mid_crash_crash_vl3_rr1.flac` | |
| ride | `mid_ride_ride_vl3_rr1.flac` | |

**알려진 한계**: 팩에 톰이 실제로는 2종(Low/High)뿐이라 우리 스키마의 3종(high/mid/floor)과 정확히 안 맞음 — tom_mid/tom_floor가 "같은 저음 톰, 다른 타법"이라 완전히 다른 음높이는 아님. 피치시프트 등 가공으로 억지 3번째 음높이를 만들지 않기로 함(근거 없는 가공 금지).

## 신규 단위 테스트(velocityToDb, 4개)
| 테스트 | 확인하는 것 |
|---|---|
| 전체 벨로시티(1)→0dB, 벨로시티0→-24dB, 중간값(0.5)→-12dB | 선형 매핑 정확성 |
| 범위 밖 값(1.5, -0.5) 클램프 | 비정상 입력에도 합리적 dB 값 반환 |

## 수동 QA(실제 브라우저) — 실제 샘플 재생 확인
Claude Browser pane에서 Vite dev 서버로 임시 하니스(QA 후 삭제)를 띄워 확인:
1. **샘플 로드**(`createDrumVoices`, 9개 fetch+디코딩): 콘솔 에러 없음.
2. **9종 순서대로 트리거**: 콘솔 에러 없음.
3. **하이햇 6연타**(0.15초 간격): `Tone.Player`가 모노포닉(Source 상속, 실제 타입 정의로 확인)이라 트리거마다 새 Player를 만들어 "발사 후 소멸"하는 패턴으로 구현했는데, 실제로 연타해도 끊기거나 예외가 나지 않음을 확인.

## 가정/한계
- 벨로시티 레이어는 각 피스 1개(최대 벨로시티)만 사용 — 멀티벨로시티 샘플링은 범위 밖(`work/T2-2b/plan.md` §가정).
- 마이크 포지션은 `mid`(기본 믹스) 1개만 사용 — 여러 마이크를 섞는 멀티마이킹은 범위 밖.
- `createDrumVoices()`가 동기→비동기로 바뀜(`Promise<DrumVoiceMap>`) — 아직 소비하는 다른 코드가 없어(T2-3 미착수) 영향 없음.
