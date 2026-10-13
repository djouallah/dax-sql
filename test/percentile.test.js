// PERCENTILE(X).INC/EXC over values with blanks, and k out of range; on the model of
// fixtures/contoso.js, every expected result worked out by hand from its 5 products.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

test('PERCENTILEX: the blanks count and come first', async () => {
  // The prices of 100 or more, blank for the others: blank, blank, blank, 800, 1000 (n = 5).
  // EXC ranks 3, 4.5 and 4.8; INC ranks 3 and 4.5.
  const big = 'IF(Product[Price] >= 100, Product[Price])';
  assert.deepEqual(await h.run(`EVALUATE ROW(
    "e50", PERCENTILEX.EXC(Product, ${big}, 0.5), "e75", PERCENTILEX.EXC(Product, ${big}, 0.75),
    "e80", PERCENTILEX.EXC(Product, ${big}, 0.8),
    "i50", PERCENTILEX.INC(Product, ${big}, 0.5), "i875", PERCENTILEX.INC(Product, ${big}, 0.875),
    "none", PERCENTILEX.EXC(FILTER(Product, FALSE()), Product[Price], 0.5))`),
  [{ e50: null, e75: 900, e80: 960, i50: null, i875: 900, none: null }]);
});

test('PERCENTILE.INC/EXC: a k out of range is an error', async () => {
  // 5 prices: for EXC, k = 0.1 is rank 0.6; INC takes k in 0..1.
  await assert.rejects(h.run('EVALUATE ROW("p", PERCENTILE.EXC(Product[Price], 0.1))'));
  await assert.rejects(h.run('EVALUATE ROW("p", PERCENTILE.INC(Product[Price], 1.5))'));
});
