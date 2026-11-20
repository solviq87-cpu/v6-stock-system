;(() => {
  const { screen, STRATEGIES, PERIODS, seriesFor, ma } = window.V6Research
  const rows = screen()
  const byId = (id) => document.getElementById(id)
  function node(tag, text) {
    const el = document.createElement(tag)
    if (text !== undefined) el.textContent = text
    return el
  }
  function table(headers, records) {
    const el = node('table')
    const head = el.createTHead().insertRow()
    headers.forEach((label) => head.append(node('th', label)))
    const body = el.createTBody()
    for (const record of records) {
      const row = body.insertRow()
      record.forEach((value) => row.insertCell().append(value))
    }
    return el
  }
  function showStocks(selection) {
    byId('demoStocks').replaceChildren(
      table(
        ['股票', '学习分', '命中策略数'],
        selection.map((r) => [r.quote.name, r.score.toFixed(1), String(r.hits)]),
      ),
    )
  }
  showStocks(rows)
  byId('demoPick').onclick = () => showStocks(rows.filter((r) => r.results.combo.hit))
  const select = byId('demoStrategy')
  for (const s of STRATEGIES.filter((s) => s.id !== 'more')) select.add(new Option(s.name, s.id))
  select.add(new Option('更多策略', 'more'))
  function selectRule() {
    const s = STRATEGIES.find((s) => s.id === select.value)
    byId('demoRule').textContent = s.rule
    if (s.id === 'more') {
      byId('demoMatches').replaceChildren(
        table(
          ['分类', '战法'],
          STRATEGIES.filter((x) => x.id !== 'more').map((x) => {
            const open = node('button', x.name)
            open.onclick = () => {
              select.value = x.id
              selectRule()
            }
            return [x.family, open]
          }),
        ),
      )
      return
    }
    const matches = rows.filter((r) => r.results[s.id].hit)
    byId('demoMatches').replaceChildren(
      matches.length
        ? table(
            ['当日命中', '教学档位', '依据'],
            matches.map((r) => [r.quote.name, r.results[s.id].position, r.results[s.id].note]),
          )
        : node('p', '当日教学样本无命中'),
    )
  }
  select.onchange = selectRule
  selectRule()
  for (const row of rows) {
    const detail = node('details')
    detail.append(node('summary', row.quote.name + ' · ' + row.quote.code))
    const list = node('ul')
    row.explain.forEach((reason) => list.append(node('li', reason)))
    detail.append(list)
    if (row.penalty) detail.append(node('p', row.penalty))
    const periods = node('select')
    periods.setAttribute('aria-label', row.quote.name + ' K线周期')
    PERIODS.forEach((period) => periods.add(new Option(period, period)))
    periods.value = '日K'
    const plot = node('div')
    function draw() {
      const bars = seriesFor(row.quote.code, periods.value)
      const closes = bars.map((bar) => bar.c)
      const latest = bars.slice(-60),
        offset = bars.length - latest.length
      const lines = [
        [5, '#facc15'],
        [10, '#22d3ee'],
        [20, '#1ed39a'],
        [60, '#ff4d73'],
      ].map(([n, color]) => ({
        n,
        color,
        points: latest.map((_, i) => ma(closes.slice(0, offset + i + 1), n)),
      }))
      const values = lines.flatMap((line) => line.points.filter((v) => v !== null))
      const low = Math.min(...latest.map((b) => b.l), ...values),
        high = Math.max(...latest.map((b) => b.h), ...values)
      const y = (value) => 96 - ((value - low) * 92) / (high - low || 1)
      const x = (i) => 4 + (i * 392) / Math.max(1, latest.length - 1)
      function svgElement(tag, attrs) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
        return el
      }
      const chart = svgElement('svg', {
        viewBox: '0 0 400 100',
        width: '100%',
        height: 120,
        role: 'img',
        'aria-label': row.quote.name + ' ' + periods.value + ' 及均线',
      })
      latest.forEach((b, i) => {
        const color = b.c >= b.o ? '#ff4d73' : '#1ed39a'
        chart.append(
          svgElement('line', { x1: x(i), x2: x(i), y1: y(b.h), y2: y(b.l), stroke: color }),
          svgElement('line', {
            x1: x(i),
            x2: x(i),
            y1: y(b.o),
            y2: y(b.c) + 0.2,
            stroke: color,
            'stroke-width': 3,
          }),
        )
      })
      plot.replaceChildren(chart)
      for (const { n, color, points } of lines) {
        const path = points.flatMap((v, i) => (v === null ? [] : [x(i) + ',' + y(v)])).join(' ')
        chart.append(svgElement('polyline', { points: path, fill: 'none', stroke: color, 'stroke-width': 1 }))
        const value = points.at(-1)
        const label = node('span', ' MA' + n + ' ' + (value === null ? '—' : value.toFixed(2)) + ' ')
        label.style.color = color
        plot.append(label)
      }
    }
    detail.addEventListener('toggle', () => {
      if (detail.open) draw()
    })
    periods.onchange = draw
    detail.append(periods, plot)
    byId('demoReviews').append(detail)
  }
})()
