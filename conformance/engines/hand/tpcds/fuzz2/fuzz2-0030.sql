-- per customer state, ship mode type and store city:
-- m0: the item categories (no filter reaches item) / catalog quantity of non-single bill customers
-- m1: store net profit
-- (the dimensions' values make the groups; a sale with no address, ship mode or store counts under a blank one)
WITH cs AS (
  SELECT ca.ca_state, sm.sm_type, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  WHERE COALESCE(cd.cd_marital_status, '') <> 'S'
  GROUP BY ALL
), ss AS (
  SELECT ca.ca_state, st.s_city, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), cats AS (
  SELECT COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) AS n FROM item
)
SELECT a.ca_state, t.sm_type, c.s_city, cats.n / NULLIF(cs.qty, 0) AS m0, ss.np AS m1
FROM (SELECT DISTINCT ca_state FROM customer_address) a
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
CROSS JOIN (SELECT DISTINCT s_city FROM store) c
CROSS JOIN cats
LEFT JOIN cs ON cs.ca_state IS NOT DISTINCT FROM a.ca_state AND cs.sm_type IS NOT DISTINCT FROM t.sm_type
LEFT JOIN ss ON ss.ca_state IS NOT DISTINCT FROM a.ca_state AND ss.s_city IS NOT DISTINCT FROM c.s_city
WHERE cs.qty IS NOT NULL OR ss.np IS NOT NULL
