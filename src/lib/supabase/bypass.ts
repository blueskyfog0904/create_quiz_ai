// 서비스 롤 키로 RLS를 우회하는 클라이언트다. 브라우저 번들에 들어가지 않게 서버 전용으로 막는다.
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'

export const createAdminClient = () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}
