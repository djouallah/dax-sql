-- each category's profit over the profit of every category (REMOVEFILTERS('item')), under the slicers
SELECT i.i_category, SUM(ss.ss_net_profit) / NULLIF(SUM(SUM(ss.ss_net_profit)) OVER (), 0) AS share
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = 2025
JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk AND ca.ca_state = 'AR'
JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status = '2 yr Degree'
LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
WHERE ss.cache_buster < 2
GROUP BY i.i_category
QUALIFY share IS NOT NULL
ORDER BY share DESC, i.i_category NULLS FIRST
