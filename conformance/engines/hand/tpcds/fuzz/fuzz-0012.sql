-- d_moy <> 4 keeps the blank month (BLANK <> 4): catalog sales with no date are its row
SELECT i.i_current_price, d.d_moy, SUM(cs.cs_quantity) AS m0, SUM(cs.cs_quantity) AS m1, SUM(cs.cs_ext_sales_price) AS m2
FROM catalog_sales cs
JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_education_status = 'Primary'
LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
WHERE d.d_moy IS DISTINCT FROM 4
GROUP BY ALL
HAVING m0 IS NOT NULL OR m2 IS NOT NULL
