SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE COALESCE(cs_ship_addr_sk, 0) < 10 OR COALESCE(cs_order_number, 0) BETWEEN 1 AND 49
GROUP BY cs_bill_cdemo_sk
