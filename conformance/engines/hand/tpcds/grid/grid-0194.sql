SELECT cs_ship_addr_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
GROUP BY cs_ship_addr_sk
