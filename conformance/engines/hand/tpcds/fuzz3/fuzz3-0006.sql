-- per brand, catalog quantity on every date shifted a year back; top 5 by it (blank last), ties by brand
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), q AS (
  SELECT cs.cs_item_sk, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN ly ON ly.dt = d.d_date
  GROUP BY ALL
), b AS (
  SELECT i.i_brand, SUM(q.qty) AS m0 FROM item i LEFT JOIN q ON q.cs_item_sk = i.i_item_sk GROUP BY i.i_brand
)
SELECT i_brand, m0 FROM b
QUALIFY rank() OVER (ORDER BY m0 DESC NULLS LAST, i_brand NULLS FIRST) <= 5
