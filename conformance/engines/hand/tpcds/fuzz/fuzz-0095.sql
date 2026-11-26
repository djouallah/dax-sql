-- the store and item tables are filtered by neither the dates nor the address: the larger of their
-- row counts for every month, all tied (a blank month too: a sale with no or an unknown date)
WITH v AS (SELECT GREATEST((SELECT COUNT(*) FROM store), (SELECT COUNT(*) FROM item)) AS m0),
m AS (
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT d.d_moy, v.m0
FROM m d CROSS JOIN v
WHERE v.m0 > 0
QUALIFY RANK() OVER (ORDER BY v.m0) <= 1
