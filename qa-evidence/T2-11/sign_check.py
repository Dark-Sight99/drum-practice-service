# Codex 모드B 지적(T2-11) — cross_correlation.py의 lag 부호가 실제로 어느 방향을
# 뜻하는지, 합성(ground-truth) 신호로 직접 검증한다. 시각 스파이크를 t=10,30,50,70에
# 두고, "오디오가 화면보다 7프레임(약 233ms) 늦게" 울리는 것으로 정답을 고정(오디오
# 스파이크 = 시각 스파이크 + 7)한 뒤, cross_correlation.py와 완전히 같은 lag 루프로
# best_lag를 구한다.
import numpy as np

N = 100
v = np.zeros(N)
a = np.zeros(N)
for base in [10, 30, 50, 70]:
    v[base] = 1.0
    a[base + 7] = 1.0  # 정답: 오디오가 화면보다 7프레임(233ms) 늦음


def norm(x):
    x = x - x.mean()
    s = x.std()
    return x / s if s > 0 else x


vn = norm(v)
an = norm(a)

best_lag, best_corr = None, -1e9
for lag in range(-20, 21):
    if lag >= 0:
        vv = vn[lag:]
        aa = an[:len(vv)]
    else:
        aa = an[-lag:]
        vv = vn[:len(aa)]
    m = min(len(vv), len(aa))
    corr = np.dot(vv[:m], aa[:m]) / m
    if corr > best_corr:
        best_corr = corr
        best_lag = lag

print("정답: 오디오가 화면보다 7프레임(233ms) 늦음(화면이 먼저)")
print("cross_correlation.py와 동일한 lag 루프의 best_lag:", best_lag, "corr:", best_corr)
print("해석: 이 부호 하에서 '화면이 먼저'는 best_lag=-7로 나타난다.")
print("실제 영상 분석의 best_lag=+7(cross_correlation_output.txt)은 반대 부호이므로,")
print("실제로는 '오디오가 화면보다 7프레임(233ms) 먼저'였다는 뜻이다.")
