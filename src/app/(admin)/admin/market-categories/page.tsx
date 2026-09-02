import { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import MarketCategoriesClient from './market-categories-client'

export const metadata: Metadata = {
  title: '카테고리 메뉴 관리 | 관리자 패널',
  description: '헤더 카테고리 메가메뉴에 노출되는 그룹과 항목을 관리합니다.',
}

interface MarketCategoriesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketCategoriesPage({ searchParams }: MarketCategoriesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          카테고리 메뉴 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        헤더 카테고리 메가메뉴에 노출되는 그룹(2단계)과 항목(3단계)입니다. 비활성화하면 메뉴와 카테고리 페이지에서 숨겨집니다.
      </p>
      <MarketCategoriesClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
