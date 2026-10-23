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

## ADTOF-pytorch (드럼 채보, Q-02/T0-2) — 2026-10-23 확인
원본 ADTOF(madmom 의존)는 Windows에서 MSVC Build Tools 또는 WSL 없이 설치 불가(madmom은 PyPI에 소스만 배포, 항상 컴파일 필요 — https://pypi.org/pypi/madmom/json 로 전 버전 확인). 대안으로 순수 PyTorch 포크 사용:
```bash
git clone https://github.com/xavriley/ADTOF-pytorch.git
pip install -e ADTOF-pytorch
adtof --audio <입력.wav> --out <출력.mid> --device cuda
```
- 클래스: GM 피치 `[35,38,47,42,49]` = kick/snare/tom(합산)/hihat(합산)/cymbal(합산) 5-class (`adtof_pytorch/post_processing.py`의 `LABELS_5` 확인)
- ⚠ **라이선스 미표시**: 저장소에 LICENSE 파일 없음, GitHub API `license: null`. 내부 테스트용으로만 사용 중, 실제 서비스(Phase 3 T3-2) 채택 전 재확인 필요 — Q-15 참고
- F-measure 평가: `mir_eval.onset.f_measure(ref, est, window=0.05)` (mir_eval 기본값)

## Tailscale Funnel 플랜 확인 (Q-13)
공식 문서: https://tailscale.com/kb/1223/funnel — "Funnel is available for all plans"(무료 Personal 포함). 베타 단계, MagicDNS·HTTPS 인증서 필요.

## Codex CLI (`/codex:setup` 결과, 2026-10-23)
- 버전: codex-cli 0.163.0, 인증: ChatGPT 로그인(alltimetimo30@gmail.com) 완료
- 세션 런타임: 첫 리뷰/작업 명령 시 자동 시작(direct mode)
- ⚠ `codex exec --sandbox read-only` 등 정확한 플래그는 아직 `codex --help`/`codex exec --help`로 실제 확인 전 — 추측 사용 금지(06-pipeline.md §1 규칙). Phase 1 Codex 검수 도입 시 실제 확인 후 이 파일에 추가할 것.
