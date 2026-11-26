-- Grouped by color and price under TREATAS on class and color, the group stays tied to its classes
-- while one of its keys is left (auto-exist); with both removed, or grouped by price alone, only the
-- class filter is left. Under the class filter alone nothing ties the classes to the group.
WITH f AS (SELECT * FROM item WHERE i_class IN ('pants', 'fiction') AND i_color = 'olive'),
fall AS (SELECT string_agg(DISTINCT i_class, ',' ORDER BY i_class) AS cls FROM f),
g AS (SELECT i_color AS c, i_current_price AS p, string_agg(DISTINCT i_class, ',' ORDER BY i_class) AS cls FROM f GROUP BY 1, 2),
j AS (SELECT * FROM item WHERE i_class IN ('pants', 'fiction')),
jall AS (SELECT string_agg(DISTINCT i_class, ',' ORDER BY i_class) AS cls FROM j),
jc AS (SELECT i_color AS c, string_agg(DISTINCT i_class, ',' ORDER BY i_class) AS cls FROM j GROUP BY 1),
jp AS (SELECT i_current_price AS p, string_agg(DISTINCT i_class, ',' ORDER BY i_class) AS cls FROM j GROUP BY 1),
jg AS (SELECT DISTINCT i_color AS c, i_current_price AS p FROM j)
SELECT g.c, g.p, 'color and price grouped', g.cls, g.cls, fall.cls FROM g, fall
UNION ALL
SELECT DISTINCT '-', f.i_current_price, 'price grouped', fall.cls, '-', '-' FROM f, fall
UNION ALL
SELECT jg.c, jg.p, 'class filter only', jc.cls, jp.cls, jall.cls
FROM jg
JOIN jc ON jc.c IS NOT DISTINCT FROM jg.c
JOIN jp ON jp.p IS NOT DISTINCT FROM jg.p
CROSS JOIN jall
