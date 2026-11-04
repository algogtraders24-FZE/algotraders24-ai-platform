"""Independent check of AT24_PR_Core: Lo-MacKinlay variance ratio, z-statistic, Hurst-style exponent and the persistence
study. Usage: python -I verify_pr.py PR_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
n, W, H = int(meta[1]), int(meta[2]), int(meta[3])
c = [float(r[1]) for r in rows if r[0] == "bar"]
r = [0.0] + [math.log(c[i] / c[i - 1]) for i in range(1, n)]

def vr_z(end, q):
    a = end - W + 1
    w = r[a:end + 1]
    mu = sum(w) / W
    va = sum((x - mu) ** 2 for x in w) / (W - 1)
    m = q * (W - q + 1) * (1 - q / W)
    sq = 0.0
    for k in range(a + q - 1, end + 1):
        s = sum(r[k - j] for j in range(q)) - q * mu
        sq += s * s
    vr = (sq / m) / va
    phi = 2 * (2 * q - 1) * (q - 1) / (3 * q * W)
    return vr, (vr - 1) / math.sqrt(phi)

bad = 0
for row in rows:
    if row[0] == "vr":
        t, q = int(row[1]), int(row[2]); vr, z = vr_z(t, q); h = 0.5 + math.log(vr) / (2 * math.log(q))
        ok = abs(vr - float(row[3])) < 1e-8 and abs(z - float(row[4])) < 1e-6 and abs(h - float(row[5])) < 1e-8
        bad += 0 if ok else 1
print("30x3 spot checks of VR / z / Hurst-style exponent: mismatches", bad)
for row in rows:
    if row[0] == "now":
        q = int(row[1]); vr, z = vr_z(n - 1, q)
        ok = abs(vr - float(row[2])) < 1e-8 and abs(z - float(row[3])) < 1e-6
        bad += 0 if ok else 1
        print(f"now q={q}: VR py {vr:.4f} mt5 {float(row[2]):.4f}, z py {z:.3f} mt5 {float(row[3]):.3f} {'ok' if ok else 'DIFF'}")
for row in rows:
    if row[0] == "study":
        q = int(row[1]); cnt = [0] * 4; same = [0] * 4
        t = W + H
        while t + H < n:
            vr, z = vr_z(t, q)
            prev, nxt = math.log(c[t] / c[t - H]), math.log(c[t + H] / c[t])
            if prev != 0 and nxt != 0:
                ok = (prev > 0) == (nxt > 0)
                g = 1 if z >= 1.645 else (2 if z <= -1.645 else 3)
                cnt[0] += 1; same[0] += ok; cnt[g] += 1; same[g] += ok
            t += H
        py = cnt + [100 * same[k] / cnt[k] if cnt[k] else 0.0 for k in range(4)]
        ref = [float(x) for x in row[2:]]
        ok = all(abs(a - b) < 1e-4 for a, b in zip(py, ref))
        bad += 0 if ok else 1
        print(f"study q={q}: samples {cnt} same-sign % {[round(x,1) for x in py[4:]]} {'ok' if ok else 'DIFF ' + str(ref)}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
