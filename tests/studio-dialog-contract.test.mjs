import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 회원 화면 팝업은 공통 틀(studio-dialog) 하나로 모양을 맞춘다(2026-11-20).
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const studioDialog = read('../src/components/design-system/studio-dialog.tsx')
const memberDialogSources = {
  loginComplete: read('../src/components/auth/login-complete-dialog.tsx'),
  purchaseComplete: read('../src/components/market/market-purchase-complete-dialog.tsx'),
  // 11번: 구매 확인창(market-checkout-confirm-dialog)은 없애고 결제 칸의 공통 동의 부품이 세부 항목 창을 연다.
  checkoutConsent: read('../src/components/checkout/checkout-consent.tsx'),
  itemActions: read('../src/components/market/market-item-actions.tsx'),
  support: read('../src/app/(solvook)/mypage/support/_components/support-view.tsx'),
  withdraw: read('../src/app/(solvook)/mypage/withdraw/_components/withdraw-view.tsx'),
  library: read('../src/app/(solvook)/library/_components/library-view.tsx'),
  credits: read('../src/app/(solvook)/mypage/credits/_components/credits-view.tsx'),
  logout: read('../src/app/(solvook)/mypage/_components/mypage-logout-button.tsx'),
  // 15번 공지 팝업
  noticePopup: read('../src/components/notice/site-notice-popup.tsx'),
}

test('studio dialog defines one shared panel, header, footer and alert dialog', () => {
  for (const name of ['StudioDialogPanel', 'StudioDialogHeader', 'StudioDialogTitle', 'StudioDialogDescription', 'StudioDialogFooter', 'StudioAlertDialog']) {
    assert.match(studioDialog, new RegExp(`function ${name}\\(`))
  }
  assert.match(studioDialog, /rounded-2xl/)
  assert.match(studioDialog, /text-center sm:text-center/)
  assert.doesNotMatch(studioDialog, /#[0-9a-fA-F]{3,8}\b/)
})

test('member popups use the shared studio dialog instead of raw DialogContent or browser alert/confirm', () => {
  for (const [name, source] of Object.entries(memberDialogSources)) {
    assert.doesNotMatch(source, /<DialogContent\b/, `${name} should not render raw DialogContent`)
    assert.doesNotMatch(source, /(^|[^.\w])(alert|confirm)\(/m, `${name} should not call browser alert/confirm`)
  }
  for (const name of ['loginComplete', 'purchaseComplete', 'itemActions', 'support', 'withdraw', 'library', 'credits', 'noticePopup']) {
    assert.match(memberDialogSources[name], /@\/components\/design-system\/studio-dialog/, `${name} should import studio-dialog`)
  }
})
