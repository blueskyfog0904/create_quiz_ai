import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'

interface BalanceTransactionRow {
  balance_after: number | null
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>
type BalanceClient = Pick<ServerSupabaseClient, 'from'>

export interface CreditBalanceSnapshot {
  profileBalance: number
  ledgerBalance: number
  spendableBalance: number
  latestTransactionBalance: number | null
  // Transitional policy: keep UI on the profile cache until all mutation paths are ledger-first.
  displayBalance: number
  hasMismatch: boolean
  mismatchReasons: string[]
}

export function selectDisplayBalance(userId: string, snapshot: CreditBalanceSnapshot) {
  const ledgerDisplayEnabled = process.env.CREDIT_LEDGER_DISPLAY_ENABLED === 'true'
  const rolloutUsers = (process.env.CREDIT_LEDGER_DISPLAY_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!ledgerDisplayEnabled) {
    return snapshot.displayBalance
  }

  if (snapshot.hasMismatch) {
    return snapshot.displayBalance
  }

  if (rolloutUsers.length > 0 && !rolloutUsers.includes(userId)) {
    return snapshot.displayBalance
  }

  return snapshot.ledgerBalance
}

export function buildCreditBalanceResponseFields(
  snapshot: CreditBalanceSnapshot,
  displayBalance: number = snapshot.displayBalance
) {
  return {
    balance: displayBalance,
    profileBalance: snapshot.profileBalance,
    ledgerBalance: snapshot.ledgerBalance,
    spendableBalance: snapshot.spendableBalance,
    latestTransactionBalance: snapshot.latestTransactionBalance,
    hasMismatch: snapshot.hasMismatch,
    mismatchReasons: snapshot.mismatchReasons,
    reconcileRequired: snapshot.hasMismatch,
  }
}

export function logCreditBalanceMismatch(
  context: string,
  userId: string,
  snapshot: CreditBalanceSnapshot
) {
  if (!snapshot.hasMismatch) {
    return
  }

  console.error(`[CreditBalance] ${context} mismatch detected`, {
    userId,
    profileBalance: snapshot.profileBalance,
    ledgerBalance: snapshot.ledgerBalance,
    spendableBalance: snapshot.spendableBalance,
    latestTransactionBalance: snapshot.latestTransactionBalance,
    mismatchReasons: snapshot.mismatchReasons,
  })
}

export async function reportCreditBalanceMismatch(
  context: string,
  userId: string,
  snapshot: CreditBalanceSnapshot
) {
  logCreditBalanceMismatch(context, userId, snapshot)

  if (!snapshot.hasMismatch) {
    return
  }

  try {
    const adminSupabase = createAdminClient()
    const { data: admins, error: adminError } = await adminSupabase
      .from('profiles')
      .select('id')
      .eq('is_admin', true)

    if (adminError || !admins || admins.length === 0) {
      return
    }

    const notificationRows = admins.map((admin) => ({
      user_id: admin.id,
      type: 'warning',
      message: `크레딧 잔액 정합성 확인 필요: ${context} / 대상 사용자 ${userId} / 원인 ${snapshot.mismatchReasons.join(', ')}`,
      action_url: '/admin/credits',
      is_read: false,
    }))

    await adminSupabase
      .from('notifications')
      .insert(notificationRows)
  } catch (error) {
    console.error('[CreditBalance] Failed to persist reconcile signal:', error)
  }
}

async function getClient(client?: BalanceClient): Promise<BalanceClient> {
  return client ?? createClient()
}

function toNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0
}

export async function getProfileBalance(userId: string, client?: BalanceClient) {
  const supabase = await getClient(client)
  const { data, error } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[CreditBalance] Failed to read profile balance:', error)
    return 0
  }

  return data?.credits ?? 0
}

export async function getLedgerBalance(userId: string, client?: BalanceClient) {
  const supabase = await getClient(client)
  const { data, error } = await supabase
    .from('credit_sources')
    .select('remaining_credits, status')
    .eq('user_id', userId)

  if (error) {
    console.error('[CreditBalance] Failed to read ledger balance:', error)
    return 0
  }

  return (data ?? []).reduce((sum, row) => {
    return row.status === 'active' || row.status === 'pending_refund'
      ? sum + toNumber(row.remaining_credits)
      : sum
  }, 0)
}

export async function getSpendableBalance(userId: string, client?: BalanceClient) {
  const supabase = await getClient(client)
  const { data, error } = await supabase
    .from('credit_sources')
    .select('remaining_credits, status')
    .eq('user_id', userId)

  if (error) {
    console.error('[CreditBalance] Failed to read spendable balance:', error)
    return 0
  }

  return (data ?? []).reduce((sum, row) => {
    return row.status === 'active'
      ? sum + toNumber(row.remaining_credits)
      : sum
  }, 0)
}

export async function getLatestTransactionBalance(userId: string, client?: BalanceClient) {
  const supabase = await getClient(client)
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<BalanceTransactionRow>()

  if (error) {
    console.error('[CreditBalance] Failed to read latest transaction balance:', error)
    return null
  }

  return data?.balance_after ?? null
}

export async function syncProfileBalanceCacheFromLedger(userId: string, client?: BalanceClient) {
  const supabase = await getClient(client)
  const ledgerBalance = await getLedgerBalance(userId, supabase)
  const { data, error } = await supabase
    .from('profiles')
    .update({ credits: ledgerBalance })
    .eq('id', userId)
    .select('credits')
    .single()

  if (error) {
    console.error('[CreditBalance] Failed to sync profile cache from ledger:', error)
    throw new Error('프로필 캐시 잔액 동기화에 실패했습니다.')
  }

  return data?.credits ?? ledgerBalance
}

export async function getCreditBalanceSnapshot(userId: string, client?: BalanceClient): Promise<CreditBalanceSnapshot> {
  const supabase = await getClient(client)
  const [profileBalance, ledgerBalance, spendableBalance, latestTransactionBalance] = await Promise.all([
    getProfileBalance(userId, supabase),
    getLedgerBalance(userId, supabase),
    getSpendableBalance(userId, supabase),
    getLatestTransactionBalance(userId, supabase),
  ])

  const mismatchReasons: string[] = []

  if (profileBalance !== ledgerBalance) {
    mismatchReasons.push('profile_vs_ledger')
  }

  if (latestTransactionBalance !== null && latestTransactionBalance !== profileBalance) {
    mismatchReasons.push('profile_vs_latest_transaction')
  }

  if (latestTransactionBalance !== null && latestTransactionBalance !== ledgerBalance) {
    mismatchReasons.push('ledger_vs_latest_transaction')
  }

  return {
    profileBalance,
    ledgerBalance,
    spendableBalance,
    latestTransactionBalance,
    displayBalance: profileBalance,
    hasMismatch: mismatchReasons.length > 0,
    mismatchReasons,
  }
}
