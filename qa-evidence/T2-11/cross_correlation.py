# Codex 모드B 2차 지적 반영 — 기존 버전은 전체 배열 기준으로 한 번 정규화한 뒤
# 겹침 구간의 내적을 구간 길이로만 나눴다(진짜 피어슨 상관계수가 아님, 합성 테스트에서
# corr=1.07처럼 1을 넘는 값이 나온 것 자체가 이 문제의 증거). 이번 버전은 lag마다
# "겹치는 구간 그 자체의" 평균·표준편차로 다시 정규화해 구간별 피어슨 상관계수를
# 계산한다 — corr은 항상 [-1, 1] 범위.
import numpy as np

v = np.load("visual.npy")
a = np.load("audio_env.npy")
n = min(len(v), len(a))
v = v[:n]
a = a[:n]


def pearson(x, y):
    x = x - x.mean()
    y = y - y.mean()
    sx = x.std()
    sy = y.std()
    if sx == 0 or sy == 0:
        return 0.0
    return float(np.dot(x, y) / (len(x) * sx * sy))


def best_lag_for(v_arr, a_arr, lo=-20, hi=20, min_overlap=10):
    best_lag, best_corr = None, -1e9
    rows = []
    for lag in range(lo, hi + 1):
        if lag >= 0:
            vv = v_arr[lag:]
            aa = a_arr[: len(vv)]
        else:
            aa = a_arr[-lag:]
            vv = v_arr[: len(aa)]
        m = min(len(vv), len(aa))
        if m < min_overlap:
            continue
        corr = pearson(vv[:m], aa[:m])
        rows.append((lag, corr, m))
        if corr > best_corr:
            best_corr = corr
            best_lag = lag
    return best_lag, best_corr, rows


best_lag, best_corr, rows = best_lag_for(v, a)
for lag, corr, m in rows:
    print(f"lag={lag:+3d} frames ({lag/30*1000:+6.1f} ms)  corr={corr:.4f}  overlap={m}")
print("BEST:", best_lag, "frames =", best_lag / 30 * 1000, "ms  corr=", best_corr)

half = n // 2
for label, sl in [("first_half", slice(0, half)), ("second_half", slice(half, n))]:
    bl, bc, _ = best_lag_for(v[sl], a[sl])
    print(label, "best lag", bl, "frames =", (bl / 30 * 1000 if bl is not None else None), "ms corr=", bc)
