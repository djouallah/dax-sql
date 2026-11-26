-- the state with the largest store revenue YTD (the last date's year, through it)
WITH y AS (SELECT MAX(d_date) AS hi FROM date_dim), t AS (
  SELECT ca.ca_state, SUM(ss.ss_ext_sales_price) AS m0
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN y ON d.d_date BETWEEN date_trunc('year', y.hi) AND y.hi
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  GROUP BY ALL
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 1
