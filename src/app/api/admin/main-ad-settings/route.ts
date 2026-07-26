import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  MAIN_AD_IMAGES_BUCKET,
  MainAdCarouselValidationError,
  buildMainAdStoragePath,
  getMainAdImageExtension,
  getReferencedMainAdImagePaths,
  validateMainAdCarouselConfig,
  validateMainAdCarouselDraftConfig,
  validateMainAdStoragePath,
  type MainAdCarouselConfig,
  type MainAdImageExtension,
  type MainAdImageRole,
  type MainAdSaveResponse,
} from '@/lib/main-ad-carousel'
import {
  getMainAdCarouselConfigForUpdate,
  getMainAdCarouselImageUrls,
  removeMainAdImagePaths,
  saveMainAdCarouselConfig,
} from '@/lib/main-ad-carousel-server'

export const dynamic = 'force-dynamic'

interface MultipartImage {
  itemId: string
  role: MainAdImageRole
  file: File
}

interface PreparedUpload extends MultipartImage {
  extension: MainAdImageExtension
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({
    success: false,
    error: { code, message },
  }, { status })
}

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, isAdmin: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return {
    user,
    isAdmin: Boolean(profile?.is_admin),
  }
}

function parseMultipartImages(formData: FormData) {
  const configValues = formData.getAll('config')
  if (configValues.length !== 1 || typeof configValues[0] !== 'string') {
    throw new MainAdCarouselValidationError('config 항목은 중복 없이 한 번만 전송해야 합니다.')
  }

  const images = new Map<string, MultipartImage>()

  for (const [fieldName, value] of formData.entries()) {
    if (fieldName === 'config') {
      if (typeof value !== 'string') {
        throw new MainAdCarouselValidationError('config 항목 형식이 올바르지 않습니다.')
      }
      continue
    }

    const match = fieldName.match(/^file:([^:]+):(pc|mobile)$/)
    if (!match || !(value instanceof File)) {
      throw new MainAdCarouselValidationError(`예상하지 않은 multipart 항목입니다: ${fieldName}`)
    }

    const [, itemId, roleValue] = match
    const role = roleValue as MainAdImageRole
    const expectedFieldName = `file:${itemId}:${role}`

    if (fieldName !== expectedFieldName || images.has(fieldName)) {
      throw new MainAdCarouselValidationError(`중복되거나 잘못된 파일 항목입니다: ${fieldName}`)
    }

    images.set(fieldName, { itemId, role, file: value })
  }

  let parsedConfig: unknown
  try {
    parsedConfig = JSON.parse(configValues[0])
  } catch {
    throw new MainAdCarouselValidationError('config JSON 형식이 올바르지 않습니다.')
  }

  return {
    draftConfig: validateMainAdCarouselDraftConfig(parsedConfig),
    images,
  }
}

function validateUploadPlan(
  draftConfig: MainAdCarouselConfig,
  previousConfig: MainAdCarouselConfig,
  images: Map<string, MultipartImage>
) {
  const draftItems = new Map(draftConfig.items.map((item) => [item.id, item]))
  const previousItems = new Map(previousConfig.items.map((item) => [item.id, item]))
  const uploads: PreparedUpload[] = []

  for (const image of images.values()) {
    const item = draftItems.get(image.itemId)
    if (!item) {
      throw new MainAdCarouselValidationError(
        `파일 항목과 일치하는 광고를 찾을 수 없습니다: ${image.itemId}`
      )
    }

    uploads.push({
      ...image,
      extension: getMainAdImageExtension(image.file),
    })
  }

  for (const item of draftConfig.items) {
    const previousItem = previousItems.get(item.id)
    const pcFile = images.get(`file:${item.id}:pc`)
    const mobileFile = images.get(`file:${item.id}:mobile`)

    if (!pcFile) {
      if (!item.pcImagePath) {
        throw new MainAdCarouselValidationError(`'${item.title}' 광고의 PC 이미지가 필요합니다.`)
      }

      validateMainAdStoragePath(item.pcImagePath, item.id, 'pc')
      if (!previousItem || previousItem.pcImagePath !== item.pcImagePath) {
        throw new MainAdCarouselValidationError(
          `새 PC 이미지는 파일 업로드를 통해서만 설정할 수 있습니다: ${item.title}`
        )
      }
    }

    if (!mobileFile && item.mobileImagePath) {
      validateMainAdStoragePath(item.mobileImagePath, item.id, 'mobile')
      if (!previousItem || previousItem.mobileImagePath !== item.mobileImagePath) {
        throw new MainAdCarouselValidationError(
          `새 모바일 이미지는 파일 업로드를 통해서만 설정할 수 있습니다: ${item.title}`
        )
      }
    }
  }

  return uploads
}

function hasServiceRoleCredentials() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST(request: Request) {
  const { user, isAdmin } = await requireAdminUser()

  if (!user) {
    return errorResponse('UNAUTHORIZED', '로그인이 필요합니다.', 401)
  }

  if (!isAdmin) {
    return errorResponse('FORBIDDEN', '관리자 권한이 필요합니다.', 403)
  }

  const uploadedPaths: string[] = []
  let settingSaved = false

  try {
    const formData = await request.formData()
    const { draftConfig, images } = parseMultipartImages(formData)
    const previousConfig = await getMainAdCarouselConfigForUpdate()
    const uploadPlan = validateUploadPlan(draftConfig, previousConfig, images)

    if (!hasServiceRoleCredentials()) {
      throw new Error('메인 광고 저장에 필요한 서비스 역할 키가 없습니다.')
    }

    const adminSupabase = createAdminClient()
    const nextConfig: MainAdCarouselConfig = {
      version: 1,
      items: draftConfig.items.map((item) => ({ ...item })),
    }
    const nextItems = new Map(nextConfig.items.map((item) => [item.id, item]))

    for (const upload of uploadPlan) {
      const storagePath = buildMainAdStoragePath(
        upload.itemId,
        upload.role,
        randomUUID(),
        upload.extension
      )
      const fileBuffer = Buffer.from(await upload.file.arrayBuffer())
      const { error: uploadError } = await adminSupabase
        .storage
        .from(MAIN_AD_IMAGES_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: upload.file.type,
          upsert: false,
        })

      if (uploadError) {
        throw new Error(
          uploadError.message.includes('Bucket not found')
            ? `Storage bucket '${MAIN_AD_IMAGES_BUCKET}' 이(가) 존재하지 않습니다.`
            : uploadError.message
        )
      }

      uploadedPaths.push(storagePath)
      const item = nextItems.get(upload.itemId)
      if (!item) {
        throw new Error('업로드한 이미지와 광고 항목을 연결하지 못했습니다.')
      }

      if (upload.role === 'pc') {
        item.pcImagePath = storagePath
      } else {
        item.mobileImagePath = storagePath
      }
    }

    const finalConfig = validateMainAdCarouselConfig(nextConfig)
    const savedConfig = await saveMainAdCarouselConfig(finalConfig)
    settingSaved = true

    const previousPaths = getReferencedMainAdImagePaths(previousConfig)
    const nextPaths = getReferencedMainAdImagePaths(savedConfig)
    const obsoletePaths = [...previousPaths].filter((path) => !nextPaths.has(path))
    const cleanupWarnings = await removeMainAdImagePaths(obsoletePaths)

    if (cleanupWarnings.length > 0) {
      console.error('메인 광고의 사용하지 않는 이미지 정리에 실패했습니다.', cleanupWarnings)
    }

    revalidatePath('/preview/solvook-concept')
    revalidatePath('/admin/main-ad-settings')

    const data: MainAdSaveResponse = {
      config: savedConfig,
      cleanupWarnings,
      imageUrls: getMainAdCarouselImageUrls(savedConfig),
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (!settingSaved && uploadedPaths.length > 0) {
      const rollbackWarnings = await removeMainAdImagePaths(uploadedPaths)
      if (rollbackWarnings.length > 0) {
        console.error('메인 광고 이미지 롤백에 실패했습니다.', rollbackWarnings)
      }
    }

    if (error instanceof MainAdCarouselValidationError || error instanceof SyntaxError) {
      return errorResponse('INVALID_MAIN_AD_SETTINGS', error.message, 400)
    }

    console.error('메인 광고 설정 저장에 실패했습니다.', error)
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      error instanceof Error ? error.message : '메인 광고 설정 저장에 실패했습니다.',
      500
    )
  }
}
