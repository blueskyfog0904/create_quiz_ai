# 프로젝트 아키텍처 및 일관성 가이드

이 문서는 `create_quiz_ai` 프로젝트의 아키텍처와 데이터베이스 스키마에 대한 **유일한 진실의 원천(Single Source of Truth)** 역할을 합니다.
**목표**: 작업 중단 후 다시 시작할 때 발생할 수 있는 혼란, 코드 중복, 스키마 불일치를 방지합니다.

---

## 1. 기술 스택 개요
- **프레임워크**: Next.js (App Router)
- **언어**: TypeScript
- **데이터베이스 / 백엔드**: Supabase (PostgreSQL)
- **스타일링**: TailwindCSS (postcss.config.mjs 및 표준 관행에 따름)
- **AI 통합**: Gemini / OpenAI (`ai_models` 테이블을 통해 관리)

## 2. 디렉토리 구조 및 주요 파일

```text
.
├── src/
│   ├── app/                    # Next.js App Router (페이지 및 API)
│   │   ├── (admin)/            # 관리자 전용 레이아웃 및 페이지
│   │   ├── (auth)/             # 인증 관련 페이지 (로그인, 회원가입)
│   │   ├── (dashboard)/        # 메인 어플리케이션 기능 (문제은행, 라이브러리 등)
│   │   ├── api/                # 백엔드 API 엔드포인트
│   │   ├── auth/               # Supabase 인증 콜백
│   │   ├── globals.css         # 글로벌 스타일
│   │   └── layout.tsx          # 루트 레이아웃
│   ├── components/             # 공통 및 기능별 컴포넌트
│   │   ├── admin/              # 관리자 전용 컴포넌트
│   │   ├── features/           # 도메인별 복합 컴포넌트 (bank, quiz 등)
│   │   ├── layout/             # 헤더, 푸터, 사이드바 등 레이아웃 컴포넌트
│   │   └── ui/                 # Shadcn UI (원자적 컴포넌트)
│   ├── lib/                    # 유틸리티 및 라이브러리 설정
│   │   ├── ai/                 # AI 모델 연동 (OpenAI, Gemini)
│   │   ├── export/             # 파일 내보내기 로직 (HWP, PDF 등)
│   │   └── supabase/           # Supabase 클라이언트/서버 설정
│   ├── types/                  # TypeScript 타입 정의
│   │   └── supabase.ts         # DB 스키마 자동 생성 타입
│   └── utils/                  # 공통 헬퍼 함수
├── public/                     # 정적 자산 (이미지, 아이콘 등)
├── supabase/                   # Supabase 관련 설정 및 마이그레이션
├── PROJECT_RULES.md            # 프로젝트 개발 규칙
└── project_architecture.md     # (현재 파일) 프로젝트 구조 요약
```

---

## 3. 데이터베이스 스키마 (ERD)

**현재 상태**: 활성 & 연결됨.
**진실의 원천**: Supabase 프로젝트 (`kzcweelnzhcmiuvjgeyi`)

### 관계 다이어그램 (Mermaid)

```mermaid
erDiagram
    profiles ||--o{ exam_papers : "생성"
    profiles ||--o{ questions : "생성"
    profiles ||--o{ passages : "생성"
    
    problem_types ||--o{ questions : "타입 정의"
    questions ||--o{ exam_paper_items : "포함됨"
    passages ||--o{ questions : "참조"
    exam_papers ||--o{ exam_paper_items : "포함"
    
    providers ||--o{ ai_models : "제공"
```

### 테이블 및 컬럼 상세 정의

#### 1) `profiles` (사용자 프로필)
`auth.users`를 확장한 사용자 정보 테이블입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | `auth.users.id`와 연결 |
| `email` | `text` | 사용자 이메일 |
| `name` | `text` | 이름 |
| `phone` | `text` | 전화번호 |
| `birthdate` | `date` | 생년월일 |
| `organization`| `text` | 소속 기관 |
| `gender` | `text` | 성별 |
| `address` | `text` | 주소 |
| `role` | `text` | 역할 (teacher, academy_instructor 등) |
| `is_admin` | `boolean` | 관리자 여부 |
| `provider` | `text` | 가입 경로 (email, kakao 등) |
| `kakao_id` | `text` | 카카오 고유 ID |
| `kakao_email` | `text` | 카카오 이메일 |
| `avatar_url` | `text` | 프로필 이미지 URL |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 2) `passages` (영어 지문)
재사용 가능한 영어 지문 및 메타데이터를 저장합니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 지문 고유 ID |
| `user_id` | `uuid` (FK) | 소유자 ID |
| `content` | `text` | 영어 지문 본문 |
| `title_en` | `text` | 영어 제목 |
| `title_ko` | `text` | 한글 제목 |
| `content_translation`| `text` | 한글 번역본 |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 3) `questions` (질문/문제)
개별 문제 데이터를 저장합니다. `passages` 테이블을 참조할 수 있습니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 문제 고유 ID |
| `user_id` | `uuid` (FK) | 생성한 사용자 ID |
| `passage_id` | `uuid` (FK) | 연결된 지문 ID (Optional) |
| `question_text`| `text` | 문제 지문/발문 |
| `passage_text` | `text` | (레거시) 보기 지문, `passage_id` 사용 권장 |
| `choices` | `jsonb` | 선지 데이터 |
| `answer` | `text` | 정답 |
| `explanation` | `text` | 해설 |
| `difficulty` | `text` | 난이도 |
| `grade_level` | `text` | 학년/수준 |
| `problem_type_id`| `uuid` (FK) | 문제 유형 ID |
| `source` | `varchar` | 출처 (ai_generated 등) |
| `raw_ai_response`| `text` | AI가 생성한 원본 응답 |
| `question_text_forward` | `text` | 앞부분 지문 (필요 시) |
| `question_text_backward` | `text` | 뒷부분 지문 (필요 시) |
| `shared_question_id`| `uuid` | 공유된 원본 문제 ID |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 3) `exam_papers` (시험지/꾸러미)
여러 문제를 묶은 시험지 단위입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 시험지 고유 ID |
| `user_id` | `uuid` (FK) | 소유자 ID |
| `paper_title` | `text` | 시험지 명칭 |
| `description` | `text` | 상세 설명 |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 4) `exam_paper_items` (시험지 구성 요소)
시험지와 문제를 연결하는 중간 테이블입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 고유 ID |
| `exam_paper_id`| `uuid` (FK) | 연결된 시험지 ID |
| `question_id` | `uuid` (FK) | 연결된 문제 ID |
| `number` | `integer` | 시험지 내 문제 번호 |
| `order_index` | `integer` | 정렬 순서 |
| `created_at` | `timestamptz`| 생성일시 |

#### 5) `problem_types` (문제 유형 설정)
문제 생성 시 사용되는 프롬프트 및 유형 정보입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 고유 ID |
| `type_name` | `text` | 유형 이름 |
| `description` | `text` | 유형 설명 |
| `provider` | `text` | 사용 AI 제공자 |
| `model_name` | `text` | 사용 AI 모델명 |
| `prompt_template`| `text` | 생성 프롬프트 템플릿 |
| `output_format` | `text` | 기대 응답 형식 |
| `is_active` | `boolean` | 활성화 여부 |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 6) `ai_models` (사용 가능 모델)
시스템에서 지원하는 AI 모델 목록입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 고유 ID |
| `name` | `text` | 모델 이름 |
| `provider` | `text` | 제공자 (openai, gemini) |
| `display_order`| `integer` | 정렬 순서 |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 7) `providers` (AI 제공자)
AI 서비스 제공자 목록입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | 고유 ID |
| `name` | `text` | 제공자 코드명 |
| `display_name` | `text` | 화면 표시 이름 |
| `display_order`| `integer` | 정렬 순서 |
| `is_active` | `boolean` | 활성화 여부 |
| `created_at` | `timestamptz`| 생성일시 |
| `updated_at` | `timestamptz`| 수정일시 |

#### 8) `system_prompts` (시스템 프롬프트)
AI/OCR 동작을 제어하기 위한 시스템 프롬프트 저장소입니다.
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `key` | `text` (PK) | 프롬프트 고유 식별자 (예: `ocr_auto_extraction`) |
| `content` | `text` | 프롬프트 내용 |
| `description` | `text` | 용도 설명 |
| `updated_at` | `timestamptz` | 마지막 수정 일시 |

---

## 4. 개발 워크플로우 및 일관성 규칙

작업 복귀 시 "중복 테이블 생성"이나 "스키마 불일치"를 방지하기 위한 규칙입니다:

### 규칙 1: 절대 무작정 테이블을 만들지 마세요
새로운 기능을 정의하기 전에, **항상** 이 문서와 `src/types/supabase.ts`를 확인하여 이미 존재하는 테이블인지 확인하세요.

### 규칙 2: 스키마 변경의 진실의 원천
이상적으로는 Supabase Migrations (`supabase/migrations`)를 사용하여 변경해야 합니다.
대시보드에서 직접 수정한 경우, 즉시 **타입 생성(Type Generation)** 명령어를 실행하여 로컬 코드를 동기화하세요.

### 규칙 3: 타입 동기화 (가장 권장하는 방법)
DB 스키마를 변경할 때마다 아래 명령어를 실행하여 로컬 타입을 업데이트하세요. 이렇게 하면 코드가 DB 변경 사항을 즉시 "인지"할 수 있습니다.

```bash
npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts
```
*(참고: `npx supabase login`으로 로그인되어 있거나 액세스 토큰이 필요할 수 있습니다)*

### 규칙 4: 이 문서 업데이트
테이블이나 컬럼을 추가하면, 즉시 `project_architecture.md` 파일을 업데이트하세요.

---

## 5. 유지보수 체크리스트 (작업 재개 시)
1. **`task.md` 확인**: 완료되지 않은 작업이 무엇인지 확인합니다.
2. **최신 코드 Pull**: git 상태가 동기화되어 있는지 확인합니다.
3. **최신 타입 Pull**: 타입 생성 명령어를 실행하여 로컬 타입이 원격 DB와 일치하는지 확인합니다.
4. **비교**: `project_architecture.md`가 현재 `src/types/supabase.ts` 내용을 포함하고 있는지 확인합니다. 그렇지 않다면 문서를 먼저 업데이트하세요.
