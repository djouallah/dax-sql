-- customers outside California (a sale without an address kept: its blank state is not CA); per store name (every
-- one, the blank row's too when a store sale's store is missing: m1 filters on no store): the smallest store profit
-- over |catalog quantity a year back from every date| (a fixed decimal over a whole number: 4 places), and the
-- smallest catalog profit
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), c AS (
  SELECT ABS(SUM(cs.cs_quantity) FILTER (WHERE cs.cs_sold_date_sk IN (SELECT sk FROM ly))) AS q, MIN(cs.cs_net_profit) AS mn
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  WHERE ca.ca_state IS DISTINCT FROM 'CA'
), s AS (
  SELECT st.s_store_name, MIN(ss.ss_net_profit) AS mn
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  WHERE ca.ca_state IS DISTINCT FROM 'CA'
  GROUP BY ALL
), n AS (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
)
SELECT n.s_store_name, ROUND(s.mn / NULLIF(c.q, 0), 4) AS m0, c.mn AS m1
FROM n CROSS JOIN c
LEFT JOIN s ON s.s_store_name IS NOT DISTINCT FROM n.s_store_name
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
