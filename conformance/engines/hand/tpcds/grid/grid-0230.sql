SELECT cs_ship_addr_sk, CAST(SUM(cs_ext_sales_price) AS DOUBLE) / NULLIF(SUM(cs_ext_sales_price), 0) AS r
FROM catalog_sales
GROUP BY cs_ship_addr_sk
