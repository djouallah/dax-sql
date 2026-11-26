SELECT cd.cd_education_status, SUM(cs.cs_net_profit) AS profit
FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
GROUP BY cd.cd_education_status
HAVING SUM(cs.cs_net_profit) IS NOT NULL
