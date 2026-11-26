-- per quarter (a row context): blank x 2 (no date between Mar 5 2026 and Nov 18 2025) + 1 x 2 (the dense rank of
-- an item count every status shares) + catalog sales from January 1 of the quarter's last year through its last date
WITH q AS (
  SELECT d_qoy, MAX(d_date) AS last FROM date_dim GROUP BY ALL
)
SELECT q.d_qoy, 2 + COUNT(cs.cs_sold_date_sk) AS m0
FROM q
LEFT JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', q.last)::DATE AND q.last
LEFT JOIN catalog_sales cs ON cs.cs_sold_date_sk = d.d_date_sk_1
GROUP BY q.d_qoy
