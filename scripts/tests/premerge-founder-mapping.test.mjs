import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

test('configured founder identity uses explicit synthetic mappings, not real secrets or creator slugs', async () => {
  const ts = createRequire(resolve('package.json'))('typescript');
  const text = await readFile('artifacts/api-server/src/lib/creator-account.ts', 'utf8');
  const source = ts.createSourceFile('creator-account.ts', text, ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'configuredFounderMatches');
  assert.ok(fn, 'test must use the real helper, not a copied implementation');
  const js = ts.transpileModule(fn.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, process: { env: {} } };
  vm.runInNewContext(js, context, { timeout: 100 });
  const match = context.exports.configuredFounderMatches;
  const founder = { id: 'synthetic-founder', email: 'FOUNDER@example.invalid' };
  assert.equal(match(founder, { userId: 'synthetic-founder' }), true);
  assert.equal(match(founder, { userId: ' synthetic-founder ' }), true);
  assert.equal(match(founder, { email: ' founder@example.invalid ' }), true);
  assert.equal(match(founder, { userId: 'other', email: 'founder@example.invalid' }), false);
  assert.equal(match({ id: 'other', email: null, username: 'fheed' }, { userId: 'synthetic-founder' }), false);
  assert.equal(match({ id: 'other', email: null }, { email: 'founder@example.invalid' }), false);
  assert.equal(match(founder, {}), false);
});