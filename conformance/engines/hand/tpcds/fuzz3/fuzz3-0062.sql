-- the billing states catalog sales reach (a sale with no address in the blank one), their profit, and the
-- stores' cities (unfiltered: store sales with no store add the blank row) times the quarters of the group's sales
-- (SUMMARIZE filters the group's catalog sales, and so their dates; a sale with no date adds the blank row)
SELECT ca.ca_state, SUM(cs.cs_net_profit) AS m0,
  (SELECT COUNT(*) FROM (SELECT s_city FROM store
     UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)))
  * (COUNT(DISTINCT d.d_qoy) + MAX(CASE WHEN d.d_date_sk_1 IS NULL THEN 1 ELSE 0 END)) AS m1
FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
GROUP BY ALL
