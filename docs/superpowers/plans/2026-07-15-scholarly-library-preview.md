# Scholarly Library Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 메인 페이지를 수정하지 않고 `/preview/scholarly-library`에 AI 영어문제 생성과 문제마켓을 동등하게 소개하는 학술 아카이브형 메인 페이지 프리뷰를 만든다.

**Architecture:** 신규 App Router 페이지가 신규 Server Component를 렌더링한다. 콘텐츠는 정적이며 CTA만 기존 영어 AI 생성과 영어·국어 문제마켓 라우트로 연결해 현재 데이터·인증 흐름과 분리한다.

**Tech Stack:** Next.js App Router, React Server Components, Tailwind CSS 4, lucide-react

---

### Task 1: 독립 프리뷰 계약 고정

**Files:**
- Create: `tests/scholarly-library-preview-contract.test.mjs`

- [ ] 신규 라우트와 컴포넌트의 존재, 핵심 카피, 실제 CTA 경로를 검증하는 계약 테스트를 작성한다.
- [ ] `node --test tests/scholarly-library-preview-contract.test.mjs`를 실행해 라우트 부재로 실패하는지 확인한다.

### Task 2: Scholarly Library 프리뷰 구현

**Files:**
- Create: `src/app/preview/scholarly-library/page.tsx`
- Create: `src/components/features/landing/ScholarlyLibraryPreview.tsx`

- [ ] 신규 페이지에서 프리뷰 컴포넌트를 렌더링하고 전용 메타데이터를 정의한다.
- [ ] 헤더, 히어로, 가치, 기능, 제작 흐름, 결과물, 최종 CTA를 정적 Server Component로 구현한다.
- [ ] 기존 페이지 파일을 수정하지 않고 CTA를 `/english/generate/personal`, `/english/library/purchased`, `/english/library/exam-papers`에 연결한다.
- [ ] 계약 테스트를 다시 실행해 통과를 확인한다.

### Task 3: 정적·시각 검증

**Files:**
- Verify: `src/app/preview/scholarly-library/page.tsx`
- Verify: `src/components/features/landing/ScholarlyLibraryPreview.tsx`

- [ ] `npx eslint src/app/preview/scholarly-library/page.tsx src/components/features/landing/ScholarlyLibraryPreview.tsx`를 실행한다.
- [ ] `npx tsc --noEmit`를 실행한다.
- [ ] `npm run build`로 신규 정적 라우트 생성을 확인한다.
- [ ] 브라우저에서 데스크톱과 모바일 뷰포트를 확인하고 주요 CTA와 섹션 배치를 검증한다.
- [ ] `git diff --check`와 `git status --short`로 기존 파일이 수정되지 않았는지 확인한다.

### Task 4: 두 대표 서비스 중심으로 메시지 재구성

**Files:**
- Modify: `src/components/features/landing/ScholarlyLibraryPreview.tsx`
- Modify: `tests/scholarly-library-preview-contract.test.mjs`

- [ ] AI 영어문제 생성이 현재 영어 전용임을 명시하고 문제마켓과 동일한 시각적 비중으로 배치한다.
- [ ] 문제마켓에 내신 문제 전문가, 무료 샘플, 개별 구매, 전체 패키지, PDF/HWP와 구매자료 보관 가치를 포함한다.
- [ ] 영어 AI 생성, 영어 문제마켓, 국어 문제마켓 CTA를 실제 경로로 연결한다.
- [ ] 계약 테스트, ESLint, TypeScript, 프로덕션 빌드와 HTTP 응답을 다시 검증한다.
