/**
 * Q0.8.2 — a native, hand-rolled lexer. No third-party parser/lexer
 * library (Q0.8.55). Recognizes identifiers, keywords, numbers, strings,
 * operators, comments, preprocessor directives, and punctuation, each
 * with an exact line/column/offset (Q0.8.3).
 */
const KEYWORDS = new Set([
    "input", "extern", "const", "static", "void", "int", "uint", "long", "ulong", "short", "ushort", "char", "uchar",
    "double", "float", "string", "bool", "datetime", "color", "struct", "class", "enum", "typedef", "template",
    "if", "else", "return", "for", "while", "do", "switch", "case", "default", "break", "continue",
    "true", "false", "NULL", "sizeof", "new", "delete", "public", "private", "protected", "virtual", "namespace", "using", "group",
]);
const MULTI_CHAR_OPERATORS = [
    "<<=", ">>=", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "->",
];
const SINGLE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "^", "~", "?", ":", "."]);
const PUNCTUATION = new Set(["(", ")", "{", "}", "[", "]", ";", ","]);
function isDigit(ch) {
    return ch >= "0" && ch <= "9";
}
function isIdentStart(ch) {
    return /[A-Za-z_]/.test(ch);
}
function isIdentPart(ch) {
    return /[A-Za-z0-9_]/.test(ch);
}
export function tokenize(sourceText) {
    const tokens = [];
    let offset = 0;
    let line = 1;
    let column = 1;
    const len = sourceText.length;
    function pos() {
        return { line, column, offset };
    }
    function advance(count = 1) {
        for (let i = 0; i < count; i++) {
            if (sourceText[offset] === "\n") {
                line += 1;
                column = 1;
            }
            else {
                column += 1;
            }
            offset += 1;
        }
    }
    function push(type, value, start) {
        tokens.push({ type, value, position: start });
    }
    while (offset < len) {
        const ch = sourceText[offset];
        // Whitespace
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            advance();
            continue;
        }
        const start = pos();
        // Preprocessor directive: a line-based construct (Q0.8.4) — capture to end of line regardless of indentation.
        if (ch === "#") {
            let text = "";
            while (offset < len && sourceText[offset] !== "\n") {
                text += sourceText[offset];
                advance();
            }
            push("PREPROCESSOR", text.trim(), start);
            continue;
        }
        // Line comment
        if (ch === "/" && sourceText[offset + 1] === "/") {
            let text = "";
            while (offset < len && sourceText[offset] !== "\n") {
                text += sourceText[offset];
                advance();
            }
            push("COMMENT", text, start);
            continue;
        }
        // Block comment
        if (ch === "/" && sourceText[offset + 1] === "*") {
            let text = "/*";
            advance(2);
            while (offset < len && !(sourceText[offset] === "*" && sourceText[offset + 1] === "/")) {
                text += sourceText[offset];
                advance();
            }
            if (offset < len) {
                text += "*/";
                advance(2);
            }
            push("COMMENT", text, start);
            continue;
        }
        // String literal
        if (ch === '"') {
            let text = "";
            advance();
            while (offset < len && sourceText[offset] !== '"') {
                if (sourceText[offset] === "\\" && offset + 1 < len) {
                    text += sourceText[offset] + sourceText[offset + 1];
                    advance(2);
                }
                else {
                    text += sourceText[offset];
                    advance();
                }
            }
            advance(); // closing quote
            push("STRING", text, start);
            continue;
        }
        // Number (int, decimal, hex, scientific)
        if (isDigit(ch) || (ch === "." && isDigit(sourceText[offset + 1] ?? ""))) {
            let text = "";
            if (ch === "0" && (sourceText[offset + 1] === "x" || sourceText[offset + 1] === "X")) {
                text += sourceText[offset] + sourceText[offset + 1];
                advance(2);
                while (offset < len && /[0-9a-fA-F]/.test(sourceText[offset])) {
                    text += sourceText[offset];
                    advance();
                }
            }
            else {
                while (offset < len && isDigit(sourceText[offset])) {
                    text += sourceText[offset];
                    advance();
                }
                if (sourceText[offset] === ".") {
                    text += ".";
                    advance();
                    while (offset < len && isDigit(sourceText[offset])) {
                        text += sourceText[offset];
                        advance();
                    }
                }
                if (sourceText[offset] === "e" || sourceText[offset] === "E") {
                    text += sourceText[offset];
                    advance();
                    if (sourceText[offset] === "+" || sourceText[offset] === "-") {
                        text += sourceText[offset];
                        advance();
                    }
                    while (offset < len && isDigit(sourceText[offset])) {
                        text += sourceText[offset];
                        advance();
                    }
                }
            }
            push("NUMBER", text, start);
            continue;
        }
        // Identifier / keyword
        if (isIdentStart(ch)) {
            let text = "";
            while (offset < len && isIdentPart(sourceText[offset])) {
                text += sourceText[offset];
                advance();
            }
            push(KEYWORDS.has(text) ? "KEYWORD" : "IDENTIFIER", text, start);
            continue;
        }
        // Multi-char operators (longest match first)
        const three = sourceText.slice(offset, offset + 3);
        const two = sourceText.slice(offset, offset + 2);
        if (MULTI_CHAR_OPERATORS.includes(three)) {
            push("OPERATOR", three, start);
            advance(3);
            continue;
        }
        if (MULTI_CHAR_OPERATORS.includes(two)) {
            push("OPERATOR", two, start);
            advance(2);
            continue;
        }
        if (SINGLE_CHAR_OPERATORS.has(ch)) {
            push("OPERATOR", ch, start);
            advance();
            continue;
        }
        if (PUNCTUATION.has(ch)) {
            push("PUNCTUATION", ch, start);
            advance();
            continue;
        }
        // Unknown character — recorded as its own token (never silently dropped), the parser/semantic layer decides what to do with it.
        push("PUNCTUATION", ch, start);
        advance();
    }
    push("EOF", "", pos());
    return tokens;
}
