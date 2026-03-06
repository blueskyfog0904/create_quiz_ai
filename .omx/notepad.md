

## WORKING MEMORY
[2026-03-05T01:36:43.754Z] 적용 진행: CreditService.deductCredits/refundCredits를 RPC(consume_credits/refund_credits) 호출형으로 전환. 핵심 변경 파일: src/lib/credits.ts, supabase/migrations/20260306000000_add_credit_ledger_rpc_functions.sql. 목적: AI 생성 중 중단/실패 시 rollback 시 partial DB update 방지.
