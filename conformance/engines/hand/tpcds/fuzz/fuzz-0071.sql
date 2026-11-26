-- USERELATIONSHIP on a catalog_sales relationship: store_sales is unchanged
WITH q AS (
  SELECT d.d_qoy, ROUND(MIN(ss.ss_ext_sales_price), 0) AS mn, MAX(ss.ss_net_profit) AS mx
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
)
SELECT d_qoy, mn / NULLIF(mx, 0) FROM q WHERE mn / NULLIF(mx, 0) IS NOT NULL
