//+------------------------------------------------------------------+
//| AT24_ModelVault.mqh - opens an ONNX model that is embedded in    |
//| the .ex5 in ENCRYPTED form (MetaTrader 5).                       |
//|                                                                  |
//| The model key is NOT in the .ex5: the AT24 licence check returns |
//| it to a valid licence (define AT24_WANT_MODEL_KEY before         |
//| including AT24_LicenseGate.mqh, then read AT24Gate_ModelKey()).  |
//| A copied .ex5, an extracted resource or an expired trial       |
//| therefore contains / receives no usable model.                   |
//|                                                                  |
//| Blob layout (made by encrypt_model.py):                          |
//|   "ATM1"(4) | nonce(16) | length(4, little endian) | tag(16) | data|
//| keystream block i = SHA256(key(32) | nonce(16) | i as 4 bytes LE) |
//| plain = data XOR keystream ; tag = SHA256("tag"|key|nonce|plain)[0..15]|
//|                                                                  |
//| USAGE:                                                           |
//|   #resource "model.enc" as uchar g_EncModel[]                    |
//|   uchar plain[];                                                 |
//|   if(AT24Vault_Decrypt(g_EncModel, AT24Gate_ModelKey(), plain))  |
//|     { handle = OnnxCreateFromBuffer(plain, ONNX_DEFAULT);        |
//|       AT24Vault_Wipe(plain); }                                   |
//+------------------------------------------------------------------+
#ifndef AT24_MODELVAULT_MQH
#define AT24_MODELVAULT_MQH

bool AT24V_Sha256(const uchar &data[], uchar &digest[])
  {
   uchar noKey[];
   ArrayResize(digest, 0);
   return (CryptEncode(CRYPT_HASH_SHA256, data, noKey, digest) == 32);
  }

int AT24V_Nibble(const ushort c)
  {
   if(c >= '0' && c <= '9') return (int)(c - '0');
   if(c >= 'a' && c <= 'f') return (int)(c - 'a') + 10;
   if(c >= 'A' && c <= 'F') return (int)(c - 'A') + 10;
   return -1;
  }

bool AT24V_HexToBytes(const string hex, uchar &out[])
  {
   int n = StringLen(hex);
   if(n != 64)
      return false;
   ArrayResize(out, 32);
   for(int i = 0; i < 32; i++)
     {
      int hi = AT24V_Nibble(StringGetCharacter(hex, 2 * i));
      int lo = AT24V_Nibble(StringGetCharacter(hex, 2 * i + 1));
      if(hi < 0 || lo < 0)
         return false;
      out[i] = (uchar)(hi * 16 + lo);
     }
   return true;
  }

void AT24Vault_Wipe(uchar &data[])
  {
   int n = ArraySize(data);
   if(n > 0)
      ArrayInitialize(data, 0);
   ArrayFree(data);
  }

//--- true only when the key is right and the blob is intact
bool AT24Vault_Decrypt(const uchar &blob[], const string keyHex, uchar &plain[])
  {
   ArrayFree(plain);
   uchar key[];
   if(!AT24V_HexToBytes(keyHex, key))
      return false;
   int total = ArraySize(blob);
   if(total < 41)
      return false;
   if(blob[0] != 'A' || blob[1] != 'T' || blob[2] != 'M' || blob[3] != '1')
      return false;
   uint len = (uint)blob[20] | ((uint)blob[21] << 8) | ((uint)blob[22] << 16) | ((uint)blob[23] << 24);
   if(len == 0 || len > 4000000 || total != 40 + (int)len)
      return false;
   int n = (int)len;

   uchar buf[52];
   ArrayCopy(buf, key, 0, 0, 32);
   ArrayCopy(buf, blob, 32, 4, 16);   // nonce
   uchar tmp[];
   ArrayResize(tmp, n);
   uchar digest[];
   uint counter = 0;
   for(int off = 0; off < n; off += 32)
     {
      buf[48] = (uchar)(counter & 0xFF);
      buf[49] = (uchar)((counter >> 8) & 0xFF);
      buf[50] = (uchar)((counter >> 16) & 0xFF);
      buf[51] = (uchar)((counter >> 24) & 0xFF);
      if(!AT24V_Sha256(buf, digest))
         return false;
      for(int j = 0; j < 32 && off + j < n; j++)
         tmp[off + j] = (uchar)(blob[40 + off + j] ^ digest[j]);
      counter++;
     }

   // integrity: SHA256("tag" | key | nonce | plain)[0..15] must equal the stored tag
   uchar chk[];
   ArrayResize(chk, 3 + 32 + 16 + n);
   chk[0] = 't'; chk[1] = 'a'; chk[2] = 'g';
   ArrayCopy(chk, key, 3, 0, 32);
   ArrayCopy(chk, blob, 35, 4, 16);
   ArrayCopy(chk, tmp, 51, 0, n);
   bool ok = AT24V_Sha256(chk, digest);
   if(ok)
      for(int i = 0; i < 16; i++)
         if(digest[i] != blob[24 + i])
           {
            ok = false;
            break;
           }
   ArrayInitialize(chk, 0);
   ArrayInitialize(buf, 0);
   ArrayInitialize(key, 0);
   if(!ok)
     {
      ArrayInitialize(tmp, 0);
      return false;
     }
   ArrayCopy(plain, tmp);
   ArrayInitialize(tmp, 0);
   return true;
  }

#endif // AT24_MODELVAULT_MQH
