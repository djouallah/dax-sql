-- promotions barought and able; m0: catalog quantity a year back of ship modes TWO DAY, NEXT DAY and EXPRESS;
-- m1: every archive row count (no date filter reaches it) times the store profit
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT i.i_category, SUM(cs.cs_quantity) AS qty_ly
  FROM catalog_sales cs
  JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name IN ('barought', 'able')
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type IN ('TWO DAY', 'NEXT DAY', 'EXPRESS')
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_category, SUM(ss.ss_net_profit) AS profit
  FROM store_sales ss
  JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk AND p.p_promo_name IN ('barought', 'able')
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), t AS (
  SELECT COALESCE(c.i_category, s.i_category) AS i_category, c.qty_ly AS m0,
    (SELECT SUM(row_count) FROM stg_tpcds_archive_log) * s.profit AS m1
  FROM c FULL JOIN s ON s.i_category IS NOT DISTINCT FROM c.i_category
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
