// PATH and the path functions, on the small sales model of fixtures/contoso.js with a
// parent-child table added: Staff, five people under Ann.
//
//   Ann (1) ── Ben (2) ── Di (4) ── Ed (5)
//           └─ Cy (3)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

const staff = {
  name: 'Staff',
  columns: [
    { name: 'StaffKey', dataType: 'int64', sourceColumn: 'StaffKey', isKey: true },
    { name: 'Name', dataType: 'string', sourceColumn: 'Name' },
    { name: 'ManagerKey', dataType: 'int64', sourceColumn: 'ManagerKey' },
  ],
  partitions: [{ name: 'Staff', source: { type: 'entity', entityName: 'Staff' } }],
};
const model = { ...bim, model: { ...bim.model, tables: [...bim.model.tables, staff] } };
const staffSql = `CREATE TABLE "Staff" AS SELECT * FROM (VALUES (1, 'Ann', NULL), (2, 'Ben', 1), (3, 'Cy', 1), (4, 'Di', 2), (5, 'Ed', 4))
  t("StaffKey", "Name", "ManagerKey");`;

let h;
before(async () => { h = await harness(model, setup + staffSql); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));
const P = 'PATH(Staff[StaffKey], Staff[ManagerKey])';

test('PATH: the keys from the root down to the row, and the path functions on it', async () => {
  const row = r('Name', 'Path', 'Depth', 'Second', 'Manager', 'Fifth');
  await eq(`EVALUATE SELECTCOLUMNS(Staff, "Name", Staff[Name], "Path", ${P}, "Depth", PATHLENGTH(${P}),
      "Second", PATHITEM(${P}, 2, INTEGER), "Manager", PATHITEMREVERSE(${P}, 2, INTEGER), "Fifth", PATHITEM(${P}, 5))`, [
    row('Ann', '1', 1, null, null, null), row('Ben', '1|2', 2, 2, 1, null), row('Cy', '1|3', 2, 3, 1, null),
    row('Di', '1|2|4', 3, 2, 2, null), row('Ed', '1|2|4|5', 4, 2, 4, null),
  ]);
});

test('PATH is computed over all the rows, whatever the filter context', async () => {
  // Ed's path goes through Ann, Ben and Di, which the filter removes.
  await eq(`EVALUATE CALCULATETABLE(SELECTCOLUMNS(Staff, "Path", ${P}), Staff[Name] = "Ed")`, [{ Path: '1|2|4|5' }]);
});

test('PATHCONTAINS in a filter: the size of each one\'s team, themselves included', async () => {
  // Ann: everyone; Ben: Ben, Di, Ed; Di: Di, Ed; Cy and Ed: themselves.
  const row = r('Name', 'Team');
  await eq(`EVALUATE ADDCOLUMNS(SELECTCOLUMNS(Staff, "Key", Staff[StaffKey], "Name", Staff[Name]),
      "Team", VAR k = [Key] RETURN COUNTROWS(FILTER(ALL(Staff), PATHCONTAINS(${P}, k))))`, [
    { Key: 1, ...row('Ann', 5) }, { Key: 2, ...row('Ben', 3) }, { Key: 3, ...row('Cy', 1) }, { Key: 4, ...row('Di', 2) }, { Key: 5, ...row('Ed', 1) },
  ]);
});

test('path functions of text: a blank path has no items', async () => {
  await eq('EVALUATE ROW("n", PATHLENGTH(BLANK()), "m", PATHLENGTH("a|b|c"), "i", PATHITEM("a|b|c", 4), "j", PATHITEMREVERSE("a|b|c", 1), "c", PATHCONTAINS("a|b|c", "b"), "d", PATHCONTAINS("a|bc", "b"))',
    [{ n: 0, m: 3, i: null, j: 'c', c: true, d: false }]);
});
