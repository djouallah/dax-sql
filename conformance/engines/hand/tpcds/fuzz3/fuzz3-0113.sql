-- items other than Books (a blank category is not "Books"); YoY over every date (last year: a
-- sale whose date a year on is in the calendar); m1: the class and color's distinct customers in
-- PARALLELPERIOD(-4 months) of the whole calendar, its first month less 4 to its last month less 4
WITH it AS (SELECT * FROM item WHERE COALESCE(i_category, '') <> 'Books'),
rng AS (
  SELECT date_trunc('month', MIN(d_date) - INTERVAL 4 MONTH)::DATE AS lo,
         last_day((MAX(d_date) - INTERVAL 4 MONTH)::DATE) AS hi
  FROM date_dim
), f AS (
  SELECT it.i_class, it.i_color, d.d_date, n.d_date IS NOT NULL AS has_next, ss.ss_ext_sales_price AS rev, ss.ss_customer_sk AS cust
  FROM store_sales ss
  JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
), a AS (
  SELECT i_class, i_color, SUM(rev) AS cur, SUM(rev) FILTER (WHERE has_next) AS ly,
    COUNT(DISTINCT cust) FILTER (WHERE d_date BETWEEN rng.lo AND rng.hi)
      + MAX((cust IS NULL AND d_date BETWEEN rng.lo AND rng.hi)::INT) AS dc
  FROM f, rng GROUP BY ALL
), t AS (
  SELECT a.i_class, a.i_color, (COALESCE(cur, 0) - ly) / NULLIF(ly, 0) AS m0, NULLIF(dc, 0)::DOUBLE AS m1 FROM a
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
