-- m0: twice the store quantity of the city over the year to date of the month's last date (DATESYTD of the
-- dates with that d_moy: the last year's month), plus every archive row count
-- m1: catalog YoY of the month (blue and almond items) over catalog's average price from 2025-10-24 to 2026-05-13
WITH months AS (
  SELECT d_moy, MAX(d_date) AS last_dt FROM date_dim GROUP BY d_moy
), cities AS (
  SELECT DISTINCT s_city FROM store
), ssd AS (
  SELECT s.s_city, d.d_date AS dt, SUM(ss.ss_quantity) AS qty
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), ytd AS (
  SELECT m.d_moy, c.s_city, SUM(ssd.qty) AS qty
  FROM months m CROSS JOIN cities c
  JOIN ssd ON ssd.s_city IS NOT DISTINCT FROM c.s_city AND ssd.dt BETWEEN date_trunc('year', m.last_dt)::DATE AND m.last_dt
  GROUP BY ALL
), arch AS (
  SELECT SUM(row_count) AS rows FROM stg_tpcds_archive_log
), csd AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN item i ON i.i_item_sk = cs.cs_item_sk
  WHERE i.i_color IN ('blue', 'almond')
  GROUP BY ALL
), shift AS (
  SELECT d_moy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_moy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), cur AS (
  SELECT d.d_moy, SUM(csd.qty) AS qty FROM date_dim d JOIN csd ON csd.dt = d.d_date GROUP BY ALL
), ly AS (
  SELECT shift.d_moy, SUM(csd.qty) AS qty FROM shift JOIN csd ON csd.dt = shift.ly GROUP BY ALL
), avgp AS (
  SELECT AVG(cs.cs_ext_sales_price) AS p
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_date BETWEEN DATE '2025-10-24' AND DATE '2026-05-13'
), t AS (
  SELECT m.d_moy, c.s_city,
    CASE WHEN ytd.qty IS NULL AND arch.rows IS NULL THEN NULL ELSE COALESCE(ytd.qty * 2, 0) + COALESCE(arch.rows, 0) END AS m0,
    ROUND(((COALESCE(cur.qty, 0) - ly.qty) / NULLIF(ly.qty, 0)) / NULLIF(avgp.p, 0), 2) AS m1
  FROM months m CROSS JOIN cities c CROSS JOIN arch CROSS JOIN avgp
  LEFT JOIN ytd ON ytd.d_moy = m.d_moy AND ytd.s_city IS NOT DISTINCT FROM c.s_city
  LEFT JOIN cur ON cur.d_moy = m.d_moy
  LEFT JOIN ly ON ly.d_moy = m.d_moy
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
