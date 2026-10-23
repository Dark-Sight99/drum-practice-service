> 한 줄 요약: T2-2b — T2-2의 Tone.js 합성음을 실제 드럼 샘플(Virtuosity Drums, CC0)로 교체. 의뢰인 피드백(합성음이 실제 소리 같지 않음)에 따른 후속 작업.

# T2-2b 계획

## 배경
T2-2 완료 후 의뢰인이 실제로 소리를 들어보고 "합성음이 실제 드럼 같지 않다"고 피드백. `intent/07-open-questions.md` Q-19에서 사운드폰트(SF2)·실제 샘플팩 라이선스를 조사한 결과 **Virtuosity Drums**(Versilian Studios/Karoryfer, **CC0 — 공식 페이지에 "open source (Creative Commons 0)"로 명시**, https://versilian-studios.com/virtuosity-drums/)를 채택하기로 함(의뢰인 승인).

## 범위
- `drumVoices.ts`를 Tone.js 신스(MembraneSynth/NoiseSynth/MetalSynth) 기반에서 실제 WAV 샘플 버퍼 재생으로 교체.
- 9종 분류 각각에 맞는 WAV 파일을 Virtuosity Drums 팩(SFZ+WAV, 1.1GB)에서 골라 `app/web/public/audio/drums/`에 넣음(팩 전체가 아니라 필요한 파일만).
- 라이선스 고지 파일(`public/audio/drums/LICENSE.txt`) 추가, `intent/03-architecture-stack.md` §4 라이선스 표 갱신.

## 설계
- Tone.js 공식 문서: 리피치(음높이 변환)가 필요 없는 샘플 재생엔 `Sampler` 대신 `Player`를 쓰라고 명시(`Sampler.d.ts` 주석 — "For sample or buffer playback where repitching is not necessary, use Player"). 우리는 각 피스를 항상 같은 음높이로만 재생하므로 `Player` 채택.
- `Tone.Player`는 `Source`를 상속해 **모노포닉**이다(실제 Tone.js 타입 정의로 확인) — 같은 피스가 빠르게 겹쳐 울리면(예: 8분음표 하이햇 연타) 이전 소리를 끊고 재시작해버림. 그래서 트리거마다 **새 `Player` 인스턴스**를 만들어 재생하고 끝나면(`onstop`) 스스로 정리하는 "발사 후 소멸" 패턴을 쓴다(Tone.js 커뮤니티에서 드럼 샘플에 권장되는 방식) — 버퍼(`ToneAudioBuffer`)는 피스당 1개만 미리 로드해 공유하고, 재생 노드만 매번 새로 만듦.
- `createDrumVoices()`가 fetch+디코딩이 필요해 **동기→비동기**로 바뀜(`Promise<DrumVoiceMap>`) — 아직 이 함수를 쓰는 다른 코드가 없어(T2-3 미착수) 영향 없음.
- velocity(0~1 정규화) → 데시벨: `velocityToDb()`. 선형 근사(velocity=1→0dB, velocity=0→-24dB) — 각 피스 샘플이 벨로시티 레이어 1개뿐이라 정밀한 커브를 맞출 근거가 없어 단순하게 둠(향후 멀티벨로시티 샘플 도입 시 재검토 여지, 이번 범위 아님).

## 샘플 선정 기준(Virtuosity Drums 안에서)
각 샘플은 "실제 비가공 녹음"만 쓰고(피치시프트 등 가공 안 함, CLAUDE.md 규칙1 — 근거 없는 가공 금지), 여러 마이크 포지션 중 하나를 대표로 고른다. 정확한 파일 경로는 압축 해제 후 폴더 구조를 보고 `qa-evidence/T2-2b/result.md`에 기록.
- kick → Kick(Snares On, Center/기본 벨로시티)
- snare → Snare(Center Hit)
- hihat_closed / hihat_open → Hi-hat(Closed / Open)
- tom_high → High Tom(Center Hit)
- tom_mid, tom_floor → **알려진 한계**: 팩에 톰이 2종(Low/High)뿐이라 우리 스키마의 3종(high/mid/floor)과 안 맞음. 가공(피치시프트)으로 억지로 3번째 음높이를 만들지 않고, Low Tom의 서로 다른 실제 타법(예: Center Hit=mid, Off-center Hit=floor)으로 구분 — 둘 다 비가공 실제 녹음.
- crash → Crash(Normal)
- ride → Ride(Normal)

## 테스트 계획
1. `velocityToDb`: 0→-24dB, 1→0dB, 0.5→-12dB, 범위 밖 값 클램프 — 단위 테스트(순수 함수, jsdom에서 가능)
2. `createDrumVoices`/`sampleVoice`/재생 자체는 T2-2와 같은 이유로 jsdom에서 테스트 불가 — 실제 브라우저 수동 QA(9종 전부 소리 확인, 빠른 연타 시 겹쳐 울리는지)
3. 기존 T2-2 단위 테스트(timing.ts 13개)는 그대로 유지·재검증(회귀 없음 확인)

## 가정
- 마이크 포지션·벨로시티 레이어는 의뢰인이 특별히 요구하지 않는 한 "자연스럽게 들리는 기본값" 1개씩만 사용 — 여러 벨로시티 레이어·마이크를 섞는 멀티샘플링은 범위 밖(필요해지면 별도 작업).
- 샘플 파일 포맷은 원본 WAV 그대로 사용(용량 때문에 압축이 필요해지면 그때 mp3/ogg 변환 검토, 이번엔 안 함).
