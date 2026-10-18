"""Builds the licence-protected v1.1.0 customer zips of the four copier directions.
The Master EA is unchanged (taken from the v1.0.0 zip), the Receiver is the newly compiled licensed build, the README gets the
licence-key section and an honest change of the 'no internet' sentence (the Receiver now contacts algotraders24.ai to check the key).
Usage: python build_licensed_bundles.py        (after compiling Experts/AT24_Copier_Receiver_MT5.ex5 / _MT4.ex4)
"""
import hashlib, json, os, re, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OLD, NEW = "1.0.0", "1.1.0"
DIRECTIONS = {"MT5_to_MT5": "MT5", "MT5_to_MT4": "MT4", "MT4_to_MT4": "MT4", "MT4_to_MT5": "MT5"}  # direction -> receiver platform

LICENCE = """LICENCE KEY (required since v{v})
  The RECEIVER needs your AT24 licence key (the Master needs none). Your key is on your AT24 purchase page
  (Dashboard > Purchases > this product > "Your licence key").
  1. In the DESTINATION terminal: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL"
     and add   https://www.algotraders24.ai
  2. When you attach the Receiver, paste the key into the input  InpLicenseKey.
  One key = ONE receiving (destination) account. Moving to another account/broker/VPS: Dashboard > Purchases >
  this product > "Change trading account" (2 changes per 30 days), then run the Receiver there.
  The Receiver checks the key when it starts and every 4 hours. Revoked key / other product / other account:
  it stops opening NEW copies (copies that are already open still follow the Master's closes and SL/TP).
  A short internet outage never stops a running Receiver (72 hours of grace).
  The only data sent to algotraders24.ai is the key and the destination account number + server name.

"""

for name, rx in DIRECTIONS.items():
    old_zip = os.path.join(HERE, "dist", f"AT24_Local_Copier_{name}_v{OLD}.zip")
    zin = zipfile.ZipFile(old_zip)
    master = next(n for n in zin.namelist() if "Master" in n)
    rx_old = next(n for n in zin.namelist() if "Receiver" in n)
    readme = zin.read("README.txt").decode("utf-8").replace("\r\n", "\n").replace("v" + OLD, "v" + NEW)
    old_sentence = "No server, no DLL, no internet connection and no account password is\nused: the two terminals exchange a small text file in the shared\n"
    assert old_sentence in readme, name
    NL = chr(10)
    readme = readme.replace(old_sentence, "No server, no DLL and no account password: the two terminals exchange a small text file in the shared" + NL, 1)
    tail = "under the same Windows user)." + NL
    assert tail in readme, name
    readme = readme.replace(tail, "under the same Windows user), so trade data never leaves your computer." + NL + "The Receiver contacts algotraders24.ai only to check your licence key (see LICENCE KEY below)." + NL, 1)
    assert "SET UP (about 3 minutes)" in readme
    readme = readme.replace("SET UP (about 3 minutes)", LICENCE.format(v=NEW) + "SET UP (about 3 minutes)", 1)
    rx_new_path = os.path.join(HERE, "Experts", "AT24_Copier_Receiver_" + rx + (".ex5" if rx == "MT5" else ".ex4"))
    files = [(master, zin.read(master)), (rx_old, open(rx_new_path, "rb").read()), ("README.txt", readme.replace("\n", "\r\n").encode("utf-8"))]
    out = os.path.join(HERE, "dist", f"AT24_Local_Copier_{name}_v{NEW}.zip")
    manifest = {"bundle": name, "version": NEW, "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for arc, data in files:
            zi = zipfile.ZipInfo(arc, date_time=(2026, 10, 18, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            manifest["files"][arc] = hashlib.sha256(data).hexdigest()
    manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
    print("built", os.path.basename(out), manifest["zipSha256"][:16])
