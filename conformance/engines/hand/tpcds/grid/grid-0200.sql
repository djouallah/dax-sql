-- a blank compares as 0
SELECT SUM(cs_net_profit)
FROM catalog_sales
WHERE COALESCE(cs_bill_addr_sk, 0) = 10
