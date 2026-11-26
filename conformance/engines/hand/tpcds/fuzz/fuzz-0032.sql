-- the class and color pairs of the items; no filter reaches store from item: every store
SELECT i_class, i_color, (SELECT NULLIF(COUNT(*), 0) FROM store) AS m0
FROM (SELECT DISTINCT i_class, i_color FROM item)
WHERE m0 IS NOT NULL
