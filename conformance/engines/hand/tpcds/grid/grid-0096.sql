SELECT d.i_current_price, ss.ss_addr_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales ss LEFT JOIN item d ON ss.ss_item_sk = d.i_item_sk
GROUP BY d.i_current_price, ss.ss_addr_sk
