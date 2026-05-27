import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('admin market products list exposes a visibility action that patches item status', () => {
  assert.match(marketProductsClient, /Eye, EyeOff/, 'list action should render hide and unhide icons')
  assert.match(marketProductsClient, /EyeOff/, 'list action should render a hide icon')
  assert.match(marketProductsClient, /handleVisibilityFromList/, 'list should have a dedicated visibility toggle handler')
  assert.match(marketProductsClient, /status:\s*nextStatus/, 'visibility handler should set the computed next status')
  assert.match(marketProductsClient, /method:\s*'PATCH'/, 'hide handler should update the existing item')
  assert.match(marketProductsClient, /숨김 처리/, 'hide icon should be accessible')
})

test('admin market products list toggles hidden items back to published', () => {
  assert.match(marketProductsClient, /hiddenItemIds/, 'list should track locally hidden item ids')
  assert.match(
    marketProductsClient,
    /const nextStatus = isHidden \? 'published' : 'hidden'/,
    'visibility action should publish hidden rows and hide visible rows'
  )
  assert.match(marketProductsClient, /status:\s*nextStatus/, 'visibility handler should patch the computed next status')
  assert.match(marketProductsClient, /setHiddenOverride\(item\.id,\s*nextStatus === 'hidden'\)/, 'local hidden override should follow the computed next status')
  assert.match(
    marketProductsClient,
    /const isHidden = item\.status === 'hidden' \|\| hiddenItemIds\.includes\(item\.id\)/,
    'row display state should include the local hidden override'
  )
  assert.match(
    marketProductsClient,
    /aria-label=\{isHidden \? `\$\{item\.title\} 숨김 해제` : `\$\{item\.title\} 숨김 처리`\}/,
    'hidden rows should expose an unhide action'
  )
  assert.match(marketProductsClient, /disabled=\{hidingItemId === item\.id\}/, 'hidden rows should not disable the visibility button')
  assert.doesNotMatch(marketProductsClient, /disabled=\{hidingItemId === item\.id \|\| isHidden\}/, 'hidden rows should remain clickable for unhide')
})

test('admin market products list supports multi-selection controls', () => {
  assert.match(marketProductsClient, /import \{ Checkbox \} from '@\/components\/ui\/checkbox'/, 'bulk selection should reuse the shared checkbox component')
  assert.match(marketProductsClient, /const \[selectedItemIds, setSelectedItemIds\] = useState<string\[\]>\(\[\]\)/, 'selected item ids should be tracked in state')
  assert.match(
    marketProductsClient,
    /const selectedItems = useMemo\(\(\) => filteredItems\.filter\(\(item\) => selectedItemIds\.includes\(item\.id\)\)/,
    'selected items should be derived from the filtered list'
  )
  assert.match(
    marketProductsClient,
    /const allFilteredSelected = filteredItems\.length > 0 && filteredItems\.every\(\(item\) => selectedItemIds\.includes\(item\.id\)\)/,
    'header checkbox should know when the filtered list is fully selected'
  )
  assert.match(marketProductsClient, /toggleItemSelection/, 'rows should be selectable individually')
  assert.match(marketProductsClient, /toggleFilteredSelection/, 'header should select or clear the filtered list')
  assert.match(marketProductsClient, /선택 \{selectedItems\.length\}개/, 'bulk action area should show selected count')
  assert.match(marketProductsClient, /aria-label="상품 전체 선택"/, 'header checkbox should be accessible')
  assert.match(marketProductsClient, /aria-label=\{`\$\{item\.title\} 선택`\}/, 'row checkbox should be accessible')
  assert.match(marketProductsClient, /<TableCell colSpan=\{7\}/, 'empty table state should account for the selection column')
})

test('admin market products list exposes bulk hide and delete actions', () => {
  assert.match(marketProductsClient, /handleBulkVisibility/, 'bulk hide handler should exist')
  assert.match(marketProductsClient, /handleBulkDelete/, 'bulk delete handler should exist')
  assert.match(marketProductsClient, /bulkDeleteTargetIds/, 'bulk delete should use confirmation state')
  assert.match(marketProductsClient, /선택 숨김/, 'bulk hide button should be rendered')
  assert.match(marketProductsClient, /선택 삭제/, 'bulk delete button should be rendered')
  assert.match(
    marketProductsClient,
    /선택한 문제마켓 상품 \{bulkDeleteTargetIds\?\.length/,
    'bulk delete dialog should show selected count'
  )
  assert.match(
    marketProductsClient,
    /method:\s*'PATCH'[\s\S]+status:\s*'hidden'/,
    'bulk hide should patch selected items to hidden'
  )
  assert.match(marketProductsClient, /method:\s*'DELETE'/, 'bulk delete should call the existing delete API')
  assert.match(marketProductsClient, /Promise\.allSettled/, 'bulk actions should aggregate partial failures')
})

test('admin market bulk actions keep failed items selected and clear successful items', () => {
  assert.match(marketProductsClient, /const failedIds =/, 'bulk handlers should identify failed item ids')
  assert.match(marketProductsClient, /setSelectedItemIds\(failedIds\)/, 'failed item ids should remain selected after partial failure')
  assert.match(
    marketProductsClient,
    /setItems\(\(current\) => current\.filter\(\(item\) => !successIds\.includes\(item\.id\)\)\)/,
    'successful bulk deletes should be removed from local list'
  )
  assert.match(
    marketProductsClient,
    /선택한 상품 \$\{successIds\.length\}개를 숨김 처리했습니다\./,
    'bulk hide should report successful hidden count'
  )
  assert.match(
    marketProductsClient,
    /선택한 상품 \$\{successIds\.length\}개를 완전 삭제했습니다\./,
    'bulk delete should report successful deleted count'
  )
})
