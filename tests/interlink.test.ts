import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertLinks } from '../src/lib/pipeline/interlink';

test('metinde geçen bağlı metne link konur', () => {
  const { html, inserted } = insertLinks('<p>POS cihazı ile ödeme alın.</p>', [
    { anchor: 'POS cihazı', url: 'https://x/y', targetId: 't1' },
  ]);
  assert.equal(inserted.length, 1);
  assert.match(html, /<a href="https:\/\/x\/y">POS cihazı<\/a>/);
});

test('metinde geçmeyen bağlı metin atlanır', () => {
  const { inserted, skipped } = insertLinks('<p>Sadece metin.</p>', [
    { anchor: 'olmayan ifade', url: '/z', targetId: 't2' },
  ]);
  assert.equal(inserted.length, 0);
  assert.equal(skipped.length, 1);
});

test('başlık içindeki ifadeye link konmaz', () => {
  const { inserted } = insertLinks('<h2>POS cihazı rehberi</h2><p>giriş.</p>', [
    { anchor: 'POS cihazı', url: '/h', targetId: 't3' },
  ]);
  assert.equal(inserted.length, 0);
});

test('aynı hedefe iki kez link verilmez', () => {
  const { inserted } = insertLinks('<p>POS cihazı ve yine POS cihazı.</p>', [
    { anchor: 'POS cihazı', url: '/a', targetId: 't4' },
    { anchor: 'POS cihazı', url: '/a', targetId: 't4' },
  ]);
  assert.equal(inserted.length, 1);
});
