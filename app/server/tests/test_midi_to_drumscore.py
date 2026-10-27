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
