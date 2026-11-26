-- per class (ADDCOLUMNS' row context: AVERAGE, no measure, sees every catalog sale): last year's store revenue
-- (every date a year back) past 1000 or a year-over-year change picks the overall average quantity, else the
-- class's catalog quantity; the top three, ties broken by class
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT i.i_class AS c, SUM(ss.ss_ext_sales_price) AS sply
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT dt FROM ly)
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), q AS (
  SELECT i.i_class AS c, SUM(cs.cs_quantity) AS csq
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), t AS (
  SELECT g.i_class,
    CASE WHEN s.sply > 1000 OR s.sply <> 0 THEN (SELECT AVG(cs_quantity) FROM catalog_sales) ELSE q.csq END AS m0
  FROM (SELECT DISTINCT i_class FROM item) g
  LEFT JOIN s ON s.c IS NOT DISTINCT FROM g.i_class
  LEFT JOIN q ON q.c IS NOT DISTINCT FROM g.i_class
)
SELECT * FROM t QUALIFY RANK() OVER (ORDER BY m0 DESC NULLS LAST, i_class ASC NULLS FIRST) <= 3
