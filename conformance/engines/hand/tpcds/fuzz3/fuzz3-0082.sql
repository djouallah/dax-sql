-- per billing state the catalog reaches (SUMMARIZE: the state's catalog rows filter the dates and classes): the
-- state's classes whose catalog quantity passes 100 over the state's sale dates a month back (DATEADD -1 MONTH: a
-- month's last day reaching the shifted month's end); the store filter is moot
WITH r AS (
  SELECT DISTINCT ca.ca_state AS st, d.d_date AS dt, i.i_class
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
), sd AS (SELECT DISTINCT st, dt FROM r WHERE dt IS NOT NULL
), m AS (
  SELECT DISTINCT sd.st, d2.d_date AS dt
  FROM sd LEFT JOIN sd p ON p.st IS NOT DISTINCT FROM sd.st AND p.dt = sd.dt - 1
  JOIN date_dim d2 ON d2.d_date BETWEEN (sd.dt - INTERVAL 1 MONTH)::DATE
    AND CASE WHEN sd.dt = last_day(sd.dt) AND p.dt IS NOT NULL
      THEN last_day((sd.dt - INTERVAL 1 MONTH)::DATE) ELSE (sd.dt - INTERVAL 1 MONTH)::DATE END
), q AS (
  SELECT ca.ca_state AS st, i.i_class, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN m ON m.st IS NOT DISTINCT FROM ca.ca_state AND m.dt = d.d_date
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), n AS (
  SELECT q.st, COUNT(*) AS n FROM q
  SEMI JOIN (SELECT DISTINCT st, i_class FROM r) k ON k.st IS NOT DISTINCT FROM q.st AND k.i_class IS NOT DISTINCT FROM q.i_class
  WHERE q.qty > 100
  GROUP BY ALL
)
SELECT g.st, n.n AS m0 FROM (SELECT DISTINCT st FROM r) g LEFT JOIN n ON n.st IS NOT DISTINCT FROM g.st
