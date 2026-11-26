-- per state: profit of store "cally" in Fairview to 4 yr Degree customers, over the same with no item filter (none)
SELECT s.s_state, SUM(ss.ss_net_profit) / NULLIF(SUM(ss.ss_net_profit), 0) AS m0
FROM store_sales ss
JOIN store s ON s.s_store_sk = ss.ss_store_sk AND s.s_store_name = 'cally' AND s.s_city = 'Fairview'
JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status = '4 yr Degree'
GROUP BY s.s_state
HAVING m0 IS NOT NULL
