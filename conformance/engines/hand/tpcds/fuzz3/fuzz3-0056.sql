-- nothing here is filtered by the ship mode: the length of the stores' cities joined by commas, or the brands
-- whose store revenue YTD (the last date's year, through it) passes 1000, whichever is larger
WITH y AS (SELECT MAX(d_date) AS hi FROM date_dim), b AS (
  SELECT COUNT(*) AS n FROM (
    SELECT i.i_brand FROM store_sales ss
    JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
    JOIN y ON d.d_date BETWEEN date_trunc('year', y.hi) AND y.hi
    JOIN item i ON i.i_item_sk = ss.ss_item_sk
    GROUP BY ALL HAVING SUM(ss.ss_ext_sales_price) > 1000)
)
SELECT DISTINCT sm.sm_type, GREATEST((SELECT LENGTH(string_agg(DISTINCT s_city, ',')) FROM store), (SELECT n FROM b)) AS m0
FROM ship_mode sm
