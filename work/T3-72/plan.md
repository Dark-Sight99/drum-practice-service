> 한 줄 요약: T3-72(REQ-02) 설계안 — 음원 자동 채보 시 "오디오 파일 시작 = 1박"이라고만 가정해 전체 곡이 일정하게(이 곡 기준 약 0.28초) 밀려 보이던 문제를, 실제 다운비트를 자동 감지해 보정하도록 고친다. "위험 작업"(오디오 타이밍·동기, 기존 `audioOffsetMs` 가드 해제) — 구현 전 Codex 모드C 검수 대상.

# T3-72 다운비트 자동 보정 — 설계

## 근거
`intent/07-open-questions.md` Q-43(2026-10-29, 이번에 신규 등록). 의뢰인이 편집기 노트 위치를 실제 악보 사이트(musescore.com) 전사본과 비교하다 "박 번호 선과 실제 타격 위치가 어긋난다"고 지적 → song id=9(Pretender)로 직접 실측(읽기 전용 librosa 재분석, `stem_drums.wav` 335초 전체): 우리가 가정한 격자(BPM 92, 틱0=오디오 0초)와 librosa가 독립적으로 다시 찾은 실제 비트 위치(426개) 사이 평균 차이 **+0.2789초(표준편차 0.0356초)** — 노래 전체에 걸쳐 편차가 작아 "연주 변동"이 아니라 **고정된 위상 오차**로 확인됨. 의뢰인 요청: "곡을 업로드할 때 같은 문제가 발생하지 않도록(실제 곡의 박자랑 일치하도록) 수정".

## 범위 경계(명시)
- **포함**: 음원 업로드(ADTOF 자동 채보) 시 다운비트 위상을 자동 감지해 틱 계산에 반영. 그 보정이 실제 음원 트랙 재생(연습 화면)·메트로놈·편집기 격자 어디서도 깨지지 않게 end-to-end로 반영.
- **제외**: 
  - **이미 업로드된 기존 곡(song id=9 포함)을 소급 재계산하는 것** — 의뢰인 요청이 "업로드할 때"(앞으로의 업로드)로 한정됨. 기존 곡은 재채보(이미 있는 "재채보" 경로 재사용)해야 적용됨 — 별도 안내만 하고 자동 일괄 재처리는 하지 않음(의도치 않은 대량 재작업 방지, CLAUDE.md §1 범위 밖 작업 금지).
  - T3-5(의뢰인이 귀로 듣고 숫자를 수동 조정하는 UI) — Q-31에서 이미 보류 결정됨, 이번 작업은 "자동 감지" 쪽이라 그 결정과 방향이 일치하지만 수동 조정 UI 자체는 범위 밖.
  - Q-23(오프셋+A-B 루프 경계 상호작용)은 **포함** — 지금까지 "값이 항상 0이라 실질 위험 없음"으로 보류돼 있었는데, 이번 작업으로 값이 실제로 0이 아니게 되므로 반드시 같이 처리해야 함.

## 현재 아키텍처 재확인(추측 아님, 코드로 직접 확인)
- `modules/transcriber/midi_to_drumscore.py:112`: `tick = round(note.start * bpm / 60 * ppq)` — 다운비트 보정 없이 "오디오 파일 시작 = 틱 0"으로 고정.
- `modules/transcriber/handler.py`: `audioOffsetMs`를 항상 0으로 설정.
- `api/schemas.py`(`DrumScoreIn`)·`app/web/src/score/validate.ts`: **둘 다 `audioOffsetMs !== 0`이면 검증 실패**(Phase 3 전까지의 임시 제한, Q-23).
- `app/web/src/audio/timing.ts`의 `audioTrackPositionSeconds(transportSeconds, songStartSeconds, playbackRate) = (transportSeconds - songStartSeconds) * playbackRate` — **이 식 자체가 "틱0 = 원곡 파일 위치 0"을 전제로 함**. 실제 음원 트랙(분리된 스템) 재생 위치를 계산하는 유일한 함수이고, `scorePlayer.ts`(최초 재생·루프 재진입 둘 다)가 그대로 씀.
- `app/web/src/features/practice/PracticeCanvas.tsx:1286`·`app/web/src/features/editor/EditorScreen.tsx:465`: **`score.audioOffsetMs === 0`일 때만 음원 트랙(실제 노래 소리)을 재생한다** — 0이 아니면 음원 트랙 자체를 아예 안 만들고 신스 드럼만 재생하는 경로로 조용히 폴백(T3-3 설계 당시 "아직 안 만든 기능"의 가드로 명시적으로 넣어둔 것, `work/T3-3/plan.md` §범위경계 재확인).
- `app/web/src/audio/scorePlayer.ts:167-170`: 신스 드럼 노트 트리거 시각 = `songStartSeconds + ticksToSeconds(tick,...) + audioOffsetMs/1000`.
- **`app/web/src/render/laneRenderer.ts:280-281`(1차 설계에서 누락, Codex 모드C 1차 C-001 지적)**: 연습 화면의 "노트가 떨어져 판정선에 닿는 시각"도 `noteTimeOf = songStartSeconds + ticksToSeconds(note.tick,...) + score.audioOffsetMs/1000`로, **똑같이** `audioOffsetMs`를 더한다.
  둘 다 **지금까지 값이 항상 0이라 실행된 적이 없는 코드**(Q-23)지만, 이 식들의 원래 의도는 "노트의 소리/화면 표시 시각을 통째로 밀고 당기는 미세 보정"이다 — 아래 설계 1번이 쓰려는 의미("틱0이 원곡 파일의 몇 초 지점인지")와는 **다른 역할**이라, 그대로 두면 1번(틱 재앵커)과 이중으로 겹쳐 신스 소리·화면 노트가 "진짜 맞는 자리"에서 `t0`만큼 더 밀려버린다(Codex가 정확히 지적한 결함 — 1차 설계는 이 두 소비처를 전부 놓쳤었다).
- **`audioTrackPositionSeconds()` 호출부 전수 확인(Codex 모드C 1차 C-002 지적으로 다시 찾음)** — `app/web/src`를 grep해 아래 **7곳 전부**를 확인(1차 설계는 `scorePlayer.ts` 1곳만 다뤘음):
  1. `audio/scorePlayer.ts:200` — 최초 재생·루프 재진입 공통(기존 §4 그대로).
  2. `features/practice/PracticeCanvas.tsx:1034` — 재생 중 주기적 리싱크(`resync()`).
  3. `features/practice/PracticeCanvas.tsx:1435` — 편집기→연습 화면 핸드오프 위치 복원(T3-62).
  4. `features/practice/PracticeCanvas.tsx:1509` — "10초 앞으로/뒤로" seek(T3-9).
  5. `features/editor/EditorScreen.tsx:633` — 편집기 자체 재생 중 리싱크.
  6. `features/editor/EditorScreen.tsx:757` — 편집기 자체 재생 시작.
  7. `features/editor/EditorScreen.tsx:791` — 편집기 자체 seek(±10초).
  **편집기 3곳(5~7)은 두 번째 인자를 `songStartSeconds`가 아니라 리터럴 `0`으로 호출**(편집기는 카운트인 없이 트랙 0초부터 바로 재생하는 별도 설계) — `EditorScreen.tsx:754-755`의 기존 주석이 "`audioOffsetMs===0`일 때만 `tracks`가 있으므로 곡 시작 기준점은 항상 0"이라고 **그 가정 자체를 근거로 명시**하고 있다. 이번 작업이 그 가정(6번에서 가드 해제)을 깨므로, 이 주석과 하드코딩된 `0`은 반드시 같이 고쳐야 한다(그대로 두면 편집기에서만 음원 트랙이 다시 어긋나는 새 버그가 생김).
- `metronomeBeatTimes()`(`audio/timing.ts:93-111`)·편집기 격자선(`EditorScreen.tsx`의 `gridLineTicks`/`barLineTicks`/`beatLines`, T3-65·T3-71)은 전부 **순수 틱 계산**이라 `audioOffsetMs`를 전혀 모름 — 틱 자체가 다운비트에 맞게 보정되면 **추가 코드 변경 없이 저절로 맞아짐**(아래 설계 1번이 이 성질을 그대로 이용, Codex도 "방향 자체는 유효하다"고 확인).
- A-B 루프 경계(`computePlaybackSchedule()`, `audio/timing.ts:133-155`)는 `loopStartSeconds = songStartSeconds + barSeconds*loop.startBar`처럼 **초 단위로, `songStartSeconds`를 기준점 삼아** 계산된다(틱이 아님, Codex 모드C 1차 C-005 지적으로 재확인) — `songStartSeconds` 자체의 의미(= 다운비트/틱0이 Transport에서 언제 오는지)는 이번 작업으로 안 바뀌므로(카운트인 길이 계산식 그대로) 루프 마디 경계는 **자동으로 맞는다**. 단, 루프 재진입이 트리거하는 `tracks.playFrom()`(위 call 1번, 루프든 아니든 같은 코드 경로)은 여전히 오프셋을 받아야 하므로 §4·5의 수정이 루프에도 그대로 적용된다.

## 설계

### 1. 틱 계산 자체를 다운비트 기준으로 재앵커(핵심 결정)
`tick = round(note.start * bpm/60*ppq)` 대신, 감지된 다운비트 위상 `t0`(초)를 먼저 빼고 계산한다:
```python
raw = (note.start - t0) * bpm / 60 * ppq
tick = round(max(0.0, raw))
```
**이 결정의 근거**: 틱0을 "진짜 다운비트"로 재정의하면, 메트로놈·편집기 격자선(위에서 확인했듯 전부 순수 틱 계산)이 **아무 코드 변경 없이** 저절로 실제 음악과 맞아떨어진다 — 대안(틱은 그대로 두고 `audioOffsetMs`만으로 보정)은 격자·메트로놈 쪽에도 오프셋을 일일이 꿰어 넣어야 해서 변경 범위가 더 넓고, 한 곳이라도 빠뜨리면 "노트는 맞는데 격자만 틀리다" 같은 새로운 불일치가 생길 위험이 있다(바로 이번에 발견한 버그의 재발 패턴). `t0`보다 이른(= 다운비트 전, 카운트인성 타격 등) 노트는 `max(0.0, raw)`로 틱 0에 클램프 — 이미 `round(max(0, ...))` 패턴이 없던 것은 아니고(`grid.ts`의 `snapTick` 등 프런트 쪽 선례와 같은 방어), 음수 틱은 `DrumScoreIn`이 어차피 거부한다(`validate.ts`/`schemas.py` 기존 검증 그대로 유지).

### 2. 다운비트 위상(`t0`) 추정 — `modules/transcriber/tempo.py`에 추가
```python
MIN_RESULTANT_LENGTH = 0.5  # 아래 설명 참고 — 위상이 이보다 덜 모여 있으면 추정 안 믿음


def estimate_downbeat_offset_seconds(audio_path, bpm: float, start_bpm: float = DEFAULT_START_BPM) -> float:
    """librosa.beat.beat_track()가 추정 bpm과 함께 내놓는 비트 위치(이번까지는
    버려지던 값, Q-43)를 이용해 "우리 격자(틱0=오디오 0초)가 실제 비트와 몇 초
    어긋나 있는지"를 원형평균(circular mean)으로 구한다. 실패·비정상 값(음수,
    한 박 길이 이상, 비트 미검출)이면 0.0(기존 동작과 동일)으로 안전 폴백."""
    try:
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        _, beat_frames = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm, units="frames")
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        if len(beat_times) < 4:          # 신뢰할 통계를 내기엔 너무 적음
            return 0.0
        period = 60.0 / bpm
        theta = (beat_times % period) / period * 2 * np.pi
        mean_sin = np.mean(np.sin(theta))
        mean_cos = np.mean(np.cos(theta))
        # 2026-10-29(Codex 모드C 1차 C-003 지적, 반영) — 위상이 원 위에 고르게
        # 흩어져 있으면(비트 트래킹 자체가 신뢰할 수 없는 곡 등) mean_sin·
        # mean_cos가 둘 다 0에 가까워져 atan2 결과가 수치 잡음에 좌우된다.
        # "합성 벡터 길이"(0=완전히 흩어짐, 1=전부 같은 위상)가 너무 작으면
        # 추정 자체를 신뢰하지 않고 0.0(보정 없음)으로 폴백한다.
        resultant_length = np.hypot(mean_sin, mean_cos)
        if resultant_length < MIN_RESULTANT_LENGTH:
            return 0.0
        t0 = (np.arctan2(mean_sin, mean_cos) / (2 * np.pi)) * period
        if t0 < 0:
            t0 += period
    except Exception:
        return 0.0
    if not np.isfinite(t0) or t0 < 0 or t0 >= period:
        return 0.0
    return float(t0)
```
- **원형평균을 쓰는 이유**: 위상이 한 박 길이(`period`) 경계(예: 0초 근처/period 근처)에 걸쳐 흩어져 있으면 단순 평균·중앙값은 양 끝을 서로 반대로 당겨 틀린 값을 낸다(예: 절반이 0.02, 절반이 0.63일 때 진짜 평균은 "경계 부근"인데 산술평균은 0.325로 완전히 엉뚱한 지점이 나옴) — 이번 song id=9 실측에서 표준편차가 36ms로 작았던 것도 "운 좋게 경계에 안 걸려서"일 수 있어, 다른 곡에서도 안전하려면 처음부터 원형 통계를 써야 한다.
- **`MIN_RESULTANT_LENGTH`(신규 상수, Codex 모드C 1차 C-003 반영)**: 원형 통계에서 "모든 비트가 정확히 같은 위상"이면 합성 벡터 길이=1, "완전히 무작위로 흩어짐"이면 기댓값 0에 수렴 — 임계값 **0.5**를 1차안으로 둔다(음악적 리듬은 비트끼리 어느 정도 위상이 맞아야 정상이라 0.5는 "절반 이상은 신뢰할 만큼 모여 있다"는 보수적인 기준, song id=9 실측치로 직접 계산해 확인 예정 — 구현 단계에서 실제 수치를 `qa-evidence/T3-72/`에 남기고 필요하면 조정). 이 값 아래면 `estimate_tempo()`가 비정상 값에 `DEFAULT_BPM`으로 폴백하는 것과 같은 안전 원칙으로 `t0=0.0`(보정 없음, 기존 동작)으로 돌아간다.
- `bpm`은 `estimate_tempo()`가 구한 값을 받는다. **같은 오디오에 대해 `librosa.beat.beat_track()`을 두 번(각 함수에서 한 번씩) 호출하는 중복은 의도적으로 감수한다**(Codex 모드C 1차 C-007 지적에 대한 결정 — 둘을 하나로 합치는 안도 검토했으나, `estimate_tempo()`는 Q-40에서 이미 구현·테스트·Codex 검수까지 끝난 코드라 이번 작업 때문에 그 시그니처·동작을 바꾸면 이미 승인된 코드에 새 위험을 더하는 셈이다. 전사 작업 자체가 ADTOF 모델 추론(수 초~수십 초)을 포함해 이미 훨씬 무거우므로, `beat_track()` 추가 1회 호출(일반적으로 1초 미만)의 비용은 무시할 만하다고 판단 — 성능이 실제로 문제가 되면 그때 합치는 리팩터링을 별도 작업으로 검토).
- `handler.py`: `bpm = estimate_tempo(drums_path)` 다음 줄에 `t0 = estimate_downbeat_offset_seconds(drums_path, bpm)` 추가, `midi_to_drumscore(midi, title=song.title, bpm=bpm, downbeat_offset_seconds=t0)`로 전달.
- `midi_to_drumscore.py`: `audioOffsetMs: round(t0 * 1000)`로 저장(기존 `0` 고정 제거) — **의미를 명확히 재정의**: "틱0(다운비트)이 원곡 파일에서 몇 ms 지점인지"(아래 3번에서 음원 트랙 재생이 이 의미로 씀). `t0`는 `note.start`에서 이미 뺐으므로(1번) 노트 틱 자체를 다시 건드리는 데는 안 쓴다 — 오직 "원곡 파일의 몇 초를 재생할지" 계산에만 쓰인다.

### 3. `audioOffsetMs`를 "노트 표시/트리거 시각"에서 쓰던 두 곳 전환(필수, Codex 모드C 1차 C-001·C-006 반영)
`scorePlayer.ts:167-170`(신스 노트 트리거)·`laneRenderer.ts:280-281`(연습 화면 노트-판정선 시각) 둘 다 현재 `songStartSeconds + ticksToSeconds(tick,...) + audioOffsetMs/1000` 형태다. **`+ audioOffsetMs/1000` 항을 두 곳 모두에서 제거**한다 — 1번 설계로 노트 틱 자체가 이미 다운비트 기준으로 보정돼 있어, 추가로 또 밀면 같은 보정이 두 번(신스는 소리가, 레인은 화면 낙하 타이밍이) 겹쳐 적용된다 — 이게 바로 Codex 1차 검수 C-001 지적의 핵심("격자·메트로놈은 공짜로 맞는다"는 주장이 이 두 소비처와 모순).
**이걸 "죽은 코드 제거"로 부르지 않는다(Codex 1차 C-006 지적 반영)** — Q-23은 "지금까지 저장된 모든 점수의 값이 0이라 이 분기가 실행된 적이 없다"는 뜻이지 "이 필드가 앞으로도 안 쓰인다"는 뜻이 아니다. 정확히는: **`audioOffsetMs`의 의미를 이번 작업으로 다시 정의**(기존의 막연한 "신스-오디오 미세조정 여지"에서 → "틱0이 원곡 파일의 몇 초 지점인지, 음원 트랙 재생 위치 계산에만 쓰는 값"으로)하고, 그 새 정의와 안 맞는 기존 두 소비처(신스 트리거·레인 표시)는 이 필드를 더 이상 참조하지 않도록 **전환**한다. 코드 변경(해당 두 줄에서 덧셈 항 삭제) 자체는 작지만, 의미 변경은 명시적으로 문서화(이 plan.md + 구현 시 각 파일의 주석)한다.

### 4. `audio/timing.ts`의 `audioTrackPositionSeconds` — 음원 트랙 재생 위치에 오프셋 반영
```ts
export function audioTrackPositionSeconds(
  transportSeconds: number,
  songStartSeconds: number,
  playbackRate: number,
  audioOffsetSeconds = 0,
): number {
  return (transportSeconds - songStartSeconds) * playbackRate + audioOffsetSeconds
}
```
- `transportSeconds === songStartSeconds`(= 틱0, 다운비트)일 때 결과가 `audioOffsetSeconds`(= `t0`)가 되도록 — "틱0에 도달하면 원곡 파일의 `t0`초 지점을 재생 중이어야 한다"는 의미 그대로.
- **호출부(Codex 모드C 1차 C-002 지적 반영 — 위 "현재 아키텍처 재확인"에서 전수 확인한 7곳 전부)**: 전부 네 번째 인자로 오프셋을 넘기도록 고친다.
  - `scorePlayer.ts:200`·`PracticeCanvas.tsx:1034,1435,1509` → `score.audioOffsetMs / 1000`(연습 화면은 `songStartSeconds`가 카운트인 포함 실제 기준점).
  - `EditorScreen.tsx:633,757,791` → `latestState.audioOffsetMs / 1000`(또는 그 시점에 쓰는 state 변수명 그대로) — **두 번째 인자(`songStartSeconds` 자리)의 리터럴 `0`은 그대로 둔다**(편집기는 카운트인이 없어 이 값 자체는 계속 0이 맞음, 바뀌는 건 네 번째 인자뿐). `EditorScreen.tsx:754-755`의 "audioOffsetMs===0일 때만 tracks가 있으므로 기준점은 항상 0" 주석은 그 전제(6번에서 가드 해제)가 깨지므로 **삭제하고, "기준점은 카운트인이 없어 항상 0, 오프셋은 네 번째 인자로 별도 전달"로 교체**.
- **문제(아래 5번에서 다룸)**: 카운트인 구간(`transportSeconds < songStartSeconds`)에 이 식을 그대로 적용하면 `t0`보다 작은, 심지어 음수인 위치가 나올 수 있다 — "원곡 파일의 음수 지점을 재생하라"는 건 불가능하므로 반드시 별도 처리가 필요하다(편집기는 카운트인이 없어 이 문제 자체가 없음 — 5번은 연습 화면에만 해당).

### 5. 음원 트랙 시작 트리거 시각 보정(카운트인 중 "먼저 틀어둬야" 하는 문제, Codex 모드C 1차 C-004 지적으로 결론 확정)
`t0 > 0`이면, 다운비트(틱0, `songStartSeconds` 시각)에 원곡 파일이 정확히 `t0`초 지점에 가 있으려면, **재생 자체는 그보다 `t0/playbackRate`초 더 일찍(카운트인 중에) 시작**돼서 파일 위치 0부터 자연스럽게 흘러 `t0`에 도달해야 한다. 즉 `tracks.playFrom(...)` 호출 시각을 `audioStartSeconds`가 아니라 `audioStartSeconds - t0/playbackRate`로 당기고, 그 시각에 `playFrom(0, playbackRate)`(파일 맨 처음부터)를 호출한다.

**카운트인 시작(0초)보다 이를 수 있는지(1차 설계에서 "구현 단계로 미룸"으로 남겨뒀던 것 — Codex가 "핵심 결정을 미루는 것"이라고 지적해 지금 확정함):**
- Codex가 직접 계산: `COUNT_IN_BARS=1`(`PracticeCanvas.tsx`), 4/4 기준 카운트인 길이 = `240/bpm`초, `t0`의 최댓값은 한 박(`60/bpm`초) 미만(§2 설계가 `t0 ∈ [0, period)`로 보장) → 4/4에서는 카운트인(4박)이 `t0`(1박 미만)보다 항상 커서 **이 극단 케이스 자체가 발생하지 않는다**.
- 그러나 **박자표가 4/4가 아니면 보장 안 됨**(예: 2/4는 카운트인이 2박뿐이라 `t0`가 1박에 가까우면 여유가 거의 없고, 그보다 더 적은 분자의 박자표는 이론상 역전될 수 있음) — "대부분 안 터진다"에 기대지 않고 **항상 안전한 일반 규칙**을 둔다:
  ```
  idealTriggerSeconds = audioStartSeconds - t0 / playbackRate
  triggerSeconds = Math.max(0, idealTriggerSeconds)
  // 트리거를 0으로 당겨 붙인 만큼, 파일도 이미 그만큼 재생된 것으로 보고 시작 위치를 보정
  startPositionSeconds = idealTriggerSeconds < 0
    ? -idealTriggerSeconds * playbackRate   // 0초보다 당겨야 했던 만큼을 파일 위치로 환산해 건너뜀
    : 0
  ```
  즉 `triggerSeconds`는 절대 0(재생 시작 그 자체) 아래로 못 내려가게 클램프하고, 그 대신 **트리거 시각에 넘기는 파일 시작 위치**를 0이 아니라 "이상적으로는 더 일찍 틀었어야 했던 만큼"으로 보정한다 — 수학적으로 항상 다운비트(`songStartSeconds`) 시각에 파일이 정확히 `t0`초 지점에 와 있도록 보장하며(연속 재생이므로 시작 위치만 맞으면 그 뒤는 `playbackRate`로 저절로 맞음), 음수 트리거 시각 같은 불가능한 경우를 만들지 않는다. **카운트인 마디 수를 늘리는 대안은 채택하지 않는다**(기존 UX를 바꾸는 더 큰 변경이고, 위 일반식이 모든 경우를 이미 안전하게 처리함).
- 루프 재진입(`loopStartSeconds` 기준)에도 **같은 일반식**을 그대로 적용한다 — `audioStartSeconds` 자리에 `loopStartSeconds`만 대입하면 되고, 루프 시작 지점이 카운트인 없이 바로 재생 중(이미 흐르고 있는 Transport)이라는 점에서 "트리거를 더 당겨야 하는데 당길 자리가 없는" 문제는 구조적으로 발생하지 않는다(루프 전 구간이 이미 재생 중이므로 0초 클램프에 걸릴 일이 없음 — 최초 진입만 카운트인이라는 "재생 시작 전" 구간이 있어 특별히 취약함).

### 6. 검증 완화
- `app/web/src/score/validate.ts`·`api/schemas.py` 둘 다: "반드시 0"에서 **"유한하고, 0 이상, 한 박 길이(`60/bpm`초, ms 단위라 올림/반올림 고려) 미만"**으로 완화 — 1번 설계의 `t0` 범위(`[0, period)`)와 정확히 일치시켜, 그 범위를 벗어나는 값은 애초에 설계가 보장하지 않는 상태이므로 계속 거부한다(완전 개방이 아니라 "지금 설계가 실제로 만들어낼 수 있는 범위"만 허용 — 과한 개방 금지).
- 편집기(`EditorScreen.tsx`)·연습 화면(`PracticeCanvas.tsx`)의 `audioOffsetMs === 0`일 때만 음원 트랙을 쓰던 가드를 제거 — 이제 0이 아니어도(4·5번 설계가 처리하므로) 음원 트랙을 정상적으로 만든다.

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**(§4·5 — `work/T3-3/plan.md`가 이미 "위험 작업"으로 분류했던 바로 그 핵심 수식을 다시 건드림, 게다가 이번엔 "지금까지 실행된 적 없는 코드 경로"가 **처음으로 실행**되게 만드는 작업이라 더 신중해야 함).
- **기존 가드 해제**: `audioOffsetMs !== 0` → 음원 트랙 끔(T3-3), 검증 거부(T2-8) 둘 다 "아직 안 만든 기능"의 임시 방어였는데, 이번에 그 기능을 실제로 만들어 가드를 해제하는 것 — 가드가 막아주던 "알 수 없는 상태"가 이제 실제로 열리므로, §5의 일반식(0초 클램프+시작 위치 보정)이 실제 구현에서도 그대로 지켜지는지 코드 리뷰·QA 둘 다에서 꼼꼼히 봐야 함.
- DB 스키마 변경 없음(`DrumScore.audioOffsetMs` 필드는 이미 존재, 값 범위만 바뀜). 공개 API 응답 형태 변경 없음(필드 값만 0이 아닐 수 있게 됨).

## QA 계획
1. 백엔드 단위 테스트: `estimate_downbeat_offset_seconds()` — 합성 비트 배열(알려진 위상으로 생성)로 원형평균이 정확한 위상을 복원하는지, 위상이 0/period 경계에 걸친 합성 데이터(바로 위에서 설명한 "산술평균이 틀리는" 경우)로 원형평균이 맞게 나오는지, 비트 4개 미만·로딩 실패 시 0.0 폴백 확인. `midi_to_drumscore()`에 `downbeat_offset_seconds`를 넘겼을 때 그 값만큼 정확히 빠진 틱이 나오는지, 다운비트보다 이른 노트가 틱 0으로 클램프되는지.
2. **song id=9(Pretender)로 재채보해 직접 검증(이번 버그의 실제 재현 사례)**: 새 로직으로 다시 채보한 결과를 이번 조사에서 이미 확보한 librosa 재측정 비트 위치(이 대화에서 쓴 분석 스크립트 재사용)와 비교 — 보정 후 노트들이 그 비트 위치에 훨씬 가깝게(이상적으로는 반올림 오차 수준까지) 맞아떨어지는지 확인. 보정 전(+0.2789초 평균 어긋남)과 보정 후를 **숫자로 나란히** 보고.
3. 프런트 단위 테스트: `audioTrackPositionSeconds`에 4번째 인자(오프셋) 추가 후 기존 테스트(`timing.test.ts`, 오프셋=0 케이스) 전부 그대로 통과하는지(하위호환), 오프셋≠0일 때의 새 케이스 추가(§5의 "트리거 0초 클램프+시작 위치 보정" 공식도 순수 함수로 분리해 단위 테스트). `validate.ts`의 완화된 검증 범위(경계값 포함) 테스트. §3에서 수정하는 `scorePlayer.ts`·`laneRenderer.ts` 두 곳 다 "오프셋이 있어도 더 이상 더하지 않는지" 회귀 테스트 추가. 위 "현재 아키텍처 재확인"에서 확인한 7개 호출부 전부 네 번째 인자를 실제로 넘기는지 코드 리뷰(Codex 모드A)에서 빠짐없이 확인.
4. **실기기/실브라우저 end-to-end**: `audioOffsetMs≠0`인 새로 채보된 곡으로 실제 재생 — 음원 트랙이 꺼지지 않고 정상 재생되는지, 카운트인 중 트랙이 미리 트리거되는지(§5), A-B 루프 켜고 재진입마다 오디오가 끊김·중복 없이 올바른 위치로 돌아가는지. 가능하면 T2-11 방식(녹화+교차상관)으로 메트로놈·실제 드럼 소리가 체감상 맞아떨어지는지까지 확인.
5. 편집기(`EditorScreen.tsx`)에서 `audioOffsetMs≠0`인 곡을 열어 음원 트랙 재생·"연습 화면으로" 핸드오프가 기존(오프셋=0)과 동일하게 동작하는지 회귀 확인.

## 가정·한계(숨기지 않음)
- 이번 실측(표준편차 36ms)은 **song id=9 한 곡 기준**이다 — 다른 곡·장르에서 비트 트래킹 자체의 신뢰도가 떨어지면(싱커페이션이 심하거나 비트가 불분명한 곡 등) `t0` 추정도 부정확해질 수 있음. `estimate_tempo()`가 이미 "표본 1곡 기준 경험적 선택"이라고 명시한 것과 같은 성격의 한계.
- `MIN_RESULTANT_LENGTH = 0.5`는 song id=9로 역산해본 값이 아니라 **1차 추정치**(구현 단계에서 실제 수치를 재고 조정) — 너무 낮으면 신뢰 못 할 위상도 통과시키고, 너무 높으면 실제로 유효한 보정까지 0.0으로 버릴 위험이 둘 다 있음.
- 4/4가 아닌 박자표(특히 분자가 작은 2/4 등)에서 §5의 "카운트인보다 이른 트리거" 일반식이 수학적으로는 항상 안전하지만, **실제로 음원 트랙이 자연스럽게 들리는지**(트리거를 0초로 당겨 붙였을 때 체감상 이상하지 않은지)는 실측 전까지 모름 — 그런 박자표의 실제 곡으로 QA해본 적 없음.
- 기존에 이미 업로드된 곡은 재채보해야만 이 보정이 적용됨(소급 자동 적용 안 함, 범위 경계 참고).
