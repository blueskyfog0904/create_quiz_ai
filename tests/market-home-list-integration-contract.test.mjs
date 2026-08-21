import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('home popular and recent sections reuse the Solvook board list rows', () => {
  const sharedPath = new URL(
    'src/app/preview/solvook-concept/_components/market-material-list.tsx',
    root
  )
  assert.equal(existsSync(sharedPath), true)

  const [shared, popular, sections, board] = [
    read('src/app/preview/solvook-concept/_components/market-material-list.tsx'),
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
    read('src/app/preview/solvook-concept/_components/board/real-market-board-results.tsx'),
  ]

  assert.match(popular, /import \{ MarketMaterialList \} from '\.\.\/market-material-list'/)
  assert.match(sections, /import \{ MarketMaterialList \} from '\.\.\/market-material-list'/)
  assert.match(board, /import \{ MarketMaterialList \} from '\.\.\/market-material-list'/)
  assert.match(popular, /<MarketMaterialList/)
  assert.match(sections, /<MarketMaterialList/)
  assert.match(board, /<MarketMaterialList/)

  assert.match(shared, /<ul role="list"/)
  assert.match(shared, /md:grid-cols-\[56px_minmax\(0,1fr\)_auto\]/)
  assert.match(shared, /startingPriceCredits/)
  assert.match(shared, /ratingAverage/)
  assert.match(shared, /MarketSamplePreviewDialog/)
  assert.match(shared, /샘플보기/)
})

test('home list rows link to the real-data Solvook preview detail', () => {
  const [popular, sections] = [
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
  ]
  const previewDetailPattern = /`\/preview\/solvook-concept\/boards\/\$\{item\.categorySlug\}\/items\/\$\{item\.id\}\?subject=\$\{subject\}`/

  assert.match(popular, previewDetailPattern)
  assert.match(sections, previewDetailPattern)
  assert.doesNotMatch(popular, /`\/\$\{subject\}\/market\//)
  assert.doesNotMatch(sections, /`\/\$\{subject\}\/market\/\$\{item\.categorySlug\}\/items\//)
})

test('home material rows receive board-equivalent price, rating, and sample data', () => {
  const [contract, server] = [
    read('src/lib/market-home.ts'),
    read('src/lib/market-home-server.ts'),
  ]

  assert.match(contract, /startingPriceCredits:\s*number \| null/)
  assert.match(contract, /ratingAverage:\s*number \| null/)
  assert.match(contract, /ratingCount:\s*number/)
  assert.match(contract, /sample:\s*\{[\s\S]*available:\s*boolean[\s\S]*pageCount:\s*number/)
  assert.match(server, /loadMarketItemListEnrichment/)
  assert.match(server, /startingPriceCredits:/)
  assert.match(server, /ratingAverage:/)
})
