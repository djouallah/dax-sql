SELECT cp.cp_type, SUM(cs.cs_ext_sales_price) AS Revenue, SUM(cs.cs_net_profit) AS Profit
FROM catalog_sales cs LEFT JOIN catalog_page cp ON cp.cp_catalog_page_sk = cs.cs_catalog_page_sk
GROUP BY cp.cp_type
