> 한 줄 요약: T6-11 통합 설계 — 스템 재생을 `<audio>`에서 `Tone.Player`(AudioBufferSourceNode)로 전환해 resync() 자체를 없앤다. 음정 유지 배속은 서버가 ffmpeg `atempo`로 미리 변환(요청 안에서 동기 처리, 최대 실측 5.5초)해 캐싱한 파일을 재생. Opus 5.5 서브에이전트 4개(코드감사/공식문서조사/프론트설계/백엔드설계) 결과를 마스터가 종합. **Codex 모드C 1차 검수 완료(수정 후 진행, C-001~C-006 전부 반영) — Step 1부터 구현 시작 가능.**

# T6-11 통합 설계 — 스템을 Tone.Player로, 배속은 서버 사전변환으로

근거: `intent/07-open-questions.md` Q-33, 서브에이전트 4개(Opus 5.5)의 조사·설계 보고(2026-10-30, 대화 기록에 전문 보존). 실기기 사전검증(의뢰인 아이폰 13 Pro): 스템 2개 `decodeAudioData()` + `AudioBufferSourceNode`로 Tone 공유 컨텍스트에 동시 재생 → **메모리·fps 문제 없음(60 유지)** — 가장 큰 두 리스크(메모리, 공유 컨텍스트) 사전 통과.

## 결정된 아키텍처

1. **스템 재생**: `<audio>`+`createMediaElementSource()` → `Tone.Player`(`AudioBufferSourceNode`). 노트와 **같은 AudioContext 시계**를 쓰므로 `resync()`가 구조적으로 불필요해짐(드리프트 자체가 안 생김).
2. **동기화 방식**: `Tone.Transport`의 `start`/`loopStart`/`stop`/`pause` 이벤트를 구독해, 매번 `player.start(time, offset)`을 샘플 단위로 재계산해 예약. `scorePlayer.ts`의 기존 "트랙 재시작 schedule() 콜백"(time 인자 미사용 버그, 루프 경계 20ms 꼼수, 에디터 핸드오프 버그의 공통 원인)은 **삭제**.
3. **음정 유지 배속**: 재생 중 배속 변경이 이미 UI로 막혀 있음(코드 확인됨) → 서버가 배속 선택 시점에 ffmpeg `atempo`로 1회 변환 + 캐싱, `Tone.Player`는 rate=1(또는 잔차 보정값)로 재생. 실시간 피치 보정 라이브러리(AudioWorklet 기반)는 전부 iOS 미해결 버그 위험이 있어 배제.
4. **플랫폼 분기 제거**: iOS 전용 `getIOSStemAudioContext()`/`useWebAudioForVolume`/`element.volume` 분기를 전부 없애고 전 플랫폼 단일 경로로 통일(맥 Safari의 Q-37도 부수적으로 해소). **(Codex 모드C 1차 C-002 반영) 이 제거는 "완료 조건부"다 — §실기기 검증의 "0.5배속 메모리" 항목이 iPad mini 5를 포함한 최저 사양 기기에서 통과하기 전까지는 Step 5에서 플랫폼 분기 코드를 지우지 않는다.** 실패 시 대응(택1, Step 5 착수 시점에 결정 — **"기존 `<audio>` 경로로 폴백"은 절대 선택지에 넣지 않는다**: 그 경로가 바로 오늘 하루 종일 추적해 확정한 iOS fps 저하·끊김의 원인 그 자체라, 특정 배속 구간만이라도 되돌리면 그 구간에서 오늘 고친 문제가 그대로 재발함): (a) `stem_drums`를 모노로 줄여 메모리 절반(드럼은 좌우 분리가 음악적으로 덜 중요해 음질 영향이 작을 가능성 — 청취 확인 필요), (b) 최저 사양 기기에서만 배속 하한을 좁힘(예: 50%→60%), (c) 그 배속 자체를 그 기기에서 막고 "이 기기에서는 지원되지 않는 배속입니다" 안내. 실패하지 않으면 원래 계획대로 전부 통일.

## API 계약 (프론트·백엔드 조율 완료 — 최종)

두 설계 에이전트가 병행 작업하며 서로 다른 API 모양을 가정했음 — **백엔드 설계(동기 처리)를 채택**(실측 근거: 최악 5.5초, 큐에 넣는 것보다 단순하고 빠름).

```
GET /songs/{song_id}/audio/{kind}/tempo/{permille}
```
- `kind`: `AUDIO_ASSET_KINDS`에서 `original` 제외.
- `permille`: `Math.round(exactRate * 1000)`, 범위 490~1510. **1000이면 변환 없이 원본 스템 그대로 반환**(atempo=1.0도 자체적으로 ~8ms 오프셋을 만든다는 게 실측으로 확인됐기 때문).
- 응답: 200 `audio/mpeg` + `X-Tempo-Permille` 헤더(또는 404/422/500). **비동기 202/폴링 없음** — 캐시 미스 시 요청 안에서 바로 변환(동기 `def` 라우트라 FastAPI가 스레드풀에서 실행, 이벤트 루프 안 막음).
- 프론트는 **잔차 playbackRate로 양자화 오차를 보정**: 서버가 실제 적용한 비율은 `permille/1000`이고 사용자가 원하는 정확한 비율은 `exactRate`이므로, `Tone.Player.playbackRate = exactRate / (permille/1000)`로 설정(최대 오차 0.05%, 음정 영향 0.87cent — 가청 임계 이하). **이건 프론트 설계의 `stemNodePlaybackRate(timing, bufferTempoRatio)` 함수가 `bufferTempoRatio = permille/1000`을 받으면 수정 없이 그대로 계산해줌** — 두 설계가 우연히 정확히 들어맞음. **(Codex 모드C 1차 C-003 반영) 단, 이 보정이 맞으려면 "변환본의 실제 재생 속도 = 요청한 `permille/1000`"이라는 전제가 성립해야 함 — ffmpeg 출력 길이·샘플레이트·시작 패딩이 요청값과 미세하게 다를 수 있음(실제로 atempo=1.0도 자체 오프셋이 있었던 것처럼). 계약을 다음과 같이 고정한다: `permille`(요청값, 정수)을 "적용 비율의 정의"로 삼는다 — 백엔드는 `atempo=permille/1000`을 정확히 그 값으로 ffmpeg에 넘기고(실측 길이가 아니라 요청값 자체가 계약), 프론트의 잔차 보정도 이 정의(요청값) 기준으로 계산한다. 실제 ffmpeg 출력이 이론값과 어긋나는 부분(시작 오프셋 등)은 잔차 playbackRate로 보정할 대상이 아니라 별도 이슈(위 "실측으로 발견한 주의점" 참고)로 다룬다 — 두 종류의 오차를 하나의 보정식에 섞지 않는다.**

```ts
// 프론트: api/songs.ts
export function stemTempoAudioUrl(songId: number, kind: string, permille: number): string {
  return permille === 1000
    ? `/api/songs/${songId}/audio/${kind}`
    : `/api/songs/${songId}/audio/${kind}/tempo/${permille}`
}
```

## 프론트엔드 설계 요약 (전체 상세는 대화 기록의 서브에이전트 보고 참고, 아래는 핵심)

- **새 파일**: `audio/stemSchedule.ts`(순수 함수, Tone 미의존 — jsdom 테스트 가능: `planStemStart()`가 Transport 이벤트 1개를 "이 AudioContext 시각에 이 버퍼 오프셋으로 시작"으로 변환), `audio/stemPlayer.ts`(`loadStemBufferPool()` + `createStemPlayer()` — `attach(timing)`/`detach()`/`setChannelGain()` 3개만 공개).
- **`trackPlayer.ts`는 당장 안 지움** — 전환 검증 끝날 때까지 공존, Step 5에서 한 번에 삭제(런타임 플래그로 신/구 공존시키지 않음 — 분기점이 7곳 이상 생겨 그 자체가 버그원이 되므로, 브랜치 단위로 비교).
- **`resync()`/`TRACK_RESYNC_*`/T6-9 `skipResync` 토글 전부 삭제** — 드리프트가 구조적으로 없어지므로.
- **`prime()`도 삭제** — 같은 Tone 컨텍스트라 `createDrumVoices()`의 `Tone.start()`(이미 제스처 안에서 동기 호출됨)로 언락 충분.
- Tone.js 15.1.22 소스를 직접 읽어 확인한 중요 사실들(설계의 전제): `Player.start()`는 매번 새 `AudioBufferSourceNode`를 만듦(1회용), `Source.start()`는 같은 시각 재시작 시 예외를 던지므로 항상 `stop(t)` 후 `start(t)` 순서 필요, `Player.sync()`는 playbackRate≠1일 때 오프셋 계산 버그 의심(소스 레벨, 그래서 `sync()` 대신 Transport 이벤트 직접 구독 채택), Transport의 재생 중 위치 변경은 `stop`+`start`를 동기적으로 연속 발생시키되 드물게 순서가 뒤집힐 수 있어(T9) 단조 가드 필요.

### Transport 이벤트 핸들러의 상태 전이 규칙(Codex 모드C 1차 C-001 반영)

Codex 지적: "Transport 이벤트마다 재생기를 다시 시작"이라는 설명만으로는 안전을 보장 못 함 — 기존 소스에 `stop(time)`을 예약하고 새 소스를 **같은 시각에** 시작하는 순서, 이벤트 시각이 이미 지난 경우 처리, 그리고 "같은 틱의 `start()`와 `seconds` 변경이 역순 전달될 수 있다"는 가정이 **Tone.js 소스만으로는 확정되지 않았다**는 점을 명시해야 함. 아래 표로 핸들러 동작을 명시하고, 타임스탬프 단조성만으로 이벤트를 거르지 않는다(이벤트 종류 + Transport 상태를 함께 본다):

| Transport 이벤트 | 재생기 쪽 핸들러 동작 |
|---|---|
| `start`(최초, 또는 seek로 인한 재시작) | 현재 재생 중인 소스가 있으면 **같은 `time`에** `stop(time)` 예약 → 새 소스를 **같은 `time`**(또는 아래 "이미 지난 시각" 규칙 적용 후)에 `start(time, offset)` 예약. 재생 중인 소스가 없으면 바로 `start`만. |
| `loopStart`(루프 재진입) | 위 `start`와 동일 취급(새 구간 오프셋으로). |
| `stop`/`pause` | 재생 중인 소스가 있으면 `stop(time)`만 예약(새 `start` 없음). 재생 중인 소스가 없으면 무시(멱등). |
| 이벤트의 `time`이 이미 `Tone.immediate()`(현재 AudioContext 시각)보다 과거 | `time`을 `Tone.immediate()`로 올려서 처리(기존 설계의 "늦게 도착한 이벤트" 보정, §T3)와 동일 규칙 — 과거 시각으로 네이티브 노드를 예약하면 스펙 위반이므로 반드시 clamp. |
| 짧은 시간 안에 `start`가 연속 도착(예: 사용자가 탐색 바를 빠르게 드래그) | 각 이벤트를 **이벤트 종류(start/stop) + 그 시점의 재생기 내부 상태(재생 중/정지)** 조합으로 판단 — "방금 처리한 시각보다 이 이벤트의 시각이 더 이전"이라는 이유만으로 건너뛰지 않는다(그러면 정당한 상태 전이를 놓칠 수 있음, Codex 지적). 대신 "가장 최근에 도착한 이벤트가 최종 상태"로 덮어쓰고, 재생기는 항상 "지금 가지고 있는 소스를 stop → 새 소스를 start" 순서를 그대로 따른다(멱등 재적용 — 중간 이벤트를 놓쳐도 최종 이벤트가 올바른 상태로 수렴). |

**중요**: 위 "같은 틱에서 Transport의 `start()`/`seconds` 변경이 실제로 역순으로 전달되는지"는 **Tone.js 소스 읽기만으로 확정 못 함** — 실제 보장이라고 간주하지 않고, Step 1(단위 테스트, 가짜 Transport로 이 순서를 직접 재현해 핸들러가 안전한지 검증)과 Step 2 실기기 검증(§7 테스트 계획의 브라우저 실측 항목)에서 **실측으로 확정**한다. 그 전까지 이 표는 "설계상 의도"이지 "동작 보장"이 아니다.

**실측으로 확정됨(2026-10-30, Step 2 구현 이후 — 아래 참고)**: `transport.seconds = X` 대입은 **Transport가 `state === "started"`(재생 중)일 때 Tone.js 자신이 네이티브 `'stop'`을 발화한 뒤 `'start'`를 재발화**한다(설치된 Tone.js 15.1.22 소스, `node_modules/tone/build/esm/core/clock/Transport.js`의 `set ticks` — `this.emit("stop", time); this._clock.setTicksAtTime(t, time); this.emit("start", time, ...)`, GitHub 이슈 #573 참고 주석 포함된 Tone.js 공식 의도 동작). 재생 중이 아닐 때는 다른 분기(`emit("ticks", now)`)를 타 아무 것도 재시작하지 않는다. 이 사실이 처음 설계(아래 "핸드오프"/"수동 seek" 행, Codex C-005)에서 가정했던 것과 달라, Step 2에서 실제 버그(노트-스템 어긋남)로 이어졌다가 발견·수정됨 — 자세한 경위는 아래 Step 2 행과 `app/web/src/audio/stemPlayer.ts`의 `StemPlayer` 코멘트 참고. **결론: `restartFromCurrentPosition()` 같은 별도 수동 훅 자체가 불필요** — `attach()`가 구독하는 `'start'`/`'loopStart'`/`'stop'`/`'pause'` 네 이벤트만으로 핸드오프·빨리감기/되감기·A-B 루프 재진입까지 전부 자동으로 올바르게 처리됨.

- **이번 감사로 새로 찾은 숨은 의존**: 지금까지 "재생 중 A-B 루프 구간을 바꿔도 트랙이 새 구간으로 재시작되는" 동작은 사실 resync()의 seek가 몰래 처리해주고 있었음 — resync를 없애면 이 경로가 명시적으로 처리돼야 함. **(Codex 모드C 1차 C-005 반영)** `Tone.Transport`의 `loopStart`/`loopEnd` **세터(setter)는 그 자체로 `'loopStart'` 이벤트를 emit하지 않는다** — 그 이벤트는 실제로 재생 중 루프 경계를 "통과하는 순간"에만 발생(Transport.js의 `_processTick()` 내부에서 직접 발화, T7). 그래서 "재생 중 사용자가 A-B 구간 값을 바꾸는" 것과 "Transport가 루프 경계를 통과하는" 것은 **서로 다른 이벤트**다. 설계를 다음과 같이 명확히 한다:
  - **루프 경계를 실제로 통과할 때**(기존 루프가 이미 켜진 채 재생 중): `loopStart` 이벤트로 처리(위 표).
  - **재생 중 사용자가 A-B 구간 "값 자체"를 바꾸는 순간**(예: 루프 끝 지점을 드래그로 조정): `clock.setLoopPoints()`/`setLoopEnabled()`만 부르고 현재 위치는 안 건드리므로, 다음 루프 경계를 Transport가 스스로 평가해 `loopStart`를 발화할 때 자연히 올바르게 처리된다(위 표 참고) — **별도 훅 불필요로 확정(2026-10-30)**. 다만 "핸드오프"나 "빨리감기/되감기"처럼 **현재 위치 자체를 `transport.seconds = X`로 대입**하는 경우는, 재생 중이면 그 대입 자체가 Tone.js 내부적으로 네이티브 `'stop'`→`'start'`를 재발화하므로(위 "중요" 문단 §1의 실측 확정 내용 참고) 이 역시 별도 처리가 필요 없다 — 오히려 별도로 수동 재시작을 불렀더니 그 네이티브 재발화가 아직 안 끝난 시점의 낡은 위치를 읽어버리는 실제 버그(노트-스템 어긋남)가 됐다. `restartFromCurrentPosition()`이라는 수동 훅을 만들었다가 이 버그로 삭제한 전체 경위는 `stemPlayer.ts`의 `StemPlayer` 코멘트에 기록.
- **메모리 해제**: 진단용 전역(`window.__t6_5_tracks`, `window.__t6_11_tone_context`) 반드시 같이 삭제 — 안 그러면 곡이 바뀌어도 버퍼(수백 MB)가 영구히 GC 안 됨.
- **새로 발견된 리스크**: iOS 무음 스위치(순수 Web Audio는 무음 스위치를 따를 수 있음 — `navigator.audioSession.type='playback'` 검토 필요, 실기기 A/B 확인 필요), 0.5배속 변환본은 재생 길이가 2배가 돼 메모리도 약 2배(~420MB/스템 2개) — 오늘 사전검증은 1.0배속 기준이라 **최저 배속은 미검증**.
- 에디터 화면(`EditorScreen.tsx`)도 같은 구조 공유 — `trackPlayer.ts`를 완전히 지우려면 에디터도 같이 전환해야 함(plan 초안에서 "범위 밖"으로 뒀던 것을 수정).

## 백엔드 설계 요약

- **변환**: 번들 ffmpeg(이미 씀, 새 의존성 없음)의 `atempo` 필터, 단일 호출(50~150% 범위는 atempo 유효범위 0.5~100 안이라 체이닝 불필요 — 실측 확인). 드럼은 WAV(무손실 Asset)를 입력으로 써서 압축 세대 손실 최소화.
- **캐시 키**: `permille`(0.1% 단위) — 정수 BPM 환경에서 서로 다른 BPM이 같은 캐시를 나눠 쓸 일이 사실상 없을 만큼 촘촘함.
- **저장**: 곡 폴더 안 평면 파일 `tempo_<kind>_<permille>.mp3`(하위 디렉터리는 기존 `delete_song_files()`가 못 지움 — 실행으로 확인된 실제 제약). Asset 행은 안 만듦(파생 데이터, DB 마이그레이션 불필요).
- **정리**: 전체 용량 상한(제안 2GiB) 넘으면 오래 안 쓴 것부터 삭제, 쓸 때마다 mtime 갱신.
- **동시성**: 키별 락 + 동시 변환 수 제한(세마포어), 최종 쓰기는 임시파일+`replace`(기존 패턴 재사용). **(Codex 모드C 1차 C-006 반영) 동기 `def` 라우트가 스레드풀에서 돌아 이벤트 루프는 안 막지만, 그게 "무제한으로 동시 변환해도 된다"는 뜻은 아님** — 이 앱은 사실상 의뢰인 1인(+지인 소수) 사용 환경이므로 동시 변환 상한을 **세마포어 2**(드럼+음악 1곡 분량이 동시에 도는 정도)로 명시 확정하고, 그 이상 요청이 몰리면 세마포어 획득을 기다리게 둔다(거부 응답 없음 — 사용자 수가 적어 큐잉으로 충분, 타임아웃은 `time_stretch_mp3()`의 기존 120초 서브프로세스 타임아웃으로 커버). Step 3 구현 시 이 숫자가 실제로 충분한지 실측으로 재확인.
- **라이선스**: `atempo`는 ffmpeg 본체 필터(LGPL-2.1+), 이미 쓰는 번들 바이너리 안에 있어 새 의존성·새 라이선스 조건 없음. `intent/03-architecture-stack.md` 95행에 용도 설명만 추가 권장(의뢰인 승인 필요).
- **실측으로 발견한 주의점**: atempo 결과물은 배속별로 일정한(누적 안 되는) 시작 오프셋이 있음(예: 0.5배속 약 −24ms, 1.5배속 약 +1ms, 1.0배속도 약 −8ms). 다른 곡에서도 같은지, 의뢰인이 체감하는지 **확인 필요** — 체감되면 보정(서버 `adelay` 또는 프론트 상수) 검토.
- rubberband(음질은 더 나을 수 있음, 3.8~4.5배 느림, GPL)는 대안으로만 보류.

## 마이그레이션 단계(프론트 설계안 채택)

| Step | 내용 |
|---|---|
| 0 | 이 문서로 API 계약·수용기준 최종 확정(완료) |
| 1 | `stemSchedule.ts`/`stemPlayer.ts` + 단위 테스트만 추가(아직 미연결) — **완료(2026-10-30)**. `app/web/src/audio/stemSchedule.ts`(11개 단위 테스트)/`stemPlayer.ts`(Tone.Player 기반 버퍼 풀+Transport 이벤트 동기화, 20개 단위 테스트) 작성. 전체 테스트 스위트 386개 전부 통과(`npx vitest run`), `tsc -p tsconfig.app.json --noEmit` 통과, `oxlint` 통과. 커밋 b2732a0. "같은 틱 이벤트 순서" 등 소스만으로 확정 못 한 가정은 가짜 Transport로 재현해 핸들러가 안전함을 확인(§5 "중요" 문단 참고) — 다만 이건 가짜 Transport이지 실제 브라우저 Transport가 아니므로, Step 2 실기기 검증까지는 여전히 "검증 완료"가 아니라 "설계상 안전성 확인"으로 취급. `scorePlayer.ts`/`PracticeCanvas.tsx`에는 아직 연결 안 함(Step 2에서). |
| 2 | `scorePlayer.ts`/`PracticeCanvas.tsx` 전환. 백엔드 API 완성 전엔 개발 확인용으로 "원본 버퍼 rate=r 그대로(피치 변함)" 임시 재생으로 싱크 로직만 먼저 검증. **(Codex 모드C 1차 C-004 반영) "merge 금지"를 문서 경고로만 두지 않는다** — Step 2는 **별도 작업 브랜치에서만** 진행하고, Step 3(백엔드 API 연결)과 **원자적으로 묶어 한 번에 main으로 merge**한다(Step 2 단독으로는 PR을 안 만듦 — CLAUDE.md §5 "QA 통과+Codex APPROVE 후에만 main에 병합"과 결합해, 피치가 깨진 중간 상태 자체가 리뷰·머지 대상이 되지 않게 함). **완료(2026-10-30, 브랜치 `task/T6-11-step2-stem-player-wiring`, 커밋 7d0e605, main 미병합)**. `scorePlayer.ts`: `tracks` 옵션 타입을 `TrackPlayer`→`StemPlayer`로 교체, `transport.schedule()` 기반 트랙 시작 콜백 삭제 → `tracks.attach(timing)`을 `transport.start()` 직전에 1회 호출, `handle.stop()`은 `tracks.detach()`, `pause()`/`resume()`은 Transport 네이티브 이벤트에 맡기고 별도 호출 제거. `PracticeCanvas.tsx`: `createAudioTrackPool`/`createTrackPlayer` → `loadStemBufferPool`(`bufferTempoRatio:1`)/`createStemPlayer`, 750ms 폴링 `tracks.resync()` 블록과 그 전용 T6-9 진단 토글("리싱크만 끄기") 완전 삭제, 핸드오프 점프·빨리감기/되감기는 `StemPlayer.restartFromCurrentPosition()`(이번에 신규 추가, Codex C-005 반영 — Transport가 모르는 수동 위치 대입 직후에만 호출, 일시정지 중엔 호출 안 함)으로 교체 — 이 과정에서 "핸드오프 땐 tracks를 아예 안 넘기는" 옛 특례(Tone.js schedule() 재진입 제약 회피용)가 통째로 불필요해져 제거(StemPlayer는 schedule()이 아니라 Transport 네이티브 이벤트를 쓰므로 그 제약이 없음). `stemPlayer.ts`에 `restartFromCurrentPosition()` + 네이티브 `playbackRate` 적용(REQ-04) 추가, 단위 테스트 22개(전체 스위트 388개 통과), `tsc`/`oxlint` 통과. 데스크톱 브라우저로 실제 재생 화면 수동 확인(재생/일시정지/재개/빨리감기·되감기/채널 뮤트 전부 정상, 콘솔 에러 없음, FPS 60 유지). **iOS Safari 실기기 재확인 완료(2026-10-30, 의뢰인 직접 테스트)** — "놀랍다. 드디어 문제가 해결되었어" — 앞으로 이동(빨리감기), BPM 변경, 재생/일시정지 모두 정상 작동, **fps 60 유지 확인**. T6-11의 핵심 목표(Q-33 fps 저하) **달성 확정** — `resync()`의 `<audio>.currentTime` 강제 seek이 iOS fps 저하의 원인이었다는 근본 원인 분석이 실기기로 최종 검증됨. **후속 버그 발견·수정(2026-10-30, 같은 날)**: 의뢰인이 빨리감기/되감기 시 노트-스템 소리가 서로 어긋난다고 보고 — 진단 결과 `restartFromCurrentPosition()`(위에서 "신규 추가"했던 수동 훅) 자체가 원인으로 확정(설치된 Tone.js 15.1.22 소스로 직접 확인: 재생 중 `transport.seconds` 대입은 Tone.js 자신이 네이티브 `'stop'`→`'start'`를 이미 재발화하는데, 그 직후 수동 훅을 한 번 더 부르면 그 재발화가 아직 덜 끝난 시점의 낡은 위치를 읽어 두 번째 잘못된 재시작으로 덮어씀). **`restartFromCurrentPosition()`과 그 모든 호출부를 삭제**해 수정(위 §4 "중요" 문단에 근거 전체 기록) — Step 2 완료 조건이었던 "핸드오프 점프·빨리감기/되감기 처리"는 이제 별도 수동 훅 없이 `attach()`의 기존 4개 이벤트 구독만으로 전부 처리됨(더 단순해짐). 단위 테스트로 이 Tone.js 재발화 패턴을 직접 재현해 회귀 방지, 데스크톱 브라우저로 위치 점프 정확성 재확인 완료 — **iOS 실기기 재확인은 아직 안 됨**. |
| 3 | 백엔드 배속 API 연결, 피치 보존 확인 |
| 4 | `EditorScreen.tsx`도 동일 전환(구 모듈 완전 삭제를 위해 필요) |
| 5 | `trackPlayer.ts`/`getIOSStemAudioContext()`와 각 테스트, T6-9 진단 토글 전부 삭제 → Codex 검수 → 의뢰인 승인 |

## 실기기 검증 항목(최종 전, 전부 통과 필요)

**fps 60 유지(2026-10-30, 의뢰인 iOS 실기기 확인 완료)**, **BPM 변경(확인 완료)**, **재생/일시정지(확인 완료)**, **빨리감기/되감기(iOS 확인 완료 — 단 수정 전 버전이었어서 노트-스템 어긋남 버그 있었음, 위 Step 2 행의 수정 후 재확인 필요)**, **오디오 지연 보정·BPM 직접 입력 및 실제 적용(iOS 확인 완료)**, **믹서 전체 조작(iOS 확인 완료)**, **무음 스위치(iOS 확인 완료)**, **A-B 루프 재생 중 구간 변경(iOS 확인 완료, 문제없음)**, **핸드오프(연습→편집, 편집→연습 위치 이동 자체는 데스크톱에서 확인 완료 — 정상)**, 노트-음원 싱크(5분 끝까지, 미검증 — 의뢰인 보고는 핵심 조작 위주), 로딩 시간, **0.5배속 메모리(iPad mini 5 포함, 미검증)**, **곡 3회 전환 후 메모리 해제 — 원인 확정·수정 완료(2026-10-30, 아래 "메모리 누수" 각주 참고), 데스크톱 재현 테스트로 수정 확인(185→189MB 평탄), iOS 실기기 재확인 필요**, 카운트인 중 일시정지→재개, 블루투스 지연보정(실제 기기로 체감 확인 — 미검증), 맥 Safari Q-37 재현 여부, 합산 클리핑, 배속 변경 시 피치 보존(**현재 bufferTempoRatio=1 임시 경로라 피치 변함 — Step 3 전까지 당연한 미완성**).

**별도 확인됨(Q-45, T6-11 범위 밖)**: 연습 화면에서 편집 화면으로 핸드오프 후 재생하면 소리가 빨리감기처럼 들리는 증상 — 웹에서는 재현 안 되고 iOS에서만 재현, `EditorScreen.tsx`는 오늘 안 건드렸으므로 그 구식 `<audio>` 기반 `resync()`(Step 4가 StemPlayer로 교체할 예정인 바로 그 코드)의 문제로 추정, Step 4 진행 시 같이 해소될 가능성 높음 — 자세한 내용은 `intent/07-open-questions.md` Q-45.

## 메모리 누수(발견·원인 확정·수정 완료, 2026-10-30)

의뢰인이 iPhone에서 Safari 메모리 타임라인으로 직접 측정(화면 녹화 제공) — 같은 곡을 재생 몇 초 후 라이브러리로 나가기를 3~4회 반복하는 동안 메모리가 **계단식으로 누적**(페이지 111MB→635MB, JavaScript 288MB→848MB, 종합 1.16GB, 처음 수준으로 한 번도 안 내려감). Opus 5.5 서브에이전트로 Tone.js 15.1.22 공식 GitHub 소스(`Player.ts`/`ToneBufferSource.ts`/`OneShotSource.ts`/`Context.ts`)를 직접 조사시켜 원인 확정:

- **근본 원인**: `Tone.Player`가 (루프가 아닌) 재생을 시작하면 `_start()`가 항상 "버퍼 길이만큼 뒤"에 네이티브 정지를 예약해둔다(`ToneBufferSource.start()` → `OneShotSource._stopGain()` → `context.setTimeout(cb, stopTime-now)`). 이 타임아웃 콜백은 `Context._timeouts`에 클로저로 저장되는데, 그 클로저가 `AudioBufferSourceNode`→`.buffer`(디코딩된 PCM 전체, 스템 하나당 수십~수백MB)까지 강한 참조로 물고 있다. **`Player.dispose()`/`ToneBufferSource.dispose()`는 이 타임아웃을 지우지도, 네이티브 소스의 `.stop()`을 부르지도 않는다** — 그래서 **재생 중인 Player를 바로 dispose()하면, 그 버퍼가 "원래 자연히 끝났어야 할 시각"(노래 끝, 길면 수 분)까지 메모리에 그대로 남는다.**
- **왜 우리 코드에서 항상 걸리는가**: `stemPlayer.ts`의 `destroyTrack()`이 `player.stop()` 없이 바로 `player.dispose()`를 불렀음 — 곡 화면을 뜰 때(보통 재생 중에 바로 나감, 의뢰인 테스트와 동일) 거의 매번 "재생 중 dispose" 경로를 탔다는 뜻. (추가로 React effect cleanup 순서가 보장되지 않아, 세션의 `tracks.detach()`(stop 포함)보다 풀의 `pool.destroy()`가 먼저 실행돼 stop 자체가 아예 안 걸리는 경우도 있었음 — `destroyTrack()` 레벨에서 고치면 이 순서 문제와 무관하게 항상 안전해짐.)
- **수정**: `destroyTrack()`에서 `dispose()` 전에 `player.stop()`을 먼저 호출(실패해도 무시하고 계속 진행). `stop()`은 `_stopGain()`을 다시 불러 그 긴 타임아웃을 짧은(수백 ms) 것으로 교체해주므로, 뒤이은 `dispose()`에서 버퍼가 바로 GC 대상이 된다.
- **검증**: 단위 테스트 2개 추가(destroy()가 dispose() 전에 stop()을 부르는지, 이미 멈춘 트랙에 또 불러도 안 터지는지). 프로덕션 빌드(`npm run build`, 8000번 포트)로 "재생 몇 초 → 라이브러리로 나가기"를 4회 반복 실측 — JS 힙이 185.3→185.9→185.5→187.5→188.6MB로 **평탄**(수정 전 iOS 실측의 계단식 패턴과 대조적). 다만 이건 데스크톱 Chromium 측정이라, **iOS 실기기 재확인(의뢰인)이 여전히 필요**.
- **서브에이전트가 같이 짚은 추가 리스크**(코드 수정은 안 함, 참고용): (1) iOS WebKit은 `decodeAudioData()`가 만든 PCM을 참조가 전혀 없어도 수십 초~1분 늦게 해제한다는 보고(WebKit Bugzilla #189337) — 우리 수정으로 "안 풀리던 참조"는 없앴지만 iOS 자체의 해제 지연은 여전히 남아있을 수 있음. (2) 새 곡을 디코딩하기 전에 이전 곡을 먼저 해제해야 피크 메모리가 "두 곡 분량"으로 안 치솟음 — 우리 구조(React 언마운트가 먼저 끝난 뒤에야 새 컴포넌트가 마운트됨)는 이미 이 순서를 지키고 있어 추가 조치 불필요로 판단.

## 다음 단계

이 문서로 Codex 모드C 설계 검수 진행 → 반영 → Step 1부터 구현 시작(**Step 1 완료, 2026-10-30**) → Step 2(`scorePlayer.ts`/`PracticeCanvas.tsx` 전환, 별도 브랜치, **완료, 2026-10-30**) → iOS 실기기로 §실기기 검증 항목 중 핵심(fps 60, 기본 조작) 확인(**완료, 2026-10-30 — Q-33 달성 확정**) → 나머지 §실기기 검증 항목(루프 구간 변경, 핸드오프, 0.5배속 메모리, 무음 스위치, 블루투스 등) 확인 → Step 3(백엔드 배속 API) 진행, Step 2 브랜치와 원자적으로 묶어 main 병합.
