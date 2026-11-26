SELECT s.s_city, ABS(SUM(ss.ss_quantity)) AS m0
FROM store_sales ss LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
GROUP BY s.s_city
HAVING m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0) <= 2
