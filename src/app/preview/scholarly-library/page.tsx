import type { Metadata } from 'next'
import { ScholarlyLibraryPreview } from '@/components/features/landing/ScholarlyLibraryPreview'

export const metadata: Metadata = {
  title: 'AI 영어문제 & 문제마켓 Preview | 써머썬 연구소',
  description: 'AI 영어문제 생성과 전문가 제작 문제마켓을 함께 소개하는 메인 페이지 디자인 프리뷰',
}

export default function ScholarlyLibraryPreviewPage() {
  return <ScholarlyLibraryPreview />
}
