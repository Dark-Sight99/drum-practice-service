"""오디오에서 템포(BPM)를 추정. 근거: REQ-02, intent/07-open-questions.md Q-40.

ADTOF-pytorch는 온셋 분류 모델일 뿐 템포(비트) 트래킹을 아예 하지 않는다
(소스 확인, Q-40) — `pretty_midi.PrettyMIDI()`가 템포 없이 생성되면
라이브러리 기본값(120)을 그대로 쓰는 바람에, 지금까지 음원 업로드 곡은
전부 실제 템포와 무관하게 `DrumScore.meta.bpm=120`으로 저장돼왔다(의뢰인이
실제 사람이 만든 악보와 비교하다 발견). librosa의 비트 트래커로 드럼
스템에서 직접 템포를 추정해 이 간극을 메운다.
"""

import librosa
import numpy as np

# 템포 추정이 실패하거나(오디오 디코딩 오류 등) 비정상 값을 내면 기존 동작과
# 같은 값으로 안전하게 폴백 — 템포 추정은 보조 메타데이터일 뿐이라, 이게
# 실패했다고 채보 작업 전체를 실패시키면 안 된다(REQ-02 핵심 경로 보호).
DEFAULT_BPM = 120.0

# librosa.beat.beat_track()의 자체 기본값(start_bpm=120.0)은 "온셋 기반 비트
# 트래킹의 옥타브 모호성"(실제 박자의 2배·4/3배 등 음악적으로 그럴듯한 다른
# 배수를 고르는 흔한 오류, MIR 분야에서 잘 알려진 문제) 때문에 테스트 곡
# (Pretender, 사람이 만든 악보 기준 92bpm)에서 123.05bpm(≈92×4/3)으로
# 수렴해버렸다 — 같은 입력에 start_bpm만 80~100 사이로 낮춰 다시 돌리면
# 92.29bpm으로 정확히 수렴함을 직접 실행해 확인(qa-evidence/T3-42 참고).
# 100을 기본값으로 둔 건 "일반적으로 연습 대상이 되는 대중가요 템포대"에서
# 더 안전한 쪽(옥타브 모호성이 있을 때 더 느린 쪽으로 수렴하는 경향)을
# 고른 것 — 표본 1곡 기준 경험적 선택이라 다른 곡에선 안 맞을 수 있다
# (Q-40에 그대로 기록, 이 추정 자체가 "항상 정답"이라는 뜻이 아님).
DEFAULT_START_BPM = 100.0


MIN_RESULTANT_LENGTH = 0.5
"""원형평균(아래 estimate_downbeat_offset_seconds)의 신뢰도 임계값. 0=완전히
흩어짐, 1=모든 비트가 정확히 같은 위상. song id=9(Pretender) 표본 1곡
기준 1차 추정치(work/T3-72/plan.md §2) — DEFAULT_START_BPM과 같은 성격의
경험적 선택."""


def estimate_tempo(audio_path, start_bpm: float = DEFAULT_START_BPM) -> float:
    """`audio_path`(드럼 스템 권장 — 리듬이 가장 또렷함)에서 템포(BPM)를
    추정한다. 실패하거나(디코딩 오류 등) 비정상 결과(0 이하·NaN·Inf)면
    `DEFAULT_BPM`(기존 "템포 추정 없음" 동작과 같은 값)으로 안전하게
    돌아간다.

    2026-10-27(의뢰인 발견, Q-40 추가) — `librosa.beat.beat_track()`은
    연속값(예: 92.28515625)을 돌려주는데, 실제 악보·메트로놈 표기는 항상
    정수다(의뢰인 지적: "메트로놈도 소수점은 없어요" — 맞는 말이고, 추정이
    딱 정수로 안 맞는 건 비트 트래킹 알고리즘의 정밀도 한계일 뿐 실제
    음악적 의미가 있는 소수점이 아니다). 그래서 반환 직전에 정수로
    반올림한다 — 어차피 ±1~2bpm 수준의 추정 오차가 있는 값이라, 소수점을
    보여주는 게 오히려 "정확도가 그만큼 있다"는 잘못된 인상을 준다.

    2026-10-27(Codex 모드A 지적, T3-44) — 반올림은 유한·양수 검사 **뒤에**
    하므로, 0보다 크지만 0.5 미만인 유효한 추정값(예: 0.4)이 반올림 후
    0.0이 되어 "비정상 값은 DEFAULT_BPM으로 폴백한다"는 이 함수의 약속을
    깨고 그대로 반환될 수 있었음 — 반올림한 값도 다시 검사해 막는다.
    """
    try:
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm)
        bpm = float(np.asarray(tempo).reshape(-1)[0])
    except Exception:
        return DEFAULT_BPM
    if not np.isfinite(bpm) or bpm <= 0:
        return DEFAULT_BPM
    rounded_bpm = float(round(bpm))
    if rounded_bpm <= 0:
        return DEFAULT_BPM
    return rounded_bpm


def estimate_downbeat_offset_seconds(
    audio_path, bpm: float, start_bpm: float = DEFAULT_START_BPM
) -> float:
    """`audio_path`(드럼 스템)에서 다운비트(진짜 1박) 위상을 추정한다.

    T3-72(REQ-02, intent/07-open-questions.md Q-43) — 지금까지 틱 계산은
    "오디오 파일 시작 = 1박"으로만 가정했는데, 실측(song id=9, Pretender)
    결과 실제 다운비트가 평균 0.2789초(표준편차 0.0356초) 늦게 와서 전체
    곡이 일정하게 밀려 보였다. `estimate_tempo()`가 이미 부르는
    `librosa.beat.beat_track()`이 같이 돌려주는 비트 위치(지금까지는
    버려지던 값)를 원형평균(circular mean)으로 모아 "우리 격자(틱0=오디오
    0초)가 실제 비트와 몇 초 어긋나 있는지"를 구한다.

    원형평균을 쓰는 이유: 위상이 한 박 길이(`period`) 경계(0초 근처/period
    근처)에 걸쳐 흩어져 있으면 단순 평균·중앙값은 양 끝을 서로 반대로
    당겨 틀린 값을 낸다 — 반드시 원형 통계로 구해야 모든 경우에 안전하다
    (work/T3-72/plan.md §2).

    `estimate_tempo()`와 별도로 `beat_track()`을 한 번 더 호출한다(의도적
    중복 — `estimate_tempo()`는 Q-40에서 이미 승인된 코드라 시그니처를
    바꾸지 않음, plan.md §2 "의도적으로 중복 호출 감수" 참고).

    실패하거나(디코딩 오류 등) 비정상·저신뢰 결과(음수, 한 박 길이 이상,
    원형평균 신뢰도가 `MIN_RESULTANT_LENGTH` 미만, 비트 4개 미만)면
    0.0(기존 "보정 없음" 동작과 동일)으로 안전하게 돌아간다 — `bpm`이
    `estimate_tempo()`처럼 이미 유효성이 보장된 값이라고 가정하지 않고,
    0 이하·비유한이면 이 함수도 바로 0.0으로 폴백한다(한 박 길이를
    `60/bpm`으로 나눠야 해서 0 나눗셈을 막아야 함).
    """
    if not np.isfinite(bpm) or bpm <= 0:
        return 0.0
    period = 60.0 / bpm
    try:
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        _, beat_frames = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm, units="frames")
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    except Exception:
        return 0.0
    if len(beat_times) < 4:  # 신뢰할 통계를 내기엔 너무 적음
        return 0.0
    theta = (beat_times % period) / period * 2 * np.pi
    mean_sin = float(np.mean(np.sin(theta)))
    mean_cos = float(np.mean(np.cos(theta)))
    # 위상이 원 위에 고르게 흩어져 있으면(비트 트래킹 자체가 신뢰할 수
    # 없는 곡 등) mean_sin·mean_cos가 둘 다 0에 가까워져 atan2 결과가
    # 수치 잡음에 좌우된다 — "합성 벡터 길이"가 너무 작으면 추정 자체를
    # 신뢰하지 않는다.
    resultant_length = float(np.hypot(mean_sin, mean_cos))
    if resultant_length < MIN_RESULTANT_LENGTH:
        return 0.0
    t0 = (np.arctan2(mean_sin, mean_cos) / (2 * np.pi)) * period
    if t0 < 0:
        t0 += period
    if not np.isfinite(t0) or t0 < 0 or t0 >= period:
        return 0.0
    return float(t0)
