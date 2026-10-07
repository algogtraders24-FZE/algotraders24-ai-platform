"""Builds the deterministic customer zip for one copier direction.
Usage: python build_bundle.py MT5_to_MT5   ->  dist/AT24_Local_Copier_MT5_to_MT5_v1.0.0.zip + dist/<name>.manifest.json"""
import sys, os, zipfile, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "1.0.0"
BUNDLES = {
    "MT5_to_MT5": ["Experts/AT24_Copier_Master_MT5.ex5", "Experts/AT24_Copier_Receiver_MT5.ex5"],
    "MT5_to_MT4": ["Experts/AT24_Copier_Master_MT5.ex5", "Experts/AT24_Copier_Receiver_MT4.ex4"],
    "MT4_to_MT4": ["Experts/AT24_Copier_Master_MT4.ex4", "Experts/AT24_Copier_Receiver_MT4.ex4"],
    "MT4_to_MT5": ["Experts/AT24_Copier_Master_MT4.ex4", "Experts/AT24_Copier_Receiver_MT5.ex5"],
}
name = sys.argv[1]
files = BUNDLES[name]
out = os.path.join(HERE, "dist", f"AT24_Local_Copier_{name}_v{VERSION}.zip")
os.makedirs(os.path.dirname(out), exist_ok=True)
manifest = {"bundle": name, "version": VERSION, "files": {}}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files + [f"package/{name}/README.txt"]:
        data = open(os.path.join(HERE, rel), "rb").read()
        arc = os.path.basename(rel)
        zi = zipfile.ZipInfo(arc, date_time=(2026, 10, 7, 0, 0, 0))   # fixed timestamp -> reproducible zip
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, data)
        manifest["files"][arc] = hashlib.sha256(data).hexdigest()
manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
print(out, manifest["zipSha256"])
