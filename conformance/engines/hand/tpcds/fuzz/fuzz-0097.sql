SELECT cd.cd_marital_status, AVG(cs.cs_quantity), SUM(cs.cs_quantity)
FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
GROUP BY 1
HAVING AVG(cs.cs_quantity) IS NOT NULL OR SUM(cs.cs_quantity) IS NOT NULL
