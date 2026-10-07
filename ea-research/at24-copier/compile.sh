#!/usr/bin/env bash
# Usage: ./compile.sh Experts/AT24_Copier_Master_MT5.mq5   (MT5)   |   ./compile.sh Experts/AT24_Copier_Master_MT4.mq4 (MT4)
# Compiles with the real MetaEditor, prints errors/warnings + the Result line. Exit 0 only when 0 errors.
set -u
cd "$(dirname "$0")"
SRC="$1"
NAME="$(basename "$SRC")"
SRC_WIN="$(cygpath -w "$(pwd)/$SRC")"
LOG_UNIX="$(pwd)/compile_${NAME}.log"
LOG_WIN="$(cygpath -w "$LOG_UNIX")"
rm -f "$LOG_UNIX"
case "$NAME" in
  *.mq5) EDITOR="/c/Program Files/MetaTrader 5/MetaEditor64.exe" ;;
  *.mq4) EDITOR="/c/Program Files (x86)/Vantage Markets MT4 Terminal/metaeditor.exe" ;;
  *) echo "unsupported extension"; exit 2 ;;
esac
"$EDITOR" "/compile:${SRC_WIN}" "/log:${LOG_WIN}" >/dev/null 2>&1
for i in $(seq 1 40); do [ -s "$LOG_UNIX" ] && break; sleep 0.5; done
python3 - "$(cygpath -w "$LOG_UNIX")" <<'PY'
import sys,re
try:
    d=open(sys.argv[1],'rb').read()
except FileNotFoundError:
    print("NO LOG PRODUCED"); sys.exit(2)
t=d.decode('utf-16-le',errors='replace') if d[:2]==b'\xff\xfe' else d.decode('utf-8',errors='replace')
res=None
for l in t.splitlines():
    low=l.lower()
    if 'error' in low or 'warning' in low or low.startswith('result'):
        print(l.strip())
        m=re.search(r'Result:\s*(\d+) errors?,\s*(\d+) warnings?',l)
        if m: res=(int(m.group(1)),int(m.group(2)))
if res is None: print("NO RESULT LINE"); sys.exit(2)
sys.exit(0 if res[0]==0 else 1)
PY
