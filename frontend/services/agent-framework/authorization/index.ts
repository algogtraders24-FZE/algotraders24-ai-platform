// services/agent-framework/authorization/index.ts
// AT24 Agent Framework - A8 central authorization boundary. Server-only.

export { AuthorizationService, authorizationService } from "./authorization-service";
export type {
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationOutcome,
  AuthorizationDenialCode,
  AuthorizationCheck,
} from "./authorization-service";
