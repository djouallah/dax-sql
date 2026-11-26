-- date_dim is not filtered by item: every (color, brand) of item has the twelve months
SELECT g.i_color, g.i_brand, m.n AS m0
FROM (SELECT DISTINCT i_color, i_brand FROM item) g,
     (SELECT NULLIF(COUNT(DISTINCT d_moy) + (COUNT(*) > COUNT(d_moy))::INT, 0) AS n FROM date_dim) m
WHERE m.n IS NOT NULL
