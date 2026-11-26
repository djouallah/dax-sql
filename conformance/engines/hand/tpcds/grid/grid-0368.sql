SELECT o.cd_demo_sk, (COUNT(DISTINCT f.ss_customer_sk) + MAX(CASE WHEN f.ss_customer_sk IS NULL THEN 1 ELSE 0 END)) AS v
FROM store_sales f
LEFT JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
GROUP BY o.cd_demo_sk
