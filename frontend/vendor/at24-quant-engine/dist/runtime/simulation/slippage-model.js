/** Q0.5.15: ZeroSlippage only — the boundary interface exists, no advanced model is implemented. */
export const ZeroSlippage = {
    name: "ZeroSlippage",
    computeSlippage: () => 0,
};
