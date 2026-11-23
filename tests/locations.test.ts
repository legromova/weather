import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessLocations } from '../server/locations.js';
const location = (name: string) => ({ name, latitude: 0, longitude: 0 });
test('похожие названия не считаются совпадением города', () => {
  const result = assessLocations('Мурманск', [location('Мурманский'), location('Мурманские Ворота')]);
  assert.equal(result.exactNameMatches.length, 0); assert.match(result.searchAdvice, /латинским/);
});
test('город и аэропорт не создают ложную неоднозначность', () => {
  const result = assessLocations('Murmansk', [location('Murmansk'), location('аэропорт Мурманск')]);
  assert.equal(result.exactNameMatches.length, 1);
});
test('проверка названий работает для произвольных городов и сохраняет неоднозначность', () => {
  assert.equal(assessLocations('São Paulo, Brasil', [location('Sao Paulo')]).exactNameMatches.length, 1);
  assert.equal(assessLocations('нью-йорк', [location('Нью Йорк')]).exactNameMatches.length, 1);
  const result = assessLocations('Казань', [location('Казань'), location('Казань')]);
  assert.equal(result.exactNameMatches.length, 2); assert.match(result.searchAdvice, /уточните/);
});
