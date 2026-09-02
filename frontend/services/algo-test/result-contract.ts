// services/algo-test/result-contract.ts
// P3.3 - the persisted Algo Test result's own field-shape version, stamped
// onto every completed AlgoTestRun (resultVersion) so a future contract
// change (a field added/renamed/removed) can be told apart from an older
// persisted row, without guessing from field presence alone. Bump this the
// same way strategyVersion is bumped for the Golden Strategy - never
// silently reinterpret an old row's fields under a new meaning.
export const RESULT_CONTRACT_VERSION = "1.0";
