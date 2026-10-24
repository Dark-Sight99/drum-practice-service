"""업로드로 들어오는 DrumScore JSON의 구조+수치 불변식 검증.

근거: work/T2-5/plan.md §4(Codex 모드C C-002 반영). 브라우저가 T1-5
`validateDrumScore()`로 이미 검증했다는 걸 전제하지 않고, 서버가 핵심
수치 불변식을 다시 검증한다 — 전체 의미 검증(T1-5 validate.ts의 모든
규칙)까지 재구현하지는 않음(§4 "여전히 안 하는 것" 참고).

`app/web/src/audio/timing.ts`의 `secondsPerBeat(bpm) = 60 / bpm`을 비롯해
거의 모든 타이밍 계산이 bpm으로 나누므로, bpm이 0 이하거나 비유한값이면
Infinity/NaN이 레인 낙하 속도·재생 스케줄 전체에 전파된다(실제 수식 확인,
plan.md §4) — 이게 서버가 막아야 할 가장 구체적인 위험이다.

`DrumPiece`·`Hand`·`ScoreSource` 값 목록은 `app/web/src/score/types.ts`와
수동으로 동기화한다(TS 타입을 Python에서 직접 공유할 수 없음, 9종뿐이라
유지 부담은 작다고 판단 — plan.md §4 가정).
"""

import math
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DrumPiece = Literal[
    "kick",
    "snare",
    "hihat_closed",
    "hihat_open",
    "tom_high",
    "tom_mid",
    "tom_floor",
    "crash",
    "ride",
]
Hand = Literal["R", "L", "RF", "LF", None]
HandSource = Literal["auto", "user"]
# Phase 2는 디지털 악보(경로 C)만 다룬다 — audio/omr은 Phase 3/4라 여기선 거부.
ScoreSourcePhase2 = Literal["midi", "musicxml", "gp"]


class DrumNoteIn(BaseModel):
    tick: int = Field(ge=0)
    piece: DrumPiece
    velocity: int = Field(ge=0, le=127)
    hand: Hand = None
    # T2-7(REQ-12) — app/web/src/score/types.ts의 HandSource와 동일 범위.
    # 업로드/저장 둘 다 검증 통과 후 원본 바이트를 그대로 저장하므로(재직렬화
    # 안 함) 이 필드가 없어도 실제로는 통과·보존돼 왔음 — 추가하는 이유는
    # "handSource: 'bogus'" 같은 잘못된 값을 조용히 통과시키던 검증 공백을
    # 메우기 위함이지 저장 동작을 바꾸는 게 아니다(work/T2-7/plan.md §설계 5).
    handSource: HandSource | None = None


class DrumScoreMetaIn(BaseModel):
    title: str
    bpm: float
    timeSignature: tuple[int, int]
    source: ScoreSourcePhase2

    @field_validator("bpm")
    @classmethod
    def bpm_must_be_finite_and_positive(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0:
            raise ValueError("bpm은 유한한 양수여야 합니다")
        return value

    @field_validator("timeSignature")
    @classmethod
    def time_signature_must_be_positive(cls, value: tuple[int, int]) -> tuple[int, int]:
        numerator, denominator = value
        if numerator <= 0 or denominator <= 0:
            raise ValueError("timeSignature는 분자·분모 모두 양의 정수여야 합니다")
        return value


class DrumScoreIn(BaseModel):
    version: Literal[1]
    meta: DrumScoreMetaIn
    notes: list[DrumNoteIn]
    ppq: int = Field(gt=0)
    audioOffsetMs: float

    @field_validator("audioOffsetMs")
    @classmethod
    def audio_offset_must_be_finite(cls, value: float) -> float:
        # Codex 모드A C-001(재현됨): `value in (inf, -inf)`는 NaN을 못 거름
        # (NaN은 어떤 값과도 같지 않아 `in` 비교에 안 걸림) — math.isfinite()는
        # inf·-inf·NaN을 전부 정확히 걸러냄(Python 공식 문서 math.isfinite).
        if not math.isfinite(value):
            raise ValueError("audioOffsetMs는 유한해야 합니다")
        return value
