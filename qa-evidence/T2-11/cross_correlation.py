import numpy as np

v = np.load("visual.npy")
a = np.load("audio_env.npy")
n = min(len(v), len(a))
v = v[:n]; a = a[:n]


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
    print(f"lag={lag:+3d} frames ({lag/30*1000:+6.1f} ms)  corr={corr:.4f}")
print("BEST:", best_lag, "frames =", best_lag / 30 * 1000, "ms  corr=", best_corr)

half = n // 2
for label, sl in [("first_half", slice(0, half)), ("second_half", slice(half, n))]:
    vn2 = norm(v[sl])
    an2 = norm(a[sl])
    bl, bc = None, -1e9
    for lag in range(-20, 21):
        if lag >= 0:
            vv = vn2[lag:]
            aa = an2[:len(vv)]
        else:
            aa = an2[-lag:]
            vv = vn2[:len(aa)]
        m = min(len(vv), len(aa))
        if m < 10:
            continue
        corr = np.dot(vv[:m], aa[:m]) / m
        if corr > bc:
            bc = corr
            bl = lag
    print(label, "best lag", bl, "frames =", bl / 30 * 1000, "ms corr=", bc)
