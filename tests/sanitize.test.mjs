// Unit tests for the frontend XSS / CSS-injection sanitizers in web/js/ui.js.
// Uses Node's built-in test runner (no dependencies): node --test tests/
//
// ui.js is a standalone ES module (no relative imports) but the repo's
// package.json says "type":"commonjs", so we import it from a data: URL — that
// is always treated as ESM and sidesteps the CJS/ESM mismatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
const ui = await import('data:text/javascript,' + encodeURIComponent(src));
const { safeHexColor, safeImageUrl, cssUrl, parseMoney } = ui;

test('safeHexColor accepts valid hex', () => {
  assert.equal(safeHexColor('#abc123'), '#abc123');
  assert.equal(safeHexColor('#ABC'), '#ABC');
  assert.equal(safeHexColor('  #112233  '), '#112233');
});

test('safeHexColor rejects CSS-injection payloads', () => {
  assert.equal(safeHexColor('#000;background:url(//evil/x)', '#252526'), '#252526');
  assert.equal(safeHexColor('red', '#252526'), '#252526');
  assert.equal(safeHexColor('', '#252526'), '#252526');
  assert.equal(safeHexColor(null, '#252526'), '#252526');
  assert.equal(safeHexColor('#000} body{display:none', '#252526'), '#252526');
});

test('safeImageUrl allows the URLs the app actually mints', () => {
  assert.equal(safeImageUrl('https://proj.supabase.co/storage/v1/object/public/media/a.jpg'),
    'https://proj.supabase.co/storage/v1/object/public/media/a.jpg');
  assert.equal(safeImageUrl('data:image/jpeg;base64,AAAABBBBCCCC'), 'data:image/jpeg;base64,AAAABBBBCCCC');
  assert.equal(safeImageUrl('/assets/logo.svg'), '/assets/logo.svg');
});

test('safeImageUrl blocks dangerous or breakout URLs', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(safeImageUrl('//evil.example/x.jpg'), '');           // protocol-relative
  assert.equal(safeImageUrl('https://x/a.jpg") onerror=alert(1) ('), ''); // quote/paren/space breakout
  assert.equal(safeImageUrl('http://insecure/x.jpg'), '');          // not https
  assert.equal(safeImageUrl(''), '');
  assert.equal(safeImageUrl(null), '');
});

test('cssUrl wraps only vetted URLs', () => {
  assert.equal(cssUrl('https://proj.supabase.co/x.jpg'), 'url("https://proj.supabase.co/x.jpg")');
  assert.equal(cssUrl('javascript:alert(1)'), '');
  assert.equal(cssUrl('x");background:url(//evil'), '');
});

test('parseMoney parses and rejects sanely', () => {
  assert.equal(parseMoney('$1,234'), 1234);
  assert.equal(parseMoney('-$5,000'), -5000);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(4200), 4200);
});
