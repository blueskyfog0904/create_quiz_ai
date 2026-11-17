import LandingPagesClient from './landing-pages-client'
import { getLandingPagesAdminData, type LandingEditorTarget } from './actions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

interface LandingPagesPageProps {
  searchParams?: Promise<{ target?: string }>
}

function resolveLandingEditorTarget(value?: string): LandingEditorTarget {
  return value === 'english' || value === 'korean' ? value : 'main'
}

export default async function LandingPagesPage({ searchParams }: LandingPagesPageProps) {
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const target = resolveLandingEditorTarget(resolvedSearchParams?.target)
  const data = await getLandingPagesAdminData()

  return <LandingPagesClient key={target} initialTarget={target} {...data} />
}
