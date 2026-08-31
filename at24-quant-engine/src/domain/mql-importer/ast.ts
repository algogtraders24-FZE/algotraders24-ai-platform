import type { SourcePosition } from "./token.js";

/**
 * Q0.8.5 — a MINIMAL AST scoped to exactly what strategy-semantic
 * extraction needs (docs/Q0.8_MQL_AST.md explains the scope boundary in
 * full). Every node carries its own `position` (Q0.8.43's source-to-IR
 * trace requirement starts here). `while`/`do-while`/`switch` are
 * deliberately NOT modeled as first-class statement nodes (Q0.8.5's own
 * minimal list omits them) — they parse as `UnparsedStatementNode`
 * (brace-balanced skip-recovery, never a crash, always a WARNING
 * diagnostic naming what was skipped and why it's safe to skip for
 * strategy-IR purposes: none of Q0.8's required constructs live inside a
 * `switch`/`while` body in the researched G01 fixture, and a future
 * sprint can promote any of them to a first-class node without
 * restructuring this file).
 */

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export interface LiteralNode {
  readonly kind: "Literal";
  readonly value: number | string | boolean;
  readonly raw: string;
  readonly position: SourcePosition;
}

export interface IdentifierNode {
  readonly kind: "Identifier";
  readonly name: string;
  readonly position: SourcePosition;
}

export interface UnaryExpressionNode {
  readonly kind: "UnaryExpression";
  readonly operator: string;
  readonly prefix: boolean;
  readonly argument: ExpressionNode;
  readonly position: SourcePosition;
}

export interface BinaryExpressionNode {
  readonly kind: "BinaryExpression";
  readonly operator: string;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
  readonly position: SourcePosition;
}

export interface AssignmentExpressionNode {
  readonly kind: "AssignmentExpression";
  readonly operator: string;
  readonly target: ExpressionNode;
  readonly value: ExpressionNode;
  readonly position: SourcePosition;
}

export interface CallExpressionNode {
  readonly kind: "CallExpression";
  readonly callee: ExpressionNode;
  readonly args: readonly ExpressionNode[];
  readonly position: SourcePosition;
}

export interface MemberExpressionNode {
  readonly kind: "MemberExpression";
  readonly object: ExpressionNode;
  readonly property: string;
  readonly position: SourcePosition;
}

export interface IndexExpressionNode {
  readonly kind: "IndexExpression";
  readonly object: ExpressionNode;
  readonly index: ExpressionNode;
  readonly position: SourcePosition;
}

export interface ConditionalExpressionNode {
  readonly kind: "ConditionalExpression";
  readonly test: ExpressionNode;
  readonly consequent: ExpressionNode;
  readonly alternate: ExpressionNode;
  readonly position: SourcePosition;
}

export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | AssignmentExpressionNode
  | CallExpressionNode
  | MemberExpressionNode
  | IndexExpressionNode
  | ConditionalExpressionNode;

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface BlockStatementNode {
  readonly kind: "BlockStatement";
  readonly body: readonly StatementNode[];
  readonly position: SourcePosition;
}

export interface IfStatementNode {
  readonly kind: "IfStatement";
  readonly test: ExpressionNode;
  readonly consequent: StatementNode;
  readonly alternate?: StatementNode;
  readonly position: SourcePosition;
}

export interface ReturnStatementNode {
  readonly kind: "ReturnStatement";
  readonly argument?: ExpressionNode;
  readonly position: SourcePosition;
}

export interface ExpressionStatementNode {
  readonly kind: "ExpressionStatement";
  readonly expression: ExpressionNode;
  readonly position: SourcePosition;
}

/** A single name in a (possibly comma-separated) declaration, e.g. the `prevDay` in `SBar prevDay, prevWeek;`. */
export interface VariableDeclarator {
  readonly name: string;
  readonly isArray: boolean;
  readonly initializer?: ExpressionNode;
}

export interface VariableDeclarationStatementNode {
  readonly kind: "VariableDeclarationStatement";
  readonly declType: string;
  readonly declarators: readonly VariableDeclarator[];
  readonly position: SourcePosition;
}

export interface ForStatementNode {
  readonly kind: "ForStatement";
  readonly init?: StatementNode;
  readonly test?: ExpressionNode;
  readonly update?: ExpressionNode;
  readonly body: StatementNode;
  readonly position: SourcePosition;
}

/** Skip-recovery for switch/while/do-while — never a crash, always accompanied by a WARNING diagnostic. */
export interface UnparsedStatementNode {
  readonly kind: "UnparsedStatement";
  readonly constructName: string;
  readonly position: SourcePosition;
}

export type StatementNode =
  | BlockStatementNode
  | IfStatementNode
  | ReturnStatementNode
  | ExpressionStatementNode
  | VariableDeclarationStatementNode
  | ForStatementNode
  | UnparsedStatementNode;

// ---------------------------------------------------------------------------
// Declarations / top level
// ---------------------------------------------------------------------------

export interface IncludeDirectiveNode {
  readonly kind: "IncludeDirective";
  readonly path: string;
  readonly isAngleBracket: boolean;
  readonly position: SourcePosition;
}

export interface DefineDirectiveNode {
  readonly kind: "DefineDirective";
  readonly name: string;
  readonly value: string;
  readonly position: SourcePosition;
}

export interface PropertyDirectiveNode {
  readonly kind: "PropertyDirective";
  readonly name: string;
  readonly value: string;
  readonly position: SourcePosition;
}

export interface InputDeclarationNode {
  readonly kind: "InputDeclaration";
  readonly declType: string;
  readonly name: string;
  readonly defaultValue: ExpressionNode;
  readonly isExtern: boolean;
  readonly comment?: string;
  readonly position: SourcePosition;
}

export interface GlobalVariableDeclarationNode {
  readonly kind: "GlobalVariableDeclaration";
  readonly declType: string;
  readonly declarators: readonly VariableDeclarator[];
  readonly isConst: boolean;
  readonly position: SourcePosition;
}

export interface StructFieldNode {
  readonly declType: string;
  readonly name: string;
  readonly isArray: boolean;
}

export interface StructDeclarationNode {
  readonly kind: "StructDeclaration";
  readonly name: string;
  readonly fields: readonly StructFieldNode[];
  readonly position: SourcePosition;
}

export interface ParameterNode {
  readonly declType: string;
  readonly name: string;
  readonly isReference: boolean;
  readonly isConst: boolean;
  readonly isArray: boolean;
}

export interface FunctionDeclarationNode {
  readonly kind: "FunctionDeclaration";
  readonly returnType: string;
  readonly name: string;
  readonly parameters: readonly ParameterNode[];
  readonly body: BlockStatementNode;
  readonly position: SourcePosition;
}

export type TopLevelNode = IncludeDirectiveNode | DefineDirectiveNode | PropertyDirectiveNode | InputDeclarationNode | GlobalVariableDeclarationNode | StructDeclarationNode | FunctionDeclarationNode;

export interface ProgramNode {
  readonly kind: "Program";
  readonly body: readonly TopLevelNode[];
  readonly position: SourcePosition;
}
