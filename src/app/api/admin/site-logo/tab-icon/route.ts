import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MAIN_AD_IMAGES_BUCKET } from '@/lib/main-ad-carousel'
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_SIZE, SITE_TAB_ICON_SETTING_KEY } from '@/lib/site-logo'
import { normalizeSiteLogo } from '@/lib/site-logo-image'

export const runtime = 'nodejs'

// 브라우저 탭 아이콘 올리기. 사이트 로고(../route.ts)와 같은 방식으로 변환·저장하고, 설정 행만 따로 둔다.
export async function POST(request: Request) {
  const guard = await requireAdminApiPermission('site.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: adminApiGuardMessage(guard) }, { status: guard.status })
  }

  if (Number(request.headers.get('content-length')) > SITE_LOGO_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: '5MB 이하인 이미지를 선택해주세요.' }, { status: 413 })
  }

  let image: Buffer
  try {
    const form = await request.formData()
    const files = form.getAll('file')
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return NextResponse.json({ error: '탭 아이콘 이미지 한 개를 선택해주세요.' }, { status: 400 })
    }
    image = await normalizeSiteLogo(files[0])
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '이미지 형식이 올바르지 않습니다.',
    }, { status: 400 })
  }

  const admin = createAdminClient()
  const path = `site-tab-icon/${randomUUID()}.png`
  let uploaded = false
  let saved = false
  try {
    const { error: uploadError } = await admin.storage.from(MAIN_AD_IMAGES_BUCKET).upload(path, image, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploadError) throw uploadError
    uploaded = true

    const { error: saveError } = await admin.from('system_settings').upsert({
      key: SITE_TAB_ICON_SETTING_KEY,
      value: { path, width: SITE_LOGO_SIZE, height: SITE_LOGO_SIZE },
      description: '브라우저 탭 아이콘(없으면 사이트 로고를 쓴다)',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (saveError) throw saveError
    saved = true

    revalidateTag(SITE_TAB_ICON_SETTING_KEY, { expire: 0 })
    revalidatePath('/', 'layout')
    // 저장된 뒤 작업 기록을 남긴다(실패해도 결과는 그대로)
    await recordAdminAudit({
      actorId: guard.access.userId,
      action: 'site_tab_icon_update',
      targetType: 'site_tab_icon',
      details: { path },
    })
    const url = admin.storage.from(MAIN_AD_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
    return NextResponse.json({ url })
  } catch (error) {
    if (uploaded && !saved) {
      const { error: cleanupError } = await admin.storage.from(MAIN_AD_IMAGES_BUCKET).remove([path])
      if (cleanupError) console.error('실패한 탭 아이콘 업로드 정리에 실패했습니다.', cleanupError)
    }
    console.error('탭 아이콘 저장에 실패했습니다.', error)
    return NextResponse.json({ error: '탭 아이콘을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
}

// 사이트 로고로 되돌리기: 탭 아이콘 설정 행을 지우면 탭 아이콘이 사이트 로고를 따른다.
// 올렸던 파일은 지우지 않는다(로고를 바꿀 때와 같음).
export async function DELETE() {
  const guard = await requireAdminApiPermission('site.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: adminApiGuardMessage(guard) }, { status: guard.status })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('system_settings').delete().eq('key', SITE_TAB_ICON_SETTING_KEY)
  if (error) {
    console.error('탭 아이콘 되돌리기에 실패했습니다.', error)
    return NextResponse.json({ error: '사이트 로고로 되돌리지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  revalidateTag(SITE_TAB_ICON_SETTING_KEY, { expire: 0 })
  revalidatePath('/', 'layout')
  await recordAdminAudit({
    actorId: guard.access.userId,
    action: 'site_tab_icon_reset',
    targetType: 'site_tab_icon',
  })
  return NextResponse.json({ success: true })
}
