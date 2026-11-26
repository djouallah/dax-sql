-- per education status, month and year (the address and ship mode filters touch no store sale):
-- (2 x store revenue + the profit share over all items, 1 unless the profit is 0) / distinct customers
SELECT cd.cd_education_status, d.d_moy, d.d_year,
  CASE WHEN SUM(ss.ss_ext_sales_price) IS NULL AND SUM(ss.ss_net_profit) IS NULL THEN NULL
       ELSE COALESCE(SUM(ss.ss_ext_sales_price), 0) * 2 + COALESCE(SUM(ss.ss_net_profit) / NULLIF(SUM(ss.ss_net_profit), 0), 0) END
    / NULLIF(COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END), 0) AS m0
FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
GROUP BY ALL
HAVING m0 IS NOT NULL
