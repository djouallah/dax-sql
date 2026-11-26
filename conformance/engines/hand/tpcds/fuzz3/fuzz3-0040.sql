-- per category (sales with no item: blank): the largest store sales price, twice the revenue plus the profit
SELECT i.i_category, MAX(ss.ss_ext_sales_price) AS m0,
       CASE WHEN SUM(ss.ss_ext_sales_price) IS NULL AND SUM(ss.ss_net_profit) IS NULL THEN NULL
            ELSE COALESCE(2 * SUM(ss.ss_ext_sales_price), 0) + COALESCE(SUM(ss.ss_net_profit), 0) END AS m1
FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY ALL
HAVING MAX(ss.ss_ext_sales_price) IS NOT NULL OR m1 IS NOT NULL
