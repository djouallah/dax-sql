-- nothing here is filtered by the ship mode: for every ship-mode type (the blank row's too, when a catalog sale's
-- ship mode is missing) the length of the stores' cities joined by commas (store's blank row an empty city), or
-- the brands whose store revenue YTD (the last date's year, through it) passes 1000, whichever is larger
WITH y AS (SELECT MAX(d_date) AS hi FROM date_dim), b AS (
  SELECT COUNT(*) AS n FROM (
    SELECT i.i_brand FROM store_sales ss
    JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
    JOIN y ON d.d_date BETWEEN date_trunc('year', y.hi) AND y.hi
    LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
    GROUP BY ALL HAVING SUM(ss.ss_ext_sales_price) > 1000)
), city AS (
  SELECT DISTINCT s_city FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
), sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT sm.sm_type, GREATEST((SELECT LENGTH(string_agg(COALESCE(s_city, ''), ',')) FROM city), (SELECT n FROM b)) AS m0
FROM sm
