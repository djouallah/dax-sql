WITH r AS (
  SELECT p.p_promo_name, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = 2026
  JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk AND ca.ca_state = 'CO'
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_education_status = 'Advanced Degree'
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  WHERE cs.cache_buster < 2
  GROUP BY p.p_promo_name
  HAVING rev IS NOT NULL
)
SELECT p_promo_name, RANK() OVER (ORDER BY rev DESC) AS rnk, rev FROM r
ORDER BY rev DESC, p_promo_name NULLS FIRST
