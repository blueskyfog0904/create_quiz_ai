-- 회원 표시 이름의 고정 태그(영문 대문자·숫자 4글자). 가입 때 자동으로 정해 저장한다.
-- 표시 이름 = 이메일 앞 4글자 + '#' + display_tag (src/lib/member-display-name.ts)
-- 새 회원: handle_new_user()가 profiles에 넣을 때 컬럼 기본값(generate_member_display_tag)으로 채워진다.
-- 기존 회원: 아래 DO 블록에서 한 명씩 채운다.
-- 되돌리기: supabase/rollback/20261112100000_profiles_display_tag_down.sql (코드를 먼저 되돌린 뒤)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.generate_member_display_tag()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  c_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_tag text;
BEGIN
  FOR i IN 1..20 LOOP
    SELECT string_agg(substr(c_alphabet, 1 + floor(random() * 36)::int, 1), '')
      INTO v_tag
      FROM generate_series(1, 4);
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE display_tag = v_tag) THEN
      RETURN v_tag;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'MEMBER_DISPLAY_TAG_EXHAUSTED';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_member_display_tag() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_member_display_tag() TO service_role;

ALTER TABLE public.profiles ADD COLUMN display_tag text;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE display_tag IS NULL ORDER BY created_at, id LOOP
    UPDATE public.profiles SET display_tag = public.generate_member_display_tag() WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN display_tag SET DEFAULT public.generate_member_display_tag(),
  ALTER COLUMN display_tag SET NOT NULL,
  ADD CONSTRAINT profiles_display_tag_format CHECK (display_tag ~ '^[0-9A-Z]{4}$'),
  ADD CONSTRAINT profiles_display_tag_key UNIQUE (display_tag);
