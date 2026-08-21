// services/licensing/adapters.ts
// Sprint M11 - Platform adapters (brief section 10). Each adapter's ONLY
// job is deriveDeviceBindingId: turn that platform's own raw runtime
// identifiers into one stable, opaque, hashed device-binding ID. Nothing
// else in the Licensing system is platform-specific - licenseCore.ts and
// licenseService.ts call getLicenseAdapter(platform).deriveDeviceBindingId(...)
// and never branch on platform themselves (proven by Test U, which runs
// the identical activate/validate flow through all six).
//
// "Never rely exclusively on a raw machine ID" (brief section 5): every
// adapter below combines at least two independent identifiers (an account/
// instance identity plus a machine/installation identity) before hashing,
// so a single spoofed value can't reproduce another user's binding.
import { createHash } from "node:crypto";
import { PLATFORM_NAMES, type PlatformName } from "@/types/marketplace-factory";

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex");
}

export interface LicensePlatformAdapter {
  platform: PlatformName;
  // Human-readable description of exactly which raw identifiers this
  // platform's binding is built from - documentation, not executable, but
  // kept next to the code so it can never silently drift from it.
  bindingInputsDescription: string;
  deriveDeviceBindingId: (raw: Record<string, string>) => string;
}

// --- MT5: account login + terminal common-data GUID + broker server name.
// MT5 exposes a per-terminal-install common-data-folder identity (stable
// across EA reloads, tied to the installation) distinct from the trading
// account itself - combining both means neither a new demo account on the
// same machine nor moving the same account to a new machine alone changes
// the binding silently in the buyer's favor.
const mt5Adapter: LicensePlatformAdapter = {
  platform: "MT5",
  bindingInputsDescription: "accountLogin + brokerServer + terminalCommonDataGuid",
  deriveDeviceBindingId: (raw) => stableHash([raw.accountLogin ?? "", raw.brokerServer ?? "", raw.terminalCommonDataGuid ?? ""]),
};

// --- MT4: MT4 has no equivalent common-data GUID API (older platform) -
// falls back to account login + broker server + a hash of the terminal's
// own data-path (still not a bare machine ID: the data path is
// install-specific, not just a single hardware fingerprint).
const mt4Adapter: LicensePlatformAdapter = {
  platform: "MT4",
  bindingInputsDescription: "accountLogin + brokerServer + terminalDataPathHash",
  deriveDeviceBindingId: (raw) => stableHash([raw.accountLogin ?? "", raw.brokerServer ?? "", raw.terminalDataPathHash ?? ""]),
};

const cTraderAdapter: LicensePlatformAdapter = {
  platform: "cTrader",
  bindingInputsDescription: "cTraderAccountId + cBotInstanceId",
  deriveDeviceBindingId: (raw) => stableHash([raw.cTraderAccountId ?? "", raw.cBotInstanceId ?? ""]),
};

const ninjaTraderAdapter: LicensePlatformAdapter = {
  platform: "NinjaTrader",
  bindingInputsDescription: "ninjaTraderAccountName + machineGuid",
  deriveDeviceBindingId: (raw) => stableHash([raw.ninjaTraderAccountName ?? "", raw.machineGuid ?? ""]),
};

const cryptoAdapter: LicensePlatformAdapter = {
  platform: "Crypto",
  bindingInputsDescription: "exchangeApiKeyFingerprint + hostInstanceId",
  deriveDeviceBindingId: (raw) => stableHash([raw.exchangeApiKeyFingerprint ?? "", raw.hostInstanceId ?? ""]),
};

const aiEngineAdapter: LicensePlatformAdapter = {
  platform: "AI Engine",
  bindingInputsDescription: "serviceAccountId + deploymentInstanceId",
  deriveDeviceBindingId: (raw) => stableHash([raw.serviceAccountId ?? "", raw.deploymentInstanceId ?? ""]),
};

const ADAPTERS: Record<PlatformName, LicensePlatformAdapter> = {
  MT5: mt5Adapter,
  MT4: mt4Adapter,
  cTrader: cTraderAdapter,
  NinjaTrader: ninjaTraderAdapter,
  Crypto: cryptoAdapter,
  "AI Engine": aiEngineAdapter,
};

export function getLicenseAdapter(platform: string): LicensePlatformAdapter | null {
  return (ADAPTERS as Record<string, LicensePlatformAdapter>)[platform] ?? null;
}

export function listLicenseAdapters(): LicensePlatformAdapter[] {
  return PLATFORM_NAMES.map((p) => ADAPTERS[p]);
}
