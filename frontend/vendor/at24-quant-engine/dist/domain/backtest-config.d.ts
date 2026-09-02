import type { ExecutionSpecification } from "./execution-specification.js";
export interface BacktestConfig {
    readonly startTimestamp: number;
    readonly endTimestamp: number;
    readonly initialEquity: number;
    readonly accountCurrency: string;
    readonly executionAssumptions: ExecutionSpecification;
}
