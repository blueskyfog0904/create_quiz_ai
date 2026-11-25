import FooterSettingsClient from './footer-client'
import { getFooterSettingsData } from './actions'
import { getSignupConsentAdminData } from './consent-actions'
import { SiteBrandForm } from './site-brand-form'
import { SiteLogoSettings } from './site-logo-settings'
import { SignupConsentAdmin } from './signup-consent-admin'
import { NoticePopupAdmin } from './notice-popup-admin'
import { getNoticePopupAdminData } from './notice-popup-actions'
import { PurchasePolicyForm } from './purchase-policy-form'
import { getMarketPurchasePolicyAdminData } from './purchase-policy-actions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { POLICY_UPCOMING_LOCKED_MESSAGE } from '@/lib/site-notice-popup'
import { readUpcomingPolicyDocumentsForAdmin } from '@/lib/site-notice-popup-server'

// 사이트 기본 정보: 사이트 이름·로고(위) + 하단 사업자 정보·약관(아래)
// 가입 동의 항목·공지 팝업 카드는 대표에게만 보인다(전 회원 재동의를 일으킬 수 있어서, 15번 7-1).
// 변경 예정 약관 고지 중(upcoming)이면 약관 칸·가입 동의 카드 위에 저장이 막힌다는 안내를 미리 보인다(7-3).
export default async function FooterSettingsPage() {
  const access = await requireAdminPagePermission('site.manage')
  const [data, consentData, purchasePolicy, noticePopupData, upcoming] = await Promise.all([
    getFooterSettingsData(),
    access.role === 'owner' ? getSignupConsentAdminData() : Promise.resolve(null),
    getMarketPurchasePolicyAdminData(),
    access.role === 'owner' ? getNoticePopupAdminData() : Promise.resolve(null),
    readUpcomingPolicyDocumentsForAdmin(),
  ])
  const policyLockNotice = upcoming.ok && upcoming.value?.status === 'upcoming' ? POLICY_UPCOMING_LOCKED_MESSAGE : null

  return (
    <FooterSettingsClient
      footerContent={data.footerContent}
      siteBrandName={data.siteBrand?.name ?? ''}
      policyLockNotice={policyLockNotice}
      topSections={(
        <>
          <SiteBrandForm initial={data.siteBrand} />
          <SiteLogoSettings />
          {noticePopupData ? <NoticePopupAdmin data={noticePopupData} /> : null}
          {consentData ? <SignupConsentAdmin data={consentData} lockNotice={policyLockNotice} /> : null}
          <PurchasePolicyForm initial={purchasePolicy} />
        </>
      )}
    />
  )
}
