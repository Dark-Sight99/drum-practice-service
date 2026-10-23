> 한 줄 요약: alphaTab(Node.js)으로 MusicXML 퍼커션 트랙에서 노트별 GM 피치까지 정확히 추출 확인. REQ-02 경로 C 타당성 확인됨.

# T0-4 결과 — alphaTab 드럼 트랙 추출 확인(2026-10-23)

## 근거 REQ
REQ-02 드럼 채보 모델 — 경로 C(디지털 악보: MIDI/.musicxml/.mxl/GP) 가져오기

## 테스트 자료 (저작권 문제 회피)
실제 저작권 있는 GP/MusicXML 샘플을 구하지 않고, **직접 작성한 최소 MusicXML 퍼커션 테스트 파일**(`drum_test.musicxml`)을 사용. 킥(MIDI 37)·스네어(MIDI 39)·클로즈 하이햇(MIDI 43) 4노트, percussion clef, MIDI channel 10 지정.

## 방법
공식 Node.js 가이드(https://alphatab.net/docs/guides/nodejs) 그대로 확인 후 사용:
```js
import * as alphaTab from "@coderline/alphatab";
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fileData), settings);
```
문서에 Track/Note의 퍼커션 관련 필드가 나와 있지 않아 **실제 실행 결과로 직접 확인**(기억/추측 금지 원칙).

## 결과 (실행 로그 전체: `raw_log.txt`)
- `staff.isPercussion` → `true` (퍼커션 트랙으로 정확히 인식)
- `track.percussionArticulations` → 배열 3개, 각각 `{id, outputMidiNumber, staffLine, ...}`
- `note.isPercussion` → `true`, `note.percussionArticulation` → `percussionArticulations` 배열의 인덱스
- **핵심**: `percussionArticulations[i].outputMidiNumber` 가 36(킥)/38(스네어)/42(하이햇)으로 **GM 표준 피치로 정규화되어 출력됨** — 원본 MusicXML에 `<midi-unpitched>37/39/43</midi-unpitched>`(MusicXML 1-indexed 표기)로 넣었는데도 alphaTab이 36/38/42(0-indexed GM 표준)로 올바르게 변환함.

## 해석
- `03-architecture-stack.md`의 DrumScore `piece`↔GM 번호 매핑(`kick=36, snare=38, hihat_closed=42...`)과 alphaTab의 `outputMidiNumber`를 그대로 1:1 연결하면 됨 — 별도 변환 테이블 불필요, GM 번호가 이미 맞게 나옴.
- REQ-02 경로 C(MIDI/MusicXML/GP → DrumScore) 중 **MusicXML 경로는 기술적으로 타당성 확인됨**.

## 한계 (지어내지 않음, 명시)
- **Guitar Pro(.gp/.gp3~.gp5/.gpx) 파일로는 테스트하지 않음** — 저작권 있는 실제 GP 파일 없이 바이너리를 직접 작성하는 건 비현실적. alphaTab 공식 사이트는 GP3~8을 지원한다고 명시하고, 내부적으로 GP/MusicXML 모두 같은 Score/Track/Beat 모델로 로드되므로(공식 Node 가이드의 `ScoreLoader.loadScoreFromBytes`가 포맷에 무관하게 동일 API 사용) 같은 필드가 나올 것으로 **추정**하나, 실측은 아님. 의뢰인이 보유한 GP 파일이 생기면 재검증 권장.
- 이번 테스트는 악보 1개 노트 4개의 최소 사례. 실제 복잡한 악보(겹음, 잇단음, 다중 보이스)에서의 동작은 Phase 2 T2-1 구현 시 추가 검증 필요.

## REQ-02 수용 기준 충족 여부
- [x] "각 경로별 샘플 1개 이상으로 DrumScore 생성 성공" 중 경로 C(MusicXML) 확인
- [ ] 경로 C의 GP 하위 포맷(.gp/.gp3~.gp5/.gpx) 실측 — 보류(실제 GP 샘플 필요)
