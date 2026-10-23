> 한 줄 요약: DrumScore TypeScript 타입·GM 매핑 상수(공식 표 재확인)·검증 함수(크래시 없음) 구현. REQ-02의 최소 분류 9종 전부 표현, 테스트 18개로 증명.

# T1-5 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/score/types.ts` | `DrumPiece`(9종), `Hand`, `HandSource`, `ScoreSource`, `DrumNote`, `DrumScoreMeta`, `DrumScore` | `intent/03-architecture-stack.md` §2 스키마, REQ-02 최소 분류 |
| `app/web/src/score/gmMapping.ts` | `PIECE_TO_GM_NOTE`, `GM_NOTE_TO_PIECE`(역방향) | REQ-02(MIDI 내보내기), 향후 T2-1(MIDI 가져오기) |
| `app/web/src/score/validate.ts` | `validateDrumScore`(예외 없이 에러 목록 반환), `isDrumScore`(타입가드) | REQ-02 수용 기준("인식 실패/부분 인식 시에도 크래시 없이... 진입") |
| `app/web/src/score/index.ts` | 재노출 | — |
| `app/web/src/score/gmMapping.test.ts`, `validate.test.ts` | 테스트 18개 | `work/T1-5/plan.md` 테스트계획 |

## 범위 결정: 왜 app/web(TypeScript)만
`intent/03-architecture-stack.md` §1 "모든 화면이 이 형식만 읽음"에 따라 DrumScore는 프런트엔드가 소비하는 계약으로 판단. T1-1에서 이미 `app/web/src/score/`를 빈 디렉터리로 스캐폴드해둔 것도 이 판단을 뒷받침함. REQ-02 경로 C(MIDI/MusicXML/GP)는 `@tonejs/midi`·`alphaTab`(JS/TS 라이브러리)로 **브라우저에서 직접** DrumScore를 만드는 경로라 TypeScript 타입이 먼저 필요함. 경로 A(ADT)·B(OMR)가 Python에서 DrumScore를 생성하는 부분은 Phase 3(T3-2)·Phase 4(T4-1) 범위라 이번엔 다루지 않음(CLAUDE.md 절대규칙 6) — 그 작업에서 Python이 만든 JSON을 이 TypeScript 타입·검증 함수로 교차 검증하면 됨. 자세한 근거는 `work/T1-5/plan.md` §범위.

## 구현 근거 (실행 결과로 확인)
- GM 매핑 값(`intent/03-architecture-stack.md`가 예시로 든 kick=36 등)은 "구현 시 공식 표로 재확인" 요구사항에 따라 메모리에 의존하지 않고 Finale 공식 문서가 게재한 General MIDI Level 1 퍼커션 키맵을 WebFetch로 직접 확인(출처 URL은 `qa-evidence/T1-5/result.md`). 9종 전부 일치 확인 — tom_mid(47→Low-Mid Tom)·tom_floor(43→High Floor Tom)는 GM에 유사 명칭이 2개씩 있는데(Hi-Mid Tom 48, Low Floor Tom 41) 우리 분류가 1종뿐이라 기존 설계값을 그대로 유지하는 쪽으로 판단.
- 검증 함수는 예외를 던지지 않고 `{valid, errors}`를 반환하도록 설계 — REQ-02 수용 기준이 "인식 실패/부분 인식 시에도 크래시 없이 '인식된 부분 + 편집 필요' 상태로 진입"을 요구하기 때문. 노트 하나가 잘못돼도 그 노트만 에러로 잡고 나머지는 영향 없음을 테스트로 확인(`validate.test.ts`의 "flags only the invalid note..." 케이스).
- 완전히 잘못된 입력(`null`, 문자열, `notes`가 배열이 아님 등)에도 예외 없이 `invalid` 반환하는 것을 테스트로 확인.

## 실행한 검증
`qa-evidence/T1-5/result.md`, `raw_log.txt` — tsc/oxlint/vitest(18/18) PASS. prettier는 이번 변경 파일(`src/score/`)만 따로 돌려 PASS 확인 — 전체 `src` 기준으로는 T1-1 때부터 있던 기존 파일 6개(App.tsx 등)에서 포맷 경고가 있으나 이번 작업과 무관해 손대지 않음(범위 밖).

## 가정
- 서버(Python)에 동일한 DrumScore 타입/검증을 만들지 않음 — Phase 3/4에서 실제 생성 코드가 필요해질 때 이 TypeScript 쪽과 교차 검증하는 방식으로 대응.
- `audioOffsetMs`는 음수도 허용(오디오가 MIDI보다 먼저 시작하는 경우 표현 — `work/T1-5/plan.md` §가정).
- `hand`가 `user`로 지정된 값을 자동 추천이 덮어쓰지 않는 보존 규칙(REQ-12)은 편집기 로직(Phase 2+)에서 구현할 내용이라 이번엔 "유효한 열거값인지"만 검사.

## 질문
- 없음.

## 남은 문제
- GM 매핑·DrumScore 타입을 실제로 쓰는 코드(MIDI/MusicXML/GP 파서, MIDI 내보내기)는 T2-1부터.
- Python 쪽 DrumScore 생성(ADT/OMR)은 Phase 3/4(T3-2, T4-1) — 그때 이 TypeScript 타입과의 교차 검증 필요.
