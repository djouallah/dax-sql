-- m0: the dates from 2025-09-11 to 2025-06-30 (none) a year back: blank; m2: MAX with no context transition is
-- the same for each education status: its average is the most store profit
WITH t AS (
  SELECT
    (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
     WHERE d.d_date IN (SELECT (d_date - INTERVAL 1 YEAR)::DATE FROM date_dim WHERE d_date BETWEEN DATE '2025-09-11' AND DATE '2025-06-30'
                        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim
                        WHERE d_date BETWEEN DATE '2025-09-11' AND DATE '2025-06-30' AND d_date = last_day(d_date))) AS m0,
    (SELECT ABS(SUM(ss_net_profit)) FROM store_sales) AS m1,
    CASE WHEN EXISTS (SELECT 1 FROM customer_demographics) THEN (SELECT MAX(ss_net_profit) FROM store_sales) END AS m2
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
