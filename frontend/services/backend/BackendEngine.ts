// services/backend/BackendEngine.ts
// Sprint 14A — Backend Foundation
// Top-level orchestrator composing repositories + core services.
// Single entry point future modules import instead of wiring services individually.

import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { healthService, HealthService } from "./HealthService";
import { versionService, VersionService } from "./VersionService";
import { logger, Logger } from "./Logger";
import { FEATURE_FLAGS } from "@/config/backend.config";
import type { FeatureFlag } from "@/config/backend.config";

export class BackendEngine {
  readonly repositories = RepositoryFactory;
  readonly health: HealthService;
  readonly version: VersionService;
  readonly logger: Logger;

  constructor() {
    this.health = healthService;
    this.version = versionService;
    this.logger = logger.child("engine");
  }

  isFeatureEnabled(flag: FeatureFlag): boolean {
    return FEATURE_FLAGS[flag] === true;
  }

  getFeatureFlags(): typeof FEATURE_FLAGS {
    return { ...FEATURE_FLAGS };
  }
}

export const backendEngine = new BackendEngine();
