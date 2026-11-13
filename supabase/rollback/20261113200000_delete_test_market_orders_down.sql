-- 20261113200000_delete_test_market_orders는 자동으로 되돌리지 않는다(지운 테스트 데이터를 다시 넣을 일이 없도록 한 결정).
-- 지운 행은 archive.deleted_test_market_rows_20261113에 원본 그대로(jsonb) 남아 있다. 복구가 필요하면
-- 일괄 구매 묶음 → 주문 → 주문 상세 → 구매 권리 → 환불 요청 → 다운로드 기록 → 후기 → 후기 추천 순으로
-- jsonb_populate_record(NULL::public.<표>, row_data)를 써서 다시 넣는 스크립트를 따로 작성해 리허설 뒤 실행한다.
-- 보관 표가 더 필요 없으면: DROP TABLE archive.deleted_test_market_rows_20261113;
SELECT source_table, count(*) FROM archive.deleted_test_market_rows_20261113 GROUP BY 1 ORDER BY 1;
