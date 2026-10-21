"""Encrypts a product's ONNX model for embedding in a .ex5 (see frontend/services/licensing/modelKey.ts and
frontend/public/downloads/AT24_ModelVault.mqh). Same algorithm as the MQL5 side:

  blob   = "ATM1"(4) | nonce(16) | length(4, LE) | tag(16) | ciphertext(length)
  stream = SHA256(key(32) | nonce(16) | counter(4, LE)) for counter 0,1,2,... (32 bytes each)
  cipher = plaintext XOR stream
  tag    = SHA256("tag" | key | nonce | plaintext)[:16]

Usage:  python encrypt_model.py <model.onnx> <out.enc> <key-hex-64>     (key from: npx tsx scripts/print-model-key.ts XXXUS30)
        python encrypt_model.py --selftest
The key is read from the command line only for this build step; it is never written to a file by this script."""
import hashlib
import os
import struct
import sys

MAGIC = b"ATM1"


def stream(key: bytes, nonce: bytes, n: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hashlib.sha256(key + nonce + struct.pack("<I", counter)).digest()
        counter += 1
    return bytes(out[:n])


def tag_of(key: bytes, nonce: bytes, plain: bytes) -> bytes:
    return hashlib.sha256(b"tag" + key + nonce + plain).digest()[:16]


def encrypt(plain: bytes, key: bytes, nonce: bytes | None = None) -> bytes:
    assert len(key) == 32
    nonce = nonce or os.urandom(16)
    ks = stream(key, nonce, len(plain))
    cipher = bytes(a ^ b for a, b in zip(plain, ks))
    return MAGIC + nonce + struct.pack("<I", len(plain)) + tag_of(key, nonce, plain) + cipher


def decrypt(blob: bytes, key: bytes) -> bytes:
    assert blob[:4] == MAGIC, "bad magic"
    nonce = blob[4:20]
    n = struct.unpack("<I", blob[20:24])[0]
    tag = blob[24:40]
    cipher = blob[40:40 + n]
    ks = stream(key, nonce, n)
    plain = bytes(a ^ b for a, b in zip(cipher, ks))
    if tag_of(key, nonce, plain) != tag:
        raise ValueError("wrong key or damaged blob")
    return plain


def main() -> None:
    if sys.argv[1:] == ["--selftest"]:
        k = bytes(range(32))
        data = os.urandom(1000)
        assert decrypt(encrypt(data, k), k) == data
        try:
            decrypt(encrypt(data, k), bytes(32))
            raise SystemExit("selftest FAILED: wrong key accepted")
        except ValueError:
            pass
        print("selftest ok")
        return
    src, dst, keyhex = sys.argv[1:4]
    key = bytes.fromhex(keyhex)
    plain = open(src, "rb").read()
    blob = encrypt(plain, key)
    assert decrypt(blob, key) == plain
    open(dst, "wb").write(blob)
    print("encrypted", src, "->", dst, "|", len(plain), "->", len(blob), "bytes | plaintext sha256", hashlib.sha256(plain).hexdigest()[:16])


if __name__ == "__main__":
    main()
