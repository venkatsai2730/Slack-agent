const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractMentionedUserIds } = require('../services/searchService');

test('extractMentionedUserIds finds Slack user mentions', () => {
  const ids = extractMentionedUserIds('hey <@U123ABC> can you loop in <@U456DEF>?');
  assert.deepEqual(ids, ['U123ABC', 'U456DEF']);
});

test('extractMentionedUserIds dedupes repeated mentions', () => {
  const ids = extractMentionedUserIds('<@U123ABC> ping <@U123ABC> again');
  assert.deepEqual(ids, ['U123ABC']);
});

test('extractMentionedUserIds returns [] when there are no mentions', () => {
  assert.deepEqual(extractMentionedUserIds('no mentions here'), []);
  assert.deepEqual(extractMentionedUserIds(), []);
});
