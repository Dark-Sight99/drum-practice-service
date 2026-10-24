# 탐(하이/미드/플로어) 피치 기반 분류 휴리스틱 — 실현 가능성 스파이크.
# 의뢰인 요청(2026-10-24~25, Phase 2 게이트 피드백 중 "탐 자동 분류" 전략 논의에서 파생)
# — ADTOF는 탐을 TT 하나로만 뭉뚱그려 내보낸다(T0-2에서 확인). "하이탐 vs 미드+플로어"
# 2단계만이라도 피치(음높이) 기반 신호처리 휴리스틱으로 가능한지 직접 측정해 확인한다.
#
# 1단계: 우리 재생 샘플 3개(tom_high/mid/floor.wav)의 기본 주파수를 측정해
#        "하이 vs 미드+플로어"가 수치로도 갈리는지 확인.
# 2단계: 실제 곡의 실측 데이터(MDB Drums, 공식 ISMIR 2017 데이터셋 — 이미 T0-2에서
#        ADTOF 벤치마크에 쓴 바로 그 데이터셋)로 검증. MDB Drums의 "subclass" 주석은
#        T0-2가 쓴 "class"(TT 하나로 뭉침)보다 더 세밀해서 HIT(하이탐)/MHT(미드하이탐)/
#        HFT(하이플로어탐)/LFT(로우플로어탐) 4종까지 구분돼 있음 — 이번에 처음 활용.
import numpy as np
import librosa
from pathlib import Path

SR = 22050


def fundamental_pitch(y, sr=SR, fmin=40, fmax=400):
    """자기상관(autocorrelation) 기반 기본 주파수 추정 — 타악기 특유의 공명 음높이를
    잡기 위해 저음역(40~400Hz, 탐이 보통 이 범위)으로 제한."""
    if len(y) < sr * 0.02:
        return None
    # 어택(타격 순간) 이후 공명이 안정되는 구간을 보기 위해 앞부분 10ms는 건너뜀
    skip = int(sr * 0.01)
    y = y[skip: skip + int(sr * 0.15)]
    if len(y) < sr * 0.05:
        return None
    y = y * np.hanning(len(y))
    corr = np.correlate(y, y, mode="full")
    corr = corr[len(corr) // 2:]
    min_lag = int(sr / fmax)
    max_lag = int(sr / fmin)
    if max_lag >= len(corr):
        max_lag = len(corr) - 1
    if min_lag >= max_lag:
        return None
    segment = corr[min_lag:max_lag]
    if len(segment) == 0 or segment.max() <= 0:
        return None
    peak_lag = min_lag + np.argmax(segment)
    return sr / peak_lag


print("===== 1단계: 우리 재생 샘플 3개 피치 측정 =====")
SAMPLES_DIR = Path(r"C:\Users\Jaewoo\드럼연습서비스\app\web\public\audio\drums")
for name in ["tom_high.wav", "tom_mid.wav", "tom_floor.wav"]:
    y, sr = librosa.load(SAMPLES_DIR / name, sr=SR, mono=True)
    pitch = fundamental_pitch(y, sr)
    print(f"  {name}: 추정 기본주파수 = {pitch:.1f} Hz" if pitch else f"  {name}: 추정 실패")
