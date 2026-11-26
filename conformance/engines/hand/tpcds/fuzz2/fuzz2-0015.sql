-- store sales of promotions other than "barought" (the promotions' names: a sale with no promotion is out),
-- per quarter and marital status: the average net profit (a fixed decimal) rounded to units
SELECT d.d_qoy, cd.cd_marital_status, ROUND(ROUND(AVG(ss.ss_net_profit), 4), 0) AS m0
FROM store_sales ss
JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
WHERE p.p_promo_name IS DISTINCT FROM 'barought'
GROUP BY ALL
HAVING AVG(ss.ss_net_profit) IS NOT NULL
