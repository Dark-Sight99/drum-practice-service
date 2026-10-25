> 한 줄 요약: T3-3(REQ-04) 설계안 — 분리된 스템(T3-1)을 Transport 기반 MIDI 재생(T2-2/T2-4)과 동기화해 다중 트랙으로 재생하고, `preservesPitch`(Q-04 기존 결정)로 음정 유지 속도 변경을 오디오 트랙에도 적용. "위험 작업"(오디오 타이밍·동기, 공개 API 변경) — 구현 전 Codex 모드C 검수 대상.

# T3-3 다중 트랙 동기 재생 + 음정 유지 속도 변경 — 설계

## 근거 REQ
REQ-04: "오디오 트랙은 **음정 유지** 상태로 속도 변경. MIDI·레인·메트로놈은 같은 BPM으로 동기화." 수용 기준: 60%/100%/130%에서 어긋남이 허용치(초기 목표 ±30ms, Q-05 미해소) 이내, 루프 경계에서 끊김·중복 없음.

## 범위 경계(명시, 과한 설계 방지)
- **포함**: 분리된 오디오 트랙(T3-1의 `stem_drums`/`stem_bass`/`stem_vocals`/`stem_other`) 재생을 기존 MIDI/메트로놈/레인 Transport와 동기화. 연습 BPM(50~150%) 변경 시 오디오 트랙도 음정 유지 상태로 속도 변경.
- **제외(다른 작업 범위)**:
  - 트랙별 볼륨 슬라이더·음소거·솔로·"드럼 빼고 듣기" 프리셋 → **T3-4**(REQ-05). T3-3은 이용 가능한 스템을 전부 **동일 기본 게인(1.0)**으로 튼다(T3-4가 UI를 추가하기 전까지의 임시 기본값).
  - `original`(분리 전 원본) 트랙 재생 선택 UI → T3-4에서 다룸(원본까지 더하면 스템 합과 중복 재생되므로 T3-3은 스템 4종만 다룸, 분리가 아직 안 된 곡은 오디오 트랙 없이 기존 MIDI만 재생 — 저하 없이 그대로 동작).
  - `audioOffsetMs` 비0 값 처리 → **T3-5**(오디오-MIDI 오프셋 정렬 UI). 지금까지 모든 실측 곡에서 이 값은 항상 0으로 확인됐음(Q-23) — T3-3의 동기화 수식은 0을 가정하고, 비0일 때의 보정은 T3-5에서 다룸(주석으로 명시, 조용히 무시하지 않음).

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
   * 똑같은 보장은 아님(추정, 실기기 QA로 확인 필요)**. */
  prime(): Promise<void>
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
- **동기화 수식(유도, 추측 아님)**: 노트는 `schedule.songStartSeconds + ticksToSeconds(tick, ppq, playbackBpm)` 시각에 울리고, `ticksToSeconds`는 `(tick/ppq)*(60/playbackBpm)`(기존 `timing.ts` 확인) — 이는 연습 BPM 기준 "경과 시각"이다. 오디오 트랙(원곡 그대로 녹음된 파일) 쪽에서 같은 틱에 대응하는 "파일 내부 위치"는 원곡 BPM 기준이므로 `(tick/ppq)*(60/originalBpm)` = `ticksToSeconds(tick,ppq,playbackBpm) * (playbackBpm/originalBpm)`이 된다. 즉 **`audio.currentTime = (transport.seconds - schedule.songStartSeconds) * playbackRate`**(`playbackRate = playbackBpm/originalBpm`)가 두 시간축을 잇는 식 — `audio.playbackRate`를 이 값으로 설정해두면 Transport가 흐르는 동안 재생 중인 오디오도 저절로 같은 비율로 맞게 흘러간다(매 프레임 currentTime을 계산해 넣는 게 아니라 시작 위치만 맞추고 playbackRate로 흘려보냄).
- **시작 트리거**: `schedule.loopStartSeconds ?? schedule.songStartSeconds` 시각에 `transport.schedule(cb, that)`로 1회 예약. 루프가 켜져 있으면 Tone 네이티브 루프가 같은 절대 시각의 `schedule()` 콜백을 경계마다 재발화함(이미 `transport.setLoopPoints`/A-B 루프 설계 시 소스로 확인된 동작, work/T2-4/plan.md "Tone.js 루프 동작 근거" 재사용) — 최초 진입과 매 루프 반복을 **같은 콜백 하나**로 처리(루프 감지용 별도 폴링 불필요).
- 콜백 안에서 `tracks.playFrom(0, playbackRate)` 호출(루프 여부와 무관하게 "그 경계 시점의 오디오 위치"는 항상 0, 즉 `loopStartSeconds`가 곧 그 트랙 재생의 기준점 — 루프 구간 자체를 오디오 쪽도 처음부터 다시 재생).

  **주의(한계, 추측 아님):** 이 설계는 **A-B 루프 구간이 통째로 반복**되는 경우만 다룬다. 지금 UI(`PracticeCanvas`)의 루프는 정확히 "구간 처음부터"만 지원하므로 범위 안. 구간 중간 탐색(스크러빙)은 REQ-04 수용 기준에 없어 범위 밖.
- `stop()`에서 `tracks.stop()`도 호출, `transport.clear(scheduledAudioStartId)` 포함.

### 5. 지속적 리싱크 — 임계값은 "확정"이 아니라 Mode C/QA에서 같이 정할 열린 질문
`PracticeCanvas`의 기존 rAF 루프(매 프레임 `clock.getPositionSeconds()`를 이미 읽고 있음)에 저빈도(예: 500ms~1초 간격 스로틀) `tracks.resync(expected, playbackRate, thresholdSeconds)` 호출을 추가한다.
- **왜 ±30ms를 threshold로 쓰면 안 될 가능성이 있는지(T0-5 실측 근거)**: T0-5가 실기기에서 측정한 "어긋남"은 배속에 비례하는 **고정 오프셋**(예: 60%≈-250ms대, 130%≈-590ms대)로 보이고, 이는 "누적되는 드리프트"가 아니라 "재생 시작 자체의 고정 지연"으로 해석됐음(`qa-evidence/T0-5/result.md` 결론2). 고정 지연을 매 polling마다 threshold 기준으로 currentTime을 스냅해 "보정"하면, 그 지연이 사라지지 않고 매번 다시 감지돼 **계속 끊어 재생하는(stutter) 역효과**를 낼 위험이 있다 — 이건 추정이며 실제로 겪어본 적은 없다(T0-5는 실제 Transport+분리 오디오 조합으로 측정한 적이 없음, Q-05 미해소로 남아있는 이유 그대로).
- **제안(마스터 1차 제안, 최종은 Codex 모드C+실기기 QA 이후 조정 가능)**: threshold를 ±30ms보다 느슨하게(예: 80~100ms) 두고 폴링 간격도 느슨하게(500ms~1s) 해서, "루프 경계 같은 큰 점프"는 바로 잡고 "고정 지연 수준의 작은 어긋남"은 상시 보정 대상으로 삼지 않는다. ±30ms 자체를 만족하는지는 실측으로만 확인하고, 못 미치면 "고정 지연"으로 보고 **보정하지 않고 보고**하는 쪽을 기본으로 한다(Q-24에서 의뢰인이 "심하지 않으면 이대로"를 이미 한 번 수용한 선례와 같은 태도).

### 6. `PracticeCanvas.tsx` 연동
- `songId: number` prop 추가(현재 `score`만 받음 — `App.tsx`가 `practiceSong.song.id`를 이미 갖고 있어 전달만 추가).
- `song.available_audio_kinds`(API에서 이미 받아온 `SongSummary`)로 어떤 스템이 있는지 파악, `createTrackPlayer(kinds.map(k => ({kind:k, url:`/api/songs/${songId}/audio/${k}`})))` 생성.
- `handlePlay()`: 기존 `async` 흐름에서 **`await` 이전에** `await trackPlayer.prime()`을 두지 않고(await가 제스처 체인을 끊을 수 있다는 우려, §3 주석 참조) 동기적으로 먼저 호출 후 결과 Promise는 무시하지 않고 기다리되, 제스처 보존을 위한 정확한 호출 순서는 구현 단계에서 실기기로 검증(이 설계 문서에서 "안전하다"고 단정하지 않음).

## 위험 분류 — Codex 모드C 대상(`intent/06-pipeline.md` §1-1)
- **오디오 타이밍·동기**: §4·5가 정면으로 이 범주. 특히 "리싱크 threshold를 어떻게 정하느냐"가 정답이 없는 트레이드오프 설계 질문.
- **공개 API 변경**: §1의 신규 엔드포인트.
DB 스키마 변경 없음(기존 Asset 테이블 읽기만), 외부 모델·라이선스 변경 없음, 인증 방식 변경 없음(기존 `get_owned_song` 재사용).

## QA 계획(이 설계로 구현된 뒤)
1. 자동 테스트: `trackPlayer.ts`의 동기화 수식(순수 계산 부분, §4 공식)은 단위 테스트 가능. `HTMLAudioElement` 실제 재생·`preservesPitch` 동작은 jsdom이 Web Audio API를 구현 안 해(기존 Tone.js 관련 모듈들과 같은 제약, `clock.ts` 주석 재확인) 단위 테스트 불가 — 실기기 수동 QA로 검증.
2. 백엔드: 엔드포인트 단위 테스트(소유권 404, 파일 없음 404, Range 요청 시 206 — 실제 `TestClient`로 `Range` 헤더 보내 검증).
3. **실제 end-to-end(이번 작업의 핵심 증거)**: 이미 분리·채보된 실제 곡(backnumber 또는 희비교차)으로 60%/100%/130% 각각 실제 재생 → 영상 녹화 후 T2-11에서 썼던 교차상관 분석(프레임+오디오 추출)으로 오디오 트랙-메트로놈/레인 어긋남을 실측 — **이것이 Q-05를 사실상 처음으로 "분리된 실제 오디오 트랙"으로 검증하는 기회**(T0-5는 합성 클릭트랙·Phase 0 시점이라 이 조건이 없었음). 결과가 ±30ms를 못 만족해도 숨기지 않고 보고(Q-05/Q-24에 갱신).
4. A-B 루프 경계에서 오디오 트랙도 끊김·중복 없이 반복되는지 확인(REQ-04 수용 기준).
5. 모바일 제스처 언락 가정(§3) 검증 — 가능하면 실제 아이폰/아이패드(T0-5 때 썼던 Tailscale 배포 경로 재사용 가능)로 N개 스템을 한 클릭으로 언락했을 때 전부 정상 재생되는지 확인.

## 가정·한계(숨기지 않음)
- `audioOffsetMs≠0` 미대응(T3-5로 이연, 지금까지 항상 0이었음을 Q-23으로 확인).
- 리싱크 threshold·폴링 간격은 추정치 제안일 뿐 — Mode C 검수와 실기기 QA 결과에 따라 조정될 수 있음.
- 모바일 "N개 언락" 가정은 T0-5의 "1개 언락" 실측 선례의 추정 확장일 뿐, 직접 재현된 적 없음.
- T3-4(믹서) 전까지 전 트랙 게인 1.0 고정은 임시 기본값 — 영구 설계가 아님.
