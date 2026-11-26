-- every item price by every year (m2 is never blank but for the blank year); m0: the store profit share of the
-- price within its year (no catalog average quantity is above 1000); m2: twice the year's quarter numbers plus
-- the store revenue of the year to its last date. The blank price / year are rows too when the model has those
-- blank rows: the blank year (sales with no date) has no quarter numbers and no year to date (m2 blank).
WITH s AS (
  SELECT i.i_current_price, d.d_year, SUM(ss.ss_net_profit) AS profit, MAX(ss.ss_quantity) AS maxq,
    SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), sy AS (
  SELECT d_year, SUM(profit) AS profit FROM s GROUP BY ALL
), c AS (
  SELECT i.i_current_price, d.d_year, AVG(cs.cs_quantity) AS avgq, MAX(cs.cs_net_profit) AS maxp
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), y AS (
  SELECT d_year, COUNT(DISTINCT d_qoy) + (COUNT(*) > COUNT(d_qoy))::INT AS qoys FROM date_dim GROUP BY ALL
  UNION ALL SELECT NULL, NULL
  WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
     OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
), p AS (
  SELECT i_current_price FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), t AS (
  SELECT p.i_current_price, y.d_year,
    CASE WHEN COALESCE(c.avgq, 0) > 1000 THEN c.maxp ELSE s.profit / NULLIF(sy.profit, 0) END AS m0,
    ABS(s.maxq) AS m1,
    y.qoys * 2 + COALESCE(s.rev, 0) AS m2
  FROM p CROSS JOIN y
  LEFT JOIN s ON s.i_current_price IS NOT DISTINCT FROM p.i_current_price AND s.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN sy ON sy.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN c ON c.i_current_price IS NOT DISTINCT FROM p.i_current_price AND c.d_year IS NOT DISTINCT FROM y.d_year
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
