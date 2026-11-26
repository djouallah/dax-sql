SELECT i.i_color, AVG(cs.cs_quantity) AS m0
FROM catalog_sales cs
JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_marital_status <> 'M'
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
GROUP BY i.i_color
HAVING AVG(cs.cs_quantity) IS NOT NULL
