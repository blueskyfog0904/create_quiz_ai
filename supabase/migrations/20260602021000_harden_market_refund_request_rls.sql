-- 문제마켓 환불 요청은 서버 API에서 적격성 검증 후 생성한다.
-- 사용자가 PostgREST로 임의 금액/상태의 환불 요청을 직접 insert하지 못하도록 차단한다.

drop policy if exists "Users can insert own market refund requests" on public.market_refund_requests;
