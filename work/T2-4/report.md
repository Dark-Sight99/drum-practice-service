> 한 줄 요약: BPM 변경(원곡 50%~150%)과 A-B 구간 반복(마디 단위) 구현. Tone.js Transport의 네이티브 loop가 schedule()·scheduleRepeat() 이벤트 모두 루프 경계에서 끊김·중복 없이 재발화하는 것을 실제 설치된 소스로 확인 후 그대로 사용 — 실측 18초(~4.5바퀴) 콘솔 에러 0건.

# T2-4 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/audio/timing.ts` | `ticksPerBar`, `barIndexForTick`, `computePlaybackSchedule`(순수 함수) 추가 | REQ-04, BPM·루프를 실제 Transport 스케줄링에 필요한 초 단위 값으로 변환 |
| `app/web/src/audio/scorePlayer.ts` | `playDrumScore`에 `playbackBpm`·`loop` 옵션 추가, `computePlaybackSchedule` 결과로 재생 시작 위치·루프 지점 설정 | REQ-04 |
| `app/web/src/render/laneRenderer.ts` | `render()`에 `playbackBpm` 선택 인자 추가 — 레인 낙하 속도·노트 위치가 연습 BPM을 따라가게 함 | REQ-04 "레인은 같은 BPM으로 동기화" |
| `app/web/src/features/practice/PracticeCanvas.tsx` | BPM 슬라이더+숫자 입력, A-B 루프 켜기/끄기+마디 입력, 마디 진행바(+루프 구간 표시) UI 추가 | REQ-04, `intent/04-ui-ux.md` §3 상단 바 |
| `app/web/src/audio/timing.test.ts` | 테스트 9개(`ticksPerBar` 2, `barIndexForTick` 3, `computePlaybackSchedule` 4) | `work/T2-4/plan.md` 테스트계획 |

## 범위 결정
`intent/05-todo.md` T2-4는 "BPM 변경·A-B 루프 (REQ-04)"만 명시. REQ-04가 함께 요구하는 "오디오 트랙은 음정 유지 상태로 속도 변경"은 Phase 2엔 분리된 원곡 오디오 트랙이 아직 없어(Demucs 분리는 Phase 3 T3-1) 적용 대상 자체가 없음 — MIDI 드럼 소리만 있고 MIDI는 속도를 바꿔도 음정이 변하지 않는다. 메트로놈 켜기/끄기·음량 UI는 `intent/04-ui-ux.md` §4 믹서 패널(메트로놈을 믹서 트랙으로 나열)에 속해 `05-todo.md` T3-4로 이미 분리돼 있어 범위 밖 — 카운트인 클릭(T2-2에서 구현)만 계속 사용. 상세 근거는 `work/T2-4/plan.md` §범위.

## 구현 근거 (실행 결과로 확인)
- **Tone.js 네이티브 루프가 끊김·중복 없이 동작하는 근거**: 실제 설치된 버전(`node_modules/tone` v15.1.22)의 소스를 직접 읽어 확인 — `Transport.js`의 `_processTick()`은 루프 중 `ticks >= loopEnd`가 되면 클록 틱을 `loopStart`로 되돌린 뒤 `this._timeline.forEachAtTime(ticks, ...)`로 그 위치에 예약된 이벤트를 호출하는데, `TransportEvent.invoke()`는 `once: true`가 아닌 한 호출 후에도 이벤트를 제거하지 않아(`transport.schedule()`로 예약한 드럼 노트·카운트인 클릭은 기본 `once: false`) 루프가 같은 위치를 다시 지나갈 때 자동으로 재발화한다. `TransportRepeatEvent.js`(메트로놈이 쓰는 `scheduleRepeat()`)는 생성자에서 `transport.on("loopStart", this._boundRestart)`로 루프 시작을 직접 구독해 다음 이벤트들을 재계산·재스케줄한다. 이 근거로 커스텀 루프 재스케줄링 로직 없이 네이티브 `loop`/`loopStart`/`loopEnd`를 그대로 썼다. 상세는 `work/T2-4/plan.md` §설계 "Tone.js 루프 동작 근거".
- **`computePlaybackSchedule` 설계**: 루프가 지정되면 카운트인을 곡 맨 앞이 아니라 "루프 시작 바로 앞"에 둬서(`playbackStartSeconds = loopStartSeconds - songStartSeconds`), 루프 밖 구간을 처음부터 재생하지 않고 곧장 루프 구간으로 진입하게 했다 — `loop.startBar===0`이면 결과가 루프 없음과 수식상 동일해짐을 테스트로 확인(`timing.test.ts`).
- `transport.start(time, offset)`의 `offset` 파라미터로 재생 시작 위치를 직접 지정할 수 있음을 실제 타입 정의·소스(`Transport.js`의 `start(time, offset)` → `this._clock.start(time, offsetTicks)`)로 확인 후 사용.

## 실행한 검증
`qa-evidence/T2-4/result.md`, `raw_log.txt` — tsc/oxlint/prettier(T2-4가 실제로 바꾼 6개 파일)/vitest(74/74) PASS. 실제 브라우저로 BPM 슬라이더↔재생 속도 동기화 확인, A-B 루프 18초(~4.5바퀴) 콘솔 에러 0건, 루프 종료 후 일반 재생 정상 복귀, 반응형 스크린샷 3종(`screenshot-phone-portrait.jpg`, `screenshot-tablet.jpg`, `screenshot-pc.jpg`).

## Codex 모드A 검수 반영
`qa-evidence/T2-4/codex-modeA.md` — 판정 REQUEST_CHANGES, 필수 수정 1건(C-001).

- **C-001(재현됨, 수정 완료)**: 마디 진행바가 루프 중에도 "곡 전체 대비 진행률"로 계산돼, 긴 곡(예: 16마디)의 짧은 일부(마디 2~3)만 루프하면 진행바가 전체 범위의 좁은 구간(12.5%~18.75%)에서만 움직여 사실상 멈춘 것처럼 보이는 버그. 루프가 켜져 있으면 진행바를 "루프 구간 안에서의 위치"(0~100%)로 계산하도록 수정, 기존 오버레이(곡 전체 위에 루프 구간 하이라이트)는 제거하고 대신 "⟲ 마디 N~M 반복 중" 라벨+진행바 색상으로 루프 모드를 표시.
- 재검증: 16마디 곡에서 마디 2~3만 루프 → 진행바가 매 바퀴 0~100%를 꽉 채워 오가는 것을 실제 브라우저에서 확인. 수정 후 tsc/oxlint/prettier/vitest 재실행 — 전부 클린, 74/74 통과.

## 가정
- BPM 슬라이더는 정수 단위로 반올림.
- A-B 루프 마디 범위는 UI에서 1-기준으로 표시(사용자 친화), 내부 계산은 0-기준.
- 마디 진행바는 Canvas가 아니라 일반 HTML(div 너비 %)로 구현.
- 메트로놈 온/오프 UI는 범위 밖(§범위) — 카운트인 클릭은 기존처럼 항상 울림.

## 질문
- 없음.

## 남은 문제
- T2-5(라이브러리)가 실제 곡 데이터를 공급하면 `totalBars`·루프 입력 범위가 실제 곡 길이 기준으로 동작하는지 추가 확인 필요.
- 메트로놈 켜기/끄기·음량 UI는 T3-4(믹서)에서 연결.
- REQ-04 공식 수용 기준(±30ms 측정)·오디오 트랙 음정 유지 속도 변경은 Q-05 계획대로 Phase 3(분리 오디오 트랙 생긴 뒤)로 유지.
