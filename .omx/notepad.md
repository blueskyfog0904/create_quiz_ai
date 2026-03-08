

## WORKING MEMORY
[2026-03-05T01:36:43.754Z] 적용 진행: CreditService.deductCredits/refundCredits를 RPC(consume_credits/refund_credits) 호출형으로 전환. 핵심 변경 파일: src/lib/credits.ts, supabase/migrations/20260306000000_add_credit_ledger_rpc_functions.sql. 목적: AI 생성 중 중단/실패 시 rollback 시 partial DB update 방지.

[2026-03-08T01:23:15.615Z] Investigated Kakao OAuth redirect issue. App code uses window.location.origin for redirectTo in login/signup, so localhost:3000 is unlikely hardcoded in app flow. Strong hypothesis: Supabase Auth URL Configuration Site URL or Additional Redirect URLs still point to localhost:3000, causing fallback; Kakao Developers Redirect URI should point to Supabase auth/v1/callback. README still mentions 3000 but only docs.