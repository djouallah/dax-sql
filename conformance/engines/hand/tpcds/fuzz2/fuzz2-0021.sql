-- stores "pri" and "ese", promotions other than "ese" (a promotion with no name kept: blank <> "ese"), per year:
-- m0: the year's months when archive source rows x 2 + the year's top catalog profit > 1 (one test for every month)
-- m1: the year's store revenue YoY / its store revenue, or 0
-- m2: store quantity
WITH pr AS (
  SELECT p_promo_sk FROM promotion WHERE p_promo_name IS DISTINCT FROM 'ese'
), ss AS (
  SELECT d.d_year, SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_quantity) AS qty
  FROM store_sales ss
  JOIN store s ON s.s_store_sk = ss.ss_store_sk AND s.s_store_name IN ('pri', 'ese')
  JOIN pr ON pr.p_promo_sk = ss.ss_promo_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), cs AS (
  SELECT d.d_year, MAX(cs.cs_net_profit) AS top
  FROM catalog_sales cs JOIN pr ON pr.p_promo_sk = cs.cs_promo_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), y AS (
  SELECT d_year, COUNT(DISTINCT d_moy) AS months FROM date_dim GROUP BY ALL
)
SELECT y.d_year,
  CASE WHEN COALESCE((SELECT SUM(row_count) FROM stg_tpcds_archive_log) * 2, 0) + COALESCE(cs.top, 0) > 1 THEN y.months END AS m0,
  COALESCE(((COALESCE(c.rev, 0) - l.rev) / NULLIF(l.rev, 0)) / NULLIF(c.rev, 0), 0) AS m1,
  c.qty AS m2
FROM y
LEFT JOIN ss c ON c.d_year = y.d_year
LEFT JOIN ss l ON l.d_year = y.d_year - 1
LEFT JOIN cs ON cs.d_year = y.d_year
