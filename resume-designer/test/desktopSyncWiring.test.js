// The macOS sync wiring must run at startup, which means it must sit directly
// in init()'s body. It was once pasted inside window.resetForTesting's arrow
// function: valid JavaScript, green build, green suite, and sync never started.
// Nothing under vitest exercises init(), so this checks the source's shape.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/main.js'), 'utf8');
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// Collects the ancestor chain of every node that passes `test`.
function find(node, test, ancestors = [], hits = []) {
  if (!node || typeof node.type !== 'string') return hits;
  if (test(node)) hits.push(ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => find(c, test, next, hits));
    else if (child && typeof child.type === 'string') find(child, test, next, hits);
  }
  return hits;
}

const isWiringNote = (n) => n.type === 'CallExpression'
  && n.callee.type === 'Identifier' && n.callee.name === 'syncNote'
  && n.arguments[0]?.type === 'TemplateLiteral'
  && n.arguments[0].quasis[0]?.value.cooked.startsWith('wiring reached');

describe('desktop sync wiring', () => {
  it('sits directly in init(), outside every gate and every nested function', () => {
    const hits = find(ast, isWiringNote);
    expect(hits).toHaveLength(1);
    const enclosing = [...hits[0]].reverse().find((n) => FUNCTION_TYPES.has(n.type));
    expect(enclosing?.type).toBe('FunctionDeclaration');
    expect(enclosing?.id?.name).toBe('init');
  });
});
