> 한 줄 요약: T3-12(모바일 믹서 음량 적용 안 됨 수정) QA 결과 — 분리 오디오 트랙 음량 제어를 `element.volume`(iOS에서 무시됨)에서 Web Audio GainNode로 교체. 테스트/타입체크/린트 통과, 브라우저에서 AudioParam 값 변경을 직접 확인(단, 실제 iOS 기기 검증은 의뢰인 몫).

# T3-12 QA 결과

## 근거(REQ)
- REQ-05 "트랙별 볼륨".
- 의뢰인 피드백: "모바일 믹서 수치 변경해도 적용 안됨. UI상 수치는 바뀌는데 실제 적용은 안되는듯... 믹서는 PC에서는 정상 반응한다."

## 원인 진단
`app/web/src/audio/trackPlayer.ts`가 분리 오디오 트랙(스템: 드럼(원곡)·음악)의 음량을 네이티브 `HTMLMediaElement.volume`로 직접 조절하고 있었음. **iOS(모든 iOS 브라우저는 WebKit 기반 — Safari뿐 아니라 "Chrome/Firefox for iOS"도 내부는 WebKit)는 이 프로퍼티를 JS로 설정해도 실제 출력 음량에 반영하지 않는다** — Apple 공식 문서(WebSearch로 확인): "On iOS devices, the audio level is always under the user's physical control. The volume property is not settable in JavaScript. Reading the volume property always returns 1." PC(데스크톱 브라우저)는 이 제한이 없어 정상 동작했던 것과 정확히 일치하는 증상.

같은 음원 재생 경로에서 `synth_drums`(Tone.js `Tone.Gain`)·`metronome`(Tone.js `Tone.Volume`)은 Web Audio API의 `GainNode` 기반이라 이 제한을 안 받음 — 분리 오디오 트랙(네이티브 `<audio>` 기반)만 영향받는 비대칭 버그였을 것으로 추정(의뢰인이 "믹서"라고만 보고해 정확히 어느 채널인지는 특정 못 했으나, 코드 경로상 스템 트랙이 유일하게 `.volume`을 쓰고 있었음).

## 변경 내용 (`app/web/src/audio/trackPlayer.ts`만 수정)
- 각 트랙의 `<audio>` 엘리먼트를 `Tone.getContext().rawContext.createMediaElementSource()`로 Web Audio 그래프에 연결 → `GainNode` → `context.destination`. Tone.js가 synth_drums/metronome에 이미 쓰는 것과 **같은 AudioContext를 공유**(별도 unlock 불필요 — `createDrumVoices()`의 `Tone.start()`가 같은 사용자 제스처 흐름 안에서 이미 resume시킴, 실제 설치된 Tone.js 15.1.22 타입 선언으로 `Context.rawContext`가 네이티브 `AudioContext`를 돌려줌을 확인).
- `setChannelGain()`: `element.volume = ...` → `gainNode.gain.value = ...`(선형 0~1 단위는 동일, 변환 불필요).
- `dispose()`: 새 Web Audio 노드 `.disconnect()` 추가(메모리 누수 방지).
- play/pause/seek/rate 제어(`playFrom`/`seekTo`/`resync`/`pause`/`resume`/`stop`)는 전혀 안 건드림 — `MediaElementAudioSourceNode`는 "출력 경로"만 바꿀 뿐 엘리먼트 자신의 재생 제어 API에는 영향 없음(스펙 동작).
- 모듈 상단 주석도 갱신("Tone.js를 모르는 순수 HTMLAudioElement 래퍼"였던 전제가 깨짐 — 이유 명시).

## 알려진 리스크 (솔직히 밝힘)
WebSearch로 조사한 결과, GainNode를 통한 iOS 음량 제어도 과거 WebKit 버그 이력이 있다(예: [WebKit Bug 151589](https://bugs.webkit.org/show_bug.cgi?id=151589), iOS 9.1 기준 — GainNode도 무시됨). 다만 더 최근 보고([WebKit Bug 276813](https://bugs.webkit.org/show_bug.cgi?id=276813))는 **코덱에 따라 다르다**(WebM/Opus는 무시, MP4/AAC는 정상)고 해, 범용적으로 아직도 깨져 있는 게 아니라 특정 코덱·구 iOS 버전 이슈일 가능성이 있음 — 이 앱의 스템 파일은 Demucs가 만드는 평범한 비압축 WAV(PCM)라 더 단순한 디코딩 경로라 영향받을 가능성이 낮다고 추정하나, **실기기(iOS Safari)로 직접 검증한 적은 없음**(Claude Code가 접근 가능한 브라우저는 실제 iOS WebKit이 아님) — 이 자체가 추측이라는 걸 숨기지 않음. 의뢰인의 모바일 재테스트 결과가 최종 검증.

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 197 tests 모두 통과(trackPlayer.test.ts에 신규 2개 — Web Audio 그래프 연결·dispose 시 disconnect, 기존 setChannelGain 테스트 3개는 .volume 스파이 대신 GainNode 값 검증으로 재작성)
npm run lint             # oxlint 통과, 경고 없음
```
jsdom은 Web Audio API가 없어 Tone.js가 메서드 없는 빈 객체(`DummyContext`)로 빠짐(실제 실행으로 확인) — `trackPlayer.test.ts`에서 `'tone'` 모듈 전체를 가짜 AudioContext(`createMediaElementSource`/`createGain`/`destination`)로 모킹해 실제 그래프 연결 로직(source→gain→destination)과 음량 적용을 값으로 검증.

## 브라우저 수동 검증 (localhost:5174, huibigyocha 곡, PC/Chromium)
`AudioParam.prototype.value`의 setter를 몽키패치해 직접 증거 확보(이 프로젝트에서 이미 여러 번 쓴 기법) — "드럼(원곡)" 슬라이더를 77%로 직접 조작(`HTMLInputElement.value` 설정 + `input` 이벤트 디스패치) → **`AudioParam.value = 0.77` 호출을 정확히 1건 확인**(추측이 아니라 실제 Web Audio 그래프에 값이 전달됐다는 직접 증거). UI 표시도 77%로 일치. 콘솔 에러 0건.

**한계**: Claude Code의 브라우저 도구는 Chromium 기반이라 iOS Safari의 실제 동작(위 "알려진 리스크" 참고)은 여기서 검증 불가 — 의뢰인 실기기 재테스트 필요.

## 결론
확인된 근본 원인(iOS가 `<audio>.volume`을 무시)에 대한 표준적 해법(Web Audio GainNode, 이 앱의 synth_drums/metronome이 이미 쓰는 방식과 동일)으로 수정. PC/Chromium에서 그래프가 실제로 연결되고 값이 전달됨을 직접 증거로 확인했으나, iOS 자체 검증은 의뢰인 몫 — 완료로 과신하지 않음.
