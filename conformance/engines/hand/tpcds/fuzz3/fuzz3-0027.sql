-- every color x year (m1 is never blank):
--   m0: the marital statuses (no filter reaches customer_demographics) over the color's store
--       profit share, over all years (ALL(d_year))
--   m1: catalog quantity on the year's dates a year back, or 0
--   m2: ISINSCOPE is false: store sales rows
WITH ly AS (
  SELECT d_year, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT d_year, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), share AS (
  SELECT i.i_color, SUM(ss.ss_net_profit) / NULLIF((SELECT SUM(ss_net_profit) FROM store_sales), 0) AS share
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), cnt AS (
  SELECT i.i_color, d.d_year, COUNT(*) AS n
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), cq AS (
  SELECT i.i_color, ly.d_year, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN ly ON ly.dt = d.d_date
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), ms AS (
  SELECT COUNT(DISTINCT cd_marital_status) + MAX(CASE WHEN cd_marital_status IS NULL THEN 1 ELSE 0 END) AS n FROM customer_demographics
)
SELECT c.i_color, y.d_year, ms.n / NULLIF(share.share, 0) AS m0, COALESCE(cq.qty, 0) AS m1, cnt.n AS m2
FROM (SELECT DISTINCT i_color FROM item) c CROSS JOIN (SELECT DISTINCT d_year FROM date_dim) y CROSS JOIN ms
LEFT JOIN share ON share.i_color IS NOT DISTINCT FROM c.i_color
LEFT JOIN cq ON cq.i_color IS NOT DISTINCT FROM c.i_color AND cq.d_year = y.d_year
LEFT JOIN cnt ON cnt.i_color IS NOT DISTINCT FROM c.i_color AND cnt.d_year = y.d_year
