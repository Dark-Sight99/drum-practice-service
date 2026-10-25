> 한 줄 요약: T3-3(REQ-04) 설계안 — 분리된 스템(T3-1)을 Transport 기반 MIDI 재생(T2-2/T2-4)과 동기화해 다중 트랙으로 재생하고, `preservesPitch`(Q-04 기존 결정)로 음정 유지 속도 변경을 오디오 트랙에도 적용. "위험 작업"(오디오 타이밍·동기, 공개 API 변경) — 구현 전 Codex 모드C 검수 대상.

# T3-3 다중 트랙 동기 재생 + 음정 유지 속도 변경 — 설계

## 근거 REQ
REQ-04: "오디오 트랙은 **음정 유지** 상태로 속도 변경. MIDI·레인·메트로놈은 같은 BPM으로 동기화." 수용 기준: 60%/100%/130%에서 어긋남이 허용치(초기 목표 ±30ms, Q-05 미해소) 이내, 루프 경계에서 끊김·중복 없음.

## 범위 경계(명시, 과한 설계 방지)
- **포함**: 분리된 오디오 트랙(T3-1의 `stem_drums`/`stem_bass`/`stem_vocals`/`stem_other`) 재생을 기존 MIDI/메트로놈/레인 Transport와 동기화. 연습 BPM(50~150%) 변경 시 오디오 트랙도 음정 유지 상태로 속도 변경.
- **제외(다른 작업 범위)**:
  - 트랙별 볼륨 슬라이더·음소거·솔로·"드럼 빼고 듣기" 프리셋 → **T3-4**(REQ-05). T3-3은 이용 가능한 스템을 전부 **동일 기본 게인(1.0)**으로 튼다(T3-4가 UI를 추가하기 전까지의 임시 기본값).
  - `original`(분리 전 원본) 트랙 재생 선택 UI → T3-4에서 다룸(원본까지 더하면 스템 합과 중복 재생되므로 T3-3은 스템 4종만 다룸, 분리가 아직 안 된 곡은 오디오 트랙 없이 기존 MIDI만 재생 — 저하 없이 그대로 동작).
  - `audioOffsetMs` 비0 값 처리 → **T3-5**(오디오-MIDI 오프셋 정렬 UI). 지금까지 모든 실측 곡에서 이 값은 항상 0으로 확인됐음(Q-23)이지만, **"항상 0이었다"는 과거 관찰일 뿐 앞으로도 그렇다는 보장은 아니다**(모드C 1라운드 지적, 타당함— 값이 바뀌면 노트와 오디오 트랙의 기준점이 달라짐). 그래서 가정에 의존하지 않고 **런타임에 직접 확인**한다.
    **가드의 단일 적용 지점(모드C 2라운드 MAJOR 반영 — "루프 재진입에도 적용되는지 불명확"했던 점 해소)**: 이 확인은 `scorePlayer.ts`가 아니라 **`PracticeCanvas.handlePlay()`가 `playDrumScore()`를 호출하기 전, 단 한 곳에서** 한다 — `score.audioOffsetMs !== 0`이면 `tracks` 옵션 자체를 넘기지 않는다(`TrackPlayer`를 **만들지도 않음** — "만들어두고 재생만 안 함"이 아니라 애초에 존재하지 않게). `scorePlayer.ts`는 `options.tracks`가 없으면 §4의 오디오 관련 스케줄(시작/루프재진입 콜백)을 **전혀 등록하지 않는** 기존 "분리 안 된 곡" 경로를 그대로 타므로, 최초 재생이든 루프 반복이든 오디오 관련 코드가 한 번도 실행되지 않는 것이 구조적으로 보장된다(매 호출마다 다시 확인하는 방식이 아니라, 애초에 그 경로 자체가 안 만들어짐 — 각 진입점마다 따로 체크해야 하는 부담이 없음).

## 설계

### 1. 백엔드 — 분리 스템 서빙 엔드포인트(공개 API 변경 — 위험 작업 ①)
`GET /songs/{song_id}/audio/{kind}` 신설. `kind`는 새 enum `AudioAssetKind`(`original`·`stem_drums`·`stem_bass`·`stem_vocals`·`stem_other` — 기존 `AssetKind`에서 `DRUMSCORE_*` 2종만 제외, FastAPI가 enum 경로 파라미터를 자동 검증해 그 외 값은 422).
- 인증·소유권: 기존 `get_owned_song` 의존성 재사용(REQ-08, 타 사용자 곡은 404).
- Asset 행 없음 또는 파일 없음(기존 `transcribe_song`의 "행은 있는데 파일 없음" 방어 패턴 재사용, `resolve_asset_path`+`exists()`) → 404.
- 응답: `FileResponse(path, media_type=...)`. **Range 요청 지원 확인(추측 아님, 실제 설치된 버전 소스로 확인)**: `app/server/.venv`의 Starlette 1.9.0 `FileResponse.__call__` 소스를 직접 읽어 `Range`/`If-Range` 헤더를 파싱해 206 Partial Content로 응답하는 로직이 이미 내장돼 있음을 확인(`_parse_range_header`, `_handle_single_range` 등) — 커스텀 스트리밍 구현 불필요. iOS Safari는 `<audio>` 재생에 Range 응답을 요구하는 것으로 알려져 있어(일반적으로 알려진 사실, 이 프로젝트에서 직접 재현 확인한 것은 아님 — 실기기 QA에서 함께 확인) 중요.
- `media_type`: 저장 포맷에 따라 다름(T3-1은 원본 포맷 그대로 보존, Demucs 출력은 wav) — `mimetypes.guess_type` 또는 확장자 매핑, 추측 없이 실제 저장된 확장자를 읽어 결정.
- CORS/인증 흐름: 프런트는 Vite 개발 프록시(`vite.config.ts`)로 `/api/*`를 동일 출처처럼 호출하므로(`app/web/src/api/client.ts` 주석 확인) `<audio src="/api/songs/9/audio/stem_drums">`도 쿠키가 자동으로 붙는 동일 출처 요청 — 별도 토큰/쿼리파라미터 인증 불필요.

### 2. `SongOut`/`SongSummary` 확장
`available_audio_kinds: list[str]` 필드 추가(해당 곡의 Asset 중 오디오 종류만, DB 조회로 계산). 프런트가 어떤 스템이 있는지 알아야 오디오 엔드포인트를 404 없이 호출할 수 있음(매 kind를 시도해보고 404를 흡수하는 방식보다 명확·효율적).

### 3. 프런트 — `app/web/src/audio/trackPlayer.ts` 신설(오디오 타이밍·동기 — 위험 작업 ②)
Tone.js를 모르는 순수 `HTMLAudioElement` 래퍼(책임 분리 — 기존 `clock.ts`/`drumVoices.ts`와 같은 "작은 책임" 모듈 원칙). Transport 스케줄링은 `scorePlayer.ts`가 맡는다(아래 4번) — `scorePlayer.ts`도 이미 `Tone.getTransport()`를 직접 참조하고 있어(클록 래퍼를 거치지 않음, 기존 코드 확인) 같은 선례를 따름.

```ts
export interface TrackSource { kind: string; url: string }
export interface TrackPlayer {
  /** 사용자 제스처(클릭) 핸들러 안에서 "동기적으로" 호출 — 각 엘리먼트를
   * play()했다가 즉시 pause()해 모바일 자동재생 정책의 "제스처로 인정"
   * 상태를 만들어둔다(이후 Transport 콜백에서의 비동기 play()가 거부되지
   * 않도록). T0-5 스파이크(`qa-evidence/T0-5/sync-test/index.html`
   * `waitForTapThenPlay`)가 iOS Safari에서 새 <audio> 엘리먼트의 첫
   * play()가 제스처 밖이면 NotAllowedError로 거부됨을 실제로 재현한 바 있음
   * — 이번엔 N개를 한 핸들러 안에서 미리 언락하는 방식이라 **그 스파이크와
   * 똑같은 보장은 아님(추정, 실기기 QA로 확인 필요)**.
   * 반환값: 각 소스별 언락 성공 여부(모드C 1라운드 MINOR 반영 — 실패를
   * 조용히 무시하지 않음). 이 성공/실패는 `TrackPlayer` 내부에
   * `kind → {element, unlocked: boolean}` 상태로 **세션(이번 재생) 내내
   * 고정 보관**한다(모드C 2라운드 MINOR 반영 — 상태를 어디 두는지·루프
   * 반복 때 재시도하는지 불명확하다는 지적). `playFrom`은 매번(최초 진입
   * 포함 루프 재진입마다) 이 상태를 다시 확인해 `unlocked===false`인
   * 트랙은 **재시도하지 않고 계속 건너뛴다** — 제스처 밖에서의 재시도는
   * 같은 이유로 다시 거부될 뿐이라 의미가 없고, 처리 안 된 Promise
   * 거부를 반복 생성하는 위험만 늘어남. 즉 "그 재생 세션 동안 그 트랙은
   * 계속 무음"이 확정 동작 — 사용자가 다시 "재생" 버튼을 눌러 새
   * `TrackPlayer`를 만들 때(§4 생명주기) 비로소 다시 언락을 시도한다. */
  prime(): Promise<{ kind: string; ok: boolean }[]>
  /** 곡 내 위치(초, 원곡 기준)로 각 트랙을 이동시키고 재생 시작.
   * preservesPitch=true + playbackRate 설정. */
  playFrom(songPositionSeconds: number, playbackRate: number): void
  /** 주기적 호출 — 기대 위치와 실제 위치가 threshold 초를 넘게 벌어지면
   * currentTime을 보정. */
  resync(expectedSongPositionSeconds: number, playbackRate: number, thresholdSeconds: number): void
  stop(): void
  dispose(): void
}
export function createTrackPlayer(sources: TrackSource[]): TrackPlayer
```
- `preservesPitch`: T0-5 스파이크가 실제 iPhone 13 Pro·iPad mini 5에서 벤더 접두사 없이 `audioEl.preservesPitch = true`만으로 동작함을 이미 실기기로 확인(코드 직접 대조, `sync-test/index.html` 173·179행) — 그대로 재사용.

### 4. `scorePlayer.ts` 확장
`PlayDrumScoreOptions`에 `tracks?: TrackPlayer`(선택, 없으면 기존과 동일하게 MIDI만 재생 — 분리 안 된 곡 하위호환) 추가.
- **동기화 수식(유도, 추측 아님)**: 노트는 `schedule.songStartSeconds + ticksToSeconds(tick, ppq, playbackBpm)` 시각에 울리고, `ticksToSeconds`는 `(tick/ppq)*(60/playbackBpm)`(기존 `timing.ts` 확인) — 이는 연습 BPM 기준 "경과 시각"이다. 오디오 트랙(원곡 그대로 녹음된 파일) 쪽에서 같은 틱에 대응하는 "파일 내부 위치"는 원곡 BPM 기준이므로 `(tick/ppq)*(60/originalBpm)` = `ticksToSeconds(tick,ppq,playbackBpm) * (playbackBpm/originalBpm)`이 된다. 즉 **`audioPositionSeconds(transportSeconds) = (transportSeconds - schedule.songStartSeconds) * playbackRate`**(`playbackRate = playbackBpm/originalBpm`)가 두 시간축을 잇는 일반식 — `audio.playbackRate`를 이 값으로 설정해두면 Transport가 흐르는 동안 재생 중인 오디오도 저절로 같은 비율로 맞게 흘러간다(매 프레임 currentTime을 계산해 넣는 게 아니라 시작 위치만 맞추고 playbackRate로 흘려보냄).
- **시작/루프 재진입 트리거(모드C 1라운드 MAJOR 수정)**: `audioStartSeconds = schedule.loopStartSeconds ?? schedule.songStartSeconds` 시각에 `transport.schedule(cb, audioStartSeconds)`로 1회 예약. 루프가 켜져 있으면 Tone 네이티브 루프가 같은 절대 시각의 `schedule()` 콜백을 경계마다 재발화함(이미 `transport.setLoopPoints`/A-B 루프 설계 시 소스로 확인된 동작, work/T2-4/plan.md "Tone.js 루프 동작 근거" 재사용) — 최초 진입과 매 루프 반복을 **같은 콜백 하나**로 처리.
  콜백 안에서 **`tracks.playFrom(audioPositionSeconds(audioStartSeconds), playbackRate)`를 호출**(위 일반식에 `audioStartSeconds`를 그대로 대입) — ~~루프 여부와 무관하게 항상 0~~(1라운드 지적대로 **틀린 설계**였음: 루프가 0번 마디부터가 아니면 `audioStartSeconds`가 `songStartSeconds`보다 뒤라 `audioPositionSeconds`가 0이 아니다. 예) 8마디 곡에서 4~6마디를 루프하면 매 루프 진입 시 오디오도 "4마디 지점"으로 이동해야 하는데 0(곡 맨 처음)으로 틀어졌을 것). 일반식을 그대로 재사용하면 루프 유무와 무관하게 항상 올바른 위치가 나옴 — 특수 분기 불필요.

  **주의(한계, 추측 아님):** 이 설계는 **A-B 루프 구간이 통째로 반복**되는 경우만 다룬다. 지금 UI(`PracticeCanvas`)의 루프는 정확히 "구간 처음부터"만 지원하므로 범위 안. 구간 중간 탐색(스크러빙)은 REQ-04 수용 기준에 없어 범위 밖.
- **경계에서의 콜백 순서(모드C 1라운드 MAJOR, 한계 인정)**: 같은 절대 시각에 예약된 오디오 재시작 콜백과 기존 노트/메트로놈 재예약 콜백 사이의 **상대적 실행 순서는 보장하지 않는다**(Tone.js 문서·기존 `work/T2-4/plan.md` 근거 모두 "경계에서 재발화한다"만 확인됐지, "여러 콜백 중 어느 게 먼저냐"는 확인된 적 없음 — 추측하지 않음). 다만 둘 다 "look-ahead 스케줄"로 같은 순간에 등록되는 것이고, 오디오 쪽은 `HTMLMediaElement.play()` 자체의 기기별 시작 지연(T0-5 실측상 수백 ms 단위)이 이미 이 순서 차이(통상 수 ms 이하로 추정)보다 훨씬 크게 지배적이라, **콜백 등록 순서 자체가 체감 가능한 차이를 만들 가능성은 낮다고 판단**(확정 아님) — QA 계획 §4에 "루프 경계에서 오디오·MIDI 상대 타이밍"을 별도 항목으로 추가해 실측으로 확인한다.
- `stop()`에서 `tracks.stop()`도 호출, `transport.clear(scheduledAudioStartId)` 포함.
- **생명주기(모드C 1라운드 MAJOR 보강)**: `TrackPlayer`는 기존 `DrumVoiceMap`과 같은 "재생 1회당 1개" 수명을 따른다 — `PracticeCanvas.handlePlay()`가 매번 새 `createTrackPlayer(...)`를 만들고(기존 `createDrumVoices()` 패턴과 동일), `PlaybackHandle.stop()`이 `tracks.stop()`+`tracks.dispose()`를 호출해 이전 `<audio>` 엘리먼트를 전부 정리한다. `stopPlayback()`은 (기존 `disposeDrumVoices` 호출과 나란히) 재생이 끝난 `TrackPlayer`를 반드시 버리고, 다음 `handlePlay()`가 새 인스턴스를 만들게 해 이전 트랙 엘리먼트가 남아 다음 재생과 겹치는 일이 없게 한다.

### 5. 지속적 리싱크 — 임계값은 "확정"이 아니라 Mode C/QA에서 같이 정할 열린 질문
`PracticeCanvas`의 기존 rAF 루프(매 프레임 `clock.getPositionSeconds()`를 이미 읽고 있음)에 저빈도(예: 500ms~1초 간격 스로틀) `tracks.resync(expected, playbackRate, thresholdSeconds)` 호출을 추가한다.
- **왜 ±30ms를 threshold로 쓰면 안 될 가능성이 있는지(T0-5 실측 근거)**: T0-5가 실기기에서 측정한 "어긋남"은 배속에 비례하는 **고정 오프셋**(예: 60%≈-250ms대, 130%≈-590ms대)로 보이고, 이는 "누적되는 드리프트"가 아니라 "재생 시작 자체의 고정 지연"으로 해석됐음(`qa-evidence/T0-5/result.md` 결론2). 고정 지연을 매 polling마다 threshold 기준으로 currentTime을 스냅해 "보정"하면, 그 지연이 사라지지 않고 매번 다시 감지돼 **계속 끊어 재생하는(stutter) 역효과**를 낼 위험이 있다 — 이건 추정이며 실제로 겪어본 적은 없다(T0-5는 실제 Transport+분리 오디오 조합으로 측정한 적이 없음, Q-05 미해소로 남아있는 이유 그대로).
- **제안(마스터 1차 제안, 구현 단계에서 쉽게 바꿀 수 있는 상수 — 최종 확정 아님)**: threshold를 ±30ms보다 느슨하게(예: 80~100ms) 두고 폴링 간격도 느슨하게(500ms~1s) 해서, "루프 경계 같은 큰 점프"는 바로 잡고 "고정 지연 수준의 작은 어긋남"은 상시 보정 대상으로 삼지 않는다.
  **명시(모드C 1라운드 MAJOR 지적 반영)**: 이 값들은 **출시 기준으로 확정하지 않는다**. T0-5의 측정(`qa-evidence/T0-5/result.md`)은 "실제 메트로놈·분리 오디오 트랙 조합"이 아니라 합성 클릭트랙 간 비교였다고 그 문서 자신이 명시하고 있어, 이 설계만으로 ±30ms 충족 여부를 판단할 근거가 못 된다. 그래서 **구현 완료를 "±30ms 충족"으로 보고하지 않고**, QA 단계(§QA계획 3번)의 실측 결과를 있는 그대로 보고한다 — 충족하면 그대로 확정, 못 미치면 "고정 지연로 보이는 수준"인지 "실제 누적 드리프트"인지 구분해 Q-05/Q-24에 갱신하고 사용자 결정을 받는다(Q-24 선례와 같은 태도).

### 6. `PracticeCanvas.tsx` 연동
- `songId: number` prop 추가(현재 `score`만 받음 — `App.tsx`가 `practiceSong.song.id`를 이미 갖고 있어 전달만 추가).
- `song.available_audio_kinds`(API에서 이미 받아온 `SongSummary`)로 어떤 스템이 있는지 파악. **`score.audioOffsetMs !== 0`이면 이 블록 전체를 건너뛴다**(§범위경계의 가드를 적용하는 단일 지점 — `TrackPlayer`를 만들지 않고 `playDrumScore()`에도 `tracks`를 넘기지 않아, 그 재생 세션은 기존 "분리 안 된 곡"과 완전히 같은 MIDI-only 경로를 탄다). 0이면 `createTrackPlayer(kinds.map(k => ({kind:k, url:`/api/songs/${songId}/audio/${k}`})))` 생성.
- `handlePlay()`: 제스처 체인을 보존하기 위해 `trackPlayer.prime()`의 각 엘리먼트별 `play()+pause()` 호출 자체는 핸들러 진입 직후 **동기적으로**(다른 `await` 앞에) 시작시키되, **그 결과(Promise)는 기다린다**(모드C 1라운드 MINOR 반영 — "기다릴지 여부를 정하지 않음" 지적 해소). 기다리는 이유: 어떤 트랙이 언락에 실패했는지 알아야 `playFrom` 호출 시 그 트랙을 건너뛸 수 있고, 실패를 모른 채 재생을 시작하면 이후 `play()`가 조용히 거부돼 그 트랙만 영원히 무음인 상태를 디버깅하기 어려워짐. 정확한 호출 순서(언제까지가 "같은 제스처"로 인정되는지)는 구현 단계에서 실기기로 검증(이 설계 문서에서 "안전하다"고 단정하지 않음, QA 계획 §5).

## 위험 분류 — Codex 모드C 대상(`intent/06-pipeline.md` §1-1)
- **오디오 타이밍·동기**: §4·5가 정면으로 이 범주. 특히 "리싱크 threshold를 어떻게 정하느냐"가 정답이 없는 트레이드오프 설계 질문.
- **공개 API 변경**: §1의 신규 엔드포인트.
DB 스키마 변경 없음(기존 Asset 테이블 읽기만), 외부 모델·라이선스 변경 없음, 인증 방식 변경 없음(기존 `get_owned_song` 재사용).

## QA 계획(이 설계로 구현된 뒤)
1. 자동 테스트: `trackPlayer.ts`의 동기화 수식(순수 계산 부분, §4 공식)은 단위 테스트 가능. `HTMLAudioElement` 실제 재생·`preservesPitch` 동작은 jsdom이 Web Audio API를 구현 안 해(기존 Tone.js 관련 모듈들과 같은 제약, `clock.ts` 주석 재확인) 단위 테스트 불가 — 실기기 수동 QA로 검증.
2. 백엔드: 엔드포인트 단위 테스트(소유권 404, 파일 없음 404, 타 사용자 곡 404, **`Range` 헤더를 실제로 보내 206+`Content-Range` 응답을 `TestClient`로 직접 검증** — "Starlette 소스를 읽어봤다"가 아니라 실제 요청-응답으로 확정, 모드C 1라운드 MINOR 반영).
3. **실제 end-to-end(이번 작업의 핵심 증거)**: 이미 분리·채보된 실제 곡(backnumber 또는 희비교차)으로 60%/100%/130% 각각 실제 재생 → 영상 녹화 후 T2-11에서 썼던 교차상관 분석(프레임+오디오 추출)으로 오디오 트랙-메트로놈/레인 어긋남을 실측 — **이것이 Q-05를 사실상 처음으로 "분리된 실제 오디오 트랙"으로 검증하는 기회**(T0-5는 합성 클릭트랙·Phase 0 시점이라 이 조건이 없었음). 결과가 ±30ms를 못 만족해도 숨기지 않고 보고(Q-05/Q-24에 갱신) — §5에서 명시했듯 이 측정 전엔 "±30ms 충족"을 주장하지 않는다.
4. A-B 루프 경계에서 (a) 오디오 트랙도 끊김·중복 없이 반복되는지, (b) **오디오 재시작과 MIDI/메트로놈 재예약 사이에 체감 가능한 상대적 어긋남이 생기는지**(모드C 1라운드 MAJOR 반영 — 콜백 순서를 보장하지 않으므로 실측으로 확인) 둘 다 확인(REQ-04 수용 기준).
5. 모바일 제스처 언락 가정(§3) 검증 — 가능하면 실제 아이폰/아이패드(T0-5 때 썼던 Tailscale 배포 경로 재사용 가능)로 N개 스템을 한 클릭으로 언락했을 때 전부 정상 재생되는지, 일부만 실패했을 때 나머지가 정상 재생되는지 확인.

## 가정·한계(숨기지 않음)
- `audioOffsetMs≠0`는 처리하지 않고 오디오 트랙을 끄는 가드로만 대응(§범위경계) — 실제 보정은 T3-5.
- 리싱크 threshold·폴링 간격은 추정치 제안일 뿐 — Mode C 검수와 실기기 QA 결과에 따라 조정될 수 있음. 이 값으로 ±30ms 충족을 보장하지 않음(§5).
- 루프 경계에서 오디오 재시작 콜백과 MIDI/메트로놈 재예약 콜백의 상대적 실행 순서는 보장되지 않음 — 체감 영향은 실측으로만 확인(§4, QA계획 4번).
- 모바일 "N개 언락" 가정은 T0-5의 "1개 언락" 실측 선례의 추정 확장일 뿐, 직접 재현된 적 없음 — 실패 시 해당 트랙만 건너뛰도록 설계했지만 "전부 성공"은 가정이 아니라 QA로 확인할 대상(§3, §6).
- T3-4(믹서) 전까지 전 트랙 게인 1.0 고정은 임시 기본값 — 영구 설계가 아님.
- 서빙 중(응답 헤더 전송 후) 파일이 교체·삭제되는 경쟁 상태는 별도 방어를 추가하지 않음 — `FileResponse`가 그 경우 500을 내는 Starlette 기본 동작을 그대로 받아들임(기존 `drumscore` 등 다른 파일 서빙 엔드포인트에도 이런 방어가 없는 것과 같은 수준, 이번 작업에서 새로 생기는 위험이 아님, 모드C 1라운드 MINOR 반영).
