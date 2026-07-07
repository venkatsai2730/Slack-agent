const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../services/llm');

test('extractJson parses clean JSON', () => {
  const result = extractJson('{"a": 1, "b": "two"}', null);
  assert.deepEqual(result, { a: 1, b: 'two' });
});

test('extractJson slices JSON out of surrounding prose (small-model quirk)', () => {
  const result = extractJson('Sure, here you go:\n{"signals": []}\nHope that helps!', null);
  assert.deepEqual(result, { signals: [] });
});

test('extractJson falls back on malformed JSON', () => {
  const fallback = { signals: [] };
  const result = extractJson('not json at all', fallback);
  assert.equal(result, fallback);
});

test('extractJson falls back when braces are absent', () => {
  const fallback = { ok: false };
  const result = extractJson('no braces here', fallback);
  assert.equal(result, fallback);
});
