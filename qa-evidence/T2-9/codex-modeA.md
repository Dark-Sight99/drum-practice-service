> 한 줄 요약: Codex 모드A(독립 코드 검수) — P2 1건: 하단 모서리 정렬이 모든 도형에 `noteSize/2`를 똑같이 썼는데, `x-ring`(열린 하이햇)은 `half*1.5` 반지름까지 그려져 다른 도형보다 더 아래로 내려가므로 판정 순간이 더 일찍 보임. 도형별 실제 하단 돌출 거리를 계산하는 `shapeBottomExtent()`로 수정.

# T2-9 Codex 모드A 원문 (2026-10-24)

대상: `branch diff against main` (task/T2-9-note-hit-edge, 커밋 8284c5e까지)

## Codex 출력 원문

```
# Codex Review

Target: branch diff against main

The new positioning aligns most note shapes by their lower edge, but does not account for the larger drawn bounds of `x-ring`, causing its apparent hit time to be early.

Review comment:

- [P2] Account for the larger x-ring when aligning notes — app/web/src/render/laneRenderer.ts:212
  When a lane uses the `x-ring` shape, `drawNoteShape` draws its circle with a radius of `size * 0.75`, but this offset moves the nominal center up by only `size / 2`. The ring's lower edge therefore reaches the hit line before the note time, unlike the other shapes; adjust the offset for `x-ring` or make its drawn bounds consistent.
```

## 재현 확인
`drawNoteShape`의 `x-ring` 케이스(열린 하이햇, `LANES`의 `hihat_open`)를 직접 확인 — X자 자체는 `half`(=`size/2`) 범위로 그리지만, 추가로 `ctx.arc(x, y, half * 1.5, ...)`로 더 큰 원을 덧그린다. 처음 수정에선 모든 도형에 `noteSize/2`를 일괄 적용했는데, `x-ring`의 실제 그려지는 범위(`half*1.5` = `size*0.75`)는 그보다 1.5배 더 아래까지 내려가 있어, 수정 의도(하단 모서리=판정선=판정 시각)가 `x-ring`에서만 어긋남을 코드로 확인 — 지적이 맞음.

## 반영
도형 중심에서 실제 그려지는 가장 아래쪽까지의 거리를 돌려주는 `shapeBottomExtent(shape, size)`를 추가 — `drawNoteShape`가 실제로 그리는 범위와 1:1로 대응하는 값(`x`/`diamond`/`circle`=half, `x-large`=half*1.3, `x-ring`=half*1.5, `rounded-rect`=size*0.35, `circle-large`=half*1.2, `bar`=size*0.2). 노트 그리는 위치와 R/L 글자 위치 둘 다 이 함수로 통일해 모든 도형이 똑같이 "하단이 판정선=판정 시각"이 되도록 수정.
