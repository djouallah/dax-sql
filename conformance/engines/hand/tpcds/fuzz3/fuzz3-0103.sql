-- the quarters of the sales (a sale with no date: a blank quarter); the stores' states are not
-- filtered by the dates (nor by DATESBETWEEN's empty range): every state, joined by ","
SELECT q.d_qoy, s.n
FROM (SELECT DISTINCT d.d_qoy FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk) q
CROSS JOIN (SELECT SUM(LENGTH(COALESCE(s_state, ''))) + COUNT(*) - 1 AS n FROM (SELECT DISTINCT s_state FROM store)) s
