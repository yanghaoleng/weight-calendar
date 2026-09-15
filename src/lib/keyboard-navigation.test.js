import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalIndex, isEditingText } from './keyboard-navigation.js';

test('arrow navigation follows keypad rows and columns', () => {
  const grid = Array.from({ length: 12 }, (_, i) => ({ x: (i % 3) * 100, y: Math.floor(i / 3) * 70 }));
  assert.equal(directionalIndex(grid, 4, 'ArrowLeft'), 3);
  assert.equal(directionalIndex(grid, 4, 'ArrowRight'), 5);
  assert.equal(directionalIndex(grid, 4, 'ArrowUp'), 1);
  assert.equal(directionalIndex(grid, 4, 'ArrowDown'), 7);
  assert.equal(directionalIndex(grid, 1, 'ArrowUp'), -1);
});

test('calendar arrows preserve weekday when moving by week', () => {
  const grid = Array.from({ length: 35 }, (_, i) => ({ x: (i % 7) * 60, y: Math.floor(i / 7) * 90 }));
  assert.equal(directionalIndex(grid, 9, 'ArrowDown'), 16);
  assert.equal(directionalIndex(grid, 9, 'ArrowUp'), 2);
  assert.equal(directionalIndex(grid, 9, 'ArrowRight'), 10);
});

test('text editing targets retain native keyboard behavior', () => {
  assert.equal(isEditingText(null), false);
  assert.equal(isEditingText({ isContentEditable: true }), true);
  assert.equal(isEditingText({ closest: () => ({}) }), true);
  assert.equal(isEditingText({ closest: () => null }), false);
});
