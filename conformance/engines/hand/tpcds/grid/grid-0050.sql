WITH g AS (SELECT DISTINCT i_current_price FROM item),
x AS (SELECT d.i_current_price, SUM(f.cs_ext_sales_price) AS x FROM catalog_sales f JOIN item d ON f.cs_item_sk = d.i_item_sk GROUP BY d.i_current_price),
y AS (SELECT d.i_current_price, COUNT(DISTINCT f.ss_customer_sk) + (COUNT(*) > COUNT(f.ss_customer_sk))::INT AS y FROM store_sales f JOIN item d ON f.ss_item_sk = d.i_item_sk GROUP BY d.i_current_price)
SELECT g.i_current_price, x.x, y.y
FROM g
LEFT JOIN x ON x.i_current_price IS NOT DISTINCT FROM g.i_current_price
LEFT JOIN y ON y.i_current_price IS NOT DISTINCT FROM g.i_current_price
