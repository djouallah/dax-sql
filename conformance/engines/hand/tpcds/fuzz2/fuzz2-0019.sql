-- per item color:
-- m0: the rank, among the years, of catalog revenue over every year
-- m1: the larger of (no store profit and no store revenue in the calendar's last year ? 0 :
--     more than 10 store sales ? catalog quantity a year back : store quantity)
--     and the dense rank, among the education statuses, of store net profit over every status
-- m2: blank (more than one year)
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), ly AS (
  SELECT d_date_sk_1 FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), c AS (
  SELECT DISTINCT i_color FROM item
), csy AS (
  SELECT i.i_color, d.d_year, GROUPING(d.d_year) AS ally, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY GROUPING SETS ((i.i_color, d.d_year), (i.i_color))
), csly AS (
  SELECT i.i_color, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk JOIN ly ON ly.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), ss AS (
  SELECT i.i_color, SUM(ss.ss_net_profit) AS np, COUNT(*) AS n, SUM(ss.ss_quantity) AS qty,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN w.y0 AND w.y1) AS ytd
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk CROSS JOIN w
  GROUP BY ALL
), sse AS (
  SELECT i.i_color, cd.cd_education_status, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT c.i_color,
  1 + (SELECT COUNT(*) FROM (SELECT DISTINCT d_year FROM date_dim) y
       LEFT JOIN csy r ON r.ally = 0 AND r.d_year = y.d_year AND r.i_color IS NOT DISTINCT FROM c.i_color
       WHERE COALESCE(r.rev, 0) > COALESCE(t.rev, 0)) AS m0,
  GREATEST(
    CASE WHEN ss.np IS NULL AND ss.ytd IS NULL THEN 0 WHEN ss.n > 10 THEN csly.qty ELSE ss.qty END,
    1 + (SELECT COUNT(DISTINCT COALESCE(e.np, 0))
         FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) x
         LEFT JOIN sse e ON e.cd_education_status IS NOT DISTINCT FROM x.cd_education_status AND e.i_color IS NOT DISTINCT FROM c.i_color
         WHERE COALESCE(e.np, 0) > COALESCE(ss.np, 0))) AS m1,
  CAST(NULL AS DECIMAL(18, 4)) AS m2
FROM c
LEFT JOIN csy t ON t.ally = 1 AND t.i_color IS NOT DISTINCT FROM c.i_color
LEFT JOIN ss ON ss.i_color IS NOT DISTINCT FROM c.i_color
LEFT JOIN csly ON csly.i_color IS NOT DISTINCT FROM c.i_color
