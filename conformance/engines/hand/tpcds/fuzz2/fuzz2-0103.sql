-- per promotion and store: m0 = 0 when the promotion has no catalog sales, else the count of customer states (never
-- blank, so every promotion x store); m1: no year -1 (blank); m2: store revenue a year back from every date
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), r AS (
  SELECT ss.ss_promo_sk, ss.ss_store_sk, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss WHERE ss.ss_sold_date_sk IN (SELECT sk FROM ly)
  GROUP BY ALL
), r2 AS (
  SELECT p.p_promo_name, st.s_state, st.s_store_name, SUM(r.rev) AS rev
  FROM r LEFT JOIN promotion p ON p.p_promo_sk = r.ss_promo_sk LEFT JOIN store st ON st.s_store_sk = r.ss_store_sk
  GROUP BY ALL
), cq AS (
  SELECT DISTINCT p.p_promo_name, TRUE AS sold
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  WHERE cs.cs_quantity IS NOT NULL
)
SELECT p.p_promo_name, st.s_state, st.s_store_name,
  CASE WHEN cq.sold IS NULL THEN 0 ELSE (SELECT COUNT(DISTINCT ca_state) + MAX(CASE WHEN ca_state IS NULL THEN 1 ELSE 0 END) FROM customer_address) END AS m0,
  NULL::DOUBLE AS m1, r2.rev AS m2
FROM (SELECT DISTINCT p_promo_name FROM promotion) p
CROSS JOIN (SELECT DISTINCT s_state, s_store_name FROM store) st
LEFT JOIN cq ON cq.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
LEFT JOIN r2 ON r2.p_promo_name IS NOT DISTINCT FROM p.p_promo_name AND r2.s_state IS NOT DISTINCT FROM st.s_state AND r2.s_store_name IS NOT DISTINCT FROM st.s_store_name
