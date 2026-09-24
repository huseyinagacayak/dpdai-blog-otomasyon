import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixAcronyms, normalizeHeadingText, normalizeHeadings } from '../src/lib/pipeline/headings';

test('kısaltmalar büyük yazılır', () => {
  assert.equal(fixAcronyms('pos cihazı'), 'POS cihazı');
  assert.equal(fixAcronyms('seo ve kdv'), 'SEO ve KDV');
  assert.equal(fixAcronyms('pci-dss uyumu'), 'PCI-DSS uyumu');
});

test('başlık: ilk harf büyük + kısaltma', () => {
  assert.equal(normalizeHeadingText('pos cihazı seçimi'), 'POS cihazı seçimi');
  assert.equal(normalizeHeadingText('kuaför pos bakımı'), 'Kuaför POS bakımı');
  // zaten düzgün olan bozulmaz
  assert.equal(normalizeHeadingText('Oto Servis POS Cihazı'), 'Oto Servis POS Cihazı');
});

test('gövdedeki H2/H3 başlıkları düzenlenir', () => {
  const out = normalizeHeadings('<h2>pos cihazı</h2><p>metin</p><h3>seo ipuçları</h3>');
  assert.match(out, /<h2>POS cihazı<\/h2>/);
  assert.match(out, /<h3>SEO ipuçları<\/h3>/);
  // paragraf metnine dokunulmaz
  assert.match(out, /<p>metin<\/p>/);
});
