const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHoursBack } = require('../services/scan');

test('parseHoursBack defaults to 24 when no value given', () => {
  assert.equal(parseHoursBack(undefined), 24);
  assert.equal(parseHoursBack(''), 24);
});

test('parseHoursBack defaults on non-numeric input', () => {
  assert.equal(parseHoursBack('abc'), 24);
});

test('parseHoursBack parses a valid numeric string', () => {
  assert.equal(parseHoursBack('48'), 48);
});

test('parseHoursBack clamps to the max lookback window', () => {
  assert.equal(parseHoursBack('9999'), 168);
});

test('parseHoursBack respects custom defaultHours/maxHours', () => {
  assert.equal(parseHoursBack(undefined, { defaultHours: 12, maxHours: 48 }), 12);
  assert.equal(parseHoursBack('100', { defaultHours: 12, maxHours: 48 }), 48);
});
