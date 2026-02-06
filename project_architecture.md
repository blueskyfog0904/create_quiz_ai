# 프로젝트 아키텍처 및 기능 분석 보고서

이 문서는 `create_quiz_ai` 프로젝트의 아키텍처, 핵심 기능, 워크플로우 및 데이터베이스 스키마에 대한 **심층 분석**과 **유일한 진실의 원천(Single Source of Truth)** 역할을 합니다.

---

## 1. 프로젝트 개요 (Overview)

**프로젝트명**: Create Quiz AI
**목표**: 선생님과 강사가 AI(Gemini/OpenAI)를 활용하여 영어 지문을 분석하고, 다양한 유형의 문제(객관식, 주관식 등)를 자동으로 생성하여 시험지를 제작할 수 있는 플랫폼입니다.

### 핵심 가치 제안 (Key Value Propositions)
1.  **AI 기반 문제 생성 (AI Generation)**: 지문 하나로 문법, 어휘, 독해 등 다양한 유형의 문제를 클릭 한 번으로 생성.
2.  **커스텀 시험지 제작 (Exam Assembly)**: 생성된 문제를 "문제 은행"에 저장하고, 원하는 문제들을 조합하여 시험지(Exam Paper)로 구성.
3.  **다양한 포맷 내보내기 (Export)**: 완성된 시험지를 **PDF** 및 **Word** 형식으로 인쇄 가능한 레이아웃(1단/2단)으로 다운로드.
4.  **유연한 관리 (Management)**: 문제 유형, 프롬프트, AI 모델 설정을 관리자 패널에서 동적으로 제어.

---

## 2. 기술 스택 (Tech Stack)

| 구분 | 기술 | 설명 |
| :--- | :--- | :--- |
| **Framework** | Next.js 14 (App Router) | React Server Components 기반의 최신 라우팅 및 렌더링 |
| **Language** | TypeScript | 정적 타입 안정성 확보 |
| **Database** | Supabase (PostgreSQL) | 관계형 데이터베이스 및 실시간 구독 |
| **Auth** | Supabase Auth | 이메일 및 소셜 로그인(Kakao) 지원 |
| **UI/Styling** | TailwindCSS + Shadcn UI | 유연하고 현대적인 컴포넌트 디자인 시스템 |
| **AI LLM** | Google Gemini / OpenAI | `ai_models` 테이블로 관리되는 멀티 LLM 지원 |
| **Export** | pdfmake, docx | 클라이언트 측 PDF 및 Word 문서 생성 라이브러리 |

---

## 3. 핵심 워크플로우 (Core Workflows)

### 3.1 문제 생성 워크플로우 (Question Generation Flow)
1.  **지문 등록 (`passages`)**: 
    - 사용자가 영어 지문을 직접 입력하거나 OCR(이미지 인식)을 통해 등록합니다.
    - AI가 지문을 분석하여 제목(한/영), 번역본, 태그 등의 메타데이터를 자동 생성할 수 있습니다.
2.  **문제 유형 선택 (`problem_types`)**:
    - 대시보드 (`/generate`)에서 원하는 문제 유형(예: 주제 찾기, 빈칸 추론, 문법성 판단 등)을 선택합니다.
    - 관리자가 `problem_types` 테이블에 정의한 프롬프트 템플릿이 사용됩니다.
3.  **AI 생성 실행**:
    - 선택한 LLM 모델이 프롬프트와 지문을 결합하여 문제를 생성합니다.
    - 생성된 결과는 `questions` 테이블에 저장되며, 사용자는 이를 즉시 수정하거나 저장할 수 있습니다.
4.  **검토 및 수정**:
    - 생성된 문제의 정답, 해설, 선지 등을 에디터에서 미세 조정합니다.

### 3.2 시험지 제작 워크플로우 (Exam Paper Assembly)
1.  **문제 은행 (`/bank`)**:
    - 생성된 모든 문제는 사용자의 개인 문제 은행에 보관됩니다.
    - 필터(난이도, 유형, 지문별)를 통해 원하는 문제를 검색합니다.
2.  **시험지 구성 (`exam_papers`)**:
    - 새 시험지를 생성하고, 문제 은행에서 문제를 선택하여 추가합니다.
    - `exam_paper_items` 테이블을 통해 문제의 순서(`order_index`)와 번호(`number`)를 관리합니다.
3.  **내보내기 (Export)**:
    - 시험지 상세 페이지(`/exam-papers/[id]`)에서 **인쇄/PDF** 또는 **Word** 버튼을 클릭합니다.
    - 옵션 선택: 문제만 출력 / 정답 포함 출력 / 1단 레이아웃 / 2단 레이아웃.

---

## 4. 디렉토리 구조 (Directory Structure)

```text
.
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (admin)/            # 관리자 기능 (문제유형 관리, 사용자 관리 등)
│   │   ├── (auth)/             # 로그인/회원가입 페이지
│   │   ├── (dashboard)/        # 일반 사용자 기능 (문제생성, 보관함 등)
│   │   │   ├── bank/           # 내 문제 은행
│   │   │   ├── exam-papers/    # 시험지 관리 및 편집
│   │   │   ├── generate/       # AI 문제 생성 페이지
│   │   │   ├── library/        # 지문(Passage) 라이브러리
│   │   │   └── mypage/         # 프로필 및 설정
│   │   └── api/                # 백엔드 API (AI 연동, DB CRUD)
│   ├── components/
│   │   ├── features/           # 도메인 특화 컴포넌트 (QuestionEditor, ExamView 등)
│   │   └── ui/                 # Shadcn UI 공통 컴포넌트
│   ├── lib/
│   │   ├── ai/                 # Gemini/OpenAI API 래퍼
│   │   └── export-utils.ts     # PDF/Word 내보내기 로직
│   └── types/                  # Supabase 생성 타입 정의
└── supabase/                   # 마이그레이션 및 설정 파일
```

---

## 5. 데이터베이스 스키마 상세 (Database Schema)

**진실의 원천**: Supabase 프로젝트 (`kzcweelnzhcmiuvjgeyi`)

### 관계 다이어그램 (ERD 요약)
- **Profiles** (1) -- (< 1) **Passages**
- **Profiles** (1) -- (< 1) **Questions**
- **Profiles** (1) -- (< 1) **Exam Papers**
- **Passages** (1) -- (0..N) **Questions**
- **Exam Papers** (1) -- (0..N) **Exam Paper Items** -- (1) **Questions**
- **Problem Types** (1) -- (0..N) **Questions**

### 테이블 및 컬럼 상세 정의

#### 1) `profiles` (사용자 프로필)
`auth.users`를 확장한 사용자 기본 정보입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | | NO | `auth.users` FK |
| `email` | `text` | | YES | 이메일 |
| `name` | `text` | | YES | 사용자 이름 |
| `role` | `text` | | YES | 역할 (`teacher`, `academy_instructor`) |
| `is_admin` | `boolean` | `false` | YES | 관리자 여부 |
| `provider` | `text` | `'email'` | YES | 가입 경로 |
| `kakao_id` | `text` | | YES | 카카오 ID |
| `kakao_email` | `text` | | YES | 카카오 이메일 |
| `phone` | `text` | | YES | 전화번호 |
| `organization` | `text` | | YES | 소속 |
| `created_at` | `timestamptz` | `now()` | YES | 생성일시 |
| `updated_at` | `timestamptz` | `now()` | YES | 수정일시 |

#### 2) `passages` (영어 지문)
문제 생성의 기반이 되는 영어 지문입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `gen_random_uuid()` | NO | PK |
| `user_id` | `uuid` | | NO | 소유자 (FK) |
| `content` | `text` | | NO | 지문 본문 (영어) |
| `content_translation` | `text` | | YES | 한글 해석 |
| `title_en` | `text` | | YES | 영어 제목 |
| `title_ko` | `text` | | YES | 한글 제목 |
| `source_type` | `text` | | YES | 출처 구분 |
| `source_1` | `text` | | YES | 출처 상세 1 |
| `source_2` | `text` | | YES | 출처 상세 2 |
| `source_3` | `text` | | YES | 출처 상세 3 |
| `source_4` | `text` | | YES | 출처 상세 4 |
| `tags` | `text[]` | `'{}'` | YES | 태그 배열 |
| `is_bookmarked` | `boolean` | `false` | YES | 북마크 여부 |
| `created_at` | `timestamptz` | `now()` | YES | 생성일시 |
| `updated_at` | `timestamptz` | `now()` | YES | 수정일시 |

#### 3) `questions` (문제)
생성된 개별 문제 데이터입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `extensions.uuid_generate_v4()` | NO | PK |
| `user_id` | `uuid` | | NO | 생성자 (FK) |
| `passage_id` | `uuid` | | YES | 관련 지문 (FK) |
| `problem_type_id` | `uuid` | | YES | 문제 유형 (FK) |
| `question_text` | `text` | | NO | 발문 |
| `question_text_forward` | `text` | | YES | [박스] 앞부분 지문 |
| `question_text_backward` | `text` | | YES | [박스] 뒷부분 지문 |
| `choices` | `jsonb` | | NO | 선지 (`[{label, text}]`) |
| `answer` | `text` | | NO | 정답 |
| `explanation` | `text` | | YES | 해설 |
| `difficulty` | `text` | | YES | 난이도 |
| `grade_level` | `text` | | YES | 학년 |
| `source` | `varchar` | `'ai_generated'` | YES | 생성 출처 |
| `tags` | `text[]` | | YES | 태그 |
| `raw_ai_response` | `text` | | YES | AI 원본 응답 디버깅용 |
| `created_at` | `timestamptz` | `now()` | YES | 생성일시 |
| `updated_at` | `timestamptz` | `now()` | YES | 수정일시 |

#### 4) `problem_types` (문제 유형)
관리자가 설정하는 문제 유형 정의입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `extensions.uuid_generate_v4()` | NO | PK |
| `type_name` | `text` | | NO | 유형 이름 (예: 주제 찾기) |
| `description` | `text` | | YES | 설명 |
| `prompt_template` | `text` | | NO | 프롬프트 템플릿 |
| `output_format` | `text` | | YES | 기대 JSON 포맷 |
| `provider` | `text` | | NO | `gemini`, `openai` |
| `model_name` | `text` | | NO | 모델명 |
| `is_active` | `boolean` | `true` | YES | 활성화 여부 |

#### 5) `exam_papers` (시험지)
사용자가 구성한 시험지 메타데이터입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `extensions.uuid_generate_v4()` | NO | PK |
| `user_id` | `uuid` | | NO | 소유자 (FK) |
| `paper_title` | `text` | | NO | 시험지 제목 |
| `description` | `text` | | YES | 설명 |
| `created_at` | `timestamptz` | `now()` | YES | 생성일시 |
| `updated_at` | `timestamptz` | `now()` | YES | 수정일시 |

#### 6) `exam_paper_items` (시험지 문항)
시험지에 포함된 문제와 순서를 관리합니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `extensions.uuid_generate_v4()` | NO | PK |
| `exam_paper_id` | `uuid` | | NO | 시험지 (FK) |
| `question_id` | `uuid` | | NO | 문제 (FK) |
| `number` | `integer` | | NO | 표기 번호 |
| `order_index` | `integer` | | NO | 정렬 순서 |

#### 7) `ai_models` (AI 모델)
시스템에서 사용 가능한 AI 모델 목록입니다.
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `extensions.uuid_generate_v4()` | NO | PK |
| `name` | `text` | | NO | 모델명 (Gemini 1.5 Pro 등) |
| `provider` | `text` | | NO | 제공자 (google, openai) |
| `display_order` | `integer` | `0` | NO | 정렬 순서 |

#### 8) `system_settings` (시스템 설정)
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `key` | `text` | | NO | 설정 키 (PK) |
| `value` | `jsonb` | | NO | 설정 값 |
| `description` | `text` | | YES | 설명 |

#### 9) `support_tickets` (고객 지원)
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `gen_random_uuid()` | NO | PK |
| `user_id` | `uuid` | | NO | 작성자 (FK) |
| `subject` | `text` | | NO | 제목 |
| `message` | `text` | | NO | 내용 |
| `status` | `text` | `'pending'` | NO | 상태 |
| `admin_response` | `text` | | YES | 관리자 답변 |

#### 10) `source_configs` (출처 설정)
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `gen_random_uuid()` | NO | PK |
| `type_name` | `text` | | NO | 출처 타입 (Unique) |
| `source_X_label` | `text` | | YES | 출처 필드 라벨 (1~4) |
| `source_X_options`| `text[]` | | YES | 출처 필드 옵션 (1~4) |

#### 11) `notifications` (알림)
| 컬럼명 | 타입 | 기본값 | Nullable | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `gen_random_uuid()` | NO | PK |
| `user_id` | `uuid` | | NO | 수신자 (FK) |
| `title` | `text` | | NO | 제목 |
| `message` | `text` | | NO | 메시지 |
| `is_read` | `boolean` | `false` | YES | 읽음 여부 |

---

## 6. 개발 컨벤션 및 규칙

1.  **스키마 변경**: Supabase 대시보드에서 변경 후 반드시 다음 명령어로 타입을 동기화합니다.
    ```bash
    npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts
    ```
2.  **API 작성**: 모든 백엔드 로직은 `src/app/api` 내의 Route Handler로 작성하며, 클라이언트에서는 `fetch` 또는 `React Query`를 사용하지 않고 Server Actions 또는 API 호출을 `useEffect`로 처리하는 패턴을 확인해야 합니다.
3.  **컴포넌트**: 재사용 가능한 UI는 `components/ui` (Shadcn)를 사용하고, 비즈니스 로직이 포함된 컴포넌트는 `components/features`에 배치합니다.
