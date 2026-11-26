-- nothing filters the stores: their count for every year and brand
SELECT y.d_year, b.i_brand, (SELECT NULLIF(COUNT(*), 0) FROM store) AS m0
FROM (SELECT DISTINCT d_year FROM date_dim) y CROSS JOIN (SELECT DISTINCT i_brand FROM item) b
