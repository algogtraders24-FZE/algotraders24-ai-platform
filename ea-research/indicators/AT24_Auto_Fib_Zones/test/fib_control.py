"""Control: do pullback depths cluster at fib levels more than at non-fib values? Bands +-2.5% around each level vs all other 5% bands between 20% and 90%."""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
sw = [(float(r[3]), int(r[4])) for r in rows if r[0] == "sw"]
dep = []
for j in range(len(sw) - 2):
    leg = abs(sw[j+1][0] - sw[j][0])
    if leg > 0: dep.append(abs(sw[j+1][0] - sw[j+2][0]) / leg)
n = len(dep)
def band(c): return sum(1 for d in dep if c - 0.025 <= d < c + 0.025) / n * 100
fib = {0.236: 0, 0.382: 0, 0.5: 0, 0.618: 0, 0.786: 0}
for f in fib: fib[f] = band(f)
ctrl = [band(c / 100) for c in range(22, 90, 5) if all(abs(c / 100 - f) > 0.05 for f in fib)]
print("legs", n)
for f, v in fib.items(): print(f"fib {f:.3f} band share {v:5.2f}%")
print(f"control bands avg {sum(ctrl)/len(ctrl):5.2f}% (min {min(ctrl):.2f} max {max(ctrl):.2f}, {len(ctrl)} bands)")
