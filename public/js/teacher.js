// 선생님 화면

let curCls = localStorage.getItem('shimpyo_tcls') || '2-3'
let filter = 'all'
let reqs = []

// ---------- 로그인 ----------
async function login() {
  try {
    const res = await api('/api/teacher/login', { body: { pin: document.getElementById('pin').value } })
    sessionStorage.setItem('shimpyo_token', res.token)
    start()
  } catch (e) {
    alert(e.message)
  }
}

document.getElementById('btnLogin').onclick = login
document.getElementById('pin').addEventListener('keydown', e => {
  if (e.key === 'Enter') login()
})

function start() {
  document.getElementById('login').hidden = true
  document.getElementById('dash').hidden = false
  refresh()
}

// 서버 재시작하면 토큰 날아감 → 다시 로그인 화면으로
function kickOut() {
  sessionStorage.removeItem('shimpyo_token')
  document.getElementById('login').hidden = false
  document.getElementById('dash').hidden = true
}

// ---------- 반 선택 ----------
const clsSel = document.getElementById('clsSel')
let opts = '<option value="">전체 반</option>'
for (let g = 1; g <= 3; g++) {
  for (let c = 1; c <= 15; c++) opts += `<option value="${g}-${c}">${g}학년 ${c}반</option>`
}
clsSel.innerHTML = opts
clsSel.value = curCls
clsSel.onchange = () => {
  curCls = clsSel.value
  localStorage.setItem('shimpyo_tcls', curCls)
  refresh()
}

async function refresh() {
  try {
    await Promise.all([renderMood(), loadReqs()])
  } catch (e) {
    if (e.status === 401) kickOut()
    else alert('불러오기 실패: ' + e.message)
  }
}

document.getElementById('btnRefresh').onclick = refresh

// ---------- 마음 날씨 ----------
async function renderMood() {
  const s = await api('/api/teacher/moods?cls=' + curCls)
  const box = document.getElementById('moodStats')
  if (!s.total) {
    box.innerHTML = '<p class="hint">아직 이번 주 기록이 없어요.</p>'
    return
  }

  let html = ''
  MOODS.forEach((m, i) => {
    const n = s.counts[i]
    const pct = Math.round(n / s.total * 100)
    html += `<div class="bar-row">
      <span class="bar-label">${m.label}</span>
      <div class="bar"><div style="width:${pct}%;background:${m.color}"></div></div>
      <span class="bar-num">${n}</span>
    </div>`
  })

  const hard = s.counts[3] + s.counts[4]
  const hardPct = Math.round(hard / s.total * 100)
  html += `<p class="sum">총 ${s.total}번 기록 · 힘들다고 한 비율 <b>${hardPct}%</b></p>`

  // 날짜별로 힘듦 비율. 높을수록 진하게
  html += '<div class="days">'
  s.days.forEach(d => {
    const p = d.total ? d.hard / d.total : 0
    html += `<div class="dcell" title="${d.date} · ${d.hard}/${d.total}명">
      <span style="background:rgba(209,73,91,${d.total ? 0.15 + p * 1.5 : 0.05})"></span>
      ${Number(d.date.slice(8))}일
    </div>`
  })
  html += '</div>'

  if (hardPct >= 30) {
    html += '<p class="tip warnTip">힘들다는 응답이 많은 편이에요. 조회나 종례 때 반 분위기를 한번 살펴봐 주세요.</p>'
  }
  box.innerHTML = html
}

// ---------- 도움 요청 ----------
async function loadReqs() {
  reqs = await api('/api/teacher/requests?cls=' + curCls)
  renderReqs()
}

function renderReqs() {
  const newN = reqs.filter(r => r.status === 'new').length
  document.getElementById('newCount').textContent = newN || ''

  const list = filter === 'all' ? reqs : reqs.filter(r => r.status === filter)
  const box = document.getElementById('reqList')
  if (!list.length) {
    box.innerHTML = '<p class="hint">없어요.</p>'
    return
  }

  box.innerHTML = list.map(r => `
    <div class="req ${r.status} ${r.want === 'meet' ? 'meet' : ''}">
      <div class="req-top">
        <span class="tag">${esc(r.type)}</span>
        <span class="tag want-${r.want}">${WANT[r.want]}</span>
        <span class="tag st">${STATUS[r.status]}</span>
        <span class="when">${r.cls} · ${fmtDate(r.at)} · ${r.code}</span>
      </div>
      ${r.name ? `<p class="name">이름: ${esc(r.name)}</p>` : ''}
      <p class="txt">${esc(r.text)}</p>
      ${r.reply ? `<p class="reply"><b>보낸 답장</b><br>${esc(r.reply)}</p>` : ''}
      ${r.status !== 'done' ? `
        <textarea rows="2" placeholder="학생한테 답장 (학생은 접수번호로 확인해요)"></textarea>
        <div class="req-btns">
          <button class="btn small" data-act="reply" data-code="${r.code}">${r.reply ? '답장 고치기' : '답장 보내기'}</button>
          <button class="btn line small" data-act="done" data-code="${r.code}">마무리</button>
        </div>` : ''}
    </div>`).join('')
}

document.getElementById('reqList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  const code = btn.dataset.code

  try {
    if (btn.dataset.act === 'reply') {
      const ta = btn.closest('.req').querySelector('textarea')
      if (!ta.value.trim()) return ta.focus()
      await api(`/api/teacher/requests/${code}/reply`, { body: { reply: ta.value } })
    } else {
      if (!confirm('마무리할까요? 학생 화면에도 "마무리"로 보여요.')) return
      await api(`/api/teacher/requests/${code}/done`, { method: 'POST', body: {} })
    }
    loadReqs()
  } catch (err) {
    if (err.status === 401) kickOut()
    else alert(err.message)
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
document.getElementById('btnSeed').onclick = async () => {
  if (!curCls) return alert('반을 하나 골라주세요')
  await api('/api/teacher/seed', { body: { cls: curCls } })
  refresh()
}

document.getElementById('btnClear').onclick = async () => {
  if (!confirm('기분 기록이랑 도움 요청 전부 지워요. 진짜요?')) return
  await api('/api/teacher/clear', { method: 'POST', body: {} })
  refresh()
}

if (sessionStorage.getItem('shimpyo_token')) start()
