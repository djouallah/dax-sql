-- per year: store revenue and profit, last year's revenue (whole years: the year before), the catalog's
-- smallest sale, and whether a brand sold over 1000 by catalog; the three smallest
WITH s AS (
  SELECT d.d_year AS y, SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT d.d_year AS y, MIN(cs.cs_ext_sales_price) AS mn
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), b AS (
  SELECT DISTINCT y FROM (
    SELECT d.d_year AS y, i.i_brand
    FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
    JOIN item i ON i.i_item_sk = cs.cs_item_sk
    GROUP BY ALL HAVING SUM(cs.cs_quantity) > 1000)
), t AS (
  SELECT y.d_year, s.rev, s.np, l.rev AS ly, c.mn, b.y IS NOT NULL AS big
  FROM (SELECT DISTINCT d_year FROM date_dim) y
  LEFT JOIN s ON s.y = y.d_year
  LEFT JOIN s l ON l.y = y.d_year - 1
  LEFT JOIN c ON c.y = y.d_year
  LEFT JOIN b ON b.y = y.d_year
), v AS (
  SELECT d_year, ly,
    CASE WHEN big THEN
      CASE WHEN COALESCE(rev, 0) > 1 AND np <> 0 THEN (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) ELSE mn END
    ELSE (SELECT COUNT(DISTINCT s_store_name) FROM store) END AS v
  FROM t
)
SELECT d_year, CASE WHEN v IS NULL AND ly IS NULL THEN NULL ELSE COALESCE(v, 0) * 2 + COALESCE(ly, 0) END AS m0
FROM v
WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0) <= 3
