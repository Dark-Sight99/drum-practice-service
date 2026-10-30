> 한 줄 요약: T6-11 기획안 — 스템(실제 음원) 재생을 `<audio>` 엘리먼트에서 `Tone.Player`(AudioBufferSourceNode, 노트와 같은 Web Audio 시계)로 바꿔 `resync()`의 seek·playbackRate 보정 자체를 구조적으로 없앤다. Opus 5.5 서브에이전트 2개(코드 감사+공식 문서 조사) 병렬 조사 결과를 마스터가 종합. **아직 구현 전 — Codex 설계 검수·실기기 사전검증·의뢰인 승인 필요.**

# T6-11 기획안 — 스템 재생을 Tone.Player(AudioBufferSourceNode)로 전환

근거: `work/T6-10/plan.md`(resync seek이 원인으로 확정, 소프트 보정 2회 실패 후 되돌림), 서브에이전트 2개(Opus 5.5)의 조사 보고(코드 감사 + 공식 문서 조사, 2026-10-30).

## 왜 다시 근본으로 돌아가나

오늘 확정된 사실: "노트"는 `Tone.Transport`(Web Audio 시계), "실제 음원"은 `<audio>` 엘리먼트(별도 미디어 파이프라인) — **두 시계가 다르다는 게 스펙상 원천적인 특성**이지, 버그가 아니다. Web Audio 공식 스펙이 직접 명시: AudioContext의 시간은 "may not be synchronized with other clocks in the system"(시스템의 다른 시계와 동기화되지 않을 수 있음). 그래서 `resync()`(둘을 주기적으로 맞추는 로직) 자체가 애초에 있어야 했던 거고, 그 "맞추는 방법"(seek, 또는 playbackRate 조정)이 전부 iOS에서 무거운 거였다 — **방법을 아무리 바꿔도 "두 시계를 쓴다"는 근본 구조가 남아있는 한 비슷한 문제가 반복될 가능성이 높다.**

## 핵심 증거(두 서브에이전트 교차 확인)

1. **WebKit 소스 코드(main 브랜치, `AudioSourceProviderAVFObjC.mm`) 직접 확인** — iOS에서 `createMediaElementSource()`로 연결된 `<audio>`의 `playbackRate`를 바꾸면, WebKit이 오디오 탭(MTAudioProcessingTap)과 링버퍼를 **통째로 부쉈다가 다시 만든다**(`destroyMixIfNeeded()` → `createMixIfNeeded()`). 재생성 중엔 "충분한 데이터가 쌓일 때까지 무음 출력"(소스 주석 원문 확인). **T6-10의 소프트 보정이 0.75초마다 바로 이 재구성을 반복시켰다는 게 끊김의 직접적 원인으로 보임** — seek도 같은 경로에서 버퍼 플러시를 유발(코드 확인).
2. **WebKit 미디어 엔지니어 Jer Noble의 공식 답변**(WebKit Bug 301824, 2025-11-07): *"There's no requirement that two `<audio>` elements remain in sync with each other; ... If you want sample accurate playback, you really need a BufferSource, not a HTMLMediaElement."* 같은 버그에서 실제로 BufferSource로 바꾼 사람의 후기: *"It works perfectly, even on iOS Safari."*
3. **아직 안 고쳐진 관련 WebKit 버그도 확인됨**: Bug 311000(`preservesPitch=true`도 AudioContext에 연결되면 choppy, 2026-06-22에 REOPENED 상태) — 즉 **지금 쓰는 경로(iOS Web Audio 우회 + preservesPitch) 자체가 WebKit의 알려진 미해결 버그 영역**이라는 것도 추가로 확인됨.
4. **Tone.js의 `Tone.Player`는 이미 이 프로젝트의 의존성**(가상드럼에 이미 씀)이고, 실제 소스 확인 결과 `AudioBufferSourceNode`를 감싼 것이며 `sync()`로 Transport의 재생/일시정지/루프 이벤트를 자동으로 따라갈 수 있음(일부 제약은 아래 리스크 참고). Web Audio 스펙상 버퍼 재생은 AudioContext의 렌더 스레드 안에서 `currentTime`과 **같은 흐름으로** 처리되므로, 드리프트가 구조적으로 생기지 않음(스펙 §1.9.3/§1.7.2/§1.9.6 확인).

## 설계 방향(1순위, 두 에이전트 공통 권고)

- 스템(`stem_drums`/`stem_music`) 재생을 `trackPlayer.ts`의 `<audio>`+`createMediaElementSource()` 방식에서 `Tone.Player`(`AudioBufferSourceNode`)로 교체.
- 믹서 게인은 `Tone.Player`/`Source`에 이미 있는 `volume`(dB)으로 — `mixer.ts`의 기존 `linearGainToDb()`를 그대로 재사용 가능(새 변환 로직 불필요). **iOS 전용 `GainNode`/`getIOSStemAudioContext()` 분기 자체가 통째로 불필요해질 가능성**(데스크톱·iOS 구분 없이 하나의 경로로 통일).
- 언락(iOS 자동재생 정책)도 `prime()`의 play+pause 트릭이 필요 없어지고, AudioContext `resume()`만 있으면 됨 — 코드가 오히려 단순해짐.

## 가장 큰 걸림돌 — 음정 유지 배속 조절(REQ-04/Q-04)

- `AudioBufferSourceNode.playbackRate`(및 `Tone.Player.playbackRate`)는 **피치도 같이 바뀐다**(스펙·Tone.js 문서 양쪽 확인). 지금 쓰는 `element.preservesPitch`에 해당하는 기능이 Web Audio 표준엔 아직 없음(Web Audio WG 이슈 #2487, "Priority: Soon"이지만 미반영).
- 실시간 피치 보정 라이브러리(AudioWorklet 기반 — Tone.GrainPlayer, Signalsmith Stretch, SoundTouchJS, Rubber Band 등)는 전부 **iOS 실사용이 검증된 1차 출처가 없고**, 특히 **"iOS에서 AudioWorklet을 쓰면 컨텍스트 전체에 글리치가 나고 컨텍스트를 새로 만들기 전까진 안 없어진다"는 미해결 WebKit 버그(226240)가 공통 리스크**로 깔려있음 — 이 프로젝트가 예전에 SoundTouchJS(AudioWorklet)로 실기기에서 실패했던 것과 같은 범주의 위험일 가능성이 높음.
- **채택할 우회(두 에이전트 공통 제안)**: 이 앱은 **재생 중 배속을 바꿀 수 없음**(코드로 확인 — BPM 입력이 재생/일시정지 중 비활성화됨, 한 세션 동안 배속은 상수). 그러니 실시간 피치 보정 DSP가 전혀 필요 없음 — **재생 "시작 전에" 그 배속만큼 미리 속도를 바꿔둔 오디오를 만들어서(오프라인 처리), 그걸 `Tone.Player`로 1배속(rate=1)으로 그냥 재생**하면 됨. 오프라인 처리는 SoundTouchJS가 실패했던 "실시간 AudioWorklet 불안정" 조건 자체에 해당하지 않음(서버에서 ffmpeg `atempo`/`rubberband` 필터로 처리 가능 — 로컬 ffmpeg 9.0.2에 둘 다 있음을 실행으로 확인, 서버 번들 ffmpeg에도 있는지는 미확인. `rubberband`는 GPL이라 쓰면 `intent/03-architecture-stack.md` 라이선스 표에 기록 필요, CLAUDE.md §6).
- 1.0배속(원곡 그대로)일 때는 전처리 자체가 필요 없음 — 서버 스템 파일을 그대로 디코딩해서 재생.

## 구현 전 반드시 실기기로 먼저 검증해야 할 것(순서대로, 코드 전면 교체 전에)

1. **메모리**: 스템 하나를 float32 PCM으로 통째로 들고 있으면 곡당(스테레오 44.1kHz, ~5분 기준) 스템 2개에 약 237MB(두 에이전트 계산 일치, 118MB 전후/스템). iPhone 13 Pro·iPad mini 5 Safari에서 이 정도 메모리로 탭이 안 죽는지(jetsam) 실기기로 직접 확인 — 안 되면 모노 변환, 필요할 때만 지연 디코딩(`stem_drums`는 기본 볼륨 0이라 토글 전엔 안 받아도 됨) 등 완화책 필요.
2. **공유 컨텍스트 위험 재확인**: T6-6에서 "Tone 공유 컨텍스트에 실제 음원(MediaElementSource)을 얹으면 렉"을 실기기로 확정했었는데, 그게 **MediaElementSource 특유의 문제였는지, AudioBufferSourceNode도 똑같이 느려지는지 아직 확인 안 됨** — 콘솔에서 같은 스템을 `decodeAudioData()`한 뒤 `AudioBufferSourceNode`로 재생하며 fps 재보려는 실험을 먼저 해봐야 함(코드 전면 교체 전 저비용 사전검증).
3. iOS 버전 확인(의뢰인 아이폰이 iOS 27 이상인지) — 27.0부터 `preservesPitch`/`playbackRate` 처리가 일부 수정됐지만 27.1/27.2에도 후속 수정 없이 관련 버그(311000)가 남아있어, 지금 겪는 증상이 iOS 버전에 따라 조금씩 다를 수 있음.

## 범위 밖(이번엔 안 건드림)

- 에디터 화면(`EditorScreen.tsx`)의 같은 구조도 똑같이 영향받지만, 실기기 성능이 중요한 건 연습 화면(모바일)이 우선 — 에디터는 주로 PC 사용으로 보여 범위를 연습 화면으로 먼저 좁히고, 성공하면 에디터도 동일 적용 검토.
- Rubber Band(GPL) 채택 여부는 라이선스 영향이 있어 의뢰인 결정 필요 — 일단 ffmpeg `atempo`(라이선스 걱정 없음, 이미 쓰는 ffmpeg 번들 안에 있을 가능성 높음)를 1차로 검토.

## 다음 단계

이 문서는 **설계 방향 정리까지**이고 구현 전입니다. REQ-04 핵심 재생 경로의 전면 교체라 범위가 크므로:
1. 위 "구현 전 검증" 2개(메모리, 공유 컨텍스트)부터 실기기로 저비용 사전 확인
2. 통과하면 상세 설계 문서 작성 → Codex 모드C 검수 → 구현 → 테스트 → 실기기 최종 검증
3. 의뢰인 승인(이 정도 규모 변경은 Phase 게이트에 준하는 결정으로 판단)
