-- m0: the largest store quantity of the date table's last year (DATESYTD with no date filter) for the city's
-- stores named 'pri'. m1: item is not filtered by store: every class counts, for every city, the blank one
-- too (store's blank row: sales of no store); DISTINCTCOUNT counts no blank row of item.
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
q AS (
  SELECT st.s_city, MAX(ss.ss_quantity) AS mq
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, y
  WHERE st.s_store_name = 'pri' AND d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx
  GROUP BY 1),
k AS (SELECT NULLIF(COUNT(DISTINCT i_class) + (COUNT(*) > COUNT(i_class))::INT, 0) AS n FROM item)
SELECT c.s_city, q.mq AS m0, k.n AS m1
FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c CROSS JOIN k LEFT JOIN q ON q.s_city IS NOT DISTINCT FROM c.s_city
WHERE q.mq IS NOT NULL OR k.n IS NOT NULL
