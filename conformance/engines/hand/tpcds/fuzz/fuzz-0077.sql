-- SUMX over the marital statuses of a value no status row changes: their number times it; with no
-- catalog quantity over 1000 that is the item's distinct prices (the item is not filtered). The statuses and the
-- states have their blank value too when the model has that blank row.
WITH c AS (
  SELECT ca.ca_state AS st, MIN(cs.cs_quantity) AS mn
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY 1
), s AS (
  SELECT ca.ca_state AS st, ROUND(AVG(ss.ss_net_profit), 4) AS av
  FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  GROUP BY 1
), k AS (
  SELECT (SELECT COUNT(*) FROM (SELECT cd_marital_status FROM customer_demographics
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)))) AS n,
    (SELECT NULLIF(COUNT(DISTINCT i_current_price) + MAX(CASE WHEN i_current_price IS NULL THEN 1 ELSE 0 END), 0) FROM item) AS prices
), r AS (
  SELECT g.st, k.n * CASE WHEN c.mn > 1000 THEN s.av ELSE k.prices END AS m0
  FROM (SELECT ca_state AS st FROM customer_address
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_addr_sk IS NULL OR ss_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_addr_sk IS NULL OR cs_bill_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address)
      OR cs_ship_addr_sk IS NULL OR cs_ship_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address))) g
  CROSS JOIN k
  LEFT JOIN c ON c.st IS NOT DISTINCT FROM g.st
  LEFT JOIN s ON s.st IS NOT DISTINCT FROM g.st
)
SELECT * FROM r WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 4
