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
    """
    try:
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm)
        bpm = float(np.asarray(tempo).reshape(-1)[0])
    except Exception:
        return DEFAULT_BPM
    if not np.isfinite(bpm) or bpm <= 0:
        return DEFAULT_BPM
    return float(round(bpm))
