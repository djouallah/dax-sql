-- no context transition: every class has the same average store profit, the current value too: rank 1
SELECT p.i_current_price, CASE WHEN EXISTS (SELECT 1 FROM item) THEN 1 END AS m0
FROM (SELECT DISTINCT i_current_price FROM item) p
