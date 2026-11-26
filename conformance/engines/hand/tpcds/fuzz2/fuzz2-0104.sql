-- per customer state: the archive's file count (unrelated, constant) and catalog quantity a year back from every date
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), q AS (
  SELECT ca.ca_state, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  WHERE cs.cs_sold_date_sk IN (SELECT sk FROM ly)
  GROUP BY ALL
)
SELECT s.ca_state, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0, q.q AS m1
FROM (SELECT DISTINCT ca_state FROM customer_address) s
LEFT JOIN q ON q.ca_state IS NOT DISTINCT FROM s.ca_state
