// 스네어 백비트 위치가 마디마다 조금씩 밀리는 현상의 원인 조사(T2-13, Phase 2 게이트
// 6차 피드백) — 원본 MIDI를 우리 앱의 import 경로와 똑같은 라이브러리(@tonejs/midi)로
// 직접 파싱해, 템포 맵이 여러 개인데 import가 첫 번째 값만 읽어서 버리는 건 아닌지 확인.
// 실행 위치: app/web/ (node_modules 해석을 위해 이 디렉터리에서 실행해야 함)
//   node ../../qa-evidence/T2-13/check_tempo.mjs ../../data/songs/2/original.mid
import { readFileSync } from 'node:fs'
import pkg from '@tonejs/midi'
const { Midi } = pkg

const bytes = readFileSync(process.argv[2])
const midi = new Midi(bytes)

console.log('tempos.length', midi.header.tempos.length)
for (const t of midi.header.tempos) {
  console.log('  tempo', JSON.stringify(t))
}
console.log('timeSignatures', JSON.stringify(midi.header.timeSignatures))

for (const track of midi.tracks) {
  if (!track.instrument.percussion) continue
  const snareNotes = track.notes.filter((n) => n.midi === 38 || n.midi === 40)
  console.log('snare note count', snareNotes.length)
  for (const n of snareNotes) {
    console.log('  midi=' + n.midi, 'ticks=' + n.ticks, 'time=' + n.time.toFixed(4) + 's')
  }
}
