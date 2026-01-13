-- Create source_configs table
CREATE TABLE IF NOT EXISTS source_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type_name text NOT NULL UNIQUE,
  source_1_label text,
  source_1_options text[],
  source_2_label text,
  source_2_options text[],
  source_3_label text,
  source_3_options text[],
  source_4_label text,
  source_4_options text[],
  created_at timestamptz DEFAULT now()
);

-- Add comments
COMMENT ON TABLE source_configs IS '출처 종류별 상세 설정 (라벨 및 옵션)';
COMMENT ON COLUMN source_configs.type_name IS '출처 종류 이름 (예: 교과서, 모의고사)';
COMMENT ON COLUMN source_configs.source_1_label IS '출처 1 필드의 라벨 (예: 과목명, 연도)';
COMMENT ON COLUMN source_configs.source_1_options IS '출처 1 필드의 선택 옵션 (빈 배열이면 텍스트 입력)';
