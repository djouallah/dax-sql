-- a year's TOTALYTD runs from January to its last date: the whole year; last year: a sale counted
-- in the year of its date a year on
WITH ytd AS (
  SELECT d.d_year AS y, SUM(cs.cs_net_profit) AS v
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
), ly AS (
  SELECT n.d_year AS y, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  GROUP BY ALL
)
SELECT g.d_year, ytd.v AS m0, ly.v AS m1
FROM (SELECT DISTINCT d_year FROM date_dim) g
LEFT JOIN ytd ON ytd.y = g.d_year
LEFT JOIN ly ON ly.y = g.d_year
WHERE ytd.v IS NOT NULL OR ly.v IS NOT NULL
