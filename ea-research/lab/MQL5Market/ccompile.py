"""usage: python ccompile.py <mq5 path> [rig|term]  - compile with MetaEditor, print result lines, list outputs"""
import subprocess, sys, os, time
B = chr(92); p = sys.argv[1].replace("/", B)
ed = "E:/at24_snap/MetaEditor64.exe" if (len(sys.argv) < 3 or sys.argv[2] == "rig") else "C:/Program Files/MetaTrader 5/metaeditor64.exe"
args = [ed] + (["/portable"] if ed.startswith("E:") else []) + ["/compile:" + p, "/log:" + p + ".log"]
subprocess.run(args); time.sleep(3)
t = open(p + ".log", encoding="utf-16", errors="replace").read()
print([l for l in t.split("\n") if "Result" in l or "error" in l.lower() or "warning" in l.lower()][:8])
print(os.path.exists(p.replace(".mq5", ".ex5")))
