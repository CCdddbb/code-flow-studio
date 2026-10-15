import ts from 'typescript';

const lineOf = (source, position) => source.slice(0, position).split('\n').length;
const text = (node, sf) => node?.getText(sf) ?? '';

// Small declarative expression vocabulary. Unsupported expressions never become executable code.
export function expression(node, sf) {
  if (!node) return { op: 'unknown', reason: 'Missing expression' };
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return expression(node.expression, sf);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return { op: 'literal', value: ts.isNumericLiteral(node) ? Number(node.text) : node.text };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { op: 'literal', value: node.kind === ts.SyntaxKind.TrueKeyword };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { op: 'literal', value: null };
  if (ts.isIdentifier(node)) return { op: 'ref', path: [node.text] };
  if (ts.isPropertyAccessExpression(node)) {
    const base = expression(node.expression, sf);
    if (base.op === 'ref') return { op: 'ref', path: [...base.path, node.name.text] };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const fields = [];
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) fields.push({ key: prop.name.text, expression: expression(prop.initializer, sf) });
      else if (ts.isShorthandPropertyAssignment(prop)) fields.push({ key: prop.name.text, expression: { op: 'ref', path: [prop.name.text] } });
      else return { op: 'unknown', reason: 'Computed property, spread or method is not supported' };
    }
    return { op: 'object', fields };
  }
  if (ts.isArrayLiteralExpression(node)) return { op: 'array', items: node.elements.map(n => expression(n, sf)) };
  return { op: 'unknown', reason: `Not evaluated: ${text(node, sf).slice(0, 100)}` };
}

export function parseTypeScript(file) {
  const sf = ts.createSourceFile(file.name, file.content, ts.ScriptTarget.Latest, true, file.name.endsWith('tsx') ? ts.ScriptKind.TSX : file.name.endsWith('jsx') ? ts.ScriptKind.JSX : file.name.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const contracts = [], functions = [];
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      const members = ts.isInterfaceDeclaration(node) ? node.members : node.type.members;
      contracts.push({ name: node.name.text, fields: members.filter(ts.isPropertySignature).map(p => ({ name: text(p.name, sf).replace(/^['"]|['"]$/g, ''), type: text(p.type, sf) || 'unknown', optional: !!p.questionToken })), line: lineOf(file.content, node.getStart(sf)) });
    }
    const isFunction = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    if (isFunction && node.body) {
      const parent = node.parent;
      const name = node.name?.getText(sf) || (ts.isVariableDeclaration(parent) ? text(parent.name, sf) : `anonymous@${lineOf(file.content, node.getStart(sf))}`);
      const className = ts.isClassDeclaration(parent) ? parent.name?.text : undefined;
      const scopeStarts = [];
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) if (ts.isFunctionLike(ancestor)) scopeStarts.push(ancestor.getStart(sf));
      const fn = { name, className, start: node.getStart(sf), end: node.end, line: lineOf(file.content, node.getStart(sf)), endLine: lineOf(file.content, node.end), parameters: node.parameters.map(p => ({ name: text(p.name, sf), type: text(p.type, sf) || 'unknown' })), calls: [], guards: [], transforms: [], transaction: false, entry: !className && !scopeStarts.length, scopeStarts, localBindings: [], parser: 'typescript-ast' };
      // Only direct top-level immutable declarations/returns are illustratable. No interpreter.
      const statements = ts.isBlock(node.body) ? node.body.statements : [];
      let straightLine = true;
      for (const statement of statements) {
        if (ts.isIfStatement(statement) || ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isTryStatement(statement) || ts.isSwitchStatement(statement) || ts.isExpressionStatement(statement)) straightLine = false;
        if (straightLine && ts.isVariableStatement(statement)) {
          if (!(statement.declarationList.flags & ts.NodeFlags.Const)) { straightLine = false; continue; }
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) { straightLine = false; break; }
            const expr = expression(decl.initializer, sf);
            fn.transforms.push({ target: decl.name.text, expression: expr, line: lineOf(file.content, decl.getStart(sf)) });
            if (JSON.stringify(expr).includes('"op":"unknown"')) { straightLine = false; break; }
          }
        }
        if (straightLine && ts.isReturnStatement(statement)) fn.transforms.push({ target: '$return', expression: expression(statement.expression, sf), line: lineOf(file.content, statement.getStart(sf)) });
      }
      if (!ts.isBlock(node.body)) fn.transforms.push({ target: '$return', expression: expression(node.body, sf), line: fn.line });
      function bodyVisit(child) {
        if (child !== node.body && (ts.isFunctionLike(child) || ts.isClassDeclaration(child))) return;
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) fn.localBindings.push(child.name.text);
        if (ts.isCallExpression(child) || ts.isNewExpression(child)) fn.calls.push({ callee: text(child.expression, sf), line: lineOf(file.content, child.getStart(sf)), args: (child.arguments ?? []).map(a => text(a, sf).slice(0, 120)), construct: ts.isNewExpression(child) });
        if (ts.isIfStatement(child)) fn.guards.push({ condition: text(child.expression, sf), line: lineOf(file.content, child.getStart(sf)), effect: /\bthrow\b/.test(text(child.thenStatement, sf)) ? 'throw' : 'conditional', basis: 'source' });
        ts.forEachChild(child, bodyVisit);
      }
      bodyVisit(node.body);
      functions.push(fn);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { functions, contracts, diagnostics: sf.parseDiagnostics.map(d => ({ severity: 'warning', code: 'PARSE_ERROR', message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), file: file.name, line: lineOf(file.content, d.start ?? 0) })) };
}

// Lexical Java adapter: masks comments and literals without changing offsets. NOT a Java compiler.
export function maskJava(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, match => match.replace(/[^\n\r]/g, ' '));
}
export function parseJava(file) {
  const clean = maskJava(file.content);
  const className = /\b(?:class|interface|record)\s+(\w+)/.exec(clean)?.[1];
  const functions = [], contracts = [];
  const fields = [...clean.matchAll(/\b(?:private|public|protected)\s+(?!static\b)([\w<>?,.\[\] ]+)\s+(\w+)\s*(?:=\s*[^;]+)?;/g)].map(m => ({ name: m[2], type: m[1].trim(), optional: true }));
  const record = /\brecord\s+(\w+)\s*\(([^)]*)\)/.exec(clean);
  if (record) contracts.push({ name: record[1], fields: record[2].split(',').map(p => /([\w<>?\[\]]+)\s+(\w+)/.exec(p)).filter(Boolean).map(m => ({ name: m[2], type: m[1], optional: false })), line: lineOf(clean, record.index) });
  else if (className && fields.length) contracts.push({ name: className, fields, line: 1 });
  const pattern = /\b(public|protected|private)\s+(?:(?:static|final|synchronized|abstract|default)\s+)*([\w<>?,.\[\]]+)\s+(\w+)\s*\(([^()]*)\)\s*(?:throws\s+[\w,. ]+)?\s*\{/g;
  for (const m of clean.matchAll(pattern)) {
    if (['class', 'interface', 'record', 'enum'].includes(m[2])) continue;
    const open = m.index + m[0].lastIndexOf('{');
    let depth = 1, end = open + 1;
    while (end < clean.length && depth) { if (clean[end] === '{') depth++; if (clean[end] === '}') depth--; end++; }
    const body = clean.slice(open + 1, end - 1);
    const rawBody = file.content.slice(open + 1, end - 1);
    const prefix = clean.slice(Math.max(0, m.index - 500), m.index).split(/[;}]/).pop();
    const fn = { name: m[3], className, start: m.index, end, line: lineOf(clean, m.index), endLine: lineOf(clean, end), parameters: m[4].split(',').map(p => /([\w<>?\[\]]+)\s+(\w+)\s*$/.exec(p.trim())).filter(Boolean).map(p => ({ name: p[2], type: p[1] })), calls: [], guards: [], transforms: [], transaction: /@Transactional\b/.test(prefix), entry: /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b/.test(prefix), receiverTypes: Object.fromEntries(fields.map(f => [f.name, f.type])), parser: 'java-lexical' };
    for (const call of body.matchAll(/\b([\w]+(?:\.[\w]+)*)\s*\(/g)) {
      if (['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'throw', 'super', 'this'].includes(call[1])) continue;
      fn.calls.push({ callee: call[1], args: [], line: lineOf(clean, open + 1 + call.index), construct: /new\s+$/.test(body.slice(Math.max(0, call.index - 5), call.index)) });
    }
    for (const guard of rawBody.matchAll(/\bif\s*\(([^\n]{1,200})\)\s*\{/g)) fn.guards.push({ condition: guard[1], line: lineOf(clean, open + 1 + guard.index), effect: 'conditional', basis: 'source' });
    functions.push(fn);
  }
  return { functions, contracts, diagnostics: [{ severity: 'warning', code: 'JAVA_LEXICAL', file: file.name, message: 'Java 使用有限词法适配：不解析重载、泛型逗号、反射、Spring 注入及事务传播；Java 数据转换不自动求值。' }] };
}
