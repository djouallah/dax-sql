-- the grand total is the row with a blank cs_bill_addr_sk
SELECT cs_bill_addr_sk, SUM(cs_net_profit)
FROM catalog_sales
GROUP BY ROLLUP (cs_bill_addr_sk)
ORDER BY cs_bill_addr_sk IS NULL, cs_bill_addr_sk, GROUPING(cs_bill_addr_sk)
