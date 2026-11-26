-- under color almond. 0 when the store YoY over the catalog quantity is blank, else the catalog's
-- largest sale of the price up to 2024-03-18 (the store does not filter the catalog)
WITH it AS (SELECT * FROM item WHERE i_color = 'almond'),
s AS (
  SELECT st.s_state AS state, it.i_current_price AS pr, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT MAX(d_year) FROM date_dim)) AS ly
  FROM store_sales ss
  JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1, 2
), c AS (
  SELECT it.i_current_price AS pr, SUM(cs.cs_quantity) AS qty,
    MAX(cs.cs_ext_sales_price) FILTER (WHERE d.d_date BETWEEN DATE '1999-01-01' AND DATE '2024-03-18') AS mx
  FROM catalog_sales cs
  JOIN it ON it.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY 1
), g AS (
  SELECT * FROM (SELECT DISTINCT s_state AS state FROM store) CROSS JOIN (SELECT DISTINCT i_current_price AS pr FROM it)
), r AS (
  SELECT g.state, g.pr,
    CASE WHEN ((COALESCE(s.rev, 0) - s.ly) / NULLIF(s.ly, 0)) / NULLIF(c.qty, 0) IS NULL THEN 0 ELSE c.mx END AS m0
  FROM g
  LEFT JOIN s ON s.state IS NOT DISTINCT FROM g.state AND s.pr IS NOT DISTINCT FROM g.pr
  LEFT JOIN c ON c.pr IS NOT DISTINCT FROM g.pr
)
SELECT * FROM r WHERE m0 IS NOT NULL
