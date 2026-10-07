"""Builds a throw-away MT4 chart profile that attaches AT24 copier EAs (test tool).
Usage: python build_x_profile_mt4.py <MT4 data folder> <profile name> receiver|master|loop [master symbol suffix]
  loop = Master and Receiver on two charts of the same terminal/account (loopback test)"""
import sys, os, re

data, prof, role = sys.argv[1], sys.argv[2], sys.argv[3]
suffix = sys.argv[4] if len(sys.argv) > 4 else ''
raw = open(os.path.join(data, 'profiles', 'default', 'chart01.chr'), 'rb').read()
base = raw.decode('utf-16') if raw[:2] == b'\xff\xfe' else raw.decode('latin1')
nl = '\r\n' if '\r\n' in base else '\n'
base = base.replace('\r\n', '\n')
out_dir = os.path.join(data, 'profiles', prof)
os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    os.remove(os.path.join(out_dir, f))

MASTER = ('AT24Copier\\AT24_Copier_Master_MT4', ['ChannelId=xtest', 'MagicFilter=777'])
RECEIVER = ('AT24Copier\\AT24_Copier_Receiver_MT4',
            ['ChannelId=xtest', 'LotMultiplier=0.5', 'MasterMagicFilter=777'] + (['MasterSymbolSuffix=' + suffix] if suffix else []))
EXPERTS = {'receiver': [RECEIVER], 'master': [MASTER], 'loop': [MASTER, RECEIVER]}

for idx, (name, inputs) in enumerate(EXPERTS[role], 1):
    t = re.sub(r'id=\d+', 'id=13100000000002%d' % idx, base, count=1)
    t = re.sub(r'symbol=\w+', 'symbol=EURUSD', t, count=1)
    t = re.sub(r'period=\d+', 'period=1', t, count=1)
    block = '<expert>\nname=%s\nflags=343\nwindow_num=0\n<inputs>\n%s\n</inputs>\n</expert>\n\n' % (name, '\n'.join(inputs))
    t = t.replace('</chart>', block + '</chart>')
    with open(os.path.join(out_dir, 'chart%02d.chr' % idx), 'wb') as fh:
        fh.write(t.replace('\n', nl).encode('latin1'))
print('profile written:', out_dir, os.listdir(out_dir))
