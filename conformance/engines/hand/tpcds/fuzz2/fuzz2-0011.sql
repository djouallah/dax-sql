-- per item class and store city: distinct store customers / the class's catalog quantity, and
-- (the class's catalog profit > 100 ? its catalog revenue : the calendar's years)
WITH ss AS (
  SELECT i.i_class, s.s_city, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS cust
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), cs AS (
  SELECT i.i_class, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_net_profit) AS profit, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT c.i_class, t.s_city,
  ss.cust / NULLIF(cs.qty, 0),
  CASE WHEN COALESCE(cs.profit, 0) > 100 THEN cs.rev ELSE (SELECT COUNT(DISTINCT d_year) FROM date_dim) END
FROM (SELECT DISTINCT i_class FROM item) c CROSS JOIN (SELECT DISTINCT s_city FROM store) t
LEFT JOIN ss ON ss.i_class IS NOT DISTINCT FROM c.i_class AND ss.s_city IS NOT DISTINCT FROM t.s_city
LEFT JOIN cs ON cs.i_class IS NOT DISTINCT FROM c.i_class
