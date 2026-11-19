import FooterSettingsClient from './footer-client'
import { getFooterSettingsData } from './actions'
import { SiteBrandForm } from './site-brand-form'
import { SiteLogoSettings } from './site-logo-settings'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

// 사이트 기본 정보: 사이트 이름·로고(위) + 하단 사업자 정보·약관(아래)
export default async function FooterSettingsPage() {
  await requireAdminPagePermission('site.manage')
  const data = await getFooterSettingsData()

  return (
    <FooterSettingsClient
      footerContent={data.footerContent}
      siteBrandName={data.siteBrand?.name ?? ''}
      topSections={(
        <>
          <SiteBrandForm initial={data.siteBrand} />
          <SiteLogoSettings />
        </>
      )}
    />
  )
}
