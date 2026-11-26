-- items of the colors navy, plum and khaki (not coral); every store state by every customer state (m1 is never
-- blank; the dimensions' values, no blank row)
-- m0: when the store sold there, catalog quantity of the address state a year back (0 if none);
-- m1: the items' classes; m2: store revenue a year back, to 1 place
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), it AS (
  SELECT * FROM item WHERE i_color IN ('navy', 'plum', 'khaki') AND i_color <> 'coral'
), s AS (
  SELECT st.s_state, ca.ca_state, MAX(ss.ss_net_profit) AS maxp,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS rev_ly
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT ca.ca_state, SUM(cs.cs_quantity) AS qty_ly
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), states AS (
  SELECT DISTINCT s_state FROM store
), castates AS (
  SELECT DISTINCT ca_state FROM customer_address
), classes AS (
  SELECT COUNT(DISTINCT i_class) + (COUNT(*) > COUNT(i_class))::INT AS n FROM it
)
SELECT g.s_state, h.ca_state,
  CASE WHEN s.maxp IS NULL THEN 0 ELSE COALESCE(c.qty_ly, 0) END AS m0,
  classes.n AS m1,
  ROUND(s.rev_ly, 1) AS m2
FROM states g CROSS JOIN castates h CROSS JOIN classes
LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM g.s_state AND s.ca_state IS NOT DISTINCT FROM h.ca_state
LEFT JOIN c ON c.ca_state IS NOT DISTINCT FROM h.ca_state
