> 한 줄 요약: Q-25(스네어 백비트가 마디마다 밀리는 현상) 추가 조사 — 앱이 실제로 저장·서빙하는 DrumScore의 스네어 틱 값을 원본 MIDI 파일에서 직접 파싱한 값과 1:1 비교한 결과 46개 전부 완전히 일치(byte-identical). **import 경로가 틱 값을 전혀 바꾸지 않음을 직접 증거로 확인** — "재생·렌더링이 추가 오차를 보탠다"는 가능성은 이걸로 사실상 배제됨. 남은 원인(연주자의 자연스러운 템포 변동 vs ADTOF 자동채보 모델의 오차)은 원본 오디오와 직접 비교해야 구분 가능(Phase 3 범위).

# T2-16 Q-25 추가 조사 — import가 스네어 드리프트를 만드는지 직접 확인(순수 조사, 코드 변경 없음)

## 배경
의뢰인이 T2-13/T2-14 이후로도 "지금도 마디마다 SN 위치가 들쭉날쭉하다"고 재확인 질문. T2-13/T2-14는 (1) 원본 MIDI에 템포 이벤트가 1개뿐임을 확인(템포 맵 버그 가설 반증), (2) SN이 그 구간에서 HH와 정확히 같은 틱에 일치하고, HH 자체가 교과서적 110틱이 아니라 평균 120틱 간격으로 기록돼 있음을 확인 — 하지만 둘 다 **원본 MIDI 파일**을 직접 분석한 것이고, "앱이 실제로 저장·재생하는 데이터가 원본과 같은가"(즉 **우리 import 파이프라인이 틱 값을 바꾸지 않는가**)는 이번 라운드로는 미검증이라고 명시해뒀던 항목(Q-25 해소방법란).

## 방법
1. `qa-evidence/T2-13/check_tempo_output.txt` — T2-13에서 원본 MIDI 파일(`data/songs/2/original.mid`)을 앱의 import와 동일한 라이브러리(`@tonejs/midi`)로 직접 파싱해 뽑은 스네어 노트 46개의 원본 틱 값.
2. 로그인된 브라우저 세션에서 앱이 실제로 서빙하는 DrumScore를 그대로 호출:
   ```js
   const res = await fetch('/api/songs/2/drumscore', {credentials: 'include'})
   const score = await res.json()
   score.notes.filter(n => n.piece === 'snare').map(n => n.tick).sort((a,b)=>a-b)
   ```
   결과: `ppq=220, bpm=120, timeSignature=[4,4]`, 스네어 46개.
3. 두 목록을 인덱스별로 직접 비교(`compare_ticks.py`).

## 결과
```
원본 MIDI 스네어 개수: 46
앱 DrumScore 스네어 개수: 46
개수 일치: True
틱 값이 다른 노트 수: 0 / 46
```
**46개 전부 완전히 일치(byte-identical)** — 순서·개수·각 노트의 틱 값 모두 원본과 동일. import 과정(`app/web/src/score/import/`)이 MIDI 바이너리를 DrumScore로 변환하며 틱 값을 반올림·재양자화하거나 다른 방식으로 바꾸는 부분이 전혀 없음을 실제 데이터로 확인.

## 결론
- **"재생·렌더링이 드리프트에 추가 오차를 보탠다"는 가능성은 사실상 배제됨.** 틱 값이 원본과 완전히 같고, 틱→초/틱→화면좌표 변환은 고정 BPM 전제의 단순 선형 계산(`timing.ts`/`layout.ts`, 이미 단위 테스트로 검증된 순수 함수)이라 선형 변환이 "들쭉날쭉함"을 새로 만들어낼 수 없음(동일 간격 입력은 반드시 동일 간격 출력으로 이어짐 — 수학적으로 자명).
- 즉 의뢰인이 화면에서 보는 "마디마다 SN 위치가 다른" 현상은 **이 테스트용 MIDI 파일의 노트 틱 값 자체에 이미 들어있는 패턴을 앱이 그대로(정확하게) 표시하고 있는 것**이지, 우리 코드가 만들어낸 버그가 아님 — "고친다"는 개념 자체가 성립 안 함(고칠 버그가 없음을 추가 증거로 확인).
- 다만 **이 데이터 자체가 왜 이런 패턴인지**(연주자의 자연스러운 템포 변동 vs T2-9에서 이미 낮은 정확도가 확인된 ADTOF 자동채보 모델의 박자 추적 오차)는 여전히 미확정 — 이 MDB Drums 테스트 파일은 사람이 손으로 만든 정답 악보가 아니라 **Phase 0(T0-2)에서 ADTOF가 음원을 자동 채보한 결과물**이기 때문에, 둘 중 어느 쪽이 원인인지는 원본 오디오(`data/datasets/MDBDrums/.../MusicDelta_Grunge_Drum.wav`)와 직접 비교해야 구분 가능 — 이건 Phase 3(사용자 음원 자동채보)에서 다룰 범위.

## 재현 방법
```
cd app/web && node ../../qa-evidence/T2-13/check_tempo.mjs ../../data/songs/2/original.mid
```
위 출력(스네어 틱)과, 로그인 후 브라우저에서 `fetch('/api/songs/2/drumscore', {credentials:'include'})`로 받은 스네어 틱을 `qa-evidence/T2-16/compare_ticks.py`에 넣어 비교(Windows에서 em-dash 등 유니코드 문자 출력 시 `PYTHONIOENCODING=utf-8` 필요 — T2-14에서 이미 확인된 동일 함정, `raw_log.txt` 참조).
