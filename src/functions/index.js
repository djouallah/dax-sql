// The function library: name -> (compiler, args, env, ast) => ir.
//   SCALAR     functions that return a value
//   TABLE      functions that return a table
//   MODIFIERS  what a function means as a filter argument of CALCULATE when that is not a
//              filter (ALL removes filters, USERELATIONSHIP changes a relationship)
import * as scalarFns from './scalar.js';
import * as aggregateFns from './aggregate.js';
import * as tableFns from './table.js';
import * as timeFns from './time.js';
import * as windowFns from './window.js';
import * as visualFns from './visual.js';

export const SCALAR = new Map(Object.entries({ ...scalarFns.scalar, ...aggregateFns.scalar, ...timeFns.scalar, ...windowFns.scalar, ...visualFns.scalar }));
export const TABLE = new Map(Object.entries({ ...tableFns.table, ...timeFns.table, ...windowFns.table }));
export const MODIFIERS = new Map(Object.entries(tableFns.modifiers));

// The fewest arguments a function takes, where it reads one it may not have been given: fewer is
// DAX's error (Power BI's words), not a function failing on an argument that is not there.
// test/errors.test.js calls every function with too few, and with each kind of argument.
const AT_LEAST = {
  1: [
    'SWITCH', 'COALESCE', 'ISBLANK', 'ERROR', 'IFERROR', 'ISNUMBER', 'ISTEXT', 'ISNONTEXT',
    'ISLOGICAL', 'ISEVEN', 'ISODD', 'ABS', 'LOG', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'TRUNC',
    'CEILING', 'FLOOR', 'ISO.CEILING', 'FACT', 'EVEN', 'ODD', 'CONVERT', 'CURRENCY', 'VALUE',
    'LEFT', 'RIGHT', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'UNICODE', 'YEAR', 'MONTH', 'DAY', 'HOUR',
    'MINUTE', 'SECOND', 'QUARTER', 'WEEKDAY', 'WEEKNUM', 'DATEVALUE', 'SUM', 'AVERAGE', 'MIN',
    'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK', 'PRODUCT',
    'MEDIAN', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MINA', 'MAXA', 'AVERAGEA', 'ISFILTERED',
    'ISCROSSFILTERED', 'ISINSCOPE', 'HASONEVALUE', 'HASONEFILTER', 'SELECTEDVALUE', 'LOOKUPVALUE',
    'RELATED', 'EARLIER', 'EARLIEST', 'CONTAINS', 'CONTAINSROW', 'ISEMPTY', 'ALLEXCEPT', 'VALUES',
    'DISTINCT', 'CALCULATETABLE', 'RELATEDTABLE', 'ADDCOLUMNS', 'SELECTCOLUMNS', 'SUMMARIZE',
    'GROUPBY', 'CROSSJOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'ROW', 'TREATAS', 'KEEPFILTERS',
    'FILTERS', 'SUBSTITUTEWITHINDEX', 'DATESYTD', 'DATESQTD', 'DATESMTD', 'SAMEPERIODLASTYEAR',
    'PREVIOUSDAY', 'PREVIOUSMONTH', 'PREVIOUSQUARTER', 'PREVIOUSYEAR', 'NEXTDAY', 'NEXTMONTH',
    'NEXTQUARTER', 'NEXTYEAR', 'STARTOFMONTH', 'STARTOFQUARTER', 'STARTOFYEAR', 'ENDOFMONTH',
    'ENDOFQUARTER', 'ENDOFYEAR', 'FIRSTDATE', 'LASTDATE', 'INDEX', 'OFFSET',
  ],
  2: [
    'USERELATIONSHIP', 'IF', 'IF.EAGER', 'DIVIDE', 'MROUND', 'CONCATENATE', 'COMBINEVALUES', 'SEARCH', 'FIND', 'REPT',
    'EXACT', 'CONTAINSSTRING', 'CONTAINSSTRINGEXACT', 'EOMONTH', 'EDATE', 'DATEDIFF', 'SUMX',
    'AVERAGEX', 'MINX', 'MAXX', 'COUNTX', 'COUNTAX', 'PRODUCTX', 'MEDIANX', 'STDEVX.S', 'STDEVX.P',
    'VARX.S', 'VARX.P', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'CONCATENATEX', 'RANKX', 'TOTALYTD',
    'TOTALQTD', 'TOTALMTD', 'CLOSINGBALANCEMONTH', 'CLOSINGBALANCEQUARTER', 'CLOSINGBALANCEYEAR',
    'OPENINGBALANCEMONTH', 'OPENINGBALANCEQUARTER', 'OPENINGBALANCEYEAR', 'FILTER', 'TOPN',
    'GENERATE', 'GENERATEALL', 'GENERATESERIES', 'CALENDAR', 'FIRSTNONBLANK', 'LASTNONBLANK',
    'NATURALINNERJOIN', 'NATURALLEFTOUTERJOIN', 'DATEADD', 'PARALLELPERIOD', 'WINDOW',
  ],
  3: [
    'CROSSFILTER', 'SUBSTITUTE', 'DATE', 'TIME', 'PERCENTILEX.INC', 'PERCENTILEX.EXC', 'TOPNSKIP', 'DATESBETWEEN',
    'DATESINPERIOD',
  ],
};
const MIN = new Map(Object.entries(AT_LEAST).flatMap(([n, fs]) => fs.map(f => [f, Number(n)])));
export const minArgs = name => MIN.get(name) ?? 0;
