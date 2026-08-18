import { handleKakaoPayCallback } from '@/lib/kakaopay-callback-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleKakaoPayCallback(request, 'fail')
}
