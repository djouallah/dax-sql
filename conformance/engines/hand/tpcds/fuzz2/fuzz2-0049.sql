-- store net profit over store net profit with no item filter: 1
SELECT SUM(ss_net_profit) / NULLIF(SUM(ss_net_profit), 0) AS m0 FROM store_sales
