import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('popular slider preserves two-up small and four-up desktop paging contracts', async () => {
  const slider = await read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx')

  assert.match(slider, /grid-cols-2/)
  assert.match(slider, /lg:grid-cols-4/)
  assert.match(slider, /5000/)
  assert.match(slider, /visibilitychange/)
  assert.match(slider, /prefers-reduced-motion/)
  assert.match(slider, /onMouseEnter/)
  assert.match(slider, /onFocusCapture/)
  assert.match(slider, /items\.length <= pageSize/)
  assert.match(slider, /aspect-\[4\/5\]/)
})

test('subject-aware preview links stay inside the selected market', async () => {
  const [header, sections] = await Promise.all([
    read('src/app/preview/solvook-concept/_components/preview-header.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
  ])

  assert.match(header, /\?subject=english/)
  assert.match(header, /\?subject=korean/)
  assert.match(header, /aria-current=/)
  assert.match(sections, /\/items\/\$\{item\.id\}/)
})

test('preview section switches preserve the single carousel shell without dead fallback anchors', async () => {
  const page = await read('src/app/preview/solvook-concept/page.tsx')

  assert.equal((page.match(/<MainAdCarousel\b/g) ?? []).length, 1)
  assert.match(page, /subject=\{subject\}/)
  assert.doesNotMatch(page, /CampaignHero/)
  assert.match(page, /homeData\.config\.popular\.isActive\s*&&\s*\([\s\S]*<PopularDownloadsSlider/)
  assert.match(page, /homeData\.config\.sourceExplorer\.isActive\s*&&\s*\([\s\S]*<TextbookExplorer/)
  assert.match(page, /homeData\.config\.recent\.isActive\s*&&\s*\([\s\S]*<RecentMaterials/)
  assert.doesNotMatch(page, /QuickAccessGrid/)
})
