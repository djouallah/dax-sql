-- blue and coral items: catalog revenue; the quantity's change over a year (all against every date a year back);
-- SUMX over their classes of MIN without a measure (the same smallest profit for every class)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), t AS (
  SELECT SUM(cs.cs_ext_sales_price) AS m0,
    ABS((COALESCE(SUM(cs.cs_quantity), 0) - SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)))
      / NULLIF(SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)), 0)) AS m1,
    MIN(cs.cs_net_profit) * (SELECT COUNT(DISTINCT i_class) + MAX((i_class IS NULL)::INT) FROM item WHERE i_color IN ('blue', 'coral', 'zz-none')) AS m2
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_color IN ('blue', 'coral', 'zz-none')
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
