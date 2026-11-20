import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const source = (file) => readFileSync(new URL('../dist/' + file, import.meta.url), 'utf8')
test('离线教学规则、周期、风险门及页面使用同一快照', async () => {
  const w = new JSDOM(source('index.html'), { url: 'https://v6.test/', runScripts: 'outside-only' }).window
  try {
    for (const script of ['analysis.bundle', 'learning-view', 'research-app'])
      w.eval(source('assets/' + script + '.js'))
    const { screen, STRATEGIES, seriesFor, readMarket, ma } = w.V6Research
    assert.equal(new Set(STRATEGIES.map((s) => s.id)).size, 36)
    const rows = screen()
    assert.equal(JSON.stringify(rows), JSON.stringify(screen()))
    assert.equal(rows.find((r) => r.quote.name === '华东重机').results.ladder_follow.hit, true)
    for (const row of rows) {
      assert.ok(row.score >= 0 && row.score <= 100)
      assert.equal(row.explain.length, 3)
      for (const s of Object.values(row.results)) {
        assert.doesNotMatch(s.note, /必涨|稳赚|保证/)
        if (row.quote.broken) assert.notEqual(s.position, '主仓')
      }
      const code = row.quote.code,
        daily = seriesFor(code, '日K'),
        minutes = seriesFor(code, '分时')
      assert.equal(minutes.length, 48)
      assert.equal(minutes[0].t, '09:30')
      assert.equal(minutes[24].t, '13:00')
      assert.equal(daily.at(-1).c, row.quote.price)
      assert.ok(daily.every((b) => ![0, 6].includes(new Date(b.t).getUTCDay())))
      for (const period of ['分时', '周K', '月K']) {
        const bars = seriesFor(code, period)
        assert.equal(bars.at(-1).c, row.quote.price)
        assert.equal(
          bars.reduce((a, b) => a + b.v, 0),
          period === '分时' ? daily.at(-1).v : daily.reduce((a, b) => a + b.v, 0),
        )
      }
    }
    assert.equal(ma([1, 2], 5), null)
    const expired = readMarket(Date.parse('2026-11-17T15:56:00+08:00'))
    assert.ok(screen(expired.stocks).every((r) => !r.results.combo.hit && !r.results.flow.hit))
    assert.equal(w.V6Research.FACTORS.length, 28)
    const stock = expired.stocks[0],
      candles = seriesFor(stock.code, '日K')
    const staleScores = w.V6Research.learning(stock, candles).scores
    for (const f of w.V6Research.FACTORS.filter((f) => f.group === '资金'))
      assert.equal(staleScores[f.id], 50)
    const ice = readMarket().stocks.map((q) => ({
      ...q,
      index: { ...q.index, limitUpCount: 20, brokenCount: 10 },
    }))
    for (const row of screen(ice))
      for (const rule of STRATEGIES.filter((s) => s.family === '情绪'))
        assert.equal(row.results[rule.id].position, '空仓')
    const select = w.document.getElementById('demoStrategy')
    select.value = 'dragon_back'
    select.dispatchEvent(new w.Event('change'))
    assert.match(w.document.getElementById('demoMatches').textContent, /华东重机/)
    assert.ok(w.document.querySelectorAll('#demoReviews details').length === rows.length)
    const review = w.document.querySelector('#demoReviews details')
    // Opening details queues its own event; await that real event before teardown.
    const opened = new Promise((resolve) => review.addEventListener('toggle', resolve, { once: true }))
    review.open = true
    await opened
    assert.equal(review.querySelectorAll('svg polyline').length, 4)
    const period = review.querySelector('select')
    period.value = '分时'
    period.dispatchEvent(new w.Event('change'))
    assert.match(review.querySelector('svg').getAttribute('aria-label'), /分时/)
    w.document.getElementById('demoPick').click()
    assert.equal(
      w.document.querySelectorAll('#demoStocks tbody tr').length,
      rows.filter((r) => r.results.combo.hit).length,
    )
  } finally {
    w.close()
  }
})
