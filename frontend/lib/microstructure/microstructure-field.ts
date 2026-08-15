// lib/microstructure/microstructure-field.ts
// Sprint D2.8.5 - the five MicrostructureField constructors every
// validation/calculation function in this module uses, so the CapabilityState
// vocabulary (types/microstructure.ts) is spelled the same way everywhere -
// never a raw `{ state: "unavailable" }` literal scattered across the
// codebase. Pure, no I/O. Lives under lib/ (not services/) so a provider
// adapter (lib/market-data/providers/*) can depend on it directly without
// a lib-depends-on-services inversion - the same layering every existing
// provider already follows (providers import from lib/market-data/*, never
// from services/market-data/*).
import type { CapabilityState, MicrostructureField } from "@/types/microstructure";

export function availableField<T>(value: T): MicrostructureField<T> {
  return { state: "available", value };
}

export function staleField<T>(value: T, reason: string): MicrostructureField<T> {
  return { state: "stale", value, reason };
}

export function unavailableField<T>(reason: string): MicrostructureField<T> {
  return { state: "unavailable", reason };
}

export function notSupportedField<T>(reason: string): MicrostructureField<T> {
  return { state: "not_supported_by_provider", reason };
}

export function invalidField<T>(reason: string): MicrostructureField<T> {
  return { state: "invalid", reason };
}

/** True only for a field that carries a real, readable value ("available" or "stale") - the one check every calculation function gates on before reading `.value`. */
export function hasValue<T>(field: MicrostructureField<T>): field is MicrostructureField<T> & { value: T } {
  return (field.state === "available" || field.state === "stale") && field.value !== undefined;
}

/** Propagates the most informative non-available state from an upstream field into a derived field that depends on it - e.g. a depth figure derived from a not_supported_by_provider order book should itself read not_supported_by_provider, not a generic "unavailable". */
export function propagateState<T, U>(upstream: MicrostructureField<T>, reason: string): MicrostructureField<U> {
  const state: CapabilityState = upstream.state === "not_supported_by_provider" ? "not_supported_by_provider" : upstream.state === "invalid" ? "invalid" : "unavailable";
  return { state, reason };
}
