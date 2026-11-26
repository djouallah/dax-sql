-- the three cities with the most store profit (ties kept)
SELECT st.s_city, SUM(ss.ss_net_profit) AS m0
FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
GROUP BY st.s_city
HAVING m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 3
