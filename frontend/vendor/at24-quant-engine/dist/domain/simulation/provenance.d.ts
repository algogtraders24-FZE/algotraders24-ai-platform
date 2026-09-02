import type { DataFidelityLevel } from "../data-fidelity.js";
import type { PositionAccountingMode } from "./position-accounting-mode.js";
/** Recorded from day one (Q0.5.40) — every SimulationResult must be reproducible from this alone. */
export interface SimulationProvenance {
    readonly strategyHash: string;
    readonly strategyVersion: string;
    readonly datasetId: string;
    readonly datasetVersion: string;
    readonly dataFidelity: DataFidelityLevel;
    readonly executionModel: string;
    readonly fillModel: string;
    readonly spreadModel: string;
    readonly slippageModel: string;
    readonly feeModel: string;
    readonly latencyModel: string;
    readonly initialBalance: number;
    readonly positionAccountingMode: PositionAccountingMode;
    readonly runtimeVersion: string;
}
