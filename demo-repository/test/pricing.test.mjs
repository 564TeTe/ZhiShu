import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDiscount } from '../src/pricing.mjs';

test('keeps a valid discount rate unchanged', () => {
  assert.equal(calculateDiscount(200, 0.2), 40);
});

test('treats a negative discount rate as zero', () => {
  assert.equal(calculateDiscount(200, -0.1), 0);
});

test('caps a discount rate at fifty percent', () => {
  assert.equal(calculateDiscount(200, 0.8), 100);
});
