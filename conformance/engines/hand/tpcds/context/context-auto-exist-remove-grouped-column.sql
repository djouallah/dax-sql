-- Under TREATAS on class and color, a group's (color, price) stays tied to its classes once the
-- price is removed (auto-exist): the classes left are the group's own. With no class filter, the
-- price removed leaves every class of the color.
WITH f AS (SELECT * FROM item WHERE i_class IN ('pants', 'fiction') AND i_color = 'olive'),
prices AS (SELECT DISTINCT i_current_price AS q FROM item),
-- the class filter's groups and their classes
gc AS (SELECT DISTINCT i_color AS c, i_current_price AS p, i_class AS k FROM f),
g AS (SELECT c, p, string_agg(k, ',' ORDER BY k) AS cls FROM gc GROUP BY c, p),
-- each group's classes at each price (of its color)
gq AS (
  SELECT gc.c, gc.p, i.i_current_price AS q, string_agg(DISTINCT i.i_class, ',' ORDER BY i.i_class) AS cls
  FROM gc JOIN item i ON i.i_color = gc.c AND i.i_class = gc.k
  GROUP BY gc.c, gc.p, i.i_current_price),
gp AS (
  SELECT g.c, g.p, g.cls, string_agg(COALESCE(gq.cls, ''), ';' ORDER BY pr.q NULLS FIRST) AS per
  FROM g CROSS JOIN prices pr
  LEFT JOIN gq ON gq.c = g.c AND gq.p IS NOT DISTINCT FROM g.p AND gq.q IS NOT DISTINCT FROM pr.q
  GROUP BY g.c, g.p, g.cls),
-- no class filter: olive's classes, and olive's classes at each price
o AS (SELECT * FROM item WHERE i_color = 'olive'),
ocls AS (SELECT string_agg(DISTINCT COALESCE(i_class, ''), ',' ORDER BY COALESCE(i_class, '')) AS cls FROM o),
oq AS (SELECT i_current_price AS q, string_agg(DISTINCT COALESCE(i_class, ''), ',' ORDER BY COALESCE(i_class, '')) AS cls FROM o GROUP BY i_current_price),
oper AS (
  SELECT string_agg(COALESCE(oq.cls, ''), ';' ORDER BY pr.q NULLS FIRST) AS per
  FROM prices pr LEFT JOIN oq ON oq.q IS NOT DISTINCT FROM pr.q)
SELECT c, p, 'plain', cls, cls, per FROM gp
UNION ALL
SELECT c, p, 'keepfilters', cls, cls, per FROM gp
UNION ALL
SELECT DISTINCT o.i_color, o.i_current_price, 'no class filter', ocls.cls, ocls.cls, oper.per
FROM o, ocls, oper
