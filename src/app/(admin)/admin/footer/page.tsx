import FooterSettingsClient from './footer-client'
import { getFooterSettingsData } from './actions'
import { getSignupConsentAdminData } from './consent-actions'
import { SiteBrandForm } from './site-brand-form'
import { SiteLogoSettings } from './site-logo-settings'
import { SignupConsentAdmin } from './signup-consent-admin'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

// 사이트 기본 정보: 사이트 이름·로고(위) + 하단 사업자 정보·약관(아래)
// 가입 동의 항목 카드는 대표에게만 보인다(전 회원 재동의를 일으킬 수 있어서).
export default async function FooterSettingsPage() {
  const access = await requireAdminPagePermission('site.manage')
  const [data, consentData] = await Promise.all([
    getFooterSettingsData(),
    access.role === 'owner' ? getSignupConsentAdminData() : Promise.resolve(null),
  ])

  return (
    <FooterSettingsClient
      footerContent={data.footerContent}
      siteBrandName={data.siteBrand?.name ?? ''}
      topSections={(
        <>
          <SiteBrandForm initial={data.siteBrand} />
          <SiteLogoSettings />
          {consentData ? <SignupConsentAdmin data={consentData} /> : null}
        </>
      )}
    />
  )
}
