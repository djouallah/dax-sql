// Years that end on a year-end argument ("6/30"), and DATESINPERIOD from the last day of a
// month, on the small sales model of fixtures/contoso.js (Date runs 2023-01-01 to 2024-12-31).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(await h.run(dax), expected);
const in2024 = (month, row) => `EVALUATE CALCULATETABLE(ROW(${row}), 'Date'[Year] = 2024, 'Date'[Month] = ${month})`;

test('PREVIOUSYEAR, STARTOFYEAR, ENDOFYEAR with a year end', async () => {
  // March 2024 is in the year July 2023 - June 2024. The year before runs from July 2022; the
  // table holds 2023-01-01 to 2023-06-30 of it: 181 days, sales 1000 + 100 + 800 + 60.
  await eq(in2024(3, `"days", COUNTROWS(PREVIOUSYEAR('Date'[Date], "6/30")), "py", CALCULATE([Sales Amount], PREVIOUSYEAR('Date'[Date], "6/30")),
    "soy", STARTOFYEAR('Date'[Date], "6/30"), "eoy", ENDOFYEAR('Date'[Date], "6/30")`),
  [{ days: 181, py: 1960, soy: '2023-07-01', eoy: '2024-06-30' }]);
  // October 2024's year ends on 2025-06-30, past the table: its last date is 2024-12-31.
  await eq(in2024(10, `"eoy", ENDOFYEAR('Date'[Date], "6/30")`), [{ eoy: '2024-12-31' }]);
});

test('CLOSINGBALANCEYEAR with a year end: the last date the column holds in that year', async () => {
  await eq(in2024(3, `"c", CLOSINGBALANCEYEAR(MAX('Date'[Date]), 'Date'[Date], "6/30")`), [{ c: '2024-06-30' }]);
  await eq(in2024(10, `"c", CLOSINGBALANCEYEAR(MAX('Date'[Date]), 'Date'[Date], "6/30")`), [{ c: '2024-12-31' }]);
});

test('DATESINPERIOD from the last day of a month moves to the end of the moved month', async () => {
  // From April 30, three months back is January 31: February, March and April, 29 + 31 + 30 days.
  await eq(`EVALUATE ROW("days", COUNTROWS(DATESINPERIOD('Date'[Date], dt"2024-04-30", -3, MONTH)))`, [{ days: 90 }]);
});
