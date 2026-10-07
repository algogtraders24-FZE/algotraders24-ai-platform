"""Builds a throw-away MT5 chart profile that attaches the AT24 Master and Receiver EAs at startup (test tool).
Usage: python build_e2e_profile.py <terminal data folder> <profile name> [ReverseCopy true|false]"""
import sys, os, re
data, prof = sys.argv[1], sys.argv[2]
reverse = (len(sys.argv) > 3 and sys.argv[3].lower() == 'true')
base = open(os.path.join(data, r'MQL5\Profiles\Charts\default\chart01.chr'), 'rb').read().decode('utf-16')
out_dir = os.path.join(data, 'MQL5', 'Profiles', 'Charts', prof)
os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    os.remove(os.path.join(out_dir, f))

def chart(cid, expert, path, inputs):
    t = re.sub(r'id=\d+', 'id=%d' % cid, base, count=1)
    t = re.sub(r'period_size=\d+', 'period_size=1', t, count=1)
    block = '<expert>\nname=%s\npath=%s\nexpertmode=33\n<inputs>\n%s\n</inputs>\n</expert>\n\n' % (expert, path, '\n'.join(inputs))
    t = t.replace('<window>', block + '<window>', 1)
    return t

master = chart(131000000000001, 'AT24_Copier_Master_MT5', r'Experts\AT24Copier\AT24_Copier_Master_MT5.ex5',
               ['ChannelId=e2e', 'MagicFilter=777'])
recv_inputs = ['ChannelId=e2e', 'LotMultiplier=0.5', 'MasterMagicFilter=777']
if reverse:
    recv_inputs.append('ReverseCopy=true')
recv = chart(131000000000002, 'AT24_Copier_Receiver_MT5', r'Experts\AT24Copier\AT24_Copier_Receiver_MT5.ex5', recv_inputs)
for name, txt in (('chart01.chr', master), ('chart02.chr', recv)):
    with open(os.path.join(out_dir, name), 'wb') as fh:
        fh.write(b'\xff\xfe' + txt.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-16-le'))
print('profile written:', out_dir, os.listdir(out_dir))
