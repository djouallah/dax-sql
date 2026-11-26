-- one row. Store Revenue YTD over every date: the calendar's last year. Last year over every
-- date: a sale whose date a year on is in the calendar. MAX(a, b) of two scalars, blank as 0
WITH v AS (
  SELECT CASE WHEN (SELECT SUM(cs_net_profit) FROM catalog_sales) IS NULL THEN 0 ELSE
      (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
       WHERE d.d_year = (SELECT year(MAX(d_date)) FROM date_dim)) END AS a,
    (SELECT SUM(cs_quantity) FROM catalog_sales)
      / NULLIF((SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
                JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE), 0) AS b
)
SELECT CASE WHEN COALESCE(a, 0) > COALESCE(b, 0) THEN a WHEN COALESCE(b, 0) > COALESCE(a, 0) THEN b ELSE COALESCE(a, b) END AS m0
FROM v
