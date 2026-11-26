-- the ship mode filter touches no store sale: smallest store quantity per promotion name and marital status
SELECT p.p_promo_name, cd.cd_marital_status, MIN(ss.ss_quantity) AS m0
FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
GROUP BY ALL
HAVING m0 IS NOT NULL
