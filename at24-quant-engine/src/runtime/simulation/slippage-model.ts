import type { SlippageModel } from "../../domain/reality-models.js";

/** Q0.5.15: ZeroSlippage only — the boundary interface exists, no advanced model is implemented. */
export const ZeroSlippage: SlippageModel & { readonly name: string } = {
  name: "ZeroSlippage",
  computeSlippage: () => 0,
};
