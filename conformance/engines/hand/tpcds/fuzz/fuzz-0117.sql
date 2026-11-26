-- under months 8 and 10 of 2025 and 2026, by brand and d_qoy: a quarter's dates are those of the
-- filter with that d_qoy; a year back is each of them a year back (no February among them).
-- DISTINCTCOUNT(d_year): the quarter's years of the date table.
WITH vis AS (SELECT * FROM date_dim WHERE d_moy IN (10, 8) AND d_year IN (2025, -1, 2026)),
ly AS (
  SELECT v.d_qoy AS q, dd.d_date_sk_1 AS sk
  FROM vis v JOIN date_dim dd ON dd.d_date = CAST(v.d_date - INTERVAL 1 YEAR AS DATE)
),
years AS (SELECT d_qoy AS q, COUNT(DISTINCT d_year) AS n FROM vis GROUP BY 1),
c_ly AS (
  SELECT i.i_brand AS b, ly.q, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs JOIN ly ON ly.sk = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1, 2
),
c_min AS (
  SELECT i.i_brand AS b, vis.d_qoy AS q, MIN(cs.cs_net_profit) AS v
  FROM catalog_sales cs JOIN vis ON vis.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1, 2
),
g AS (
  SELECT * FROM (SELECT DISTINCT i_brand AS b FROM item) CROSS JOIN (SELECT DISTINCT d_qoy AS q FROM vis)
),
r AS (
  SELECT g.b, g.q, c_ly.v * (years.n / NULLIF(c_min.v, 0)) AS m0
  FROM g
  LEFT JOIN c_ly ON c_ly.b IS NOT DISTINCT FROM g.b AND c_ly.q = g.q
  LEFT JOIN c_min ON c_min.b IS NOT DISTINCT FROM g.b AND c_min.q = g.q
  LEFT JOIN years ON years.q = g.q
)
SELECT * FROM r WHERE m0 IS NOT NULL
