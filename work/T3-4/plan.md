> 한 줄 요약: T3-4(REQ-05) 설계안 — 6개 채널(분리 스템 4종·신스 드럼·메트로놈) 각각 볼륨/음소거/솔로 + "드럼 빼고 듣기"(스템 드럼만 음소거) 프리셋, 곡별 저장(기존 `practice_settings.volumes_json` 재사용, 마이그레이션 불필요). 새 공개 API라 위험 작업 — 구현 전 Codex 모드C 검수 대상.

# T3-4 믹서(볼륨/M/S/프리셋) — 설계

## 근거 REQ
REQ-05: "트랙: 분리된 각 오디오 트랙, MIDI 드럼 소리(신스/샘플), 메트로놈 — 각 트랙 음량 슬라이더 + 음소거 + 솔로 — 프리셋 1개: 드럼 빼고 듣기(마이너스원) — 수용 기준: 조작 즉시(체감 지연 없이) 반영, 곡별 마지막 설정 기억."

## 범위 경계
- **포함**: 6채널(`stem_drums`/`stem_bass`/`stem_vocals`/`stem_other`/`synth_drums`/`metronome`) 볼륨(0~100%)+음소거+솔로, 프리셋 1개, `GET`/`PUT /songs/{id}/practice-setting`로 곡별 저장·복원.
- **"드럼 빼고 듣기" 프리셋 의미(의뢰인 확인, 2026-10-25)**: `stem_drums`(실제 원곡 녹음)만 음소거. `synth_drums`(우리 앱의 신스 클릭음)·메트로놈·다른 스템은 안 건드림 — 전통적 "마이너스원"(연주자 자신의 파트만 빼고 나머지 반주는 그대로)과 같은 개념.
- **메트로놈을 실제 연습 화면에 처음으로 연결**(범위 안, 불가피): `metronome.ts`는 T2-2에서 이미 완성됐지만 `PracticeCanvas.tsx`가 지금까지 한 번도 `createMetronome()`을 호출한 적이 없음(코드 전수 검색으로 확인, 0건) — T2-4가 "메트로놈 켜기/끄기 UI는 믹서(T3-4)로 분리"라고 명시적으로 미뤄둔 것. 이번에 처음 재생 흐름에 연결한다.
- **제외**: `practice_bpm`/`loop_start_measure`/`loop_end_measure` 저장(같은 DB 행에 있지만 REQ-04 범위, REQ-05가 요구하는 건 아님) — 이번엔 안 건드림(과한 설계 방지). 트랙별 EQ·팬 등 REQ-05에 없는 기능 추가 안 함.

## 설계

### 1. 백엔드 — `GET`/`PUT /songs/{id}/practice-setting`(공개 API 변경 — 위험 작업)
- 기존 `PracticeSetting` 테이블(T1-2가 이미 만들어둠, `song_id` 유니크) 재사용 — **마이그레이션 불필요**.
- `volumes_json`에 저장할 형식(새로 정의): 채널 키 6개 → `{"volume": number(0~1), "muted": boolean, "solo": boolean}`. 예:
  ```json
  {"stem_drums": {"volume": 1.0, "muted": false, "solo": false}, "stem_bass": {...}, ...}
  ```
- `GET`: 행이 없거나 `volumes_json`이 비어있으면 기본값(전 채널 volume=1.0, muted=false, solo=false)을 **서버가 아니라 프런트가** 채운다(서버는 "저장된 게 없다"를 있는 그대로 돌려줌 — `null`/빈 객체 — 기본값 결정은 UI 레이어 책임, 서버가 추측 안 함).
- `PUT`: find-or-create 패턴으로 `PracticeSetting` 행을 가져오거나 새로 만들고 `volumes_json`만 갱신(`practice_bpm`/루프 컬럼은 이번 범위 밖이라 안 건드림 — 기존 값 있으면 그대로 둠). 소유권은 기존 `get_owned_song` 재사용.
  **동시 최초 생성 경쟁(모드C 1라운드 C-005 반영)**: `song_id`가 유니크 제약이라, 아직 행이 없는 곡에 동시에 두 PUT이 오면 하나는 INSERT가 `IntegrityError`로 거부될 수 있음 — 이미 이 저장소에 있는 선례(`app/server/api/songs.py`의 `save_song_drumscore`, 모드C 지적으로 도입된 "낙관적 upsert": INSERT 시도 → `IntegrityError`면 `rollback()` → 재조회 → UPDATE로 재시도)를 그대로 재사용. 새 패턴을 만들지 않음.
- 입력 검증: 채널 키가 정확히 저 6개인지, `volume`이 `[0,1]` 범위인지 Pydantic으로 검증(알 수 없는 채널 키나 범위 밖 값은 422) — 저장 전에 걸러서 프런트의 버그가 DB에 쓰레기 값으로 남지 않게.
- **동시 저장 충돌(모드C 1라운드 C-002 일부 반영)**: 버전·병합 로직 없음 — **명시적으로 last-write-wins**. 이 기능은 한 사용자가 자기 곡을 혼자 연습하며 쓰는 개인 설정이라(여러 기기·탭에서 동시에 같은 곡을 믹싱할 시나리오가 REQ-05에 없음) 충돌 해결을 위한 버전 관리는 과한 설계로 판단 — 마스터가 직접 받아들이는 트레이드오프로 문서에 남김(Q-17과 같은 급의 판단).

### 2. 프런트 — `app/web/src/audio/mixer.ts` 신설(순수 함수, Tone 의존 없음 — jsdom 테스트 가능)
```ts
export type ChannelKey = 'stem_drums' | 'stem_bass' | 'stem_vocals' | 'stem_other' | 'synth_drums' | 'metronome'
export interface ChannelState { volume: number; muted: boolean; solo: boolean }
export type MixerState = Record<ChannelKey, ChannelState>

export function defaultMixerState(): MixerState  // 전부 volume=1, muted=false, solo=false
export function effectiveGain(channel: ChannelState, allChannels: MixerState): number
/** "드럼 빼고 듣기" — stem_drums.muted를 토글(다른 채널은 안 건드림, §범위경계). */
export function toggleDrumlessPreset(state: MixerState): MixerState
```

**솔로/음소거 규칙(모드C 1라운드 C-001 반영 — 명문화, 표준 DAW 관례를 채택)**:
- `solo=true`인 채널이 **하나도 없으면**: 각 채널은 `muted`면 0, 아니면 `volume`.
- `solo=true`인 채널이 **1개 이상 있으면**: `solo=true`인 채널만 들림(그 채널 자신의 `volume` 그대로 — **그 채널의 `muted`는 무시됨**, "솔로가 음소거를 이김"이 표준 DAW 관례). `solo=false`인 채널은 **자신의 `muted` 값과 무관하게** 전부 0.
- **동시에 여러 채널을 솔로할 수 있다** — 각자 자기 `volume`으로 들리고, 서로 영향 없음(평균·boost 없음).
- `muted`와 `solo`는 한 채널에 동시에 켤 수 있는 독립된 토글(UI에서 막지 않음) — 그 채널이 솔로 중이면 뮤트는 위 규칙대로 무시되지만, 체크박스 자체는 그대로 둠(상태를 잃지 않음 — 나중에 그 채널의 솔로를 끄면 뮤트가 다시 적용됨).
- "마지막 솔로를 껐을 때" 같은 별도 전환 처리는 필요 없음 — `effectiveGain`은 항상 현재 `allChannels` 스냅샷에서 다시 계산하는 순수 함수라, 솔로가 하나도 안 남으면 자동으로 "솔로 없음" 규칙으로 돌아감.

### 3. 기존 오디오 모듈에 "공용 게인 지점" 추가(최소 침습)
- **`drumVoices.ts`**: `createDrumVoices(destination?: Tone.ToneAudioNode)`로 선택적 매개변수 추가. 안 넘기면 기존처럼 `.toDestination()`(하위 호환, 기존 호출부 깨지지 않음 — 실제 설치된 Tone.js(15.1.22) 소스로 `toDestination()`이 정확히 `this.connect(this.context.destination)`임을 확인함, `Tone.getDestination()`이 같은 노드 — 모드C 1라운드에서도 같은 버전·소스로 재확인됨). 믹서를 쓰는 호출부는 `Tone.Gain`을 하나 만들어 destination에 연결해두고 그걸 넘김 — 매 타격마다 새로 만들어지는 `Tone.Player`들이 전부 그 공용 Gain을 거치게 돼, `gain.gain.value`(또는 `Tone.Volume`이면 `.volume.value` dB) 하나로 "신스 드럼 전체" 볼륨을 조절할 수 있게 됨. `DrumVoiceMap`(피스별 트리거 맵) 타입 자체는 안 바꿈 — 기존 `scorePlayer.ts`의 `voices[note.piece].trigger(...)` 호출부 무수정.
  **공용 Gain의 소유·정리(모드C 1라운드 C-003 반영)**: 이 Gain은 `handlePlay()`가 `voices`/`tracks`/metronome과 같은 "재생 1회당 1개" 수명으로 만들고(§4), `playbackRef.current`에 같이 보관한다. `stopPlayback()`에서 **`disposeDrumVoices(voices)`를 먼저 호출(기존 동작 그대로 — `activePlayers`를 순회하며 지금 울리고 있는 Player들을 전부 즉시 `dispose()`함, 이건 T3-4가 바꾸는 동작이 아니라 drumVoices.ts의 기존 로직)한 다음에 공용 Gain을 `dispose()`**한다 — 모든 Player가 먼저 끊어진 뒤에 그 다운스트림 Gain을 지우므로, "아직 연결된 Player가 있는데 Gain부터 지워 끊기는" 경우가 없다. 확인된 사실(모드C 1라운드): `Player.dispose()`가 공용 Gain 자체를 지우지는 않음(각자 자기 노드만 정리) — 그래서 Gain은 반드시 별도로 명시적 `dispose()`해야 함(안 하면 재생할 때마다 새로 만드는 Gain이 하나씩 누적돼 leak).
- **`trackPlayer.ts`**: `TrackPlayer`에 `setChannelGain(kind: string, gain: number): void` 추가 — 해당 `kind`의 `<audio>` 엘리먼트 `.volume = clamp(gain, 0, 1)`(네이티브 0~1 선형이라 변환 불필요). 믹서(mixer.ts)가 이미 mute/solo를 반영한 "최종 게인"을 계산해서 넘기므로, trackPlayer.ts 자신은 mute/solo 개념을 전혀 모름(책임 분리 유지).
- **`metronome.ts`**: 이미 있는 `setVolume(db)`/`setEnabled(bool)` 그대로 재사용 — 믹서가 linear→dB 변환(`20*log10(linear)`, `linear<=0`이면 `-Infinity`) 후 호출.

### 4. `PracticeCanvas.tsx` 연동
- 마운트 시 `GET /songs/{id}/practice-setting` 호출 → `volumes_json`이 있으면 파싱해 초기 믹서 상태로, 없으면 `defaultMixerState()`(모드C 1라운드 C-006 반영: 알 수 없는/누락된 채널 키는 프런트가 방어적으로 기본값으로 채움 — 저장 형식이 나중에 바뀌어도 깨지지 않게).
- 믹서 상태(`mixerState`)는 기존 `playbackBpmRef`와 같은 패턴으로 ref(`mixerStateRef`)도 같이 들고 effect로 동기화(재생 루프·콜백이 리렌더 없이 최신값을 읽기 위함).
- 믹서 상태가 바뀔 때마다(재생 중이든 아니든 — REQ-05 "조작 즉시 반영"은 BPM/루프와 달리 **재생 중에도 잠그지 않음**, 볼륨은 Transport 스케줄에 영향 없는 순수 게인 조절이라 T3-2-feedback-1의 "보이는 마디 수"와 같은 판단):
  1. **`playbackRef.current`가 있을 때만**(=지금 실제로 재생 중일 때만) 그 세션의 `tracks`/`drumVoices 공용 게인`/`metronome`에 즉시 `effectiveGain(...)` 적용 — 이 조건 검사 자체가 모드C 1라운드 C-004가 지적한 경쟁을 없앤다: `handlePlay()` 도중(비동기 셋업 중, 아직 `playbackRef.current`가 안 채워진 짧은 틈)에 믹서를 바꿔도 "지금 당장 밀어넣을 대상이 없음"으로 조용히 무시될 뿐이고(위험하지 않음), `handlePlay()`가 세션을 만들 때는 **그 시점의 `mixerStateRef.current`를 그대로 읽어 처음부터 맞게 구성**하므로 그 사이의 변경이 유실되지 않는다. `stopPlayback()`은 동기적으로 `playbackRef.current = null`부터 하므로, 그 이후의 게인 적용 시도는 항상 "재생 중 아님"으로 올바르게 건너뛴다.
  2. `PUT /songs/{id}/practice-setting`을 **400ms 디바운스**해서 호출(슬라이더 드래그 중 매 픽셀마다 요청 안 보내게 — 과한 요청 방지, UI 자체는 즉시 반영되니 저장이 늦어도 체감 지연 없음).
     **디바운스 유실 방지(모드C 1라운드 C-002 반영)**: 디바운스 타이머가 `songId`를 클로저로 캡처하므로(곡이 바뀌면 `PracticeCanvas`가 다른 `song`/`songId` props로 다시 마운트됨 — `App.tsx`가 화면 전환 시 컴포넌트를 새로 그림) 늦게 발사돼도 엉뚱한 곡에 저장되지 않는다. 추가로 **컴포넌트 언마운트 시(곡 전환·화면 이탈) 대기 중인 디바운스 타이머를 즉시 flush**(남은 타이머를 취소하고 그 자리에서 바로 PUT 호출)하는 `useEffect` 클린업을 둬서, "바꾸자마자 바로 나가면 저장 안 됨" 유실을 막는다. 여러 탭·기기의 동시 쓰기는 §1에서 명시한 대로 last-write-wins(과한 설계 아님).
     **같은 탭 안의 요청 순서 역전(모드C 2라운드 지적, 타당함)**: 디바운스가 두 번 연달아 발사되면(예: 저장이 아직 진행 중인데 사용자가 또 값을 바꿔 다음 디바운스가 돌고, 언마운트 flush까지 겹치면) PUT 요청 두 개가 동시에 네트워크에 떠 있을 수 있고, **네트워크 지연 차이로 먼저 보낸(오래된 값) 요청이 나중에 도착**하면 최신 값을 덮어쓸 수 있음 — 서버에 버전 필드를 추가하면 DB 스키마 변경(위험 분류 상승)이 되므로, **클라이언트에서 요청을 직렬화**해 이 경쟁 자체가 날 수 없게 한다:
     - `savingRef`(지금 PUT이 네트워크에 떠 있는지)와 `pendingSaveRef`(그 사이 값이 더 바뀌어 한 번 더 보내야 하는지) 두 플래그만으로 구현.
     - 저장 시도 시 이미 `savingRef`가 true면 `pendingSaveRef = true`만 세우고 새 요청을 **보내지 않는다**(동시에 두 요청이 뜨는 상황 자체를 차단).
     - 진행 중이던 요청이 끝나면(성공/실패 무관) `pendingSaveRef`가 true일 때만 **그 시점의 최신 `mixerStateRef.current`**로 바로 다음 요청을 보낸다(큐에 쌓아둔 과거 값이 아니라 항상 "지금" 값을 보냄 — 중간값은 자연히 건너뜀, 필요한 건 "마지막 상태가 결국 저장되는 것"뿐이므로 손실 아님).
     - 이 직렬화는 언마운트 flush에도 그대로 적용(§언마운트 flush는 "지금 바로 `doSave()` 호출"로 구현되고, `doSave()` 자체가 이 직렬화 로직을 갖고 있음 — 별도 경로 아님).
     - 결과: 한 곡(song_id)에 대해 이 탭에서 PUT이 **항상 1개씩만** 떠 있고, 다음 PUT은 이전 것이 끝난 뒤에만 나가므로 네트워크 지연에 의한 순서 역전이 구조적으로 불가능해짐. 여러 탭·기기 간의 동시 쓰기는 각 탭 안에서는 이렇게 순서가 보장되더라도 탭 사이의 순서까지는 보장 못 함 — 그건 여전히 §1의 last-write-wins 범위(의도적으로 받아들이는 한계, 새로 생긴 문제 아님).
- 메트로놈은 `handlePlay()`에서 `createMetronome(...)`을 새로 만들어(기존 voices/tracks와 같은 "재생 1회당 1개" 수명) `playbackRef.current`에 같이 들고 있다가 `stopPlayback()`에서 `dispose()`(메트로놈도 §3의 공용 Gain과 같은 순서 원칙 — Transport에 등록된 반복 이벤트는 `transport.clear(eventId)`로 먼저 끊긴 뒤 synth가 `dispose()`됨, 이미 `metronome.ts`의 기존 `dispose()` 구현이 그렇게 돼 있음).
- UI: 6행(채널명 + 슬라이더(0~100) + 음소거 체크박스 + 솔로 체크박스) + "드럼 빼고 듣기" 버튼.

## 위험 분류 — Codex 모드C 대상
- **공개 API 변경**: `GET`/`PUT /songs/{id}/practice-setting` 신설.
- DB 스키마 변경 없음(기존 테이블 재사용), 오디오 타이밍·동기 아님(볼륨은 스케줄에 영향 없음 — T3-3의 "오디오 타이밍" 범주와 다름), 인증 방식 변경 없음.

## QA 계획
1. 자동 테스트: `mixer.ts`(순수 함수) — `effectiveGain`을 §솔로/음소거 규칙의 모든 조합으로(솔로 없음+뮤트, 솔로 1개, 솔로 여러 개, 솔로+자기자신 뮤트인 채널) 검증, `toggleDrumlessPreset`이 `stem_drums`만 건드리는지. 백엔드 `GET`/`PUT` 엔드포인트(소유권 404, 채널 키/범위 검증 422, find-or-create로 기존 `practice_bpm` 등 안 건드리는지, **동시 최초 PUT 경쟁을 실제로 재현**하는 회귀 테스트 — T2-6 선례의 테스트 방식 재사용).
2. 실제 브라우저: 슬라이더를 재생 중에 움직여 체감 지연 없이 반영되는지, "드럼 빼고 듣기" 눌렀을 때 스템 드럼만 빠지는지, 페이지 새로고침 후 마지막 설정이 복원되는지, 메트로놈을 처음으로 켜봐서 실제로 클릭음이 남을 확인(이번에 처음 연결되는 경로라 각별히 확인), 값을 바꾸자마자(400ms 안에) 곡 화면을 벗어나도 저장되는지(언마운트 flush) 확인.

## 가정·한계
- `practice_bpm`/루프 설정의 영속화는 이번 범위 밖(REQ-04 쪽 — 필요해지면 별도 작업).
- 디바운스 400ms는 추정치 — "저장 안 됨" 체감이 있으면 조정 가능.
