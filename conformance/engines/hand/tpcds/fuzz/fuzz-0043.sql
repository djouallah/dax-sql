SELECT cd.cd_marital_status, MAX(ss.ss_quantity) AS m0
FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
GROUP BY cd.cd_marital_status
HAVING m0 IS NOT NULL
