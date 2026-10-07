"""Builds a throw-away MT5 profile for the CROSS-terminal test (test tool).
Usage: python build_x_profile.py <terminal data folder> <profile name> master|receiver [master symbol suffix]"""
import sys, os, re
data, prof, role = sys.argv[1], sys.argv[2], sys.argv[3]
suffix = sys.argv[4] if len(sys.argv) > 4 else ''
base = open(os.path.join(data, r'MQL5\Profiles\Charts\default\chart01.chr'), 'rb').read().decode('utf-16')
out_dir = os.path.join(data, 'MQL5', 'Profiles', 'Charts', prof)
os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    os.remove(os.path.join(out_dir, f))
if role == 'master':
    expert, path = 'AT24_Copier_Master_MT5', r'Experts\AT24Copier\AT24_Copier_Master_MT5.ex5'
    inputs = ['ChannelId=xtest', 'MagicFilter=777']
else:
    expert, path = 'AT24_Copier_Receiver_MT5', r'Experts\AT24Copier\AT24_Copier_Receiver_MT5.ex5'
    inputs = ['ChannelId=xtest', 'LotMultiplier=0.5', 'MasterMagicFilter=777']
    if suffix:
        inputs.append('MasterSymbolSuffix=' + suffix)
t = re.sub(r'id=\d+', 'id=131000000000009', base, count=1)
t = re.sub(r'period_size=\d+', 'period_size=1', t, count=1)
block = '<expert>\nname=%s\npath=%s\nexpertmode=33\n<inputs>\n%s\n</inputs>\n</expert>\n\n' % (expert, path, '\n'.join(inputs))
t = t.replace('<window>', block + '<window>', 1)
with open(os.path.join(out_dir, 'chart01.chr'), 'wb') as fh:
    fh.write(b'\xff\xfe' + t.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-16-le'))
print('profile written:', out_dir)
