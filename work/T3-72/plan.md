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

**호출부(Codex 모드C 1차 C-002, 2차 C-002 재지적 반영 — 각 호출부의 실제 수정 전/후를 명시)**: 위 "현재 아키텍처 재확인"에서 전수 확인한 7곳 전부 네 번째 인자로 오프셋을 넘긴다.
- `scorePlayer.ts:200`·`PracticeCanvas.tsx:1034,1435,1509`: 네 번째 인자로 `score.audioOffsetMs / 1000` 추가(이 네 곳은 이미 `songStartSeconds`를 세 번째 인자로 올바르게 쓰고 있음 — 바뀌는 건 네 번째 인자뿐).
- `EditorScreen.tsx:633,757,791`: 2차 검수 지적대로 **실제 호출 형태를 명시**한다 — 현재 `audioTrackPositionSeconds(seconds, 0, playbackRate)` 형태(3개 인자)인 걸 `audioTrackPositionSeconds(seconds, 0, playbackRate, latestState.audioOffsetMs / 1000)`(633번), `audioTrackPositionSeconds(positionSeconds, 0, playbackRate, latestState.audioOffsetMs / 1000)`(757번), `audioTrackPositionSeconds(target, 0, playbackRate, latestState.audioOffsetMs / 1000)`(791번)로 바꾼다 — **네 번째 인자만 새로 추가**, 세 번째까지는 그대로.
  **두 번째 인자(`songStartSeconds` 자리)가 계속 리터럴 `0`인 진짜 이유(2차 검수 지적 반영 — 옛 주석의 근거가 틀렸음을 인정하고 다시 씀)**: 기존 `EditorScreen.tsx:754-755` 주석은 "`audioOffsetMs===0`일 때만 `tracks`가 있어 기준점이 항상 0"이라고 적어뒀는데, **그 인과관계 자체가 틀렸다** — 진짜 이유는 `EditorScreen.tsx:730`에서 `playDrumScore()`를 호출할 때 `countInBars: 0`을 명시적으로 넘기기 때문이다(편집기는 연습 화면과 달리 카운트인 없이 재생 미리듣기를 하는 별도 설계, `audioOffsetMs`와는 무관한 독립된 선택). `computePlaybackSchedule()`의 `songStartSeconds = barSeconds * countInBars`이므로 `countInBars=0`이면 `songStartSeconds`는 **항상** 0 — `audioOffsetMs` 값과 전혀 상관없이 성립하는 사실이다. 따라서 가드를 없애도(6번) 이 `0`은 계속 맞다 — 주석만 "countInBars=0이라 항상 0, audioOffsetMs는 네 번째 인자로 별도 전달"로 교체.

### 5. 다운비트 전 오디오("카운트인 중 트랙을 미리 틀어둬야 하나?") — 불필요함을 증명(Codex 모드C 2차 C-004 지적으로 1차 설계의 §5 전체를 재검토, 더 단순한 결론으로 교체)
1차 설계는 "카운트인 중에 트랙을 미리(`t0/playbackRate`초 당겨) 틀어서 파일 위치 0부터 자연스럽게 흘러 `t0`에 도달해야 한다"는 "선재생" 메커니즘을 제안했는데, Codex 2차 검수가 그 클램프 공식의 불변식이 성립함을 보여주는 유도 과정이 빠져 있다고 지적했다 — 다시 유도해보니, **애초에 이 메커니즘 자체가 불필요했다**:
- `tracks.playFrom(positionSeconds, playbackRate)`는 **이미 임의의 위치로 직접 탐색(seek)할 수 있다** — 이건 새로 만드는 능력이 아니라, 루프 재진입(0마디가 아닌 마디에서 루프할 때 파일 중간 지점으로 바로 이동)에 **이미 쓰이고 있는, T3-3부터 있던 기존 동작**이다(`scorePlayer.ts:205`, 코드로 확인). "파일 맨 처음부터 자연스럽게 흘러서 도달"해야 할 기술적 이유가 없다 — 그냥 `audioTrackPositionSeconds(audioStartSeconds, songStartSeconds, playbackRate, t0)`가 계산한 위치로 **직접** `playFrom()`을 부르면 된다(4번 설계 그대로, 특별한 분기 없음).
- **이게 항상 안전한지(음수 위치가 안 나오는지) 수학적으로 증명**: `audioStartSeconds`는 `songStartSeconds`(최초 재생) 또는 `loopStartSeconds = songStartSeconds + barSeconds*loop.startBar`(루프 재진입, `loop.startBar ≥ 0`이므로 `loopStartSeconds ≥ songStartSeconds` 항상) 둘 중 하나 — 어느 쪽이든 **`audioStartSeconds ≥ songStartSeconds`가 항상 성립**한다. 따라서:
  ```
  audioTrackPositionSeconds(audioStartSeconds, songStartSeconds, playbackRate, t0)
    = (audioStartSeconds - songStartSeconds) * playbackRate + t0
    ≥ 0 * playbackRate + t0        // (audioStartSeconds - songStartSeconds) ≥ 0, playbackRate > 0
    = 0 + t0 = t0                  // 부등식이지 등식이 아님(Codex 모드C 3차 C-001 지적, 반영) —
                                    // 루프 재진입(audioStartSeconds=loopStartSeconds>songStartSeconds)에서는
                                    // 첫 항이 양수라 결과가 t0보다 더 커짐(여전히 0 이상이라는 결론엔 영향 없음,
                                    // "항상 정확히 t0"라고 잘못 쓴 걸 "항상 t0 이상"으로 바로잡음)
    ≥ 0                             // §2 설계가 t0 ∈ [0, period)로 항상 보장
  ```
  **즉 이 위치는 수학적으로 항상 0 이상이다** — 음수가 나올 수 있는 입력 자체가 없다(1차 설계가 걱정했던 "카운트인보다 이른 트리거"는 애초에 발생할 수 없는 상황을 전제로 한 것이었다 — `scorePlayer.ts:194-208`의 실제 재생 경로가 최초 진입·루프 재진입 둘 다 "예약된 시각에 `playFrom()` 한 번 호출"뿐이라는 것도 코드로 재확인, Codex 3차 C-005).
- **단, 이 증명이 보장하는 건 "트랙 위치가 음수가 되지 않는다"까지다 — "건너뛰어도 괜찮다"는 별개의 주장(Codex 모드C 3차 C-002 지적, 중요)**: `t0 > 0`인 곡은 재생 시작 시 `playFrom(t0, ...)`으로 원곡 파일의 **처음 `t0`초를 건너뛰고** 시작한다(`trackPlayer.ts`의 `playFrom()`이 지정 위치로 `currentTime`을 옮긴 뒤 재생하는 구조, 코드로 확인). **그 구간에 실제로 들을 만한 소리(픽업 노트·보컬 도입부 등)가 있는지 없는지는 이 설계가 증명하지 못한다** — 1차 설계 문서가 "그 구간은 소리가 없다"고 단정했던 건 근거 없는 주장이었다(삭제). 올바른 서술: **이 설계는 `t0`초를 건너뛰는 것을 의도적으로 선택**한다(복잡한 선재생 메커니즘 없이 구현이 훨씬 단순해지는 대가로) — 실제로 그 구간에 중요한 소리가 있어 체감상 어색하면, 그건 "버그"가 아니라 "이 설계의 트레이드오프가 실제로 문제가 되는 사례"이고, 그때는 (a) 건너뛰는 대신 카운트인 전체 길이를 늘려 선재생할 여유를 만들거나 (b) 짧게라도 그 구간을 들려주는 방향을 재검토해야 한다 — **이번 작업의 QA(아래 end-to-end 항목)에서 반드시 직접 들어보고 확인한다**(가정·한계에도 명시).
- **결론**: 1차 설계의 "선재생/클램프" 메커니즘(트리거 시각을 당기고 시작 위치를 보정하는 복잡한 공식)은 **"음수 위치를 막기 위해서는" 불필요했다** — 그 목적(위치 음수 방지)은 위 증명대로 애초에 걱정할 필요가 없었다. 다만 "픽업 구간을 들려주고 싶다"는 **다른 목적**이라면 선재생이 여전히 한 방법일 수 있다 — 이 설계는 그 목적 자체를 추구하지 않기로 선택한 것이지, 선재생이 전적으로 무가치하다고 증명한 게 아니다(Codex 3차 지적 반영, 과장하지 않음). 루프 재진입도 같은 이유로 별도 분기 없이 4번 설계의 평범한 호출 하나로 끝난다(음수 방지 목적에 한해서는 Codex 2차 D-001 지적도 이걸로 해소).

### 6. 검증 완화
- `app/web/src/score/validate.ts`·`api/schemas.py` 둘 다: "반드시 0"에서 **"유한하고, 0 이상, 한 박 길이(`60/bpm`초, ms 단위라 올림/반올림 고려) 미만"**으로 완화 — 1번 설계의 `t0` 범위(`[0, period)`)와 정확히 일치시켜, 그 범위를 벗어나는 값은 애초에 설계가 보장하지 않는 상태이므로 계속 거부한다(완전 개방이 아니라 "지금 설계가 실제로 만들어낼 수 있는 범위"만 허용 — 과한 개방 금지).
- 편집기(`EditorScreen.tsx`)·연습 화면(`PracticeCanvas.tsx`)의 `audioOffsetMs === 0`일 때만 음원 트랙을 쓰던 가드를 제거 — 이제 0이 아니어도(4·5번 설계가 처리하므로) 음원 트랙을 정상적으로 만든다.

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**(§4·5 — `work/T3-3/plan.md`가 이미 "위험 작업"으로 분류했던 바로 그 핵심 수식을 다시 건드림, 게다가 이번엔 "지금까지 실행된 적 없는 코드 경로"가 **처음으로 실행**되게 만드는 작업이라 더 신중해야 함).
- **기존 가드 해제**: `audioOffsetMs !== 0` → 음원 트랙 끔(T3-3), 검증 거부(T2-8) 둘 다 "아직 안 만든 기능"의 임시 방어였는데, 이번에 그 기능을 실제로 만들어 가드를 해제하는 것 — 가드가 막아주던 "알 수 없는 상태"가 이제 실제로 열리므로, §4·5가 증명한 "위치는 항상 0 이상" 불변식이 실제 구현에서도 그대로 지켜지는지(7개 호출부 전부 올바른 인자를 넘기는지) 코드 리뷰·QA 둘 다에서 꼼꼼히 봐야 함.
- DB 스키마 변경 없음(`DrumScore.audioOffsetMs` 필드는 이미 존재, 값 범위만 바뀜). 공개 API 응답 형태 변경 없음(필드 값만 0이 아닐 수 있게 됨).

## QA 계획
1. 백엔드 단위 테스트: `estimate_downbeat_offset_seconds()` — 합성 비트 배열(알려진 위상으로 생성)로 원형평균이 정확한 위상을 복원하는지, 위상이 0/period 경계에 걸친 합성 데이터(바로 위에서 설명한 "산술평균이 틀리는" 경우)로 원형평균이 맞게 나오는지, 비트 4개 미만·로딩 실패 시 0.0 폴백 확인. `midi_to_drumscore()`에 `downbeat_offset_seconds`를 넘겼을 때 그 값만큼 정확히 빠진 틱이 나오는지, 다운비트보다 이른 노트가 틱 0으로 클램프되는지.
2. **song id=9(Pretender)로 재채보해 직접 검증(이번 버그의 실제 재현 사례)**: 새 로직으로 다시 채보한 결과를 이번 조사에서 이미 확보한 librosa 재측정 비트 위치(이 대화에서 쓴 분석 스크립트 재사용)와 비교 — 보정 후 노트들이 그 비트 위치에 훨씬 가깝게(이상적으로는 반올림 오차 수준까지) 맞아떨어지는지 확인. 보정 전(+0.2789초 평균 어긋남)과 보정 후를 **숫자로 나란히** 보고.
3. 프런트 단위 테스트: `audioTrackPositionSeconds`에 4번째 인자(오프셋) 추가 후 기존 테스트(`timing.test.ts`, 오프셋=0 케이스) 전부 그대로 통과하는지(하위호환), 오프셋≠0일 때의 새 케이스 추가(§5가 증명한 "결과가 항상 0 이상" 성질도 `audioStartSeconds>=songStartSeconds`·`t0∈[0,period)` 조합으로 테스트). `validate.ts`의 완화된 검증 범위(경계값 포함) 테스트. §3에서 수정하는 `scorePlayer.ts`·`laneRenderer.ts` 두 곳 다 "오프셋이 있어도 더 이상 더하지 않는지" 회귀 테스트 추가. 위 "현재 아키텍처 재확인"에서 확인한 7개 호출부 전부 네 번째 인자를 실제로 넘기는지 코드 리뷰(Codex 모드A)에서 빠짐없이 확인(편집기 3곳은 세 번째 인자까지 그대로 두고 네 번째만 추가됐는지 특히 확인).
4. **실기기/실브라우저 end-to-end**: `audioOffsetMs≠0`인 새로 채보된 곡으로 실제 재생 — 음원 트랙이 꺼지지 않고 정상 재생되는지, A-B 루프 켜고 재진입마다 오디오가 끊김·중복 없이 올바른 위치로 돌아가는지. 가능하면 T2-11 방식(녹화+교차상관)으로 메트로놈·실제 드럼 소리가 체감상 맞아떨어지는지까지 확인.
   **별도 항목(Codex 모드C 3차 C-002 지적, 필수)**: §5가 건너뛰는 원곡 파일의 처음 `t0`초를 **실제로 직접 들어본다** — 무음/박수·카운트 등 안 들려도 그만인 소리면 문제없다고 결론, 보컬·악기의 실제 음악적 시작(픽업 노트 등)이 그 안에 있으면 "건너뛰기"가 체감상 어색한지까지 확인하고 결과를 그대로 보고(좋든 나쁘든 숨기지 않음) — song id=9는 `t0`가 0.28초로 짧아 이 곡에서는 문제없을 가능성이 높지만, 그걸 "확인됨"으로 적지 않고 실제로 들어본 뒤에만 그렇게 적는다.
5. 편집기(`EditorScreen.tsx`)에서 `audioOffsetMs≠0`인 곡을 열어 음원 트랙 재생·"연습 화면으로" 핸드오프가 기존(오프셋=0)과 동일하게 동작하는지 회귀 확인.

## Codex 모드C 설계 검수 이력
1차(C-001~007) → 2차(C-001 EditorScreen 호출부 미반영, C-004/D-001 선재생 불변식 미증명) → 3차(C-001 등식/부등식 표기 오류, C-002 "건너뛰어도 괜찮다" 근거 없는 단정) → **4차: "진행 가능"(지적 없음)**. 세션 ID는 각 라운드 커밋 로그 참고(`git log --grep=T3-72`). 구현 단계로 진행.

## 가정·한계(숨기지 않음)
- 이번 실측(표준편차 36ms)은 **song id=9 한 곡 기준**이다 — 다른 곡·장르에서 비트 트래킹 자체의 신뢰도가 떨어지면(싱커페이션이 심하거나 비트가 불분명한 곡 등) `t0` 추정도 부정확해질 수 있음. `estimate_tempo()`가 이미 "표본 1곡 기준 경험적 선택"이라고 명시한 것과 같은 성격의 한계.
- `MIN_RESULTANT_LENGTH = 0.5`는 song id=9로 역산해본 값이 아니라 **1차 추정치**(구현 단계에서 실제 수치를 재고 조정) — 너무 낮으면 신뢰 못 할 위상도 통과시키고, 너무 높으면 실제로 유효한 보정까지 0.0으로 버릴 위험이 둘 다 있음.
- `t0 > 0`인 곡은 재생 시작 시 원곡 파일의 맨 앞 0~`t0`초가 항상 건너뛰어진다(§5) — "트랙 위치가 음수가 안 된다"는 수학적으로 증명했지만(§5), **"그 구간을 건너뛰어도 체감상 괜찮다"는 전혀 다른 주장이고 아직 검증 안 됨**(Codex 모드C 3차 C-002 지적, QA 계획 4번에서 실제로 들어보고 확인 예정 — 그 전까지 이 plan.md도 "괜찮다"고 단정하지 않는다).
- 기존에 이미 업로드된 곡은 재채보해야만 이 보정이 적용됨(소급 자동 적용 안 함, 범위 경계 참고).
