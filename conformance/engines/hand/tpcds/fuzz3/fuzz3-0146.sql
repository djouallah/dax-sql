-- one row. m0: the ship modes joined by "," (the blank row, when a catalog sale has no ship mode, an empty
-- one) when there is more than one customer (MINX's
-- COUNTROWS takes no store filter: the whole catalog). m1: DATESINPERIOD on the date column
-- replaces every filter of the date table, the month's too: the 3 months to 2026-02-24
WITH s AS (
  SELECT COUNT(DISTINCT ss_customer_sk) + MAX((ss_customer_sk IS NULL)::INT) AS dc, MAX(ss_ext_sales_price) AS mx, MIN(ss_quantity) AS mq
  FROM store_sales
)
SELECT CASE WHEN COALESCE(s.dc, 0) > 1 THEN (SELECT SUM(LENGTH(COALESCE(sm_type, ''))) + COUNT(*) - 1 FROM (SELECT sm_type FROM ship_mode
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)))
    WHEN COALESCE((SELECT COUNT(*) FROM catalog_sales), 0) < 100 THEN s.mx
    ELSE s.mq END AS m0,
  (SELECT MAX(ss.ss_net_profit) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
   WHERE d.d_date > (DATE '2026-02-24' - INTERVAL 3 MONTH) AND d.d_date <= DATE '2026-02-24') AS m1
FROM s
