// 18번 7절(G-05): 서명 업로드 주소로 파일을 올리며 진행률을 받는다(브라우저 전용).
// supabase-js 의 storage.uploadToSignedUrl 은 진행률을 주지 않아, 같은 요청을 XMLHttpRequest 로 보낸다.
// 요청 꼴은 설치된 @supabase/storage-js(2.83.0) StorageFileApi.uploadToSignedUrl 과 같다(계약 시험이 그 소스와 대조):
//   PUT {SUPABASE_URL}/storage/v1/object/upload/sign/{bucket}/{path}?token={token}
//   본문 FormData: cacheControl='3600', ''=파일 / 머리: x-upsert=false, apikey, Authorization(Bearer 공개 키)

export interface SignedUploadTarget {
  bucket: string
  storagePath: string
  token: string
}

const DEFAULT_CACHE_CONTROL = '3600'

function cleanStoragePath(path: string) {
  return path.replace(/^\/|\/$/g, '').replace(/\/+/g, '/')
}

export function buildSignedUploadUrl(supabaseUrl: string, target: SignedUploadTarget) {
  const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/upload/sign/${target.bucket}/${cleanStoragePath(target.storagePath).replace(/^\/+/, '')}`)
  url.searchParams.set('token', target.token)
  return url.toString()
}

export function uploadFileToSignedUrl(
  target: SignedUploadTarget,
  file: Blob,
  onProgress: (loaded: number, total: number) => void
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', buildSignedUploadUrl(supabaseUrl, target))
    request.setRequestHeader('x-upsert', 'false')
    request.setRequestHeader('apikey', publicKey)
    request.setRequestHeader('Authorization', `Bearer ${publicKey}`)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }
      let message = `파일을 올리지 못했습니다(${request.status}).`
      try {
        const payload = JSON.parse(request.responseText) as { message?: string; error?: string }
        message = payload.message || payload.error || message
      } catch {
        // 본문이 JSON 이 아니면 상태 코드만 보인다
      }
      reject(new Error(message))
    }
    request.onerror = () => reject(new Error('네트워크 오류로 파일을 올리지 못했습니다.'))
    request.onabort = () => reject(new Error('파일 올리기가 취소되었습니다.'))
    const body = new FormData()
    body.append('cacheControl', DEFAULT_CACHE_CONTROL)
    body.append('', file)
    request.send(body)
  })
}
