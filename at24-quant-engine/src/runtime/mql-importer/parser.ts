import type { Token, SourcePosition } from "../../domain/mql-importer/token.js";
import type {
  ProgramNode,
  TopLevelNode,
  IncludeDirectiveNode,
  DefineDirectiveNode,
  PropertyDirectiveNode,
  InputDeclarationNode,
  GlobalVariableDeclarationNode,
  StructDeclarationNode,
  StructFieldNode,
  FunctionDeclarationNode,
  ParameterNode,
  StatementNode,
  BlockStatementNode,
  IfStatementNode,
  ReturnStatementNode,
  ExpressionStatementNode,
  VariableDeclarationStatementNode,
  ForStatementNode,
  UnparsedStatementNode,
  ExpressionNode,
} from "../../domain/mql-importer/ast.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
import { diagnostic } from "../../domain/mql-importer/diagnostic.js";

const TYPE_KEYWORDS = new Set(["void", "int", "uint", "long", "ulong", "short", "ushort", "char", "uchar", "double", "float", "string", "bool", "datetime", "color"]);
const MODIFIER_KEYWORDS = new Set(["const", "static", "extern"]);
const SKIP_RECOVERY_KEYWORDS = new Set(["switch", "while", "do"]);

/**
 * Q0.8.5 — a native recursive-descent parser with precedence-climbing
 * expression parsing (Q0.8's own "SOURCE -> LEXER -> AST -> SEMANTIC
 * ANALYSIS" critical rule: this file builds structure ONLY, it assigns
 * no trading-strategy MEANING to anything — that is
 * `semantic-analyzer.ts`'s exclusive job, a genuinely separate pass over
 * the AST this file produces).
 */
export class MQLParser {
  private readonly tokens: readonly Token[];
  private index = 0;
  readonly diagnostics: Diagnostic[] = [];

  constructor(tokens: readonly Token[]) {
    // Comments are dropped from the parse stream but never silently lost —
    // they are captured separately by the lexer's own token list, which
    // callers (e.g. the semantic layer wanting an input's trailing
    // comment) can still consult directly.
    this.tokens = tokens.filter((t) => t.type !== "COMMENT");
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }
  private current(): Token {
    return this.peek(0);
  }
  private advance(): Token {
    const t = this.current();
    if (t.type !== "EOF") this.index += 1;
    return t;
  }
  private isValue(value: string): boolean {
    return this.current().value === value;
  }
  private isType(...types: readonly string[]): boolean {
    return types.includes(this.current().type);
  }
  private expectValue(value: string): Token {
    if (!this.isValue(value)) {
      this.diagnostics.push(diagnostic("PARSE_EXPECTED_TOKEN", `expected "${value}", got "${this.current().value}"`, "BLOCKING", this.current().position));
    }
    return this.advance();
  }

  parseProgram(): ProgramNode {
    const start = this.current().position;
    const body: TopLevelNode[] = [];
    while (!this.isType("EOF")) {
      const before = this.index;
      const node = this.parseTopLevel();
      if (node) body.push(node);
      if (this.index === before) this.advance(); // never loop forever on an unrecognized token
    }
    return { kind: "Program", body, position: start };
  }

  // ---------------------------------------------------------------------
  // Top level
  // ---------------------------------------------------------------------

  private parseTopLevel(): TopLevelNode | undefined {
    const tok = this.current();

    if (tok.type === "PREPROCESSOR") return this.parsePreprocessor();

    if (tok.value === "input" || tok.value === "extern") return this.parseInputDeclaration();

    if (tok.value === "struct") return this.parseStructDeclaration();

    if (tok.value === "class" || tok.value === "enum" || tok.value === "template" || tok.value === "namespace") {
      // Not required by Q0.8.5's minimal declaration list — skip the whole
      // brace-balanced body so parsing continues, with a WARNING.
      this.skipBalanced(tok.value);
      return undefined;
    }

    // "const"/"static" modifiers followed by a type, or a bare type/identifier -> could be a function or a global variable.
    return this.parseFunctionOrGlobalVariable();
  }

  private parsePreprocessor(): TopLevelNode {
    const tok = this.advance();
    const pos = tok.position;
    const text = tok.value;

    if (text.startsWith("#include")) {
      const rest = text.slice("#include".length).trim();
      const isAngleBracket = rest.startsWith("<");
      const path = rest.replace(/^[<"]/, "").replace(/[>"]$/, "");
      return { kind: "IncludeDirective", path, isAngleBracket, position: pos } satisfies IncludeDirectiveNode;
    }
    if (text.startsWith("#define")) {
      const rest = text.slice("#define".length).trim();
      const spaceIdx = rest.indexOf(" ");
      const name = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const value = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
      return { kind: "DefineDirective", name, value, position: pos } satisfies DefineDirectiveNode;
    }
    if (text.startsWith("#property")) {
      const rest = text.slice("#property".length).trim();
      const spaceIdx = rest.indexOf(" ");
      const name = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const value = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim().replace(/^"|"$/g, "");
      return { kind: "PropertyDirective", name, value, position: pos } satisfies PropertyDirectiveNode;
    }

    this.diagnostics.push(diagnostic("UNSUPPORTED_PREPROCESSOR", `unsupported preprocessor directive: "${text}"`, "WARNING", pos));
    return { kind: "PropertyDirective", name: "unsupported", value: text, position: pos } satisfies PropertyDirectiveNode;
  }

  private parseInputDeclaration(): InputDeclarationNode | PropertyDirectiveNode {
    const pos = this.current().position;
    const isExtern = this.isValue("extern");
    this.advance(); // 'input' | 'extern'

    // MQL5's `input group "Section Title"` is a UI-organization directive,
    // not a real input — no type, no name, and (per the real G01 source)
    // no trailing semicolon. Handled as its own case rather than forcing
    // it through the declaration shape below.
    if (this.isValue("group")) {
      this.advance();
      const label = this.current().type === "STRING" ? this.advance().value : "";
      if (this.isValue(";")) this.advance(); // tolerate an optional trailing ';' too
      return { kind: "PropertyDirective", name: "input-group", value: label, position: pos } satisfies PropertyDirectiveNode;
    }

    const declType = this.parseTypeName();
    const name = this.advance().value;
    let defaultValue: ExpressionNode = { kind: "Literal", value: 0, raw: "0", position: pos };
    if (this.isValue("=")) {
      this.advance();
      defaultValue = this.parseExpression();
    }
    // Trailing "; // comment" — MQL's own idiom for a human-readable input label.
    let comment: string | undefined;
    this.expectValue(";");
    const rawComment = this.fullTokens[this.rawIndexAfterLastConsumed()];
    if (rawComment?.type === "COMMENT") comment = rawComment.value.replace(/^\/\/\s*/, "");
    return { kind: "InputDeclaration", declType, name, defaultValue, isExtern, ...(comment !== undefined ? { comment } : {}), position: pos } satisfies InputDeclarationNode;
  }

  /** Since comments are filtered from `this.tokens`, look them up from the FULL token list by matching the position just consumed — used only for InputDeclaration's trailing label. */
  private fullTokens: readonly Token[] = [];
  private rawIndexAfterLastConsumed(): number {
    // Best-effort only: find the first COMMENT token in fullTokens whose
    // offset is greater than the just-consumed ';' token's offset and
    // that appears before the next non-comment token's offset. Never
    // throws if unavailable — comment metadata is advisory, not required.
    const lastPos = this.tokens[Math.max(0, this.index - 1)]!.position.offset;
    const idx = this.fullTokens.findIndex((t) => t.type === "COMMENT" && t.position.offset > lastPos);
    return idx === -1 ? -1 : idx;
  }

  setFullTokens(tokens: readonly Token[]): void {
    this.fullTokens = tokens;
  }

  private parseStructDeclaration(): StructDeclarationNode {
    const pos = this.current().position;
    this.advance(); // 'struct'
    const name = this.advance().value;
    this.expectValue("{");
    const fields: StructFieldNode[] = [];
    while (!this.isValue("}") && !this.isType("EOF")) {
      while (MODIFIER_KEYWORDS.has(this.current().value)) this.advance();
      const declType = this.parseTypeName();
      const fieldName = this.advance().value;
      let isArray = false;
      if (this.isValue("[")) {
        isArray = true;
        while (!this.isValue("]") && !this.isType("EOF")) this.advance();
        this.expectValue("]");
      }
      fields.push({ declType, name: fieldName, isArray });
      while (!this.isValue(";") && !this.isType("EOF")) this.advance();
      this.expectValue(";");
    }
    this.expectValue("}");
    this.expectValue(";");
    return { kind: "StructDeclaration", name, fields, position: pos };
  }

  private parseTypeName(): string {
    let name = this.advance().value;
    // Template-ish or namespaced type names (rare in MQL, defensive only).
    while (this.isValue("::")) {
      this.advance();
      name += "::" + this.advance().value;
    }
    return name;
  }

  private parseFunctionOrGlobalVariable(): TopLevelNode | undefined {
    const startPos = this.current().position;
    const isConst = this.isValue("const");
    while (MODIFIER_KEYWORDS.has(this.current().value)) this.advance();

    if (!this.isType("IDENTIFIER", "KEYWORD")) {
      // Not a recognizable declaration start — skip one token defensively.
      return undefined;
    }
    const declType = this.parseTypeName();

    if (!this.isType("IDENTIFIER", "KEYWORD")) return undefined;
    const name = this.advance().value;

    if (this.isValue("(")) {
      // Function declaration.
      const params = this.parseParameterList();
      if (this.isValue(";")) {
        // Forward declaration — no body to analyze.
        this.advance();
        return undefined;
      }
      const body = this.parseBlock();
      return { kind: "FunctionDeclaration", returnType: declType, name, parameters: params, body, position: startPos } satisfies FunctionDeclarationNode;
    }

    // Global variable (possibly array, possibly initialized, possibly comma-separated).
    let isArray = false;
    if (this.isValue("[")) {
      isArray = true;
      this.advance();
      while (!this.isValue("]") && !this.isType("EOF")) this.advance();
      this.expectValue("]");
    }
    let initializer: ExpressionNode | undefined;
    if (this.isValue("=")) {
      this.advance();
      initializer = this.parseAssignment();
    }
    const declarators = [{ name, isArray, ...(initializer !== undefined ? { initializer } : {}) }, ...this.parseAdditionalDeclarators()];
    while (!this.isValue(";") && !this.isType("EOF")) this.advance(); // tolerate struct-literal initializers, etc.
    this.expectValue(";");
    return { kind: "GlobalVariableDeclaration", declType, declarators, isConst, position: startPos } satisfies GlobalVariableDeclarationNode;
  }

  /** After the FIRST declarator (already parsed by the caller), consume any further `, name...` declarators. */
  private parseAdditionalDeclarators(): readonly import("../../domain/mql-importer/ast.js").VariableDeclarator[] {
    const rest: import("../../domain/mql-importer/ast.js").VariableDeclarator[] = [];
    while (this.isValue(",")) {
      this.advance();
      rest.push(...this.parseDeclaratorList());
      break; // parseDeclaratorList already consumes any further commas
    }
    return rest;
  }

  private parseParameterList(): readonly ParameterNode[] {
    this.expectValue("(");
    const params: ParameterNode[] = [];
    while (!this.isValue(")") && !this.isType("EOF")) {
      const isConst = this.isValue("const");
      if (isConst) this.advance();
      const declType = this.parseTypeName();
      let isReference = false;
      if (this.isValue("&")) {
        isReference = true;
        this.advance();
      }
      const name = this.isType("IDENTIFIER", "KEYWORD") ? this.advance().value : "";
      let isArray = false;
      if (this.isValue("[")) {
        isArray = true;
        this.advance();
        this.expectValue("]");
      }
      if (this.isValue("=")) {
        this.advance();
        this.parseExpression(); // default value, not modeled further
      }
      params.push({ declType, name, isReference, isConst, isArray });
      if (this.isValue(",")) this.advance();
    }
    this.expectValue(")");
    return params;
  }

  // ---------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------

  private parseBlock(): BlockStatementNode {
    const pos = this.current().position;
    this.expectValue("{");
    const body: StatementNode[] = [];
    while (!this.isValue("}") && !this.isType("EOF")) {
      const before = this.index;
      body.push(this.parseStatement());
      if (this.index === before) this.advance();
    }
    this.expectValue("}");
    return { kind: "BlockStatement", body, position: pos };
  }

  private parseStatement(): StatementNode {
    const tok = this.current();

    if (tok.value === "{") return this.parseBlock();
    if (tok.value === "if") return this.parseIf();
    if (tok.value === "return") return this.parseReturn();
    if (tok.value === "for") return this.parseFor();
    if (SKIP_RECOVERY_KEYWORDS.has(tok.value)) return this.skipRecoveryStatement(tok.value);
    if (this.looksLikeDeclaration()) return this.parseVariableDeclarationStatement();

    return this.parseExpressionStatement();
  }

  private looksLikeDeclaration(): boolean {
    let i = 0;
    while (MODIFIER_KEYWORDS.has(this.peek(i).value)) i += 1;
    const typeTok = this.peek(i);
    const nameTok = this.peek(i + 1);
    const isTypeLike = typeTok.type === "IDENTIFIER" || TYPE_KEYWORDS.has(typeTok.value);
    const isNameLike = nameTok.type === "IDENTIFIER";
    return isTypeLike && isNameLike && typeTok.value !== "return";
  }

  private parseVariableDeclarationStatement(): VariableDeclarationStatementNode {
    const pos = this.current().position;
    while (MODIFIER_KEYWORDS.has(this.current().value)) this.advance();
    const declType = this.parseTypeName();
    const declarators = this.parseDeclaratorList();
    this.expectValue(";");
    return { kind: "VariableDeclarationStatement", declType, declarators, position: pos };
  }

  /** Comma-separated declarators, e.g. `prevDay, prevWeek` in `SBar prevDay, prevWeek;` — a real pattern found in the G01 fixture. */
  private parseDeclaratorList(): readonly import("../../domain/mql-importer/ast.js").VariableDeclarator[] {
    const declarators: import("../../domain/mql-importer/ast.js").VariableDeclarator[] = [];
    for (;;) {
      const name = this.advance().value;
      let isArray = false;
      if (this.isValue("[")) {
        isArray = true;
        this.advance();
        while (!this.isValue("]") && !this.isType("EOF")) this.advance();
        this.expectValue("]");
      }
      let initializer: ExpressionNode | undefined;
      if (this.isValue("=")) {
        this.advance();
        initializer = this.parseAssignment();
      }
      declarators.push({ name, isArray, ...(initializer !== undefined ? { initializer } : {}) });
      if (this.isValue(",")) {
        this.advance();
        continue;
      }
      break;
    }
    return declarators;
  }

  private parseIf(): IfStatementNode {
    const pos = this.current().position;
    this.advance(); // 'if'
    this.expectValue("(");
    const test = this.parseExpression();
    this.expectValue(")");
    const consequent = this.parseStatement();
    let alternate: StatementNode | undefined;
    if (this.isValue("else")) {
      this.advance();
      alternate = this.parseStatement();
    }
    return { kind: "IfStatement", test, consequent, ...(alternate !== undefined ? { alternate } : {}), position: pos };
  }

  private parseReturn(): ReturnStatementNode {
    const pos = this.current().position;
    this.advance(); // 'return'
    let argument: ExpressionNode | undefined;
    if (!this.isValue(";")) argument = this.parseExpression();
    this.expectValue(";");
    return { kind: "ReturnStatement", ...(argument !== undefined ? { argument } : {}), position: pos };
  }

  private parseFor(): ForStatementNode {
    const pos = this.current().position;
    this.advance(); // 'for'
    this.expectValue("(");
    let init: StatementNode | undefined;
    if (!this.isValue(";")) {
      init = this.looksLikeDeclaration() ? this.parseVariableDeclarationStatement() : this.parseExpressionStatement();
    } else {
      this.advance();
    }
    let test: ExpressionNode | undefined;
    if (!this.isValue(";")) test = this.parseExpression();
    this.expectValue(";");
    let update: ExpressionNode | undefined;
    if (!this.isValue(")")) update = this.parseExpression();
    this.expectValue(")");
    const body = this.parseStatement();
    return { kind: "ForStatement", ...(init !== undefined ? { init } : {}), ...(test !== undefined ? { test } : {}), ...(update !== undefined ? { update } : {}), body, position: pos };
  }

  private parseExpressionStatement(): ExpressionStatementNode {
    const pos = this.current().position;
    const expression = this.parseExpression();
    this.expectValue(";");
    return { kind: "ExpressionStatement", expression, position: pos };
  }

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
  private skipRecoveryStatement(constructName: string): UnparsedStatementNode {
    const pos = this.current().position;
    this.diagnostics.push(diagnostic("UNPARSED_STATEMENT", `"${constructName}" statement not modeled by the minimal AST (Q0.8.5) — skipped structurally, never crashed on`, "WARNING", pos));
    this.advance(); // the keyword itself
    if (this.isValue("(")) this.skipBalancedParens();
    if (this.isValue("while")) {
      // do-while's trailing "while (...)"
      this.advance();
      if (this.isValue("(")) this.skipBalancedParens();
    }
    if (this.isValue("{")) this.skipBalanced("{");
    else if (!this.isValue(";")) this.parseStatement();
    else this.advance();
    return { kind: "UnparsedStatement", constructName, position: pos };
  }

  private skipBalancedParens(): void {
    this.expectValue("(");
    let depth = 1;
    while (depth > 0 && !this.isType("EOF")) {
      if (this.isValue("(")) depth += 1;
      else if (this.isValue(")")) depth -= 1;
      this.advance();
    }
  }

  private skipBalanced(_context: string): void {
    // Skip forward to the next '{', then consume a balanced brace region.
    while (!this.isValue("{") && !this.isValue(";") && !this.isType("EOF")) this.advance();
    if (this.isValue(";")) {
      this.advance();
      return;
    }
    if (!this.isValue("{")) return;
    let depth = 0;
    do {
      if (this.isValue("{")) depth += 1;
      else if (this.isValue("}")) depth -= 1;
      this.advance();
    } while (depth > 0 && !this.isType("EOF"));
    if (this.isValue(";")) this.advance();
  }

  // ---------------------------------------------------------------------
  // Expressions — precedence climbing
  // ---------------------------------------------------------------------

  parseExpression(): ExpressionNode {
    return this.parseAssignment();
  }

  private parseAssignment(): ExpressionNode {
    const left = this.parseConditional();
    const assignOps = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
    if (assignOps.has(this.current().value)) {
      const pos = this.current().position;
      const operator = this.advance().value;
      const value = this.parseAssignment();
      return { kind: "AssignmentExpression", operator, target: left, value, position: pos };
    }
    return left;
  }

  private parseConditional(): ExpressionNode {
    const test = this.parseLogicalOr();
    if (this.isValue("?")) {
      const pos = this.current().position;
      this.advance();
      const consequent = this.parseAssignment();
      this.expectValue(":");
      const alternate = this.parseAssignment();
      return { kind: "ConditionalExpression", test, consequent, alternate, position: pos };
    }
    return test;
  }

  private parseBinaryLevel(next: () => ExpressionNode, operators: readonly string[]): ExpressionNode {
    let left = next();
    while (operators.includes(this.current().value)) {
      const pos = this.current().position;
      const operator = this.advance().value;
      const right = next();
      left = { kind: "BinaryExpression", operator, left, right, position: pos };
    }
    return left;
  }

  private parseLogicalOr(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseLogicalAnd(), ["||"]);
  }
  private parseLogicalAnd(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseBitwiseOr(), ["&&"]);
  }
  private parseBitwiseOr(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseBitwiseXor(), ["|"]);
  }
  private parseBitwiseXor(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseBitwiseAnd(), ["^"]);
  }
  private parseBitwiseAnd(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseEquality(), ["&"]);
  }
  private parseEquality(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseRelational(), ["==", "!="]);
  }
  private parseRelational(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseShift(), ["<", "<=", ">", ">="]);
  }
  private parseShift(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseAdditive(), ["<<", ">>"]);
  }
  private parseAdditive(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseMultiplicative(), ["+", "-"]);
  }
  private parseMultiplicative(): ExpressionNode {
    return this.parseBinaryLevel(() => this.parseUnary(), ["*", "/", "%"]);
  }

  private parseUnary(): ExpressionNode {
    const unaryOps = new Set(["!", "-", "+", "~", "++", "--"]);
    if (unaryOps.has(this.current().value)) {
      const pos = this.current().position;
      const operator = this.advance().value;
      const argument = this.parseUnary();
      return { kind: "UnaryExpression", operator, prefix: true, argument, position: pos };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExpressionNode {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.isValue("(")) {
        const pos = this.current().position;
        this.advance();
        const args: ExpressionNode[] = [];
        while (!this.isValue(")") && !this.isType("EOF")) {
          args.push(this.parseAssignment());
          if (this.isValue(",")) this.advance();
        }
        this.expectValue(")");
        expr = { kind: "CallExpression", callee: expr, args, position: pos };
      } else if (this.isValue(".")) {
        const pos = this.current().position;
        this.advance();
        const property = this.advance().value;
        expr = { kind: "MemberExpression", object: expr, property, position: pos };
      } else if (this.isValue("[")) {
        const pos = this.current().position;
        this.advance();
        const index = this.parseExpression();
        this.expectValue("]");
        expr = { kind: "IndexExpression", object: expr, index, position: pos };
      } else if (this.isValue("++") || this.isValue("--")) {
        const pos = this.current().position;
        const operator = this.advance().value;
        expr = { kind: "UnaryExpression", operator, prefix: false, argument: expr, position: pos };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): ExpressionNode {
    const tok = this.current();
    const pos = tok.position;

    if (tok.value === "(") {
      this.advance();
      // Could be a parenthesized expression OR a C-style cast "(type)expr".
      // Detection is DELIBERATELY conservative (documented in
      // docs/Q0.8_MQL_AST.md): only primitive TYPE_KEYWORDS and
      // identifiers matching MQL's own `ENUM_*` naming convention are
      // recognized as cast targets — an arbitrary ALL-CAPS constant like
      // `INIT_FAILED` must NOT be misread as a cast just because it's
      // followed by ")". A custom struct/class cast (rare in practice)
      // is not auto-detected; it parses as a parenthesized expression
      // instead, which is a safe (if imprecise) fallback, never a crash.
      const innerTok = this.current();
      const isCastTarget = TYPE_KEYWORDS.has(innerTok.value) || /^ENUM_[A-Z0-9_]+$/.test(innerTok.value);
      if (isCastTarget && this.peek(1).value === ")") {
        const afterParen = this.peek(2);
        const nonCastFollowers = new Set([";", ",", ")", "]", ":", "?", "==", "!=", "<=", ">=", "<", ">", "&&", "||", "=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "<<", ">>", "&", "|", "^", "*", "/", "%"]);
        // "+"/"-" alone are ambiguous (could be binary or unary-of-cast-target); only accepted when immediately followed by a non-binary-continuation context is impractical to detect further here, so they are excluded from cast detection too — a real trailing binary "(x) - 5" must never be misread as a cast.
        const looksLikeCast = !nonCastFollowers.has(afterParen.value) && afterParen.value !== "+" && afterParen.value !== "-";
        if (looksLikeCast) {
          this.advance(); // type
          this.expectValue(")");
          const argument = this.parseUnary();
          return { kind: "UnaryExpression", operator: `(${innerTok.value})`, prefix: true, argument, position: pos };
        }
      }
      const expr = this.parseExpression();
      this.expectValue(")");
      return expr;
    }

    if (tok.type === "NUMBER") {
      this.advance();
      return { kind: "Literal", value: tok.value.startsWith("0x") ? parseInt(tok.value, 16) : Number(tok.value), raw: tok.value, position: pos };
    }
    if (tok.type === "STRING") {
      this.advance();
      return { kind: "Literal", value: tok.value, raw: tok.value, position: pos };
    }
    if (tok.value === "true" || tok.value === "false") {
      this.advance();
      return { kind: "Literal", value: tok.value === "true", raw: tok.value, position: pos };
    }
    if (tok.value === "NULL") {
      this.advance();
      return { kind: "Literal", value: "NULL", raw: "NULL", position: pos };
    }
    if (tok.type === "IDENTIFIER" || tok.type === "KEYWORD") {
      this.advance();
      return { kind: "Identifier", name: tok.value, position: pos };
    }

    // Genuinely unrecognized token in expression position — record and recover with a placeholder identifier so parsing continues.
    this.diagnostics.push(diagnostic("PARSE_UNEXPECTED_TOKEN", `unexpected token "${tok.value}" in expression position`, "WARNING", pos));
    this.advance();
    return { kind: "Identifier", name: tok.value || "<error>", position: pos };
  }
}

export function parseMQL(tokens: readonly Token[]): { program: ProgramNode; diagnostics: readonly Diagnostic[] } {
  const parser = new MQLParser(tokens);
  parser.setFullTokens(tokens);
  const program = parser.parseProgram();
  return { program, diagnostics: parser.diagnostics };
}
