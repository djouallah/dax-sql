WITH g AS (SELECT DISTINCT p_cost FROM promotion),
x AS (SELECT d.p_cost, SUM(f.cs_quantity) AS x FROM catalog_sales f JOIN promotion d ON f.cs_promo_sk = d.p_promo_sk GROUP BY d.p_cost),
y AS (SELECT d.p_cost, SUM(f.ss_ext_sales_price) AS y FROM store_sales f JOIN promotion d ON f.ss_promo_sk = d.p_promo_sk GROUP BY d.p_cost)
SELECT g.p_cost, x.x, y.y
FROM g
LEFT JOIN x ON x.p_cost IS NOT DISTINCT FROM g.p_cost
LEFT JOIN y ON y.p_cost IS NOT DISTINCT FROM g.p_cost
