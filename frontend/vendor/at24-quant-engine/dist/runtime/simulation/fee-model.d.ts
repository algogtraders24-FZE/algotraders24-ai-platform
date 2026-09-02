import type { FeeModel } from "../../domain/reality-models.js";
/** Q0.5.16: ZeroFee only. PerTrade/PerUnit/Percentage/Tiered are future models. */
export declare const ZeroFee: FeeModel & {
    readonly name: string;
};
