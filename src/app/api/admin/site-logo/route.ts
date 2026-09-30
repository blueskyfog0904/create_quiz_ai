import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MAIN_AD_IMAGES_BUCKET } from '@/lib/main-ad-carousel'
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_SETTING_KEY, SITE_LOGO_SIZE } from '@/lib/site-logo'
import { normalizeSiteLogo } from '@/lib/site-logo-image'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  if (Number(request.headers.get('content-length')) > SITE_LOGO_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: '5MB 이하인 이미지를 선택해주세요.' }, { status: 413 })
  }

  let image: Buffer
  try {
    const form = await request.formData()
    const files = form.getAll('file')
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return NextResponse.json({ error: '로고 이미지 한 개를 선택해주세요.' }, { status: 400 })
    }
    image = await normalizeSiteLogo(files[0])
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '이미지 형식이 올바르지 않습니다.',
    }, { status: 400 })
  }

  const admin = createAdminClient()
  const path = `site-logo/${randomUUID()}.png`
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
      key: SITE_LOGO_SETTING_KEY,
      value: { path, width: SITE_LOGO_SIZE, height: SITE_LOGO_SIZE },
      description: '영어·국어 공통 헤더 및 푸터 로고',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (saveError) throw saveError
    saved = true

    revalidateTag(SITE_LOGO_SETTING_KEY, { expire: 0 })
    revalidatePath('/', 'layout')
    const url = admin.storage.from(MAIN_AD_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
    return NextResponse.json({ url, width: SITE_LOGO_SIZE, height: SITE_LOGO_SIZE })
  } catch (error) {
    if (uploaded && !saved) {
      const { error: cleanupError } = await admin.storage.from(MAIN_AD_IMAGES_BUCKET).remove([path])
      if (cleanupError) console.error('실패한 로고 업로드 정리에 실패했습니다.', cleanupError)
    }
    console.error('사이트 로고 저장에 실패했습니다.', error)
    return NextResponse.json({ error: '로고를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
}
