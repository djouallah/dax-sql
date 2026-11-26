SELECT d.i_current_price, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales ss JOIN item d ON ss.ss_item_sk = d.i_item_sk
WHERE d.i_brand IN ('edupack #2', 'eduuniv #3')
GROUP BY d.i_current_price
