"""T3-2 ADTOF(5-class) MIDI -> DrumScore 변환. 근거: REQ-02, work/T3-2/plan.md §2."""

import pretty_midi
import pytest

from api.schemas import DrumScoreIn
from modules.transcriber.midi_to_drumscore import PITCH_TO_PIECE, midi_to_drumscore


def _make_midi(notes: list[tuple[int, float, float, int]], ppq: int = 220, bpm: float = 120.0):
    """notes: (pitch, start, end, velocity) 목록."""
    midi = pretty_midi.PrettyMIDI(resolution=ppq, initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=1, is_drum=True)
    for pitch, start, end, velocity in notes:
        inst.notes.append(pretty_midi.Note(velocity=velocity, pitch=pitch, start=start, end=end))
    midi.instruments.append(inst)
    return midi


def test_maps_all_five_adtof_classes_to_expected_pieces():
    """Q-41(T3-44에서 되돌림) — GM 표준 관례대로 매핑한다: GM42=하이햇,
    GM47=탐. (T3-43에서 한 번 "벤더 채널 순서 버그"라는 가설로 42/47을
    스왑했었지만, T3-44의 스펙트럼 분석으로 그 가설이 틀렸음을 확인하고
    되돌렸다 — 모듈 docstring 참고.)"""
    pitches = [35, 38, 42, 47, 49]
    midi = _make_midi([(p, i * 0.5, i * 0.5 + 0.1, 100) for i, p in enumerate(pitches)])

    drumscore, unmapped = midi_to_drumscore(midi, title="테스트곡", bpm=120.0)

    assert unmapped == 0
    pieces = [n["piece"] for n in drumscore["notes"]]
    assert pieces == ["kick", "snare", "hihat_closed", "tom_mid", "crash"]


def test_notes_sorted_by_tick_and_velocity_preserved():
    midi = _make_midi([(38, 1.0, 1.1, 90), (35, 0.0, 0.1, 100)])

    drumscore, _ = midi_to_drumscore(midi, title="t", bpm=120.0)

    assert [n["piece"] for n in drumscore["notes"]] == ["kick", "snare"]
    assert drumscore["notes"][0]["tick"] == 0
    assert drumscore["notes"][0]["velocity"] == 100
    assert drumscore["notes"][1]["velocity"] == 90


def test_unmapped_pitch_is_skipped_and_counted():
    midi = _make_midi([(35, 0.0, 0.1, 100), (60, 0.2, 0.3, 100)])  # 60은 LABELS_5 밖

    drumscore, unmapped = midi_to_drumscore(midi, title="t", bpm=120.0)

    assert len(drumscore["notes"]) == 1
    assert unmapped == 1


def test_meta_bpm_is_whatever_caller_passes():
    midi = _make_midi([(35, 0.0, 0.1, 100)])

    drumscore, _ = midi_to_drumscore(midi, title="t", bpm=140.0)

    assert drumscore["meta"]["timeSignature"] == [4, 4]
    assert drumscore["meta"]["bpm"] == pytest.approx(140.0)
    assert drumscore["meta"]["source"] == "audio"
    assert drumscore["ppq"] == 220
    assert drumscore["audioOffsetMs"] == 0


def test_tick_uses_passed_bpm_not_midis_internal_tempo():
    """Q-40(의뢰인 발견) 핵심 회귀 테스트 — ADTOF 출력 MIDI는 항상
    pretty_midi 기본 템포(120)로 고정돼 있는데(온셋 분류 모델이라 템포를
    전혀 추정 안 함), 이 함수가 받는 `bpm`은 그와 다른 실제 추정값일 수
    있다. `note.start`(초, 템포 맵과 무관하게 항상 정확)를 `midi`의 내부
    템포(120)가 아니라 **호출자가 넘긴 bpm**으로 직접 환산해야 한다 —
    안 그러면 저장되는 틱이 어긋나 재생 시 소리 타이밍이 밀린다."""
    # MIDI 내부 템포는 120(ADTOF 출력과 동일한 상황을 흉내)이지만, 이
    # 함수에는 다른 값(92, 실제 추정 템포라고 가정)을 넘긴다.
    midi = _make_midi([(35, 1.0, 1.1, 100)], bpm=120.0)

    drumscore, _ = midi_to_drumscore(midi, title="t", bpm=92.0)

    # 1.0초 지점의 노트는 92bpm·ppq=220 기준으로 1.0 * 92/60 * 220 ≈ 337.3틱.
    # (120bpm을 그대로 썼다면 440틱이 나왔을 것 — 그 값이 아님을 확인.)
    assert drumscore["notes"][0]["tick"] == pytest.approx(337, abs=1)
    assert drumscore["notes"][0]["tick"] != 440


def test_output_passes_drumscore_in_validation():
    midi = _make_midi([(p, i * 0.25, i * 0.25 + 0.05, 100) for i, p in enumerate(PITCH_TO_PIECE)])

    drumscore, _ = midi_to_drumscore(midi, title="검증용", bpm=120.0)

    validated = DrumScoreIn.model_validate(drumscore)
    assert validated.meta.source == "audio"
    assert len(validated.notes) == len(PITCH_TO_PIECE)


def test_empty_midi_produces_empty_notes_but_still_valid():
    midi = _make_midi([])

    drumscore, unmapped = midi_to_drumscore(midi, title="빈곡", bpm=120.0)

    assert drumscore["notes"] == []
    assert unmapped == 0
    DrumScoreIn.model_validate(drumscore)  # 예외 없이 통과해야 함


# T3-72(REQ-02, intent/07-open-questions.md Q-43) — 다운비트 자동 보정.


def test_downbeat_offset_reanchors_tick_zero():
    """다운비트(틱 0)가 실제 오디오 파일의 `downbeat_offset_seconds`초
    지점이라고 보정하면, 그 지점에 정확히 있는 노트의 틱이 0이 돼야 한다
    (work/T3-72/plan.md §1 핵심 결정)."""
    midi = _make_midi([(35, 0.28, 0.38, 100)])  # 0.28초 지점의 킥

    drumscore = midi_to_drumscore(
        midi, title="t", bpm=92.0, downbeat_offset_seconds=0.28
    )[0]

    assert drumscore["notes"][0]["tick"] == 0


def test_downbeat_offset_shifts_all_ticks_by_the_same_amount():
    """다운비트 보정 전/후 결과를 나란히 비교 — 모든 노트가 똑같은 양만큼
    (초 단위로) 당겨져야 한다(이번 버그의 실제 증상이었던 song id=9 실측,
    평균 0.2789초와 같은 성격)."""
    notes = [(35, 0.5, 0.6, 100), (38, 1.0, 1.1, 90), (42, 1.5, 1.6, 100)]
    midi_unshifted = _make_midi(notes)
    midi_shifted = _make_midi(notes)
    offset = 0.2789

    before = midi_to_drumscore(midi_unshifted, title="t", bpm=92.0)[0]
    after = midi_to_drumscore(
        midi_shifted, title="t", bpm=92.0, downbeat_offset_seconds=offset
    )[0]

    ppq = before["ppq"]
    expected_tick_delta = round(offset * 92.0 / 60 * ppq)
    for note_before, note_after in zip(before["notes"], after["notes"], strict=True):
        assert note_before["tick"] - note_after["tick"] == pytest.approx(
            expected_tick_delta, abs=1
        )


def test_notes_before_downbeat_are_clamped_to_tick_zero():
    """다운비트보다 이른(카운트인성) 타격은 음수 틱이 아니라 0으로
    클램프돼야 한다 — `DrumScoreIn`이 음수 틱을 거부하므로(`api/schemas.py`),
    여기서 막지 않으면 멀쩡한 채보가 저장 단계에서 통째로 실패한다."""
    midi = _make_midi([(35, 0.1, 0.2, 100)])  # 다운비트(0.28초)보다 이름

    drumscore = midi_to_drumscore(
        midi, title="t", bpm=92.0, downbeat_offset_seconds=0.28
    )[0]

    assert drumscore["notes"][0]["tick"] == 0
    DrumScoreIn.model_validate(drumscore)  # 클램프 덕분에 검증도 통과해야 함


def test_audio_offset_ms_stores_the_downbeat_offset_in_milliseconds():
    """`audioOffsetMs`는 더 이상 0 고정이 아니라 다운비트 오프셋(ms)을
    그대로 담는다 — 음원 트랙 재생 위치 계산에만 쓰임(노트 틱 자체는
    이미 보정됐으므로)."""
    midi = _make_midi([(35, 0.5, 0.6, 100)])

    drumscore = midi_to_drumscore(
        midi, title="t", bpm=92.0, downbeat_offset_seconds=0.2789
    )[0]

    assert drumscore["audioOffsetMs"] == pytest.approx(278.9, abs=0.5)


def test_downbeat_offset_default_zero_matches_old_behavior():
    """`downbeat_offset_seconds`를 안 넘기면(기본값 0.0) 기존 동작과
    완전히 동일해야 한다 — 하위호환 회귀 테스트."""
    midi = _make_midi([(35, 0.5, 0.6, 100)])

    drumscore = midi_to_drumscore(midi, title="t", bpm=92.0)[0]

    assert drumscore["audioOffsetMs"] == 0
