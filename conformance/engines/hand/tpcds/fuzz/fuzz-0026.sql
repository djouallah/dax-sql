WITH g AS (
  SELECT ca.ca_state, d.d_year, i.i_brand, SUM(cs.cs_net_profit) AS profit, SUM(cs.cs_ext_sales_price) AS rev,
    MIN(cs.cs_net_profit) AS minp
  FROM catalog_sales cs
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT ca_state, d_year, i_brand, ROUND(profit, 1) AS m0,
  CASE WHEN rev IS NOT NULL OR minp IS NOT NULL THEN COALESCE(rev, 0) - COALESCE(minp, 0) END AS m1, ABS(rev) AS m2
FROM g
WHERE profit IS NOT NULL OR rev IS NOT NULL OR minp IS NOT NULL
