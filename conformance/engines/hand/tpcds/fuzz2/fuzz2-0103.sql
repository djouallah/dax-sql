-- per promotion and store: m0 = 0 when the promotion has no catalog sales, else the count of customer states (never
-- blank, so every promotion x store); m1: in the year -1, round(twice the store revenue of the year's dates a year back
-- plus the store profit, 2), blank when both are; m2: store revenue a year back from every date. A sale with
-- no (or an unknown) store or promotion makes that table's blank row: a blank state and name, or promotion name
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
), ly1 AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim WHERE d_year = -1
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_year = -1 AND d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), y AS (
  SELECT p.p_promo_name, st.s_state, st.s_store_name,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE ss.ss_sold_date_sk IN (SELECT sk FROM ly1)) AS sp,
    SUM(ss.ss_net_profit) FILTER (WHERE d.d_year = -1) AS np
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), cq AS (
  SELECT DISTINCT p.p_promo_name, TRUE AS sold
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  WHERE cs.cs_quantity IS NOT NULL
)
SELECT p.p_promo_name, st.s_state, st.s_store_name,
  CASE WHEN cq.sold IS NULL THEN 0 ELSE (SELECT COUNT(DISTINCT ca_state) + MAX(CASE WHEN ca_state IS NULL THEN 1 ELSE 0 END) FROM customer_address) END AS m0,
  CASE WHEN y.sp IS NOT NULL OR y.np IS NOT NULL THEN ROUND(COALESCE(y.sp * 2, 0) + COALESCE(y.np, 0), 2) END AS m1, r2.rev AS m2
FROM (SELECT DISTINCT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))) p
CROSS JOIN (SELECT DISTINCT s_state, s_store_name FROM store
  UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) st
LEFT JOIN cq ON cq.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
LEFT JOIN y ON y.p_promo_name IS NOT DISTINCT FROM p.p_promo_name AND y.s_state IS NOT DISTINCT FROM st.s_state AND y.s_store_name IS NOT DISTINCT FROM st.s_store_name
LEFT JOIN r2 ON r2.p_promo_name IS NOT DISTINCT FROM p.p_promo_name AND r2.s_state IS NOT DISTINCT FROM st.s_state AND r2.s_store_name IS NOT DISTINCT FROM st.s_store_name
