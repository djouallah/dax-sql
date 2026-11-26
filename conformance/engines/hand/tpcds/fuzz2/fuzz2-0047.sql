-- per quarter (a row context): blank x 2 (no date between Mar 5 2026 and Nov 18 2025) + 1 x 2 (the dense rank of
-- an item count every status shares) + catalog sales from January 1 of the quarter's last year through its last date
-- (the blank quarter, for a sale with no or an unknown date, has no dates: none)
WITH q AS (
  SELECT d_qoy, MAX(d_date) AS last FROM date_dim GROUP BY ALL
  UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT q.d_qoy, 2 + COUNT(cs.cs_sold_date_sk) AS m0
FROM q
LEFT JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', q.last)::DATE AND q.last
LEFT JOIN catalog_sales cs ON cs.cs_sold_date_sk = d.d_date_sk_1
GROUP BY q.d_qoy
