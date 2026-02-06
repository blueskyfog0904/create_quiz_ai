-- ============================================================================
-- 크레딧 시스템 마이그레이션
-- 생성일: 2026-02-06
-- 설명: FIFO 기반 크레딧 시스템을 위한 테이블 및 정책 생성
-- ============================================================================

-- ============================================================================
-- 1. profiles 테이블에 credits 컬럼 추가
-- ============================================================================
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS credits integer DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.profiles.credits IS '사용자의 현재 총 크레딧 잔액';

-- ============================================================================
-- 2. pricing_plans 테이블 (요금제 정보)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pricing_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,                           -- 요금제명 (Starter, Basic, Pro)
  credits integer NOT NULL,                     -- 제공 크레딧 수
  price integer NOT NULL,                       -- 가격 (원)
  description text,                             -- 요금제 설명
  is_active boolean DEFAULT true NOT NULL,      -- 판매 여부
  sort_order integer DEFAULT 0 NOT NULL,        -- 정렬 순서
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.pricing_plans IS '크레딧 요금제 정보 (공통 테이블)';

-- ============================================================================
-- 3. credit_sources 테이블 (구매건별 잔액 추적 - FIFO용)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credit_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan_id uuid REFERENCES public.pricing_plans(id) ON DELETE SET NULL,
  initial_credits integer NOT NULL,             -- 최초 구매 크레딧
  remaining_credits integer NOT NULL,           -- 남은 크레딧
  status text DEFAULT 'active' NOT NULL         -- active, pending_refund, refunded
    CHECK (status IN ('active', 'pending_refund', 'refunded')),
  purchased_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz,                       -- 만료일 (nullable, 현재 미사용)
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.credit_sources IS '구매건별 크레딧 잔액 (FIFO 차감용)';

CREATE INDEX IF NOT EXISTS idx_credit_sources_user_id ON public.credit_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_sources_status ON public.credit_sources(status);
CREATE INDEX IF NOT EXISTS idx_credit_sources_purchased_at ON public.credit_sources(purchased_at);

-- ============================================================================
-- 4. credit_consumption 테이블 (소비 상세 기록)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credit_consumption (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  source_id uuid REFERENCES public.credit_sources(id) ON DELETE CASCADE NOT NULL,
  amount integer NOT NULL,                      -- 차감량 (양수)
  resource_type text,                           -- question, ai_generation 등
  resource_id uuid,                             -- 관련 리소스 ID
  description text,                             -- 설명
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.credit_consumption IS '어떤 source에서 얼마나 차감됐는지 기록';

CREATE INDEX IF NOT EXISTS idx_credit_consumption_user_id ON public.credit_consumption(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_consumption_source_id ON public.credit_consumption(source_id);

-- ============================================================================
-- 5. credit_transactions 테이블 (모든 증감 로그)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL                            -- purchase, consume, refund, admin_grant
    CHECK (type IN ('purchase', 'consume', 'refund', 'admin_grant', 'bonus')),
  amount integer NOT NULL,                      -- 변동량 (+/-)
  balance_after integer NOT NULL,               -- 변동 후 잔액
  description text,                             -- 설명
  source_id uuid REFERENCES public.credit_sources(id) ON DELETE SET NULL, -- 관련 구매건
  resource_type text,                           -- 관련 리소스 타입
  resource_id uuid,                             -- 관련 리소스 ID
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.credit_transactions IS '크레딧 증감 이력 (전체 로그)';

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at);

-- ============================================================================
-- 6. payment_history 테이블 (결제 내역)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  source_id uuid REFERENCES public.credit_sources(id) ON DELETE SET NULL, -- 관련 구매건
  plan_id uuid REFERENCES public.pricing_plans(id) ON DELETE SET NULL,
  amount integer NOT NULL,                      -- 결제 금액 (원)
  payment_method text DEFAULT 'test' NOT NULL,  -- test, toss 등
  payment_key text,                             -- 외부 결제 키 (토스페이먼츠 등)
  status text DEFAULT 'completed' NOT NULL      -- completed, refunded
    CHECK (status IN ('completed', 'refunded', 'failed')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.payment_history IS '결제 내역';

CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON public.payment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_status ON public.payment_history(status);

-- ============================================================================
-- 7. refund_requests 테이블 (환불 요청)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  source_id uuid REFERENCES public.credit_sources(id) ON DELETE CASCADE NOT NULL,
  reason text,                                  -- 환불 사유
  status text DEFAULT 'pending' NOT NULL        -- pending, approved, rejected
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note text,                              -- 관리자 메모
  processed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- 처리 관리자
  processed_at timestamptz,                     -- 처리 일시
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.refund_requests IS '환불 요청';

CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id ON public.refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status);

-- ============================================================================
-- 8. RLS 정책 활성화
-- ============================================================================

-- pricing_plans: 모든 사용자가 조회 가능 (공개 테이블)
ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active pricing plans" ON public.pricing_plans
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins can manage pricing plans" ON public.pricing_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- credit_sources: 본인 것만 조회 가능
ALTER TABLE public.credit_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credit sources" ON public.credit_sources
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert credit sources" ON public.credit_sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update credit sources" ON public.credit_sources
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all credit sources" ON public.credit_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- credit_consumption: 본인 것만 조회 가능
ALTER TABLE public.credit_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consumption" ON public.credit_consumption
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert consumption" ON public.credit_consumption
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- credit_transactions: 본인 것만 조회 가능
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert transactions" ON public.credit_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions" ON public.credit_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- payment_history: 본인 것만 조회 가능
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payments" ON public.payment_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert payments" ON public.payment_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all payments" ON public.payment_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- refund_requests: 본인 것만 조회/생성, 관리자는 전체 관리
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own refund requests" ON public.refund_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own refund requests" ON public.refund_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all refund requests" ON public.refund_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- ============================================================================
-- 9. 초기 데이터: 요금제 3개 추가
-- ============================================================================
INSERT INTO public.pricing_plans (name, credits, price, description, is_active, sort_order)
VALUES 
  ('Starter', 3000, 3000, '입문자를 위한 스타터 요금제', true, 1),
  ('Basic', 12000, 9900, '가장 인기 있는 베이직 요금제', true, 2),
  ('Pro', 50000, 36900, '전문가를 위한 프로 요금제', true, 3)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10. updated_at 자동 갱신 트리거
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 각 테이블에 트리거 적용
DROP TRIGGER IF EXISTS update_pricing_plans_updated_at ON public.pricing_plans;
CREATE TRIGGER update_pricing_plans_updated_at
  BEFORE UPDATE ON public.pricing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_credit_sources_updated_at ON public.credit_sources;
CREATE TRIGGER update_credit_sources_updated_at
  BEFORE UPDATE ON public.credit_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_history_updated_at ON public.payment_history;
CREATE TRIGGER update_payment_history_updated_at
  BEFORE UPDATE ON public.payment_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER update_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
