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
- `PUT`: find-or-create 패턴(T2-6 `_find_edited_asset`과 같은 선례)으로 `PracticeSetting` 행을 가져오거나 새로 만들고 `volumes_json`만 갱신(`practice_bpm`/루프 컬럼은 이번 범위 밖이라 안 건드림 — 기존 값 있으면 그대로 둠). 소유권은 기존 `get_owned_song` 재사용.
- 입력 검증: 채널 키가 정확히 저 6개인지, `volume`이 `[0,1]` 범위인지 Pydantic으로 검증(알 수 없는 채널 키나 범위 밖 값은 422) — 저장 전에 걸러서 프런트의 버그가 DB에 쓰레기 값으로 남지 않게.

### 2. 프런트 — `app/web/src/audio/mixer.ts` 신설(순수 함수, Tone 의존 없음 — jsdom 테스트 가능)
```ts
export type ChannelKey = 'stem_drums' | 'stem_bass' | 'stem_vocals' | 'stem_other' | 'synth_drums' | 'metronome'
export interface ChannelState { volume: number; muted: boolean; solo: boolean }
export type MixerState = Record<ChannelKey, ChannelState>

export function defaultMixerState(): MixerState  // 전부 volume=1, muted=false, solo=false
/** 표준 믹서 로직: 아무 채널도 solo가 아니면 muted 여부만 보고, 하나라도
 * solo면 solo인 채널만 들림(solo 아닌 채널은 muted와 무관하게 무음). */
export function effectiveGain(channel: ChannelState, allChannels: MixerState): number
/** "드럼 빼고 듣기" — stem_drums.muted를 토글(다른 채널은 안 건드림, §범위경계). */
export function toggleDrumlessPreset(state: MixerState): MixerState
```

### 3. 기존 오디오 모듈에 "공용 게인 지점" 추가(최소 침습)
- **`drumVoices.ts`**: `createDrumVoices(destination?: Tone.ToneAudioNode)`로 선택적 매개변수 추가. 안 넘기면 기존처럼 `.toDestination()`(하위 호환, 기존 호출부 깨지지 않음 — 실제 설치된 Tone.js 소스로 `toDestination()`이 정확히 `this.connect(this.context.destination)`임을 확인함, `Tone.getDestination()`이 같은 노드). 믹서를 쓰는 호출부는 `Tone.Gain`을 하나 만들어 destination에 연결해두고 그걸 넘김 — 매 타격마다 새로 만들어지는 `Tone.Player`들이 전부 그 공용 Gain을 거치게 돼, `gain.gain.value`(또는 `Tone.Volume`이면 `.volume.value` dB) 하나로 "신스 드럼 전체" 볼륨을 조절할 수 있게 됨. `DrumVoiceMap`(피스별 트리거 맵) 타입 자체는 안 바꿈 — 기존 `scorePlayer.ts`의 `voices[note.piece].trigger(...)` 호출부 무수정.
- **`trackPlayer.ts`**: `TrackPlayer`에 `setChannelGain(kind: string, gain: number): void` 추가 — 해당 `kind`의 `<audio>` 엘리먼트 `.volume = clamp(gain, 0, 1)`(네이티브 0~1 선형이라 변환 불필요). 믹서(mixer.ts)가 이미 mute/solo를 반영한 "최종 게인"을 계산해서 넘기므로, trackPlayer.ts 자신은 mute/solo 개념을 전혀 모름(책임 분리 유지).
- **`metronome.ts`**: 이미 있는 `setVolume(db)`/`setEnabled(bool)` 그대로 재사용 — 믹서가 linear→dB 변환(`20*log10(linear)`, `linear<=0`이면 `-Infinity`) 후 호출.

### 4. `PracticeCanvas.tsx` 연동
- 마운트 시 `GET /songs/{id}/practice-setting` 호출 → `volumes_json`이 있으면 파싱해 초기 믹서 상태로, 없으면 `defaultMixerState()`.
- 믹서 상태가 바뀔 때마다(재생 중이든 아니든 — REQ-05 "조작 즉시 반영"은 BPM/루프와 달리 **재생 중에도 잠그지 않음**, 볼륨은 Transport 스케줄에 영향 없는 순수 게인 조절이라 T3-2-feedback-1의 "보이는 마디 수"와 같은 판단):
  1. 현재 재생 중인 `playbackRef.current`(있으면)의 `tracks`/`drumVoices 공용 게인`/`metronome`에 즉시 `effectiveGain(...)` 적용.
  2. `PUT /songs/{id}/practice-setting`을 **400ms 디바운스**해서 호출(슬라이더 드래그 중 매 픽셀마다 요청 안 보내게 — 과한 요청 방지, UI 자체는 즉시 반영되니 저장이 늦어도 체감 지연 없음).
- 메트로놈은 `handlePlay()`에서 `createMetronome(...)`을 새로 만들어(기존 voices/tracks와 같은 "재생 1회당 1개" 수명) `playbackRef.current`에 같이 들고 있다가 `stopPlayback()`에서 `dispose()`.
- UI: 6행(채널명 + 슬라이더(0~100) + 음소거 체크박스 + 솔로 체크박스) + "드럼 빼고 듣기" 버튼.

## 위험 분류 — Codex 모드C 대상
- **공개 API 변경**: `GET`/`PUT /songs/{id}/practice-setting` 신설.
- DB 스키마 변경 없음(기존 테이블 재사용), 오디오 타이밍·동기 아님(볼륨은 스케줄에 영향 없음 — T3-3의 "오디오 타이밍" 범주와 다름), 인증 방식 변경 없음.

## QA 계획
1. 자동 테스트: `mixer.ts`(순수 함수) — `effectiveGain`의 mute/solo 조합 전부, `toggleDrumlessPreset`이 `stem_drums`만 건드리는지. 백엔드 `GET`/`PUT` 엔드포인트(소유권 404, 채널 키/범위 검증 422, find-or-create로 기존 `practice_bpm` 등 안 건드리는지).
2. 실제 브라우저: 슬라이더를 재생 중에 움직여 체감 지연 없이 반영되는지, "드럼 빼고 듣기" 눌렀을 때 스템 드럼만 빠지는지, 페이지 새로고침 후 마지막 설정이 복원되는지, 메트로놈을 처음으로 켜봐서 실제로 클릭음이 남을 확인(이번에 처음 연결되는 경로라 각별히 확인).

## 가정·한계
- `practice_bpm`/루프 설정의 영속화는 이번 범위 밖(REQ-04 쪽 — 필요해지면 별도 작업).
- 디바운스 400ms는 추정치 — "저장 안 됨" 체감이 있으면 조정 가능.
