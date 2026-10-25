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
# T3-2(REQ-02 경로 A)에서 "audio" 추가 — app/web/src/score/types.ts의
# ScoreSource(`'audio'|'omr'|'midi'|'musicxml'|'gp'`)와 점진적으로 동기화하는
# 중. "omr"은 아직 Phase 4 범위라 안 넣음(과한 선확장 방지, work/T3-2/plan.md §5).
# 이 확장은 PUT /songs/{id}/drumscore(편집 저장)에도 적용됨 — 의도된 전제조건
# (오디오 기반 DrumScore를 기존 편집기로 수정·저장하려면 "audio"가 허용돼야
# 함). POST /songs(디지털 악보 업로드)는 확장자-소스 일치 검사가 별도로 있어
# "audio"가 그 경로로 새어 들어올 수 없음(work/T3-2/plan.md §5 교차 확인).
ScoreSourcePhase2 = Literal["midi", "musicxml", "gp", "audio"]


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
    def audio_offset_must_be_zero(cls, value: float) -> float:
        # Codex 모드A C-001(재현됨): `value in (inf, -inf)`는 NaN을 못 거름
        # (NaN은 어떤 값과도 같지 않아 `in` 비교에 안 걸림) — math.isfinite()는
        # inf·-inf·NaN을 전부 정확히 걸러냄(Python 공식 문서 math.isfinite).
        #
        # T2-8(Codex 모드C 3차 지적, C-001): "유한하기만 하면 통과"였던 이전 검증은
        # 0이 아닌 값을 API로 직접 올리는 경로를 막지 못했다 — scorePlayer.ts가
        # 노트를 A-B 루프 경계 밖으로 밀어낼 수 있는데, 그 상호작용 설계는
        # audioOffsetMs를 실제로 쓰게 될 Phase 3(T3-5, 오디오-MIDI 오프셋 정렬 UI)
        # 전까지 보류(intent/07-open-questions.md Q-23). 그래서 0만 허용.
        if not math.isfinite(value) or value != 0:
            raise ValueError(
                "audioOffsetMs는 0이어야 합니다(Phase 3 오디오-MIDI 정렬 전까지 임시 제한)"
            )
        return value


# T3-4(REQ-05) — 믹서. work/T3-4/plan.md §1에서 정의한 6채널 고정 집합.
MIXER_CHANNEL_KEYS = frozenset(
    {"stem_drums", "stem_bass", "stem_vocals", "stem_other", "synth_drums", "metronome"}
)


class ChannelStateIn(BaseModel):
    volume: float = Field(ge=0, le=1)
    muted: bool
    solo: bool


class PracticeSettingIn(BaseModel):
    """`PUT /songs/{id}/practice-setting` 요청 본문. 채널 키가 정확히
    `MIXER_CHANNEL_KEYS` 6개여야 함(work/T3-4/plan.md §1 — 알 수 없는 키나
    누락된 키는 프런트의 버그일 수 있어 저장 전에 422로 거부)."""

    volumes: dict[str, ChannelStateIn]

    @field_validator("volumes")
    @classmethod
    def channel_keys_must_match_exactly(
        cls, value: dict[str, ChannelStateIn]
    ) -> dict[str, ChannelStateIn]:
        if set(value.keys()) != MIXER_CHANNEL_KEYS:
            raise ValueError(f"volumes의 키는 정확히 {sorted(MIXER_CHANNEL_KEYS)}여야 합니다")
        return value


class PracticeSettingOut(BaseModel):
    """`GET /songs/{id}/practice-setting` 응답. 저장된 게 없으면 `volumes=None`
    — 기본값을 서버가 추측하지 않고 그대로 돌려줌(work/T3-4/plan.md §1)."""

    volumes: dict[str, ChannelStateIn] | None
