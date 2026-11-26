-- NEXT DAY catalog sales, per item class: the lowest catalog quantity YoY over the bill-to states, made positive;
-- no date filter: "last year" is every date whose next-year date is in the calendar
WITH ly AS (
  SELECT d_date_sk_1 FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), q AS (
  SELECT i.i_class, ca.ca_state, SUM(cs.cs_quantity) AS qty,
    SUM(cs.cs_quantity) FILTER (WHERE cs.cs_sold_date_sk IN (SELECT d_date_sk_1 FROM ly)) AS qtyly
  FROM catalog_sales cs
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type = 'NEXT DAY'
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT i_class, ABS(MIN((COALESCE(qty, 0) - qtyly) / NULLIF(qtyly, 0))) AS m0
FROM q GROUP BY ALL
HAVING m0 IS NOT NULL
