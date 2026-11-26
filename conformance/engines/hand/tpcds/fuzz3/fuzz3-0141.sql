-- one row. m0: HASONEVALUE of the brand over every item. m1: RANKX of an aggregate with no measure
-- in it, no context transition: every store name ties, rank 1. m2: PREVIOUSMONTH of the whole
-- calendar is the month before its first date; with no catalog quantity there, 0, else that
-- quantity in its first month of the year (INDEX(-1) of the months sorted descending)
WITH one AS (SELECT COUNT(DISTINCT i_brand) + MAX((i_brand IS NULL)::INT) = 1 AS one FROM item),
pm AS (
  SELECT d.* FROM date_dim d, (SELECT date_trunc('month', MIN(d_date) - INTERVAL 1 MONTH)::DATE AS m FROM date_dim) x
  WHERE date_trunc('month', d.d_date) = x.m
), q AS (
  SELECT SUM(cs.cs_quantity) AS q,
    SUM(cs.cs_quantity) FILTER (WHERE pm.d_moy = (SELECT MIN(d_moy) FROM date_dim)) AS q1
  FROM catalog_sales cs JOIN pm ON pm.d_date_sk_1 = cs.cs_sold_date_sk
), cy AS (
  SELECT (COALESCE(SUM(cs.cs_quantity), 0) - ly.q) / NULLIF(ly.q, 0) AS yoy FROM catalog_sales cs,
    (SELECT SUM(cs.cs_quantity) AS q FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
     JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE) ly
  GROUP BY ly.q
)
SELECT CASE WHEN one.one THEN COALESCE(cy.yoy * 2, 0) + COALESCE((SELECT MAX(cs_ext_sales_price) FROM catalog_sales), 0) END AS m0,
  1 AS m1,
  CASE WHEN q.q IS NULL THEN 0 ELSE q.q1 END AS m2
FROM one, q, cy
