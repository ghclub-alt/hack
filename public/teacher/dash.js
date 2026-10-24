// 선생님 화면

const $ = id => document.getElementById(id)

let curCls = localStorage.getItem('shimpyo_tcls') ?? '2-3'
let filter = 'all'
let reqs = []
let lastNew = -1

const LV = { red: '긴급', orange: '주의', yellow: '참고' }

const QUICK = [
  '말해줘서 고마워. 많이 힘들었겠다.',
  '내일 점심시간에 상담실에서 잠깐 볼까? 부담되면 안 와도 괜찮아.',
  '네 잘못 아니야. 어떻게 하면 좋을지 선생님이 같이 생각해볼게.',
  '혹시 지금도 위험하면 112나 117에 바로 연락해줘.',
]

// ---------- 로그인 ----------
$('artFaces').innerHTML = MOODS.map(m => face(m.v, 48)).join('')

$('loginForm').onsubmit = async e => {
  e.preventDefault()
  try {
    const res = await api('/api/login', { body: { pin: $('pin').value } })
    sessionStorage.setItem('shimpyo_token', res.token)
    $('loginErr').textContent = ''
    start()
  } catch (err) {
    $('loginErr').textContent = err.message
    const f = $('loginForm')
    f.classList.remove('shake')
    void f.offsetWidth // 애니메이션 다시 돌리려고
    f.classList.add('shake')
    $('pin').select()
  }
}

function start() {
  $('login').hidden = true
  $('dash').hidden = false
  refresh()
}

// 서버 재시작하면 토큰 날아감 → 다시 로그인 화면으로
function kickOut() {
  sessionStorage.removeItem('shimpyo_token')
  $('login').hidden = false
  $('dash').hidden = true
  lastNew = -1
}

$('btnLogout').onclick = kickOut

// ---------- 반 선택 ----------
let opts = '<option value="">전체 반</option>'
for (let g = 1; g <= 3; g++) {
  for (let c = 1; c <= 15; c++) opts += `<option value="${g}-${c}">${g}학년 ${c}반</option>`
}
$('clsSel').innerHTML = opts
$('clsSel').value = curCls
$('clsSel').onchange = () => {
  curCls = $('clsSel').value
  localStorage.setItem('shimpyo_tcls', curCls)
  lastNew = -1
  refresh()
}

function clsName(cls) {
  if (!cls) return '전체 반'
  const [g, c] = cls.split('-')
  return `${g}학년 ${c}반`
}

async function refresh() {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 6)
  $('crumb').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DAY_NAMES[now.getDay()]}요일 · 최근 7일 (${from.getMonth() + 1}/${from.getDate()}~)`
  $('clsTitle').textContent = clsName(curCls)

  try {
    const q = '?cls=' + curCls
    const [mood, alerts, list] = await Promise.all([
      api('/api/moods' + q),
      api('/api/alerts' + q),
      api('/api/requests' + q),
    ])
    reqs = list
    renderAlerts(alerts)
    renderKpis(mood)
    renderDayChart(mood)
    renderWeek(mood)
    renderReqs()
    notifyNew()
  } catch (e) {
    if (e.status === 401) kickOut()
    else toast('불러오기 실패: ' + e.message)
  }
}

$('btnRefresh').onclick = async () => {
  await refresh()
  toast('새로 불러왔어요')
}

// 30초마다 알아서 새로고침
setInterval(() => {
  if (!$('dash').hidden) refresh()
}, 30000)

// 새 요청 오면 알려주기
function notifyNew() {
  const n = reqs.filter(r => r.status === 'new').length
  if (lastNew >= 0 && n > lastNew) toast('새 도움 요청이 왔어요')
  lastNew = n
  document.title = n ? `(${n}) 쉼표 선생님` : '쉼표 선생님'
}

// ---------- 알림 ----------
function renderAlerts(alerts) {
  const box = $('sec-alerts')
  $('navAlerts').textContent = alerts.length || ''

  if (!alerts.length) {
    box.innerHTML = `<div class="all-good">${icon('check', 18)} 지금은 급한 알림이 없어요</div>`
    return
  }
  box.innerHTML = alerts.map(a => `
    <div class="alert ${a.level}">
      ${icon(a.level === 'orange' ? 'bell' : 'alert', 20)}
      <div><b><span class="lv">${LV[a.level]}</span>${esc(a.title)}</b>${esc(a.msg)}</div>
      ${a.code ? `<button class="btn small alert-go" data-code="${a.code}">보러 가기</button>` : ''}
    </div>`).join('')

  box.querySelectorAll('.alert-go').forEach(b => {
    b.onclick = () => jumpTo(b.dataset.code)
  })
}

function jumpTo(code) {
  if (filter !== 'all') {
    filter = 'all'
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x.dataset.f === 'all'))
    renderReqs()
  }
  const el = $('req-' + code)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

// ---------- 숫자 카드 ----------
function renderKpis(s) {
  const hard = s.counts[3] + s.counts[4]
  const hardPct = s.total ? Math.round(hard / s.total * 100) : 0
  const activeDays = s.days.filter(d => d.counts.some(n => n)).length || 1
  const newN = reqs.filter(r => r.status === 'new').length
  const urgent = reqs.filter(r => r.status === 'new' && ((r.danger && r.danger.length) || r.want === 'meet')).length

  const hardSub = hardPct >= 30
    ? `<span class="kpi-sub orange">${icon('alert', 14)} 주의: 평소보다 높아요</span>`
    : `<span class="kpi-sub">${icon('check', 14)} 보통</span>`

  $('kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">${icon('users', 16)} 이번 주 기록</div>
      <div class="kpi-num">${s.total}<small>번</small></div>
      <div class="kpi-sub">하루 평균 ${Math.round(s.total / activeDays)}명</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${icon('heart', 16)} 힘들다는 응답</div>
      <div class="kpi-num">${hardPct}<small>%</small></div>
      ${hardSub}
    </div>
    <div class="kpi">
      <div class="kpi-label">${icon('inbox', 16)} 새 도움 요청</div>
      <div class="kpi-num">${newN}<small>건</small></div>
      <div class="kpi-sub">답장을 기다리는 중</div>
    </div>
    <div class="kpi ${urgent ? 'hot' : ''}">
      <div class="kpi-label">${icon('alert', 16)} 먼저 볼 요청</div>
      <div class="kpi-num">${urgent}<small>건</small></div>
      ${urgent
        ? `<div class="kpi-sub red">${icon('alert', 14)} 위험 신호·직접 도움 요청</div>`
        : '<div class="kpi-sub">없어요</div>'}
    </div>`

  $('navReqs').textContent = newN || ''
}

// ---------- 요일별 차트 (쌓은 막대) ----------
$('legend').innerHTML = MOODS.slice().reverse().map(m =>
  `<span><i style="background:${m.color}"></i>${m.label}</span>`
).join('')

function niceStep(max) {
  if (max <= 5) return 1
  if (max <= 10) return 2
  if (max <= 25) return 5
  return 10
}

function renderDayChart(s) {
  const box = $('dayChart')
  const totals = s.days.map(d => d.counts.reduce((a, b) => a + b, 0))
  const max = Math.max(...totals)
  if (!max) {
    box.innerHTML = '<p class="empty">아직 이번 주 기록이 없어요</p>'
    return
  }

  const W = 600, H = 240, L = 30, R = 4, T = 8, B = 30
  const pw = W - L - R
  const ph = H - T - B
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = v => T + ph - (v / top) * ph

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 7일 요일별 기분 기록">`

  svg += '<g class="grid">'
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`
    svg += `<text class="ylab" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`
  }
  svg += '</g>'

  const slot = pw / 7
  const bw = Math.min(46, slot * 0.58)

  s.days.forEach((d, i) => {
    const x = L + slot * i + (slot - bw) / 2
    const tot = totals[i]
    svg += `<g class="col" data-i="${i}">`
    if (tot) {
      // 위쪽만 둥글게 하려고 clip 씀
      const topY = y(tot)
      svg += `<clipPath id="cc${i}"><rect x="${x}" y="${topY}" width="${bw}" height="${y(0) - topY + 6}" rx="4"/></clipPath>`
      svg += `<g clip-path="url(#cc${i})">`
      let acc = 0
      d.counts.forEach((n, k) => {
        if (!n) return
        const isTop = acc + n === tot
        const y1 = y(acc + n) + (isTop ? 0 : 2) // 칸 사이 2px 틈
        const h = y(acc) - y1
        svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(h, 0)}" fill="${MOODS[k].color}"/>`
        acc += n
      })
      svg += '</g>'
    }
    svg += '</g>'

    const isToday = i === 6
    svg += `<text class="xlab ${isToday ? 'today' : ''}" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${isToday ? '오늘' : dayName(d.date) + ' ' + Number(d.date.slice(8))}</text>`
    svg += `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ph}"/>`
  })
  svg += '</svg>'
  box.innerHTML = svg

  // 마우스 올리면 그날 내용
  const tip = $('chartTip')
  box.querySelectorAll('.hit').forEach(hit => {
    const i = Number(hit.dataset.i)
    hit.addEventListener('mouseenter', () => {
      box.querySelectorAll('.col').forEach(c => c.classList.toggle('dim', c.dataset.i !== String(i)))
      const d = s.days[i]
      const tot = totals[i]
      const dt = new Date(d.date + 'T00:00:00')
      let html = `<b>${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DAY_NAMES[dt.getDay()]}요일 · ${tot}명</b>`
      MOODS.slice().reverse().forEach(m => {
        html += `<div class="row"><i style="background:${m.color}"></i><span>${m.label}</span><span>${d.counts[m.v - 1]}</span></div>`
      })
      if (tot) html += `<div class="row" style="margin-top:4px;opacity:.8"><span>힘듦 비율</span><span>${Math.round((d.counts[3] + d.counts[4]) / tot * 100)}%</span></div>`
      tip.innerHTML = html
      tip.hidden = false
    })
    hit.addEventListener('mousemove', e => {
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10)
      tip.style.left = x + 'px'
      tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px'
    })
    hit.addEventListener('mouseleave', () => {
      tip.hidden = true
      box.querySelectorAll('.col').forEach(c => c.classList.remove('dim'))
    })
  })
}

// ---------- 이번 주 전체 ----------
function renderWeek(s) {
  if (!s.total) {
    $('weekBar').innerHTML = '<p class="empty">아직 기록이 없어요</p>'
    $('moodTable').innerHTML = ''
    return
  }

  $('weekBar').innerHTML = '<div class="week-bar">' + MOODS.map((m, i) => {
    const n = s.counts[i]
    if (!n) return ''
    const pct = Math.round(n / s.total * 100)
    return `<div style="flex:${n};background:${m.color};color:${m.ink}" title="${m.label} ${n}번 (${pct}%)">${pct >= 9 ? pct + '%' : ''}</div>`
  }).join('') + '</div>'

  const hard = s.counts[3] + s.counts[4]
  $('moodTable').innerHTML = MOODS.map((m, i) => `
    <tr>
      <td>${face(m.v, 20)} ${m.label}</td>
      <td class="n">${s.counts[i]}번</td>
      <td class="p">${Math.round(s.counts[i] / s.total * 100)}%</td>
    </tr>`).join('') + `
    <tr class="sum">
      <td>힘들다고 한 응답</td>
      <td class="n">${hard}번</td>
      <td class="p">${Math.round(hard / s.total * 100)}%</td>
    </tr>`
}

// ---------- 도움 요청 ----------
function isDanger(r) {
  return r.danger && r.danger.length > 0
}

function renderReqs() {
  const box = $('reqList')

  // 새로고침해도 쓰던 답장 안 날아가게
  const drafts = {}
  box.querySelectorAll('textarea[data-code]').forEach(t => {
    if (t.value) drafts[t.dataset.code] = t.value
  })
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.code : null

  let list = filter === 'all' ? reqs.slice() : reqs.filter(r => r.status === filter)
  // 위험 신호 있는 건 맨 위로
  list.sort((a, b) => {
    const da = isDanger(a) && a.status !== 'done' ? 1 : 0
    const dbb = isDanger(b) && b.status !== 'done' ? 1 : 0
    return dbb - da || b.at - a.at
  })

  if (!list.length) {
    box.innerHTML = '<p class="empty">여기는 비어 있어요</p>'
    return
  }

  box.innerHTML = list.map(r => {
    let txt = esc(r.text)
    ;(r.danger || []).forEach(w => {
      txt = txt.split(esc(w)).join(`<mark>${esc(w)}</mark>`)
    })

    const wantIc = { listen: 'ear', advice: 'compass', meet: 'user' }[r.want]

    return `<article class="req s-${r.status} ${isDanger(r) ? 'danger' : ''}" id="req-${r.code}">
      <div class="req-avatar">${isDanger(r) ? icon('alert', 18) : esc(r.type[0])}</div>
      <div class="req-main">
        <div class="req-top">
          ${isDanger(r) ? `<span class="flag">${icon('alert', 13)} 위험 신호</span>` : ''}
          <span class="tag">${esc(r.type)}</span>
          <span class="tag want-${r.want}">${icon(wantIc, 13)} ${WANT[r.want]}</span>
          ${r.status !== 'new' ? `<span class="tag st-${r.status}">${STATUS[r.status]}</span>` : ''}
          <span class="when">${clsName(r.cls)} · ${timeAgo(r.at)} · #${r.code}</span>
        </div>
        ${r.name ? `<p class="name">${icon('user', 14)} ${esc(r.name)}</p>` : ''}
        <p class="txt">${txt}</p>
        ${r.reply ? `<div class="sent"><small>보낸 답장</small>${esc(r.reply)}</div>` : ''}
        ${r.status !== 'done' ? `
          <div class="reply-box">
            <div class="quick">${QUICK.map((q, i) => `<button data-q="${i}">${esc(q.length > 18 ? q.slice(0, 17) + '…' : q)}</button>`).join('')}</div>
            <textarea rows="2" data-code="${r.code}" placeholder="학생한테 답장 (학생은 접수번호로 확인해요)"></textarea>
            <div class="req-btns">
              <button class="btn ok small" data-act="reply" data-code="${r.code}">${icon('send', 14)} ${r.reply ? '답장 고치기' : '답장 보내기'}</button>
              <button class="btn ghost small" data-act="done" data-code="${r.code}">${icon('check', 14)} 마무리</button>
            </div>
          </div>` : ''}
      </div>
    </article>`
  }).join('')

  box.querySelectorAll('textarea[data-code]').forEach(t => {
    if (drafts[t.dataset.code]) {
      t.value = drafts[t.dataset.code]
      t.closest('.reply-box').classList.add('open')
    }
    if (focused === t.dataset.code) t.focus()
  })
}

$('reqList').addEventListener('focusin', e => {
  const box = e.target.closest('.reply-box')
  if (box) box.classList.add('open')
})

$('reqList').addEventListener('click', async e => {
  // 빠른 답장 누르면 입력칸에 붙여줌
  const q = e.target.closest('button[data-q]')
  if (q) {
    const ta = q.closest('.reply-box').querySelector('textarea')
    const add = QUICK[q.dataset.q]
    ta.value = ta.value ? ta.value.trimEnd() + ' ' + add : add
    ta.focus()
    return
  }

  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  const code = btn.dataset.code

  try {
    if (btn.dataset.act === 'reply') {
      const ta = btn.closest('.req').querySelector('textarea')
      if (!ta.value.trim()) return ta.focus()
      await api(`/api/requests/${code}/reply`, { body: { reply: ta.value } })
      ta.value = ''
      toast('답장 보냈어요')
    } else {
      if (!confirm('마무리할까요? 학생 화면에도 "마무리"로 보여요.')) return
      await api(`/api/requests/${code}/done`, { method: 'POST', body: {} })
      toast('마무리했어요')
    }
    refresh()
  } catch (err) {
    if (err.status === 401) kickOut()
    else toast(err.message)
  }
})

document.querySelectorAll('#filters button').forEach(b => {
  b.onclick = () => {
    filter = b.dataset.f
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b))
    renderReqs()
  }
})

// ---------- 시연용 ----------
$('btnSeed').onclick = async () => {
  if (!curCls) return toast('반을 하나 골라주세요')
  await api('/api/seed', { body: { cls: curCls } })
  lastNew = -1
  await refresh()
  toast('시연용 데이터 넣었어요')
}

$('btnClear').onclick = async () => {
  if (!confirm('기분 기록이랑 도움 요청 전부 지워요. 진짜요?')) return
  await api('/api/clear', { method: 'POST', body: {} })
  lastNew = -1
  refresh()
}

// ---------- 앱 설치 ----------
setupPwa('teacher', '다시 연결됐어요')
setupInstall({
  box: 'btnInstallT',
  btn: 'btnInstallT',
  key: 'shimpyo_t_install_no',
  iosMsg: '사파리 아래 공유 버튼(□↑) → "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.',
})

window.addEventListener('online', () => {
  if (!$('dash').hidden) refresh()
})

if (sessionStorage.getItem('shimpyo_token')) start()
