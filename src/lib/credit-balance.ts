import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>
type BalanceClient = Pick<ServerSupabaseClient, 'from'>

export interface CreditBalanceSnapshot {
  profileBalance: number
  ledgerBalance: number
  spendableBalance: number
  expiredBalance: number
  latestTransactionBalance: number | null
  nextExpirationAt: string | null
  databaseNow: string
  displayBalance: number
  hasMismatch: boolean
  mismatchReasons: string[]
}

export function selectDisplayBalance(_userId: string, snapshot: CreditBalanceSnapshot) {
  return snapshot.spendableBalance
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
    expiredBalance: snapshot.expiredBalance,
    latestTransactionBalance: snapshot.latestTransactionBalance,
    nextExpirationAt: snapshot.nextExpirationAt,
    databaseNow: snapshot.databaseNow,
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

interface CreditBalanceRpcResult {
  profile_balance: number
  ledger_balance: number
  spendable_balance: number
  expired_balance: number
  latest_transaction_balance: number | null
  next_expiration_at: string | null
  database_now: string
}

async function readCreditBalanceRpc(userId: string) {
  const admin = createAdminClient()
  const rpcClient = admin as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>
    ) => Promise<{
      data: unknown
      error: { message?: string } | null
    }>
  }
  const { data, error } = await rpcClient.rpc('get_credit_balance_snapshot', {
    p_user_id: userId,
  })

  if (error) {
    throw new Error(error.message || '크레딧 잔액을 조회하지 못했습니다.')
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | CreditBalanceRpcResult
    | undefined

  if (!result || typeof result.database_now !== 'string') {
    throw new Error('크레딧 잔액 응답이 올바르지 않습니다.')
  }

  return result
}

export async function getProfileBalance(userId: string, _client?: BalanceClient) {
  void _client
  const snapshot = await readCreditBalanceRpc(userId)
  return toNumber(snapshot.profile_balance)
}

export async function getLedgerBalance(userId: string, _client?: BalanceClient) {
  void _client
  const snapshot = await readCreditBalanceRpc(userId)
  return toNumber(snapshot.ledger_balance)
}

export async function getSpendableBalance(userId: string, _client?: BalanceClient) {
  void _client
  const snapshot = await readCreditBalanceRpc(userId)
  return toNumber(snapshot.spendable_balance)
}

export async function getLatestTransactionBalance(userId: string, _client?: BalanceClient) {
  void _client
  const snapshot = await readCreditBalanceRpc(userId)
  return snapshot.latest_transaction_balance
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
  void client
  const result = await readCreditBalanceRpc(userId)
  const profileBalance = toNumber(result.profile_balance)
  const ledgerBalance = toNumber(result.ledger_balance)
  const spendableBalance = toNumber(result.spendable_balance)
  const expiredBalance = toNumber(result.expired_balance)
  const latestTransactionBalance = result.latest_transaction_balance

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
    expiredBalance,
    latestTransactionBalance,
    nextExpirationAt: result.next_expiration_at,
    databaseNow: result.database_now,
    displayBalance: spendableBalance,
    hasMismatch: mismatchReasons.length > 0,
    mismatchReasons,
  }
}
