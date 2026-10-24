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

    drumscore, unmapped = midi_to_drumscore(midi, title="테스트곡")

    assert unmapped == 0
    pieces = [n["piece"] for n in drumscore["notes"]]
    assert pieces == ["kick", "snare", "hihat_closed", "tom_mid", "crash"]


def test_notes_sorted_by_tick_and_velocity_preserved():
    midi = _make_midi([(38, 1.0, 1.1, 90), (35, 0.0, 0.1, 100)])

    drumscore, _ = midi_to_drumscore(midi, title="t")

    assert [n["piece"] for n in drumscore["notes"]] == ["kick", "snare"]
    assert drumscore["notes"][0]["tick"] == 0
    assert drumscore["notes"][0]["velocity"] == 100
    assert drumscore["notes"][1]["velocity"] == 90


def test_unmapped_pitch_is_skipped_and_counted():
    midi = _make_midi([(35, 0.0, 0.1, 100), (60, 0.2, 0.3, 100)])  # 60은 LABELS_5 밖

    drumscore, unmapped = midi_to_drumscore(midi, title="t")

    assert len(drumscore["notes"]) == 1
    assert unmapped == 1


def test_meta_defaults_timesig_4_4_and_bpm_from_tempo_changes():
    midi = _make_midi([(35, 0.0, 0.1, 100)], bpm=140.0)

    drumscore, _ = midi_to_drumscore(midi, title="t")

    assert drumscore["meta"]["timeSignature"] == [4, 4]
    assert drumscore["meta"]["bpm"] == pytest.approx(140.0)
    assert drumscore["meta"]["source"] == "audio"
    assert drumscore["ppq"] == 220
    assert drumscore["audioOffsetMs"] == 0


def test_output_passes_drumscore_in_validation():
    midi = _make_midi([(p, i * 0.25, i * 0.25 + 0.05, 100) for i, p in enumerate(PITCH_TO_PIECE)])

    drumscore, _ = midi_to_drumscore(midi, title="검증용")

    validated = DrumScoreIn.model_validate(drumscore)
    assert validated.meta.source == "audio"
    assert len(validated.notes) == len(PITCH_TO_PIECE)


def test_empty_midi_produces_empty_notes_but_still_valid():
    midi = _make_midi([])

    drumscore, unmapped = midi_to_drumscore(midi, title="빈곡")

    assert drumscore["notes"] == []
    assert unmapped == 0
    DrumScoreIn.model_validate(drumscore)  # 예외 없이 통과해야 함
