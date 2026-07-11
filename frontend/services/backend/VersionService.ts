// services/backend/VersionService.ts
// Sprint 14A — Backend Foundation
// Exposes platform/build/release/sprint version info.

import type { VersionInfo } from "@/types/backend";
import { VERSION } from "@/config/backend.config";

export class VersionService {
  private version: VersionInfo;

  constructor(version: VersionInfo = VERSION) {
    this.version = version;
  }

  get(): VersionInfo {
    return { ...this.version };
  }

  getPlatformVersion(): string {
    return this.version.platformVersion;
  }

  getBuildVersion(): string {
    return this.version.buildVersion;
  }
}

export const versionService = new VersionService();
