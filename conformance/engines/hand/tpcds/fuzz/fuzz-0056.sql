-- the year to date of the date table's last date
SELECT CASE WHEN (SELECT SUM(ss_net_profit) FROM store_sales) IS NULL THEN 0 ELSE
  (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
   WHERE d.d_date BETWEEN date_trunc('year', (SELECT MAX(d_date) FROM date_dim))::DATE AND (SELECT MAX(d_date) FROM date_dim)) END AS m0
