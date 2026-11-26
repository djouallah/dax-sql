-- every color x quarter number (each with its blank row when some row's key misses the table: a sale without a
-- date is in the blank quarter): catalog revenue
WITH r AS (
  SELECT i.i_color, d.d_qoy, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), c AS (
  SELECT DISTINCT i_color FROM item
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
                       OR EXISTS (FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk)
), q AS (
  SELECT DISTINCT d_qoy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)
)
SELECT c.i_color, q.d_qoy, r.rev AS m0
FROM c CROSS JOIN q
LEFT JOIN r ON r.i_color IS NOT DISTINCT FROM c.i_color AND r.d_qoy IS NOT DISTINCT FROM q.d_qoy
