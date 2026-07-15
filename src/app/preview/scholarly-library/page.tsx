import type { Metadata } from 'next'
import { ScholarlyLibraryPreview } from '@/components/features/landing/ScholarlyLibraryPreview'

export const metadata: Metadata = {
  title: 'Scholarly Library Preview | 써머썬 연구소',
  description: '써머썬 연구소의 학술 아카이브형 메인 페이지 디자인 프리뷰',
}

export default function ScholarlyLibraryPreviewPage() {
  return <ScholarlyLibraryPreview />
}
