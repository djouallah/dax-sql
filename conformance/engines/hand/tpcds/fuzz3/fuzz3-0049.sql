-- every color x quarter number: catalog revenue
WITH r AS (
  SELECT i.i_color, d.d_qoy, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT c.i_color, q.d_qoy, r.rev AS m0
FROM (SELECT DISTINCT i_color FROM item) c CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
LEFT JOIN r ON r.i_color IS NOT DISTINCT FROM c.i_color AND r.d_qoy IS NOT DISTINCT FROM q.d_qoy
