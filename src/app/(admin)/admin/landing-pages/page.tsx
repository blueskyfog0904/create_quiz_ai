import LandingPagesClient from './landing-pages-client'
import { getLandingPagesAdminData, type LandingEditorTarget } from './actions'

interface LandingPagesPageProps {
  searchParams?: Promise<{ target?: string }>
}

function resolveLandingEditorTarget(value?: string): LandingEditorTarget {
  return value === 'english' || value === 'korean' ? value : 'main'
}

export default async function LandingPagesPage({ searchParams }: LandingPagesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const target = resolveLandingEditorTarget(resolvedSearchParams?.target)
  const data = await getLandingPagesAdminData()

  return <LandingPagesClient key={target} initialTarget={target} {...data} />
}
