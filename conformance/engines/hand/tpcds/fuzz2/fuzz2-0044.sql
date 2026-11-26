-- store revenue / store net profit, and the store names with a positive net profit
SELECT (SELECT SUM(ss_ext_sales_price) / NULLIF(SUM(ss_net_profit), 0) FROM store_sales) AS m0,
  (SELECT NULLIF(COUNT(*), 0) FROM (
     SELECT s.s_store_name FROM store s JOIN store_sales ss ON ss.ss_store_sk = s.s_store_sk
     GROUP BY s.s_store_name HAVING SUM(ss.ss_net_profit) > 0)) AS m1
