import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMainAdCarouselAdminData } from '@/lib/main-ad-carousel-server'
import MainAdSettingsClient from './main-ad-settings-client'

interface MainAdSettingsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MainAdSettingsPage({ searchParams }: MainAdSettingsPageProps) {
  await requireAdminPagePermission('storefront.edit')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const data = await getMainAdCarouselAdminData(workspaceSubject)

  return (
    <MainAdSettingsClient
      {...data}
      key={workspaceSubject}
      workspaceSubject={workspaceSubject}
    />
  )
}
