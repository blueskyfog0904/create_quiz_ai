'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_KEYS,
  isAdminPermissionLimitOptional,
  validateAdminPermissionGrants,
  type AdminPermissionKey,
} from '@/lib/admin-permissions'

export interface AdminPermissionPreset {
  name: string
  permissions: string[]
}

interface AdminPermissionsDialogProps {
  account: { userId: string; loginId: string; grants: Array<{ permission: string; limits: unknown }> }
  presets: AdminPermissionPreset[]
  onClose: () => void
  onSaved: () => void
}

const isKnown = (key: string): key is AdminPermissionKey => (ADMIN_PERMISSION_KEYS as string[]).includes(key)

// 체크한 권한이 함께 필요로 하는 권한까지 넣는다.
function withRequired(keys: Iterable<AdminPermissionKey>) {
  const result = new Set<AdminPermissionKey>()
  const visit = (key: AdminPermissionKey) => {
    if (result.has(key)) return
    result.add(key)
    ADMIN_PERMISSIONS[key].requires.forEach((required) => visit(required as AdminPermissionKey))
  }
  for (const key of keys) visit(key)
  return result
}

// 해제한 권한에 기대는 권한(직접·간접)
function dependentsOf(key: AdminPermissionKey, checked: Set<AdminPermissionKey>) {
  const result = new Set<AdminPermissionKey>()
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of checked) {
      if (result.has(candidate) || candidate === key) continue
      const requires = ADMIN_PERMISSIONS[candidate].requires as readonly string[]
      if (requires.includes(key) || requires.some((required) => result.has(required as AdminPermissionKey))) {
        result.add(candidate)
        grew = true
      }
    }
  }
  return result
}

// 계정별 권한 편집 창(계획 U3-4). 저장은 서버가 같은 규칙(validateAdminPermissionGrants)으로 다시 검증한다.
export function AdminPermissionsDialog({ account, presets, onClose, onSaved }: AdminPermissionsDialogProps) {
  const [checked, setChecked] = useState<Set<AdminPermissionKey>>(
    () => new Set(account.grants.map((grant) => grant.permission).filter(isKnown))
  )
  const [limitDrafts, setLimitDrafts] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(
    account.grants.filter((grant) => isKnown(grant.permission)).map((grant) => [
      grant.permission,
      Object.fromEntries(Object.entries((grant.limits ?? {}) as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'number' ? String(value) : ''])),
    ])
  ))
  const [notice, setNotice] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const toggle = (key: AdminPermissionKey, next: boolean) => {
    setErrors([])
    if (next) {
      const added = [...withRequired([key])].filter((item) => !checked.has(item) && item !== key)
      setChecked(new Set([...checked, ...withRequired([key])]))
      setNotice(added.length > 0 ? `함께 필요한 권한도 체크했습니다: ${added.map((item) => ADMIN_PERMISSIONS[item].label).join(', ')}` : null)
      return
    }
    const dependents = dependentsOf(key, checked)
    const remaining = new Set([...checked].filter((item) => item !== key && !dependents.has(item)))
    setChecked(remaining)
    setNotice(dependents.size > 0 ? `이 권한이 필요한 권한도 함께 해제했습니다: ${[...dependents].map((item) => ADMIN_PERMISSIONS[item].label).join(', ')}` : null)
  }

  // 묶음은 체크만 채운다(지금 체크를 묶음 구성으로 바꾼다). 한도 숫자는 직접 입력하고, 저장은 따로 누른다.
  const applyPreset = (preset: AdminPermissionPreset) => {
    setErrors([])
    setChecked(withRequired(preset.permissions.filter(isKnown)))
    setNotice(`'${preset.name}' 묶음으로 체크를 채웠습니다. 한도가 있는 권한은 한도를 입력한 뒤 저장하세요.`)
  }

  // 빈 칸은 보내지 않는다(필수 한도는 검증이 막고, 비울 수 있는 한도는 기본 한도를 쓴다).
  const buildGrants = () => ADMIN_PERMISSION_KEYS.filter((key) => checked.has(key)).map((key) => ({
    permission: key,
    limits: Object.fromEntries(Object.keys(ADMIN_PERMISSIONS[key].limits).flatMap((limitKey) => {
      const raw = (limitDrafts[key]?.[limitKey] ?? '').trim()
      return raw === '' ? [] : [[limitKey, Number(raw)]]
    })),
  }))

  const save = async () => {
    const grants = buildGrants()
    const problems = validateAdminPermissionGrants(grants)
    if (problems.length > 0) {
      setErrors(problems)
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch(`/api/admin/admin-accounts/${account.userId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '권한을 저장하지 못했습니다.')
      }
      alert('권한을 저장했습니다. 그 계정의 다음 요청(화면 이동·새로고침)부터 반영됩니다.')
      onSaved()
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '권한을 저장하지 못했습니다.'])
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>&apos;{account.loginId}&apos; 권한 편집</DialogTitle>
          <DialogDescription>
            체크한 권한만 쓸 수 있습니다. 저장한 권한은 그 계정의 다음 요청부터 반영됩니다.
          </DialogDescription>
        </DialogHeader>

        {presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">묶음으로 체크 채우기:</span>
            {presets.map((preset) => (
              <Button key={preset.name} type="button" size="sm" variant="outline" onClick={() => applyPreset(preset)}>
                {preset.name}
              </Button>
            ))}
          </div>
        )}

        {notice && <p role="status" className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{notice}</p>}

        <ul className="divide-y rounded-lg border">
          {ADMIN_PERMISSION_KEYS.map((key) => {
            const definition = ADMIN_PERMISSIONS[key]
            const limitEntries = Object.entries<string>(definition.limits)
            const isChecked = checked.has(key)
            return (
              <li key={key} className="px-3 py-2">
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={isChecked}
                    onChange={(event) => toggle(key, event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{definition.label}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{key}</span>
                    {definition.requires.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        함께 필요: {definition.requires.map((required) => ADMIN_PERMISSIONS[required as AdminPermissionKey].label).join(', ')}
                      </span>
                    )}
                  </span>
                </label>
                {isChecked && limitEntries.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3 pl-6">
                    {limitEntries.map(([limitKey, limitLabel]) => (
                      <label key={limitKey} className="flex items-center gap-2 text-sm">
                        <span>{limitLabel} (크레딧, {isAdminPermissionLimitOptional(key) ? '비우면 기본 한도' : '필수'})</span>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          className="w-28"
                          value={limitDrafts[key]?.[limitKey] ?? ''}
                          onChange={(event) => setLimitDrafts((current) => ({
                            ...current,
                            [key]: { ...current[key], [limitKey]: event.target.value },
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 rounded border border-red-300 bg-red-50 py-2 pl-8 pr-3 text-sm text-red-800">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>닫기</Button>
          <Button type="button" onClick={() => void save()} disabled={isSaving}>{isSaving ? '저장 중…' : '저장'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
