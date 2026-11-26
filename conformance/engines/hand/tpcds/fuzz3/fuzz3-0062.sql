-- the billing states catalog sales reach, their profit, and the stores' cities times the quarters (unfiltered)
SELECT ca.ca_state, SUM(cs.cs_net_profit) AS m0,
  (SELECT COUNT(DISTINCT s_city) FROM store) * (SELECT COUNT(DISTINCT d_qoy) FROM date_dim) AS m1
FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
GROUP BY ALL
