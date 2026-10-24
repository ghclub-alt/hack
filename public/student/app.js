// 학생 화면

// 내 정보는 그냥 폰에 저장 (id는 랜덤이라 누군지 모름)
let me = JSON.parse(localStorage.getItem('shimpyo_me') || 'null')

if (me && !me.seen) me.seen = {} // 예전에 만든 정보엔 없어서

function saveMe() {
  localStorage.setItem('shimpyo_me', JSON.stringify(me))
}

const $ = id => document.getElementById(id)

// ---------- 페이지 이동 ----------
function go(name) {
  document.querySelectorAll('.page').forEach(p => {
    p.hidden = p.id !== 'page-' + name
  })
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.page === name)
  })
  window.scrollTo(0, 0)
  // 새로고침해도 보던 화면 그대로
  try { sessionStorage.setItem('shimpyo_page', name) } catch (e) {}
  if (name === 'help') renderMine()
}

document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.page))
})
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]')
  if (b) go(b.dataset.go)
})

// ---------- 처음 화면 ----------
for (let i = 1; i <= 3; i++) $('selGrade').innerHTML += `<option value="${i}">${i}학년</option>`
for (let i = 1; i <= 15; i++) $('selClass').innerHTML += `<option value="${i}">${i}반</option>`
$('welcomeFaces').innerHTML = MOODS.map(m => face(m.v, 46)).join('')

$('btnSetup').onclick = () => {
  const cls = $('selGrade').value + '-' + $('selClass').value
  if (me) {
    me.cls = cls
  } else {
    me = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      cls,
      codes: [],
      seen: {},
    }
  }
  saveMe()
  $('welcome').hidden = true
  renderHome()
  renderMine()
}

$('clsChip').onclick = () => {
  const [g, c] = me.cls.split('-')
  $('selGrade').value = g
  $('selClass').value = c
  $('welcome').hidden = false
}

// ---------- 경고창 ----------
document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-close]')) bg.hidden = true
  })
})

// ---------- 홈 ----------
function renderHome() {
  $('clsChip').textContent = me ? me.cls.replace('-', '학년 ') + '반' : ''

  const now = new Date()
  $('todayText').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DAY_NAMES[now.getDay()]}요일`

  const h = now.getHours()
  let hello
  if (h >= 5 && h < 11) hello = '좋은 아침이야.<br>오늘도 천천히 가자'
  else if (h >= 11 && h < 17) hello = '오늘 하루 어때?<br>잠깐 쉬어가도 돼'
  else if (h >= 17 && h < 23) hello = '오늘도 수고했어.<br>푹 쉬자'
  else hello = '아직 안 자?<br>얼른 자자, 내일 또 보자'
  $('helloText').innerHTML = hello

  // 날마다 다른 한마디
  const dayNo = Math.floor(now / 86400000)
  $('tipText').textContent = TIPS[dayNo % TIPS.length]

  renderMoods()
}

async function renderMoods() {
  let mine = []
  if (me) {
    try {
      mine = await api('/api/moods/mine?id=' + encodeURIComponent(me.id))
    } catch (e) {
      console.log('기분 불러오기 실패', e)
    }
  }
  const todayMood = mine.find(m => m.date === daysAgo(0))

  const wrap = $('moods')
  wrap.classList.toggle('has-pick', !!todayMood)
  wrap.innerHTML = MOODS.map(m => `
    <button class="mood ${todayMood && todayMood.mood === m.v ? 'picked' : ''}" data-v="${m.v}">
      ${face(m.v, 44)}<span>${m.label}</span>
    </button>`).join('')

  wrap.querySelectorAll('.mood').forEach(btn => {
    btn.onclick = () => pickMood(Number(btn.dataset.v))
  })

  $('moodMsg').textContent = todayMood
    ? moodOf(todayMood.mood).reply
    : '하나만 누르면 끝. 누가 눌렀는지는 아무도 몰라.'

  // 최근 7일
  let html = ''
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i)
    const rec = mine.find(m => m.date === d)
    html += `<div class="day ${i === 0 ? 'today' : ''}">
      ${rec ? face(rec.mood, 22) : '<span class="blank"></span>'}
      ${i === 0 ? '오늘' : dayName(d)}
    </div>`
  }
  $('week').innerHTML = html

  // 일주일에 3번 이상 힘들다고 했거나 오늘 많이 힘들면 살짝 알려줌
  const hard = mine.filter(m => m.mood >= 4).length
  $('careBox').hidden = !(hard >= 3 || (todayMood && todayMood.mood === 5))
}

async function pickMood(v) {
  if (!me) return
  try {
    await api('/api/moods', { body: { id: me.id, cls: me.cls, mood: v } })
    await renderMoods()
    toast('오늘 마음 날씨 기록했어')
  } catch (e) {
    toast('저장이 안 됐어. 잠시 후에 다시 눌러줘')
  }
}

// ---------- 말 점검 ----------
// 일부러 서버로 안 보냄. 보내기 전 말은 저장할 이유가 없어서
const EXAMPLES = [
  '너 진짜 노답이다 ㅋㅋㅋ',
  '쟤 빼고 우리끼리 가자',
  '@지민 닥쳐 관종아!!!',
  '내일 같이 도서관 갈래?',
]

$('examples').innerHTML = EXAMPLES.map(t => `<button>${esc(t)}</button>`).join('')
$('examples').querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    $('msgInput').value = b.textContent
    runCheck()
  }
})

function checkMsg(text) {
  const flat = text.replace(/\s/g, '')
  const found = BAD_WORDS.filter(b => flat.includes(b.word.replace(/\s/g, '')))
  let score = found.reduce((sum, b) => sum + b.level, 0)
  const tips = []

  if (found.length && /[ㅋㅎ]{2,}/.test(text)) {
    tips.push('ㅋㅋ 붙이면 장난 같아도, 받는 사람은 하나도 안 웃길 수 있어.')
  }
  if (/[!?]{3,}/.test(text)) {
    tips.push('느낌표나 물음표가 많으면 화난 걸로 보여.')
    score += 1
  }
  if (found.length && /@\S+/.test(text)) {
    tips.push('단톡방에서 콕 집어서(@) 이런 말 하면 다른 애들도 다 보게 돼.')
    score += 1
  }
  return { found, score, tips }
}

function runCheck(fromFix) {
  const text = $('msgInput').value.trim()
  const box = $('checkResult')
  if (!text) {
    box.innerHTML = ''
    return
  }

  const r = checkMsg(text)
  let shown = esc(text)
  r.found.forEach(b => {
    shown = shown.split(esc(b.word)).join(`<mark>${esc(b.word)}</mark>`)
  })

  let lv, title, sub, pin
  if (r.score === 0) {
    lv = 'ok'
    title = '괜찮아 보여!'
    sub = '그래도 화난 상태면 10분만 있다가 보내는 것도 방법이야.'
    pin = 14
  } else if (r.score <= 2) {
    lv = 'soso'
    title = '한 번만 더 읽어볼래?'
    sub = '장난이어도 받는 사람한테는 다르게 들릴 수 있어.'
    pin = 35 + r.score * 10
  } else {
    lv = 'bad'
    title = '이건 안 보내는 게 좋겠어'
    sub = '받는 친구한테 오래 남는 말이 될 수 있어.'
    pin = Math.min(94, 72 + (r.score - 3) * 6)
  }
  const ic = { ok: 'check', soso: 'alert', bad: 'alert' }[lv]

  const now = new Date()
  const time = `${now.getHours() < 12 ? '오전' : '오후'} ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`

  let html = `<div class="card result">
    <div class="meter">
      <div class="meter-track"><span></span><span></span><span></span></div>
      <div class="meter-pin" style="left:0%"></div>
    </div>
    <div class="meter-labels"><span>괜찮아</span><span>조심</span><span>위험</span></div>

    <h3 class="verdict ${lv}">${icon(ic, 22)} ${title}</h3>
    <p class="verdict-sub">${sub}</p>

    <div class="chatroom">
      <div class="chat-hd">우리반 단톡 <span>28</span></div>
      <div class="chat-body">
        <div class="msg">
          <div class="avatar">${icon('user', 16)}</div>
          <div><span class="who">반 친구</span><div class="bubble">내일 수행평가 뭐였지?</div></div>
        </div>
        <div class="msg mine">
          <div class="bubble">${shown}</div>
          <span class="time">${time}</span>
        </div>
      </div>
    </div>`

  if (r.found.length) {
    html += '<ul class="alts">'
    r.found.forEach(b => {
      html += b.alt
        ? `<li><span class="from">${esc(b.word)}</span>${icon('arrow', 14)}<span class="to">${esc(b.alt)}</span></li>`
        : `<li><span class="from">${esc(b.word)}</span><span class="drop">이 말은 그냥 빼는 게 좋아</span></li>`
    })
    html += '</ul>'
  }

  if (r.found.some(b => b.alt)) {
    html += `<button class="btn yellow full" id="btnFix">${icon('wand', 18)} 바꾼 말로 다시 써보기</button>`
  }

  if (r.tips.length) {
    html += '<div class="tips">' + r.tips.map(t => `<p>${t}</p>`).join('') + '</div>'
  }

  if (lv === 'bad') {
    html += `<div class="alert red law">
      ${icon('alert', 18)}
      <div><b>단톡방 욕설, 따돌림도 학교폭력이야</b>
      사이버 언어폭력이나 따돌림은 학교폭력예방법에 따라 학교폭력으로 처리될 수 있어.</div>
    </div>`
  }
  html += '</div>'
  box.innerHTML = html

  // 바늘 움직이는 거 보이게 한 박자 늦게
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      box.querySelector('.meter-pin').style.left = pin + '%'
    })
  })

  const fix = $('btnFix')
  if (fix) {
    fix.onclick = () => {
      let t = $('msgInput').value
      r.found.forEach(b => {
        if (b.alt) t = t.split(b.word).join(b.alt)
      })
      $('msgInput').value = t
      runCheck(true)
      toast('바꿔봤어. 어때?')
    }
  }

  // 바꾸기 버튼으로 다시 본 거면 경고창은 또 안 띄움
  if (lv === 'bad' && !fromFix) showWarn(text)
}

// 심한 말이면 경고창 한번 띄움
function showWarn(text) {
  $('warnBox').innerHTML = `
    <div class="modal-ic">${icon('alert', 32)}</div>
    <h3>잠깐! 보내기 전에</h3>
    <p>이 메시지는 받는 친구한테 큰 상처가 될 수 있어.</p>
    <div class="quote">${esc(text)}</div>
    <p>한번 보낸 말은 캡처돼서 계속 남아.</p>
    <div class="btns">
      <button class="btn go big full" id="warnRewrite">다시 쓸게</button>
      <button class="btn ghost full" data-close>결과만 볼게</button>
    </div>`
  $('warnModal').hidden = false
  $('warnRewrite').onclick = () => {
    $('warnModal').hidden = true
    $('msgInput').focus()
  }
}

$('btnCheck').onclick = () => runCheck()

// ---------- 도움 요청 ----------
$('typeChips').innerHTML = TYPES.map(t =>
  `<label><input type="radio" name="type" value="${t}">${t}</label>`
).join('')

document.querySelectorAll('input[name=want]').forEach(r => {
  r.addEventListener('change', () => {
    $('nameWrap').hidden = r.value !== 'meet'
  })
})

// 쓰는 중에 위험한 말 나오면 바로 연락처 보여줌
function onHelpText() {
  const t = $('helpText').value
  $('cnt').textContent = t.length
  const danger = findDanger(t).length > 0
  if (danger && $('dangerInline').hidden) $('dangerInline').hidden = false
  if (!danger) $('dangerInline').hidden = true
}
$('helpText').addEventListener('input', onHelpText)

// ---------- 임시 저장 ----------
// 쓰다가 새로고침하거나 실수로 나가도 안 날아가게
const DRAFT_KEY = 'shimpyo_draft'

function saveDraft() {
  const type = document.querySelector('input[name=type]:checked')
  const d = {
    type: type ? type.value : '',
    text: $('helpText').value,
    want: document.querySelector('input[name=want]:checked').value,
    name: $('helpName').value,
  }
  try {
    if (!d.type && !d.text.trim() && !d.name) {
      localStorage.removeItem(DRAFT_KEY)
      $('draftNote').hidden = true
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    $('draftNote').hidden = false
  } catch (e) {
    // 저장 막힌 브라우저면 그냥 넘어감
  }
}

function loadDraft() {
  let d = null
  try {
    d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
  } catch (e) {}
  if (!d) return

  document.querySelectorAll('input[name=type]').forEach(r => { r.checked = r.value === d.type })
  document.querySelectorAll('input[name=want]').forEach(r => { r.checked = r.value === d.want })
  $('helpText').value = d.text || ''
  $('helpName').value = d.name || ''
  $('nameWrap').hidden = d.want !== 'meet'
  onHelpText()
  $('draftNote').hidden = false
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch (e) {}
  $('draftNote').hidden = true
}

$('helpForm').addEventListener('input', saveDraft)
$('helpForm').addEventListener('change', saveDraft)

$('btnDraftClear').onclick = () => {
  if (!confirm('쓰던 거 지울까?')) return
  $('helpForm').reset()
  $('nameWrap').hidden = true
  onHelpText()
  clearDraft()
}

$('helpForm').onsubmit = async e => {
  e.preventDefault()

  const type = document.querySelector('input[name=type]:checked')
  const text = $('helpText').value.trim()
  const want = document.querySelector('input[name=want]:checked').value

  if (!type) return toast('어떤 일인지 하나만 골라줘')
  if (text.length < 5) return toast('조금만 더 적어줄래?')

  const btn = e.target.querySelector('button[type=submit]')
  btn.disabled = true
  try {
    const res = await api('/api/requests', {
      body: { cls: me.cls, type: type.value, text, want, name: $('helpName').value },
    })
    me.codes.push(res.code)
    saveMe()

    e.target.reset()
    $('nameWrap').hidden = true
    $('dangerInline').hidden = true
    $('cnt').textContent = 0
    clearDraft()

    showTicket(res.code, res.danger)
    renderMine()
  } catch (err) {
    toast(err.message)
  }
  btn.disabled = false
}

function showTicket(code, urgent) {
  const done = $('helpDone')
  done.innerHTML = `<div class="ticket">
    <div class="ticket-top">
      <div class="ok-ic">${icon('check', 24)}</div>
      <b>잘 보냈어. 말해줘서 고마워.</b>
      <p>선생님이 확인하면 답장해줄 거야.</p>
      ${urgent ? `<div class="urgent-note">${icon('alert', 16)} 선생님한테 급함으로 표시됐어</div>` : ''}
    </div>
    <div class="ticket-cut"></div>
    <div class="ticket-bottom">
      <small>접수번호</small>
      <div class="code">${code}</div>
      <button class="btn yellow small" id="btnCopy">${icon('copy', 15)} 번호 복사</button>
      <p class="hint code-hint">이 번호로 답장을 확인해. 캡처해두면 편해.</p>
    </div>
  </div>`
  done.hidden = false
  done.scrollIntoView({ behavior: 'smooth', block: 'center' })

  $('btnCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast('복사했어')
    } catch (e) {
      toast('복사가 안 돼서.. 캡처해줘!')
    }
  }
}

// ---------- 내가 보낸 이야기 ----------
// 접수번호는 폰에 저장해두고, 열 때마다 서버에서 상태 다시 받아옴
function isFresh(r) {
  return !!r.reply && me.seen[r.code] !== r.repliedAt
}

function storyHtml(r) {
  const fresh = isFresh(r)
  const short = r.text.length > 26 ? r.text.slice(0, 25) + '…' : r.text
  return `<details class="story ${fresh ? 'fresh' : ''}" data-code="${r.code}" ${fresh ? 'open' : ''}>
    <summary>
      <span class="story-top">
        <span class="st st-${r.status}">${STATUS[r.status]}</span>
        ${fresh ? '<span class="new-badge">새 답장</span>' : ''}
        <span class="story-meta">${r.code} · ${esc(r.type)} · ${timeAgo(r.at)}</span>
      </span>
      <span class="story-sum">${esc(short)}</span>
    </summary>
    <div class="thread">
      <div class="msg mine"><div class="bubble">${esc(r.text)}</div></div>
      ${r.reply
        ? `<div class="msg">
            <div class="avatar">${icon('user', 16)}</div>
            <div><span class="who">선생님</span><div class="bubble">${esc(r.reply)}</div></div>
          </div>`
        : `<div class="waiting"><span class="dots"><i></i><i></i><i></i></span> 선생님이 아직 확인 중이야</div>`}
    </div>
  </details>`
}

async function renderMine() {
  if (!me) return
  const box = $('myList')
  if (!me.codes.length) {
    box.innerHTML = '<p class="hint">아직 보낸 이야기가 없어. 보내면 새로고침해도 여기 계속 남아 있어.</p>'
    $('replyBox').hidden = true
    return
  }

  const codes = me.codes.slice().reverse()
  const got = await Promise.all(codes.map(c =>
    api('/api/requests/' + encodeURIComponent(c)).catch(e => (e.status === 404 ? { gone: c } : null))
  ))

  // 서버에서 지워진 번호는 목록에서도 뺌
  const gone = got.filter(r => r && r.gone).map(r => r.gone)
  if (gone.length) {
    me.codes = me.codes.filter(c => !gone.includes(c))
    saveMe()
  }

  const list = got.filter(r => r && !r.gone)
  if (!list.length) {
    box.innerHTML = got.some(r => r === null)
      ? '<p class="hint">지금 서버랑 연결이 안 돼서 못 불러왔어. 잠시 후에 다시 와줘.</p>'
      : '<p class="hint">아직 보낸 이야기가 없어. 보내면 새로고침해도 여기 계속 남아 있어.</p>'
    $('replyBox').hidden = true
    return
  }

  // 펼쳐둔 거는 다시 그려도 펼친 채로
  const opened = [...box.querySelectorAll('details[open]')].map(d => d.dataset.code)
  box.innerHTML = list.map(storyHtml).join('')
  box.querySelectorAll('details.story').forEach(d => {
    if (opened.includes(d.dataset.code)) d.open = true
  })

  // 이 화면 보고 있으면 답장 읽은 걸로 (배지는 이번엔 그대로 보여줌)
  // toggle 이벤트로 하면 open 붙은 채로 그려질 때도 불려서 안 씀
  if (!$('page-help').hidden) {
    list.filter(isFresh).forEach(r => { me.seen[r.code] = r.repliedAt })
    saveMe()
  }
  updateReplyBox(list)
}

// 홈에 "답장 왔어" 띄우기
function updateReplyBox(list) {
  const n = list.filter(isFresh).length
  $('replyBox').hidden = n === 0
  $('replyText').textContent = n > 1
    ? `답장이 ${n}개 왔어. 확인해볼래?`
    : '내가 보낸 이야기에 답장이 왔어. 확인해볼래?'
}

async function findByCode() {
  const code = $('codeInput').value.trim().toUpperCase()
  if (!code) return
  try {
    await api('/api/requests/' + encodeURIComponent(code))
    if (!me.codes.includes(code)) {
      me.codes.push(code)
      saveMe()
    }
    $('codeInput').value = ''
    $('findMsg').textContent = '찾았어! 위 목록에 넣어뒀어.'
    renderMine()
  } catch (e) {
    $('findMsg').textContent = '그 번호는 없어. 다시 확인해줘.'
  }
}

$('btnFind').onclick = findByCode
$('codeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') findByCode()
})

// ---------- 봤을 때 ----------
$('guideList').innerHTML = GUIDE.map((g, i) => `
  <details class="guide" ${i === 0 ? 'open' : ''}>
    <summary><span class="guide-ic" style="background:${g.tint}">${icon(g.icon, 20)}</span>${g.title}</summary>
    <ol>${g.items.map(t => `<li>${t}</li>`).join('')}</ol>
  </details>`).join('')

// ---------- 앱 설치 ----------
setupPwa('student', '다시 연결됐어')
setupInstall({
  box: 'installBox',
  btn: 'btnInstall',
  msg: 'installMsg',
  close: 'btnInstallX',
  key: 'shimpyo_install_no',
  iosMsg: '아래 공유 버튼(□↑) 누르고 "홈 화면에 추가" 누르면 돼.',
})

// 다시 연결되면 답장 왔는지 바로 확인
window.addEventListener('online', renderMine)

// ---------- 시작 ----------
if (!me) $('welcome').hidden = false
renderHome()
loadDraft()
renderMine()

let lastPage = null
try { lastPage = sessionStorage.getItem('shimpyo_page') } catch (e) {}
if (lastPage && $('page-' + lastPage)) go(lastPage)

// 선생님 답장 왔는지 1분마다 확인
setInterval(renderMine, 60000)
