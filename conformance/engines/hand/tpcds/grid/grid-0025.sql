WITH g AS (SELECT DISTINCT d_qoy FROM date_dim),
x AS (SELECT d.d_qoy, SUM(f.cs_ext_sales_price) AS x FROM catalog_sales f JOIN date_dim d ON f.cs_sold_date_sk = d.d_date_sk_1 GROUP BY d.d_qoy),
y AS (SELECT d.d_qoy, SUM(f.ss_net_profit) AS y FROM store_sales f JOIN date_dim d ON f.ss_sold_date_sk = d.d_date_sk_1 GROUP BY d.d_qoy)
SELECT g.d_qoy, x.x, y.y
FROM g
LEFT JOIN x ON x.d_qoy IS NOT DISTINCT FROM g.d_qoy
LEFT JOIN y ON y.d_qoy IS NOT DISTINCT FROM g.d_qoy
