import type { Token } from "../../domain/mql-importer/token.js";
import type { ProgramNode, ExpressionNode } from "../../domain/mql-importer/ast.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
/**
 * Q0.8.5 — a native recursive-descent parser with precedence-climbing
 * expression parsing (Q0.8's own "SOURCE -> LEXER -> AST -> SEMANTIC
 * ANALYSIS" critical rule: this file builds structure ONLY, it assigns
 * no trading-strategy MEANING to anything — that is
 * `semantic-analyzer.ts`'s exclusive job, a genuinely separate pass over
 * the AST this file produces).
 */
export declare class MQLParser {
    private readonly tokens;
    private index;
    readonly diagnostics: Diagnostic[];
    constructor(tokens: readonly Token[]);
    private peek;
    private current;
    private advance;
    private isValue;
    private isType;
    private expectValue;
    parseProgram(): ProgramNode;
    private parseTopLevel;
    private parsePreprocessor;
    private parseInputDeclaration;
    /** Since comments are filtered from `this.tokens`, look them up from the FULL token list by matching the position just consumed — used only for InputDeclaration's trailing label. */
    private fullTokens;
    private rawIndexAfterLastConsumed;
    setFullTokens(tokens: readonly Token[]): void;
    private parseStructDeclaration;
    private parseTypeName;
    private parseFunctionOrGlobalVariable;
    /** After the FIRST declarator (already parsed by the caller), consume any further `, name...` declarators. */
    private parseAdditionalDeclarators;
    private parseParameterList;
    private parseBlock;
    private parseStatement;
    private looksLikeDeclaration;
    private parseVariableDeclarationStatement;
    /** Comma-separated declarators, e.g. `prevDay, prevWeek` in `SBar prevDay, prevWeek;` — a real pattern found in the G01 fixture. */
    private parseDeclaratorList;
    private parseIf;
    private parseReturn;
    private parseFor;
    private parseExpressionStatement;
    /**
     * Q0.8.5's minimal statement list omits switch/while/do-while — rather
     * than crash or silently drop them, this consumes the construct's
     * balanced-brace body (or single statement, for a brace-less form) and
     * records a WARNING diagnostic naming exactly what was skipped
     * (docs/Q0.8_MQL_AST.md explains why this is a safe, documented scope
     * boundary rather than data loss: none of Q0.8's required strategy
     * constructs live inside a switch/while/do body in the researched G01
     * fixture, and the position is preserved for a future promotion to a
     * first-class node).
     */
    private skipRecoveryStatement;
    private skipBalancedParens;
    private skipBalanced;
    parseExpression(): ExpressionNode;
    private parseAssignment;
    private parseConditional;
    private parseBinaryLevel;
    private parseLogicalOr;
    private parseLogicalAnd;
    private parseBitwiseOr;
    private parseBitwiseXor;
    private parseBitwiseAnd;
    private parseEquality;
    private parseRelational;
    private parseShift;
    private parseAdditive;
    private parseMultiplicative;
    private parseUnary;
    private parsePostfix;
    private parsePrimary;
}
export declare function parseMQL(tokens: readonly Token[]): {
    program: ProgramNode;
    diagnostics: readonly Diagnostic[];
};
