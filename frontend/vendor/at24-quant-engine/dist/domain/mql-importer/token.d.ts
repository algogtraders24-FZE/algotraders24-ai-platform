/** Q0.8.2/8.3 — every token category the lexer recognizes, and its exact source position. */
export type TokenType = "IDENTIFIER" | "KEYWORD" | "NUMBER" | "STRING" | "OPERATOR" | "PUNCTUATION" | "PREPROCESSOR" | "COMMENT" | "EOF";
/** Q0.8.3 — line/column are 1-based; offset is 0-based into the raw source text. Parser errors point here, never a vague "somewhere in the file." */
export interface SourcePosition {
    readonly line: number;
    readonly column: number;
    readonly offset: number;
}
export interface Token {
    readonly type: TokenType;
    readonly value: string;
    readonly position: SourcePosition;
}
