import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, sameKeyword } from '../src/lib/quality/similarity';

test('aynı metin tam benzer', () => {
  assert.equal(similarity('kedi maması seçimi', 'kedi maması seçimi'), 1);
});

test('alakasız metinler düşük benzer', () => {
  assert.ok(similarity('kedi maması seçimi', 'otomobil lastik basıncı') < 0.4);
});

test('aynı odak kelime yakalanır (Türkçe ön ek)', () => {
  assert.equal(sameKeyword('pos cihazı', 'pos cihazı'), true);
  assert.equal(sameKeyword('kedi diş', 'kedi dişleri'), true);
  assert.equal(sameKeyword('pos cihazı', 'seo denetimi'), false);
});
