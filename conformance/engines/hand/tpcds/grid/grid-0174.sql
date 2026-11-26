SELECT cs_bill_cdemo_sk, cs_item_sk, SUM(cs_net_profit)
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk, cs_item_sk
