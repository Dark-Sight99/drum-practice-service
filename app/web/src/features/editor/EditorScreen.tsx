import { useMemo, useRef, useState } from 'react'
import type { DrumNote, DrumPiece, DrumScore, Hand } from '../../score/types'
import { alternateHandsByTick, recommendSticking, validateDrumScore } from '../../score'
import { saveSongDrumScore, type SongSummary } from '../../api/songs'
import { ApiError } from '../../api/client'
import { barIndexForTick, ticksPerBar } from '../../audio'
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type EditHistory,
} from './editHistory'
import { EDITOR_ROWS, editorRowIndexForPiece, snapTick, ticksPerGridUnit, type GridUnit } from './grid'
import { VELOCITY_TIERS, velocityTierOf, type VelocityTier } from './velocity'

const HAND_LABEL: Record<Exclude<Hand, null>, string> = { R: '오른손', L: '왼손', RF: '오른발', LF: '왼발' }

export interface EditorScreenProps {
  song: SongSummary
  initialScore: DrumScore
  onSaved: () => void
  onCancel: () => void
}

interface EditableNote extends DrumNote {
  _editorId: number
}

interface EditorState {
  version: 1
  meta: DrumScore['meta']
  ppq: number
  audioOffsetMs: number
  notes: EditableNote[]
}

function toEditorState(score: DrumScore): EditorState {
  return {
    version: 1,
    meta: { ...score.meta },
    ppq: score.ppq,
    audioOffsetMs: score.audioOffsetMs,
    notes: score.notes.map((note, i) => ({ ...note, _editorId: i })),
  }
}

function toDrumScore(state: EditorState): DrumScore {
  return {
    version: 1,
    meta: state.meta,
    ppq: state.ppq,
    audioOffsetMs: state.audioOffsetMs,
    notes: state.notes.map(({ _editorId: _unused, ...note }) => note),
  }
}

function readPieceColor(piece: DrumPiece): string {
  const varName =
    piece === 'hihat_closed' || piece === 'hihat_open'
      ? '--piece-hihat'
      : piece === 'tom_high'
        ? '--piece-tom1'
        : piece === 'tom_mid'
          ? '--piece-tom2'
          : piece === 'tom_floor'
            ? '--piece-floortom'
            : `--piece-${piece}`
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#fff'
}

const PX_PER_GRID_UNIT = 24
const ROW_HEIGHT = 36
const NOTE_SIZE = 16
// 그리드가 가로로 스크롤돼도 행 레이블(HH/SN/KK 등)이 항상 보여야 한다 — 악보를
// 못 읽는 사용자가 의지하는 유일한 행 식별 수단이라, 스크롤로 사라지면 어느 행을
// 편집 중인지 알 수 없게 된다(수동 QA 중 발견: 레이블이 음표와 같은 스크롤 영역에
// absolute로 떠 있어 오른쪽으로 스크롤하면 전부 사라졌었음). 레이블 전용 고정
// 거터를 따로 두고 음표 타임라인은 그 오른쪽부터 시작하게 분리한다.
const ROW_LABEL_WIDTH = 64

export function EditorScreen({ song, initialScore, onSaved, onCancel }: EditorScreenProps) {
  const [history, setHistory] = useState<EditHistory<EditorState>>(() =>
    createHistory(toEditorState(initialScore)),
  )
  const [gridUnit, setGridUnit] = useState<GridUnit>('8n')
  // REQ-12 "여러 노트 선택 후 RLRL/LRLR 교대 일괄 적용" — 단일 선택(이동·셈여림·
  // 삭제·손 1개 지정용)은 size===1일 때만 의미를 갖고, 다중 선택(size>=2)은
  // 교대 일괄 적용에만 쓴다(work/T2-7/plan.md §설계 2, 범위 확장 안 함).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [startHand, setStartHand] = useState<'R' | 'L'>('R')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const nextIdRef = useRef(initialScore.notes.length)

  const state = history.present
  const { meta, ppq } = state

  function commit(next: EditorState) {
    setHistory((h) => pushHistory(h, next))
  }

  const totalBars = useMemo(() => {
    const lastTick = Math.max(0, ...state.notes.map((n) => n.tick))
    return barIndexForTick(lastTick, meta.timeSignature, ppq) + 1 + 2 // 여유 2마디
  }, [state.notes, meta.timeSignature, ppq])

  const unitTicks = ticksPerGridUnit(gridUnit, ppq)
  const barTicks = ticksPerBar(meta.timeSignature, ppq)
  const totalTicks = totalBars * barTicks
  const gridWidthPx = ROW_LABEL_WIDTH + (totalTicks / unitTicks) * PX_PER_GRID_UNIT

  function tickToPx(tick: number): number {
    return ROW_LABEL_WIDTH + (tick / unitTicks) * PX_PER_GRID_UNIT
  }

  function pxToSnappedTick(px: number): number {
    return Math.max(
      0,
      snapTick(Math.round(((px - ROW_LABEL_WIDTH) / PX_PER_GRID_UNIT) * unitTicks), gridUnit, ppq),
    )
  }

  function handleRowClick(e: React.MouseEvent<HTMLDivElement>, piece: DrumPiece) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relativeX = e.clientX - rect.left + e.currentTarget.scrollLeft
    if (relativeX < ROW_LABEL_WIDTH) return // 고정 레이블 거터 클릭은 무시
    const tick = pxToSnappedTick(relativeX)
    const id = nextIdRef.current++
    const newNote: EditableNote = {
      _editorId: id,
      tick,
      piece,
      velocity: VELOCITY_TIERS.mid,
      hand: null,
    }
    commit({ ...state, notes: [...state.notes, newNote] })
    setSelectedIds(new Set([id]))
  }

  function handleNoteClick(e: React.MouseEvent, editorId: number) {
    e.stopPropagation()
    const isToggle = e.ctrlKey || e.metaKey
    if (!isToggle) {
      setSelectedIds(new Set([editorId]))
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(editorId)) next.delete(editorId)
      else next.add(editorId)
      return next
    })
  }

  const selectedNote =
    selectedIds.size === 1 ? (state.notes.find((n) => selectedIds.has(n._editorId)) ?? null) : null
  const selectedMulti = useMemo(
    () =>
      selectedIds.size >= 2
        ? state.notes.filter((n) => selectedIds.has(n._editorId)).sort((a, b) => a.tick - b.tick)
        : [],
    [selectedIds, state.notes],
  )

  function updateSelectedNote(patch: Partial<DrumNote>) {
    if (selectedNote === null) return
    commit({
      ...state,
      notes: state.notes.map((n) =>
        n._editorId === selectedNote._editorId ? { ...n, ...patch } : n,
      ),
    })
  }

  function deleteSelectedNote() {
    if (selectedNote === null) return
    commit({ ...state, notes: state.notes.filter((n) => n._editorId !== selectedNote._editorId) })
    setSelectedIds(new Set())
  }

  function setSelectedHand(hand: Hand) {
    updateSelectedNote({ hand, handSource: hand === null ? undefined : 'user' })
  }

  function applyAlternateHands(batchStartHand: 'R' | 'L') {
    if (selectedMulti.length < 2) return
    const updated = alternateHandsByTick(selectedMulti, batchStartHand)
    const byId = new Map(updated.map((n, i) => [selectedMulti[i]._editorId, n]))
    commit({
      ...state,
      notes: state.notes.map((n) => {
        const replacement = byId.get(n._editorId)
        return replacement ? { ...n, hand: replacement.hand, handSource: replacement.handSource } : n
      }),
    })
  }

  function applyAutoRecommend() {
    const recommended = recommendSticking(state.notes, ppq, startHand)
    commit({
      ...state,
      notes: state.notes.map((n, i) => ({
        ...n,
        hand: recommended[i].hand,
        handSource: recommended[i].handSource,
      })),
    })
  }

  function moveSelected(deltaTicks: number, deltaRows: number) {
    if (selectedNote === null) return
    // ppq가 격자 분할 수로 나누어떨어지지 않으면 unitTicks 자체가 정수가 아닐 수
    // 있어(Codex 모드A 지적, grid.ts의 snapTick 주석 참고) 더한 뒤 다시 격자에
    // 스냅해 항상 정수·격자정렬 틱을 보장한다.
    const nextTick = snapTick(Math.max(0, selectedNote.tick + deltaTicks), gridUnit, ppq)
    const rowIdx = editorRowIndexForPiece(selectedNote.piece)
    const nextRowIdx = Math.min(EDITOR_ROWS.length - 1, Math.max(0, rowIdx + deltaRows))
    updateSelectedNote({ tick: nextTick, piece: EDITOR_ROWS[nextRowIdx].piece })
  }

  function setSelectedVelocityTier(tier: VelocityTier) {
    updateSelectedNote({ velocity: VELOCITY_TIERS[tier] })
  }

  // Codex 모드C C-004: 그리드 컨테이너 자체(tabIndex=0)에만 바인딩 — 이벤트가
  // 여기까지 올라왔다는 건 포커스가 BPM/박자표 입력창 등 바깥 요소가 아니라
  // 그리드 안에 있다는 뜻이라, 별도의 "input이면 무시" 분기 없이도 바깥 요소의
  // 키보드 동작(타이핑, 버튼 Enter/Space)을 건드리지 않는다.
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (selectedNote === null) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveSelected(-unitTicks, 0)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveSelected(unitTicks, 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelected(0, -1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelected(0, 1)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelectedNote()
    } else if (e.key === '1') {
      setSelectedVelocityTier('soft')
    } else if (e.key === '2') {
      setSelectedVelocityTier('mid')
    } else if (e.key === '3') {
      setSelectedVelocityTier('strong')
    }
  }

  async function handleSave() {
    const score = toDrumScore(state)
    const validation = validateDrumScore(score)
    if (!validation.valid) {
      setSaveError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
      return
    }
    setSaveError(null)
    setIsSaving(true)
    try {
      await saveSongDrumScore(song.id, score)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '저장에 실패했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <button onClick={onCancel}>← 라이브러리</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          BPM
          <input
            type="number"
            min={1}
            value={meta.bpm}
            onChange={(e) => commit({ ...state, meta: { ...meta, bpm: Number(e.target.value) } })}
            style={{ width: 64 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          박자표
          <input
            type="number"
            min={1}
            value={meta.timeSignature[0]}
            onChange={(e) =>
              commit({
                ...state,
                meta: {
                  ...meta,
                  timeSignature: [Number(e.target.value), meta.timeSignature[1]],
                },
              })
            }
            style={{ width: 48 }}
          />
          /
          <input
            type="number"
            min={1}
            value={meta.timeSignature[1]}
            onChange={(e) =>
              commit({
                ...state,
                meta: {
                  ...meta,
                  timeSignature: [meta.timeSignature[0], Number(e.target.value)],
                },
              })
            }
            style={{ width: 48 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          격자
          <select value={gridUnit} onChange={(e) => setGridUnit(e.target.value as GridUnit)}>
            <option value="4n">4분</option>
            <option value="8n">8분</option>
            <option value="16n">16분</option>
            <option value="8nt">셋잇단(8분)</option>
          </select>
        </label>
        <button onClick={() => setHistory((h) => undo(h))} disabled={!canUndo(history)}>
          실행취소
        </button>
        <button onClick={() => setHistory((h) => redo(h))} disabled={!canRedo(history)}>
          다시실행
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          필인 시작손
          <select value={startHand} onChange={(e) => setStartHand(e.target.value as 'R' | 'L')}>
            <option value="R">오른손</option>
            <option value="L">왼손</option>
          </select>
        </label>
        <button onClick={applyAutoRecommend}>자동 추천 재적용</button>
        <button onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? '저장 중…' : '저장'}
        </button>
      </div>

      {selectedNote && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span>
            선택됨: {EDITOR_ROWS[editorRowIndexForPiece(selectedNote.piece)]?.label} · 틱{' '}
            {selectedNote.tick} · 셈여림 {velocityTierOf(selectedNote.velocity)} · 손:{' '}
            {selectedNote.hand
              ? `${HAND_LABEL[selectedNote.hand]}${selectedNote.handSource === 'user' ? '(지정)' : '(추천)'}`
              : '미지정'}
          </span>
          <button onClick={() => setSelectedVelocityTier('soft')}>약</button>
          <button onClick={() => setSelectedVelocityTier('mid')}>중</button>
          <button onClick={() => setSelectedVelocityTier('strong')}>강</button>
          <button onClick={() => setSelectedHand('R')}>R</button>
          <button onClick={() => setSelectedHand('L')}>L</button>
          <button onClick={() => setSelectedHand('RF')}>RF</button>
          <button onClick={() => setSelectedHand('LF')}>LF</button>
          <button onClick={() => setSelectedHand(null)}>손 지우기</button>
          <button onClick={deleteSelectedNote}>삭제</button>
        </div>
      )}

      {selectedMulti.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>선택: {selectedMulti.length}개 노트</span>
          <button onClick={() => applyAlternateHands('R')}>RLRL 교대</button>
          <button onClick={() => applyAlternateHands('L')}>LRLR 교대</button>
        </div>
      )}

      {saveError && <p style={{ color: 'var(--danger)' }}>{saveError}</p>}

      <div
        role="application"
        aria-label="드럼 편집 그리드"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        style={{
          overflowX: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-control)',
        }}
      >
        {EDITOR_ROWS.map((row) => (
          <div
            key={row.piece}
            data-testid={`editor-row-${row.piece}`}
            onClick={(e) => handleRowClick(e, row.piece)}
            style={{
              position: 'relative',
              height: ROW_HEIGHT,
              width: gridWidthPx,
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                position: 'sticky',
                left: 0,
                display: 'inline-block',
                width: ROW_LABEL_WIDTH,
                height: ROW_HEIGHT,
                lineHeight: `${ROW_HEIGHT}px`,
                paddingLeft: 4,
                background: 'var(--surface)',
                color: 'var(--text-muted)',
                fontSize: '0.8em',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              {row.label}
            </span>
            {state.notes
              .filter((n) => n.piece === row.piece)
              .map((note) => {
                const isSelected = selectedIds.has(note._editorId)
                return (
                  <button
                    key={note._editorId}
                    aria-label={`${row.label} 노트, 틱 ${note.tick}${note.hand ? ` ${HAND_LABEL[note.hand]}${note.handSource === 'user' ? '(지정)' : '(추천)'}` : ''}${isSelected ? ' (선택됨)' : ''}`}
                    onClick={(e) => handleNoteClick(e, note._editorId)}
                    style={{
                      position: 'absolute',
                      left: tickToPx(note.tick) - NOTE_SIZE / 2,
                      top: (ROW_HEIGHT - NOTE_SIZE) / 2,
                      width: NOTE_SIZE,
                      height: NOTE_SIZE,
                      borderRadius: '50%',
                      border: isSelected ? '2px solid var(--warning)' : '1px solid var(--border)',
                      background: readPieceColor(note.piece),
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {note.hand && (
                      <span
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: -12,
                          transform: 'translateX(-50%)',
                          fontSize: '0.6em',
                          color: 'var(--text)',
                          opacity: note.handSource === 'user' ? 1 : 0.5,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {note.hand}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}
