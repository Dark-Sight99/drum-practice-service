> 한 줄 요약: Phase 2 게이트 실사용 피드백에서 발견된 오디오-화면 동기화 버그(카운트인 오프셋 누락) 수정 — "오디오 타이밍·동기"는 위험 작업이라 Codex 모드C 선행. 연습 화면 R/L 즉석 자동계산(위험 작업 아님)도 같이 진행.

# T2-8 계획 — Phase 2 게이트 피드백 수정

## 배경
의뢰인이 실제 MIDI 곡(MusicDelta_Grunge)으로 연습 화면을 써보고 2026-10-24에 보고한 문제:
1. 노트가 판정선(하얀 선)을 다 지나간 뒤에야 실제 드럼 소리가 들림 — "늦게 치는 느낌"
2. 노트가 안 보이는데 드럼 소리만 들릴 때가 있음
3. 곡 초반 5초가 특히 안 맞음
4. 연습 화면의 "R/L 표시" 체크박스를 켜고 꺼도 차이가 없음(MusicDelta_Grunge는 스티킹 데이터가 아예 없는 곡)

## 원인 조사(실제 코드로 확인)
`app/web/src/audio/scorePlayer.ts`의 `playDrumScore()`는 각 노트의 실제 소리를 `schedule.songStartSeconds + ticksToSeconds(note.tick, ...)`에 예약한다(`songStartSeconds = barDurationSeconds(...) * countInBars` — 카운트인 마디 길이, 기본 1마디·120bpm 4/4면 2초). 반면 `app/web/src/render/laneRenderer.ts`의 `noteTimeOf`는 `ticksToSeconds(note.tick, ...) + audioOffsetMs/1000`만 계산해 **`songStartSeconds`를 더하지 않는다.**

그 결과 노트는 화면에서 카운트인이 없는 것처럼 2초(1마디) 일찍 나타나 판정선을 지나가고, 실제 소리는 카운트인이 끝난 뒤 제 박자에 맞춰 2초 늦게 난다 — 사용자가 보고한 "노트 지나간 뒤 소리 남"과 정확히 일치. 이 오프셋은 곡 전체에 걸쳐 일정하게 존재한다(초반만의 문제가 아니라, 처음 인지되는 지점이 초반이었을 뿐).

`PracticeCanvas.tsx`의 진행바(progress bar) 계산은 이미 `songStartSeconds`를 올바르게 반영하고 있어 — 렌더러 호출 쪽만 빠뜨린 것으로 확인(동일 파일 안에서 두 로직이 따로 songStartSeconds를 다루다 한쪽만 빠짐).

마디/박선(`barBeatLines`)은 수정 불필요 — `songStartSeconds`가 항상 `barDurationSeconds`의 정수배(카운트인이 정수 마디수)라, t=0 기준으로 생성되는 주기적 격자가 이미 `songStartSeconds` 지점에서도 마디 경계와 자연히 일치한다(카운트인 구간도 "박자 격자" 상으로는 그냥 그 앞의 마디일 뿐).

## 위험 작업 여부 판단
`intent/06-pipeline.md` §1-1의 위험 작업 기준에 **"오디오 타이밍·동기"가 명시**돼 있음 — 이번 수정 1(동기화 버그)은 정확히 이 범주. **구현 전 Codex 모드C 설계 검수 필요.**
수정 2(연습 화면 R/L 즉석 계산)는 DB/API 변경도, 오디오 타이밍 변경도 없는 순수 표시 로직 추가라 위험 작업 아님 — 모드C 생략, 모드A/B만.

## 설계

### 수정 1(위험 작업 — 모드C 대상): 동기화 버그
- `render/laneRenderer.ts`: `LaneRenderer.render()`에 `songStartSeconds: number` 파라미터 추가(새 필수 파라미터, `currentTimeSeconds` 바로 다음 — 둘 다 "지금이 절대 시각 기준 언제인지"를 나타내는 값이라 묶어 둠). `noteTimeOf`를 `songStartSeconds + ticksToSeconds(note.tick, score.ppq, playbackBpm) + score.audioOffsetMs/1000`으로 수정(이 식 자체는 기존과 동일, `songStartSeconds`만 추가).
- `features/practice/PracticeCanvas.tsx`: 렌더 루프 안에서 `barSeconds`/`songStartSeconds` 계산을 (이미 진행바 계산에 있던 것을) `renderer.render()` 호출보다 앞으로 끌어올려 같은 값을 렌더러 호출에도 전달. 진행바 계산은 그대로 재사용(중복 계산 제거).
- 영향 범위: 호출부가 `PracticeCanvas.tsx` 한 곳뿐임을 grep으로 확인 — `LaneRenderer` 타입을 쓰는 다른 테스트 파일 없음(T2-3 때부터 Canvas 렌더러는 전용 테스트 없이 수동 QA로만 검증, jsdom 제약 때문).

### 수정 1-2(Codex 모드C 1차 지적 C-001 반영, 필수): `audioOffsetMs` 비대칭
`laneRenderer.ts`의 `noteTimeOf`는 `score.audioOffsetMs`를 더하는데, `scorePlayer.ts`의 실제 오디오 스케줄링(`schedule.songStartSeconds + ticksToSeconds(...)`)은 애초부터 이 필드를 전혀 반영하지 않았음(카운트인 오프셋과는 별개의, 기존부터 있던 비대칭) — `audioOffsetMs`가 0이 아닌 곡이 생기면(현재는 `score/import/midiEvents.ts`가 항상 0으로 생성해 실질 영향 없음, Phase 3 오디오-MIDI 정렬(T3-5)에서 실제로 쓰일 값) 화면과 소리가 그만큼 계속 어긋난다. `scorePlayer.ts`의 노트 스케줄 식도 렌더러와 동일하게 `+ score.audioOffsetMs / 1000`을 더해 대칭을 맞춘다(카운트인 클릭 스케줄은 악보 노트가 아니라 메트로놈 프리롤이라 영향 없음, 그대로 둠).

### 수정 1-2 관련 보류 사항 → 최종적으로 검증 단계에서 0 강제(Codex 모드C 2~3차 지적 반영)
위 수정을 적용하면 오프셋이 노트를 A-B 루프 시작/끝 마디 경계 너머로 밀어낼 수 있어, 그 노트가 반복마다 누락되거나 구간 밖에서 재생될 수 있다는 지적(2차, high). **1차 대응(문서화만)은 부족했다** — "`audioOffsetMs`를 설정하는 UI·가져오기 경로가 없다"는 근거만으로는 막지 못함: `score/validate.ts`·`api/schemas.py`의 검증이 "유한하기만 하면 통과"였어서, **API에 직접 0이 아닌 값을 가진 DrumScore JSON을 올리는 경로(업로드·저장 둘 다)는 막혀 있지 않았다**(3차 지적, C-001 — 맞는 지적, 1차 판단이 틀렸음을 인정).

**최종 수정**: `score/validate.ts`와 `api/schemas.py` 둘 다 `audioOffsetMs`를 "유한한 숫자"에서 **"정확히 0"**으로 검증을 강화 — 업로드(`POST /songs`)·편집기 저장(`PUT /songs/{id}/drumscore`) 어느 경로로도 0이 아닌 값이 들어올 수 없게 됐다(클라이언트 `validateDrumScore()`가 편집기 저장 전에도 한 번 더 막음). 이걸로 "지금은 발생 불가능하다"는 주장이 우연한 현재 상태가 아니라 **검증으로 강제되는 불변식**이 됐다 — 루프 경계+오프셋 상호작용 설계 자체는 여전히 Q-23으로 Phase 3(T3-5)에 넘기되, 그 전까지 이 경로가 실제로 막혀 있음을 테스트로 증명.

### 수정 2(위험 작업 아님): 연습 화면 R/L 즉석 계산
- `PracticeCanvas.tsx`에서 `score.notes`를 렌더러에 그대로 넘기는 대신, `useMemo(() => recommendSticking(score.notes, score.ppq, DEFAULT_START_HAND), [score])`로 계산한 사본을 **렌더링(시각 표시)에만** 사용. 재생(`playDrumScore`)은 `hand`/`handSource`를 전혀 읽지 않으므로 원본 `score` 그대로 사용 — 재생 로직 영향 없음.
- `recommendSticking`은 이미 `handSource==='user'`(편집기에서 직접 지정한 값)는 그대로 통과시키므로, 편집기에서 일부만 지정해둔 곡도 지정 안 된 나머지만 자동 계산되는 기존 동작과 자연스럽게 일치.
- 서버에는 아무것도 저장하지 않음(연습 화면은 읽기 전용 표시) — 편집기에서 "자동 추천 재적용"을 눌러야 저장되는 기존 흐름(REQ-12)은 그대로 유지, 연습 화면은 그 결과를 미리 보여주는 것뿐.

## 가정 — R/L 자동 추천의 신뢰도(의뢰인 질문에 대한 답)
의뢰인이 "정확한 정보를 줄 수 있냐"고 물었음 — **정확하다고 보증할 수 없다.** `score/sticking.ts`의 규칙은 REQ-12가 명시한 "오른손잡이 기본 규칙"(하이햇/라이드/크래시=오른손, 킥=오른발, 하이햇과 동시타 스네어=왼손, 빠른 연타 구간은 교대)일 뿐 전문 드러머 검증을 거치지 않은 휴리스틱이다. Q-11(스티킹 자동 추천 규칙의 타당성, Phase 2 게이트에서 의뢰인 검토 예정)이 바로 이 상황을 가리키던 질문 — 이번이 그 검토 시점. 자동 계산 값은 화면에 반투명(50%)으로 표시돼 "추천"임을 구분하지만(REQ-12), 반투명 표시만으로는 "확실하지 않다"는 뜻이 명확히 안 와닿을 수 있어 별도 안내 문구 필요 여부는 의뢰인에게 확인.

## 테스트 계획
1. `render/laneRenderer.ts`는 전용 단위 테스트가 없음(Canvas, jsdom 한계) — `noteTimeOf` 계산 자체의 정합성은 코드 리뷰+수동 QA로.
2. 수동 QA(실제 브라우저+서버): MusicDelta_Grunge 재생 → 카운트인 클릭이 끝나는 순간과 곡 첫 노트가 판정선에 닿는 순간이 일치하는지, 중반 노트 몇 개를 눈과 귀로 대조해 판정선 통과 시점과 소리가 같이 나는지 확인. R/L 표시 토글 켜면 레인/킷에 글자·점선이 바로 보이는지(저장 없이) 확인, 편집기에서 직접 지정한 손이 있는 곡이면 그 값이 유지되는지(연습 화면에서 임의로 안 바뀌는지) 확인.
3. **`audioOffsetMs` 비영점 사례**(Codex 모드C 1차 C-001 요구): `audioOffsetMs`를 0이 아닌 값(예: 500ms)으로 설정한 테스트 DrumScore를 만들어 `app/web/src/audio/scorePlayer.ts`의 노트 스케줄 식과 `app/web/src/render/laneRenderer.ts`의 `noteTimeOf`가 같은 값을 내는지 코드 리뷰로 재확인(현재 Phase 2 실제 데이터엔 비영점 값이 없어 수동 브라우저 QA로는 직접 재현 불가 — 코드 대칭성 확인으로 대체, 사유를 QA 증거에 명시).
4. 전체 회귀: `npx tsc -b`/`oxlint`/`vitest run`, 백엔드는 변경 없음(프론트 전용 수정).
