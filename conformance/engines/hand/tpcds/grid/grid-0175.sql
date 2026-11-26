SELECT cs_bill_cdemo_sk, SUM(cs_quantity)
FROM catalog_sales
WHERE cs_ext_list_price = 952.49
GROUP BY cs_bill_cdemo_sk
