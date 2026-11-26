-- each category's profit over its year's profit of every category
SELECT i.i_category, d.d_year,
  SUM(ss.ss_net_profit) / NULLIF(SUM(SUM(ss.ss_net_profit)) OVER (PARTITION BY d.d_year), 0) AS share
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year IN (2025, 2026)
LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY i.i_category, d.d_year
QUALIFY share IS NOT NULL
