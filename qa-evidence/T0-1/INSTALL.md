> 한 줄 요약: Demucs 분리 벤치마크(T0-1) 실행을 위한 설치 명령. 윈도우(RTX 5060, CUDA)와 맥(M1, MPS/CPU) 공용.

# T0-1 설치 안내

## 공통
- Python 3.10 이상 (이 벤치마크는 Python 3.12.7로 검증)
- 가상환경 권장: `python -m venv .venv`

## 윈도우(NVIDIA GPU, Blackwell/RTX 50 시리즈 포함 — CUDA 12.8+ 빌드 필요)
확인 근거: https://download.pytorch.org/whl/cu128/torch/ 에 cp312/win_amd64용 torch 2.11.0+cu128 wheel 실존 확인(2026-10-23).
```bash
python -m venv .venv
.venv\Scripts\activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install demucs numpy
```
확인 명령(CUDA 인식 여부):
```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
```
RTX 5060에서 실제 출력(2026-10-23): `True NVIDIA GeForce RTX 5060 (12, 0)` → sm_120(Blackwell) 정상 인식.

## 맥(M1, MPS 또는 CPU)
```bash
python -m venv .venv
source .venv/bin/activate
pip install torch torchaudio
pip install demucs numpy
```
MPS 사용 가능 여부 확인:
```bash
python -c "import torch; print(torch.backends.mps.is_available())"
```
⚠ 01-vision.md 땔감 표에 따르면 모델별로 MPS가 CPU보다 느린 사례가 보고되어 있음 — 맥에서는 `--device mps`와 `--device cpu` 둘 다 측정해 비교할 것.

## 벤치마크 실행
```bash
python bench_demucs.py <입력 wav 경로> --device cuda   # 윈도우
python bench_demucs.py <입력 wav 경로> --device mps     # 맥(가능 시)
python bench_demucs.py <입력 wav 경로> --device cpu     # 공용 비교
```
`bench_demucs.py`는 이 폴더(`qa-evidence/T0-1/`)에 있음. 출력은 JSON(처리시간·배속)으로 stdout에 표시.

## Demucs 저장소 확인 (Q-08 해소)
- `facebookresearch/demucs`는 2025-01-01부로 archived(읽기 전용).
- 현재 유지 저장소는 저자(Alexandre Défossez)의 포크 `adefossez/demucs`. 최신 버전 4.1.0(2026-07-11 릴리스).
- 저자가 Meta를 떠나 Kyutai로 이동, 적극적인 신기능 개발은 없다고 README에 명시. 버그 수정·응답은 느릴 수 있음.
- 설치: `pip install demucs` (PyPI 패키지명 동일, 이 포크가 배포).
- 출처: https://github.com/adefossez/demucs , https://pypi.org/project/demucs/ (2026-10-23 확인)
