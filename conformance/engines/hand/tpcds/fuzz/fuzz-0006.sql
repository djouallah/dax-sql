-- marital status <> "M" keeps the blank (BLANK <> "M"): catalog sales with no bill demographics count too
SELECT i.i_color, AVG(cs.cs_quantity) AS m0
FROM catalog_sales cs
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
WHERE cd.cd_marital_status IS DISTINCT FROM 'M'
GROUP BY i.i_color
HAVING AVG(cs.cs_quantity) IS NOT NULL
