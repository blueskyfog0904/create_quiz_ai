import { requireAuth } from '@/lib/auth'
import { WithdrawClient } from './withdraw-client'

export default async function WithdrawPage() {
  const user = await requireAuth()
  
  return <WithdrawClient email={user.email || ''} />
}


