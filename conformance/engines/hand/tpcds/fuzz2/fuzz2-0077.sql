-- Per brand, the marital statuses whose store revenue of the date table's last year (TOTALYTD with no date
-- filter) is past 1: the brand's row and the status's both filter (context transition)
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
r AS (
  SELECT i.i_brand, cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx
  GROUP BY 1, 2),
n AS (
  SELECT r.i_brand, COUNT(*) AS n
  FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
  JOIN r ON r.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
  WHERE r.rev > 1
  GROUP BY 1)
SELECT b.i_brand, n.n AS m0
FROM (SELECT DISTINCT i_brand FROM item) b LEFT JOIN n ON n.i_brand IS NOT DISTINCT FROM b.i_brand
