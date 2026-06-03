import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/app/(admin)/admin/problem-types/problem-types-client.tsx', import.meta.url),
  'utf8'
)

test('problem type list supports selecting cards for bulk deletion', () => {
  assert.match(source, /import \{ Checkbox \} from '@\/components\/ui\/checkbox'/)
  assert.match(source, /const \[selectedTypeIds, setSelectedTypeIds\] = useState<string\[\]>\(\[\]\)/)
  assert.match(source, /const \[bulkDeleting, setBulkDeleting\] = useState\(false\)/)
  assert.match(source, /const selectedTypeCount = selectedTypeIds\.length/)
  assert.match(source, /const toggleSelectedType = \(id: string\) => \{/)
  assert.match(source, /checked=\{selectedTypeIds\.includes\(type\.id\)\}/)
  assert.match(source, /onCheckedChange=\{\(\) => toggleSelectedType\(type\.id\)\}/)
  assert.match(source, /aria-label=\{`\$\{type\.type_name\} 선택`\}/)
})

test('bulk delete confirms selected count, deletes selected types, and refreshes list', () => {
  assert.match(source, /const handleBulkDelete = async \(\) => \{/)
  assert.match(source, /선택한 문제 유형 \$\{selectedTypeIds\.length\}개를 삭제하시겠습니까\?/)
  assert.match(source, /for \(const id of selectedTypeIds\)/)
  assert.match(source, /await deleteProblemType\(id\)/)
  assert.match(source, /setSelectedTypeIds\(\[\]\)/)
  assert.match(source, /router\.refresh\(\)/)
  assert.match(source, /variant="destructive"[\s\S]*선택 삭제/)
  assert.match(source, /disabled=\{selectedTypeCount === 0 \|\| bulkDeleting\}/)
})
