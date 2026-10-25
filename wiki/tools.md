> 한 줄 요약: Phase 0에서 검증된 설치·실행 명령 모음. 다음 작업은 이 파일부터 확인하고 추측으로 재검증하지 않는다.

# 검증된 도구/명령 (tools.md)

## PyTorch (CUDA 12.8, Blackwell/RTX 50 지원) — 2026-10-23 확인
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
```
- 확인 환경: Windows, Python 3.12.7, RTX 5060
- 결과: `torch==2.11.0+cu128` 설치, `torch.cuda.get_device_capability(0)` → `(12, 0)`(sm_120) 정상 인식
- 출처: https://download.pytorch.org/whl/cu128/torch/ (cp312-win_amd64 wheel 존재 확인)

## Demucs — 2026-10-23 확인 (Q-08 해소)
```bash
pip install demucs numpy
```
- `facebookresearch/demucs`는 archived(2025-01-01, 읽기 전용). **현재 유지 저장소는 `adefossez/demucs`**(저자 포크). 최신 버전 4.1.0(2026-07-11 릴리스).
- `pip install demucs`로 설치되는 PyPI 패키지가 이 유지 포크를 배포함.
- numpy는 demucs의 자동 의존성에 포함되지 않아(2026-10-23 기준 4.1.0, "lighter inference dependencies" 변경) **별도로 설치해야 함**. 안 하면 `import numpy` 실패.
- CLI: `python -m demucs -n htdemucs -d cuda -o <출력폴더> <입력.wav>` (기본 모델 htdemucs, `-d`로 cuda/mps/cpu 선택)
- 출처: https://github.com/adefossez/demucs , https://pypi.org/project/demucs/

## nvidia-smi로 GPU 여유 메모리 확인
```bash
nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv
```

## Audiveris OMR (T0-3) — 2026-10-23 확인
```bash
"C:\Program Files\Audiveris\Audiveris.exe" -batch -transcribe -export -output <출력폴더> <입력이미지...>
```
- 버전 5.11.0, 설치: 공식 Windows MSI(`Audiveris-5.11.0-windows-x86_64.msi`, GitHub Releases) — **관리자 권한 필요**(일반 사용자 토큰으로 설치 시도 시 Error 1925, 의뢰인이 직접 UAC 동의하고 설치).
- 사진이 회전된 상태로 촬영됐다면 Audiveris가 자동으로 바로 세워주지 않음 — Pillow로 `im.rotate(-90, expand=True)` 등 사전 회전 필요(방향은 실제 사진으로 눈으로 확인 후 결정).
- 출력: 입력 1개 이미지에 여러 곡/악장이 있으면 `<파일명>.mvt1.mxl`, `.mvt2.mxl`...로 분리돼 나옴.
- 한 줄 압축 표기(표준 5선 드럼보표 아님) 악보에서는 `percussion` 클레프 인식률이 낮고(약 40%), 인식돼도 보이스(스템 방향)별 악기 배정이 틀릴 수 있음 — 상세는 `qa-evidence/T0-3/result.md`.
- OCR 텍스트 인식은 `eng` 언어팩 미설치로 비활성 상태(`WARN TesseractOCR: supported languages is empty`) — 노트 인식과 무관, 필요 시 별도 설치.

## ADTOF-pytorch (드럼 채보, Q-02/T0-2) — 2026-10-23 확인, 2026-10-25(T3-2) 실행 방식 갱신
원본 ADTOF(madmom 의존)는 Windows에서 MSVC Build Tools 또는 WSL 없이 설치 불가(madmom은 PyPI에 소스만 배포, 항상 컴파일 필요 — https://pypi.org/pypi/madmom/json 로 전 버전 확인). 대안으로 순수 PyTorch 포크 사용:
```bash
git clone https://github.com/xavriley/ADTOF-pytorch.git
pip install -e ADTOF-pytorch
python -m adtof_pytorch.cli --audio <입력.wav> --out <출력.mid> --device cuda
```
- **`adtof.exe`(pip console-script) 직접 실행은 이 PC에서 Windows 애플리케이션 실행 정책에 막힘**(`OSError: [WinError 4551]`, 2026-10-25 T3-2 실측) — `python -m adtof_pytorch.cli`로 같은 CLI를 모듈로 실행하면 정상 동작(Demucs를 `python -m demucs`로 돌린 것과 같은 이유·해법). 프로덕션 코드(`app/server/modules/transcriber/adtof_transcriber.py`)는 처음부터 이 방식.
- 가중치는 저장소에 번들(`adtof_pytorch/data/adtof_frame_rnn_pytorch_weights.pth`) — 추론 시 네트워크 불필요.
- velocity는 CLI 소스(`cli.py`)에 `velocity=100`으로 하드코딩돼 있음(모델 예측 아님, Q-10 해소).
- 클래스: GM 피치 `[35,38,47,42,49]` = kick/snare/tom(합산)/hihat(합산)/cymbal(합산) 5-class (`adtof_pytorch/post_processing.py`의 `LABELS_5` 확인)
- ⚠ **라이선스 미표시**: 저장소에 LICENSE 파일 없음, GitHub API `license: null`. 내부 테스트용으로만 사용 중, 실제 서비스(Phase 3 T3-2) 채택 전 재확인 필요 — Q-15 참고
- F-measure 평가: `mir_eval.onset.f_measure(ref, est, window=0.05)` (mir_eval 기본값)

## alphaTab Node.js 사용법 (T0-4) — 2026-10-23 확인
```bash
npm install @coderline/alphatab
```
```js
import * as alphaTab from "@coderline/alphatab";
import * as fs from "fs";
const fileData = await fs.promises.readFile(filePath);
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fileData), new alphaTab.Settings());
```
- 출처: https://alphatab.net/docs/guides/nodejs
- 퍼커션 트랙 식별: `staff.isPercussion === true`, `note.isPercussion === true`
- 타악기 종류: `note.percussionArticulation`을 인덱스로 `track.percussionArticulations[idx]` 조회 → `.outputMidiNumber`가 **GM 표준 피치**(kick=36, snare=38, hihat_closed=42 등)로 이미 정규화되어 나옴. 별도 변환 불필요(실제 실행으로 확인, 문서에 없던 내용).

## Tailscale Funnel 플랜 확인 (Q-13)
공식 문서: https://tailscale.com/kb/1223/funnel — "Funnel is available for all plans"(무료 Personal 포함). 베타 단계, MagicDNS·HTTPS 인증서 필요.

## Codex CLI (`/codex:setup` 결과, 2026-10-23)
- 버전: codex-cli 0.163.0, 인증: ChatGPT 로그인(alltimetimo30@gmail.com) 완료
- 세션 런타임: 첫 리뷰/작업 명령 시 자동 시작(direct mode)
- **플래그 확인 완료**(`codex exec --help`, 2026-10-23): `-s, --sandbox <SANDBOX_MODE>` 값은 `read-only|workspace-write|danger-full-access`. 읽기 전용 검수 명령: `codex exec -s read-only -o <결과파일> "<프롬프트>"` (`-o/--output-last-message`로 마지막 응답을 파일로 저장 가능). `-C/--cd <DIR>`로 작업 디렉터리 지정 가능.
- ⚠ 윈도우에서 `read-only` 샌드박스가 실제로 파일 쓰기를 막는지는 아직 실행으로 확인 안 함(06-pipeline.md §1의 확인 항목) — Phase 1 전 재확인 권장.

## ⚠ 프런트(`app/web`) 타입체크 — 올바른 명령은 `tsc -p tsconfig.app.json`, 인자 없는 `npx tsc --noEmit`이 아님 (2026-10-26 발견)
`app/web/tsconfig.json`은 `"files": []`에 `references`(→`tsconfig.app.json`/`tsconfig.node.json`)만 있는 구조 — TypeScript 프로젝트 레퍼런스 패턴. **인자 없이 `npx tsc --noEmit`을 돌리면 루트 설정의 `"files": []`만 보고 사실상 아무 파일도 체크 안 한 채 조용히 성공 종료**(실제 실행으로 확인: `npx tsc --noEmit` vs `npx tsc -p tsconfig.app.json --noEmit`을 나란히 돌려 비교). `package.json`의 `"build": "tsc -b && vite build"`가 쓰는 `tsc -b`(빌드 모드, 레퍼런스를 따라감)가 원래 올바른 방식.

**실제 피해**: 이 세션에서 한동안 `npx tsc --noEmit`(빈 체크)을 "타입체크 통과"로 잘못 보고함 — T3-13 작업 중 `handle` 변수 스코프 버그(try 블록 밖에서 참조)를 못 잡았고, Codex가 `-p tsconfig.app.json`으로 직접 돌려서야 발견(`qa-evidence/T3-13/result.md` 참고). 같은 명령으로 재검사해보니 테스트 파일 4건(`trackPlayer.test.ts` 2건, `EditorScreen.test.tsx`/`filterSongs.test.ts` 각 1건 이상)에 더 오래된(T3-13과 무관한) 타입 오류가 이미 있었음도 함께 드러남 — 프로덕션 코드(`src/` 내 비-테스트 파일)엔 추가 오류 없음, 테스트는 vitest가 타입 체크 없이(esbuild 변환만) 돌아서 런타임 통과엔 영향 없었음. 그 4건은 이번 작업 범위 밖이라 미수정 — `intent/07-open-questions.md` Q-34 참고.

**앞으로 타입체크는 반드시**:
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit
```
(또는 `npm run build`가 쓰는 `npx tsc -b`)
