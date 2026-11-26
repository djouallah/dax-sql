SELECT o.s_market_manager, f.ss_item_sk, SUM(f.ss_net_profit) AS v
FROM store_sales f JOIN store o ON o.s_store_sk = f.ss_store_sk
GROUP BY o.s_market_manager, f.ss_item_sk
