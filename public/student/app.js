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
  if (name === 'help') renderMine({ visit: true })
  else freshShown.clear()
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
// 단어 목록으로 폰에서 먼저 바로 보고, ChatGPT 켜져 있으면 서버 거쳐서 더 자세히 봄
// (어느 쪽이든 저장은 안 함. 보내기 전 말은 저장할 이유가 없어서)
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

const VERDICT = [
  { lv: 'ok', icon: 'check', title: '괜찮아 보여!', sub: '그래도 화난 상태면 10분만 있다가 보내는 것도 방법이야.' },
  { lv: 'soso', icon: 'alert', title: '한 번만 더 읽어볼래?', sub: '장난이어도 받는 사람한테는 다르게 들릴 수 있어.' },
  { lv: 'bad', icon: 'alert', title: '이건 안 보내는 게 좋겠어', sub: '받는 친구한테 오래 남는 말이 될 수 있어.' },
]

const LAW_HTML = `<div class="alert red law">
  ${icon('alert', 18)}
  <div><b>단톡방 욕설, 따돌림도 학교폭력이야</b>
  사이버 언어폭력이나 따돌림은 학교폭력예방법에 따라 학교폭력으로 처리될 수 있어.</div>
</div>`

function levelOf(score) {
  return score === 0 ? 0 : score <= 2 ? 1 : 2
}

function pinOf(idx, score) {
  if (idx === 0) return 14
  if (idx === 1) return Math.min(60, 35 + score * 10)
  return Math.min(94, 72 + Math.max(0, score - 3) * 6)
}

// 여러 표현 한 번에 표시 (겹치면 합침)
function markAll(text, terms) {
  const ranges = []
  terms.forEach(t => {
    if (!t) return
    let i = text.indexOf(t)
    while (i !== -1) {
      ranges.push([i, i + t.length])
      i = text.indexOf(t, i + t.length)
    }
  })
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  ranges.forEach(r => {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  })
  let out = ''
  let pos = 0
  merged.forEach(([a, b]) => {
    out += esc(text.slice(pos, a)) + `<mark>${esc(text.slice(a, b))}</mark>`
    pos = b
  })
  return out + esc(text.slice(pos))
}

function setVerdict(box, idx, score) {
  const v = VERDICT[idx]
  const h = box.querySelector('.verdict')
  h.className = 'verdict ' + v.lv
  h.innerHTML = `${icon(v.icon, 22)} ${v.title}`
  box.querySelector('.verdict-sub').textContent = v.sub

  // 바늘 움직이는 거 보이게 한 박자 늦게
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      box.querySelector('.meter-pin').style.left = pinOf(idx, score) + '%'
    })
  })

  const law = box.querySelector('.law')
  const aiBox = box.querySelector('.ai-box')
  if (idx === 2 && !law) {
    if (aiBox) aiBox.insertAdjacentHTML('beforebegin', LAW_HTML)
    else box.querySelector('.result').insertAdjacentHTML('beforeend', LAW_HTML)
  }
  if (idx < 2 && law) law.remove()
}

function runCheck(fromFix) {
  const text = $('msgInput').value.trim()
  const box = $('checkResult')
  checkRun++ // 예전 AI 결과 늦게 와도 무시하게
  if (!text) {
    box.innerHTML = ''
    return
  }

  const r = checkMsg(text)
  const localIdx = levelOf(r.score)

  const now = new Date()
  const time = `${now.getHours() < 12 ? '오전' : '오후'} ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`

  let html = `<div class="card result">
    <div class="meter">
      <div class="meter-track"><span></span><span></span><span></span></div>
      <div class="meter-pin" style="left:0%"></div>
    </div>
    <div class="meter-labels"><span>괜찮아</span><span>조심</span><span>위험</span></div>

    <h3 class="verdict"></h3>
    <p class="verdict-sub"></p>

    <div class="chatroom">
      <div class="chat-hd">우리반 단톡 <span>28</span></div>
      <div class="chat-body">
        <div class="msg">
          <div class="avatar">${icon('user', 16)}</div>
          <div><span class="who">반 친구</span><div class="bubble">내일 수행평가 뭐였지?</div></div>
        </div>
        <div class="msg mine">
          <div class="bubble">${markAll(text, r.found.map(b => b.word))}</div>
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
  html += '</div>'
  box.innerHTML = html
  setVerdict(box, localIdx, r.score)

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
  // AI 켜져 있으면 AI 결과 보고 띄움 ("죽어라 공부" 같은 거에 괜히 뜨지 않게)
  if (aiOn) aiCheck(text, r, localIdx, fromFix)
  else if (localIdx === 2 && !fromFix) showWarn(text)
}

// ---------- 말 점검: ChatGPT ----------
let aiOn = false
let checkRun = 0

async function aiCheck(text, r, localIdx, fromFix) {
  const run = checkRun
  const box = $('checkResult')
  box.querySelector('.result').insertAdjacentHTML('beforeend',
    `<div class="ai-box loading" id="aiBox">${icon('sparkle', 16)} AI가 더 자세히 보는 중<span class="dots"><i></i><i></i><i></i></span></div>`)

  let a
  try {
    a = await api('/api/check', { body: { text } })
  } catch (e) {
    if (run !== checkRun || !$('aiBox')) return
    $('aiBox').className = 'ai-box off'
    $('aiBox').innerHTML = `${icon('sparkle', 16)} AI가 지금 안 돼서 단어로만 봤어`
    if (localIdx === 2 && !fromFix) showWarn(text)
    return
  }
  if (run !== checkRun || !$('aiBox')) return // 그 사이에 다른 말 넣었으면 무시

  const aiIdx = { ok: 0, careful: 1, hurtful: 2 }[a.level]
  // AI가 더 심하다고 하면 올리고, 단어 목록이 오해한 거면("죽어라 공부" 같은) 내림
  // 근데 심한 욕이 있으면 '조심'까지만 내림
  const idx = localIdx === 2 && aiIdx === 0 ? 1 : aiIdx
  if (idx !== localIdx) setVerdict(box, idx, Math.max(r.score, idx === 2 ? 3 : 1))

  // AI가 짚은 표현도 같이 표시
  box.querySelector('.msg.mine .bubble').innerHTML = markAll(text, [...r.found.map(b => b.word), ...a.phrases])

  $('aiBox').className = 'ai-box'
  $('aiBox').innerHTML = `
    <div class="ai-hd">${icon('sparkle', 15)} AI(ChatGPT)가 같이 봤어</div>
    ${a.summary ? `<p class="ai-sum">${esc(a.summary)}</p>` : ''}
    ${a.why ? `<p class="ai-why">${esc(a.why)}</p>` : ''}
    ${a.better && a.better !== text ? `
      <div class="ai-better">
        <small>이렇게 바꿔보면?</small>
        <p>${esc(a.better)}</p>
        <button class="btn yellow small" id="btnUseAi">${icon('wand', 15)} 이걸로 바꾸기</button>
      </div>` : ''}`

  const use = $('btnUseAi')
  if (use) {
    use.onclick = () => {
      $('msgInput').value = a.better
      runCheck(true)
      toast('AI가 바꾼 말로 넣었어')
    }
  }

  if (idx === 2 && !fromFix) showWarn(text)
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
  if (!(await checkBeforeSend(text, btn))) return $('helpText').focus()
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
    if (res.warned) toast('욕을 써서 경고가 1번 쌓였어')
    if (res.danger) showDanger()
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

// ---------- 보내기 전에 검수 (AI 있으면 AI가) ----------
// 직접 쓴 욕이면 보내자마자 경고 1번. 누가 한 말 옮긴 건 괜찮음
async function reviewText(text) {
  try {
    return await api('/api/review', { body: { text } })
  } catch (e) {
    // 서버 안 되면 폰에서 단어 목록으로라도
    return {
      by: 'words',
      words: findBad(text),
      insultTeacher: atTeacherBad(text).length > 0,
      danger: findDanger(text).length > 0,
      warn: selfBad(text).length > 0,
      reason: '',
    }
  }
}

function confirmWarn(v) {
  return new Promise(resolve => {
    const words = v.words && v.words.length
      ? `<div class="quote">${v.words.map(w => `<mark>${esc(w)}</mark>`).join(', ')}</div>`
      : ''
    $('warnBox').innerHTML = `
      <div class="modal-ic">${icon('alert', 32)}</div>
      <h3>${v.insultTeacher ? '선생님한테 욕하면 경고야' : '욕이 들어 있어'}</h3>
      ${words}
      ${v.by === 'ai' && v.reason ? `<p class="ai-why-line">${icon('sparkle', 13)} AI: ${esc(v.reason)}</p>` : ''}
      <p><b>이대로 보내면 바로 경고가 1번 쌓여.</b><br>경고 3번이면 이 대화는 닫혀.</p>
      <p class="hint">누가 너한테 한 말이면 "걔가 ○○이라고 했어요"처럼 적어줘. 그건 경고 안 해.</p>
      <div class="btns">
        <button class="btn go big full" id="badFix">고쳐 쓸게</button>
        <button class="btn ghost full" id="badSend">그래도 보낼게</button>
      </div>`
    $('warnModal').hidden = false
    const done = ok => {
      $('warnModal').hidden = true
      resolve(ok)
    }
    $('badFix').onclick = () => done(false)
    $('badSend').onclick = () => done(true)
  })
}

// 보내기 전에 검수 → 경고 받을 글이면 물어봄. 보낼 거면 true
async function checkBeforeSend(text, btn) {
  const before = btn.innerHTML
  btn.disabled = true
  btn.classList.add('busy')
  if (btn.type === 'submit' && btn.closest('#helpForm')) btn.innerHTML = `${icon('sparkle', 18)} 확인하는 중...`
  const v = await reviewText(text)
  btn.innerHTML = before
  btn.classList.remove('busy')
  btn.disabled = false
  if (v.warn && !(await confirmWarn(v))) return false
  return true
}

// 위험한 말 보냈을 때 연락처
function showDanger() {
  $('warnBox').innerHTML = `
    <div class="modal-ic">${icon('heart', 30)}</div>
    <h3>선생님한테 급함으로 보냈어</h3>
    <p>혹시 지금 위험한 상황이면 기다리지 말고 바로 연락해.</p>
    <div class="danger-btns modal-sos">
      <a href="tel:112">112 긴급</a>
      <a href="tel:117">117 학교폭력</a>
      <a href="tel:109">109 상담</a>
    </div>
    <div class="btns"><button class="btn ghost full" data-close>알겠어</button></div>`
  $('warnModal').hidden = false
}

// ---------- 내가 보낸 이야기 (선생님이랑 대화) ----------
// 접수번호는 폰에 저장해두고, 열 때마다 서버에서 대화 다시 받아옴
function lastTeacherAt(r) {
  const t = r.messages.filter(m => m.from === 'teacher')
  return t.length ? t[t.length - 1].at : 0
}

function isFresh(r) {
  const t = lastTeacherAt(r)
  return t > 0 && t > (me.seen[r.code] || 0)
}

// 이번에 화면에서 본 새 답장은 다른 탭 갈 때까지 배지 그대로 둠
// (목록 다시 그릴 때마다 배지 없어지면 뭐가 새 건지 모름)
const freshShown = new Set()

// 쓰던 답장도 새로고침해도 남게
const CHAT_KEY = 'shimpyo_chat_drafts'
function chatDrafts() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')
  } catch (e) {
    return {}
  }
}
function setChatDraft(code, text) {
  const d = chatDrafts()
  if (text) d[code] = text
  else delete d[code]
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(d)) } catch (e) {}
}

function msgHtml(m) {
  if (m.kind === 'info') return `<p class="sys">${esc(m.text)}</p>`
  if (m.kind === 'warn') {
    return `<div class="msg warn-msg">
      <div class="avatar">${icon('alert', 16)}</div>
      <div><span class="who">${m.auto ? '자동 경고' : '선생님 경고'}</span><div class="bubble">${esc(m.text)}</div></div>
    </div>`
  }
  if (m.from === 'student') {
    return `<div class="msg mine"><div class="bubble">${esc(m.text)}</div><span class="time">${timeAgo(m.at)}</span></div>`
  }
  return `<div class="msg">
    <div class="avatar">${icon('user', 16)}</div>
    <div><span class="who">선생님</span><div class="bubble">${esc(m.text)}</div></div>
    <span class="time">${timeAgo(m.at)}</span>
  </div>`
}

function storyHtml(r) {
  const fresh = isFresh(r) || freshShown.has(r.code)
  const first = r.messages[0].text
  const short = first.length > 26 ? first.slice(0, 25) + '…' : first
  const last = r.messages[r.messages.length - 1]
  const waiting = last.from === 'student' && !r.locked && r.status !== 'done'

  return `<details class="story ${fresh ? 'fresh' : ''} ${r.locked ? 'locked' : ''}" data-code="${r.code}" ${fresh ? 'open' : ''}>
    <summary>
      <span class="story-top">
        <span class="st st-${r.status}">${STATUS[r.status]}</span>
        ${fresh ? '<span class="new-badge">새 답장</span>' : ''}
        ${r.warnings ? `<span class="warn-badge">${icon('alert', 12)} 경고 ${r.warnings}</span>` : ''}
        <span class="story-meta">${r.code} · ${esc(r.type)} · ${timeAgo(r.at)}</span>
      </span>
      <span class="story-sum">${esc(short)}</span>
    </summary>
    <div class="thread">
      <div class="thread-msgs">
        ${r.messages.map(msgHtml).join('')}
        ${waiting ? '<div class="waiting"><span class="dots"><i></i><i></i><i></i></span> 선생님이 아직 확인 중이야</div>' : ''}
      </div>
      <div class="thread-foot" data-locked="${r.locked ? 1 : 0}">
        ${r.locked
          ? `<p class="sys locked-msg">${icon('lock', 14)} 선생님이 이 대화를 닫았어. 필요하면 새로 이야기를 보내줘.</p>`
          : `<form class="chat-form" data-code="${r.code}">
              <textarea rows="1" maxlength="500" enterkeyhint="send" placeholder="${r.status === 'done' ? '더 하고 싶은 말 있으면 보내도 돼' : '선생님한테 답장 (Enter 보내기)'}"></textarea>
              <button class="btn go" type="submit" aria-label="보내기">${icon('send', 17)}</button>
            </form>`}
      </div>
    </div>
  </details>`
}

let lastList = []

// visit: 학생이 직접 이 화면에 들어온 거면 새 답장 읽은 걸로 침
// (실시간으로 그냥 다시 그리는 건 학생이 아직 못 봤을 수도 있어서 안 침)
async function renderMine(opts = {}) {
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

  // 이미 그려져 있고 순서도 같으면 바뀐 부분만 바꿔 끼움
  // (통째로 다시 그리면 쓰던 칸이 새로 바뀌어서 한글 조합 중이던 글자가 날아감)
  const shown = [...box.querySelectorAll('details.story')]
  if (shown.length === list.length && shown.every((d, i) => d.dataset.code === list[i].code)) {
    list.forEach((r, i) => patchStory(shown[i], r))
    afterRender(list, opts)
    return
  }

  // 쓰고 있던 칸에 커서 있으면 다시 그린 뒤에도 거기로
  const focused = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest('.chat-form')
    : null
  const focusedCode = focused ? focused.dataset.code : null

  // 펼쳐둔 거는 다시 그려도 펼친 채로
  const opened = [...box.querySelectorAll('details[open]')].map(d => d.dataset.code)
  box.innerHTML = list.map(storyHtml).join('')
  const drafts = chatDrafts()
  box.querySelectorAll('details.story').forEach(d => {
    if (opened.includes(d.dataset.code)) d.open = true
    const ta = d.querySelector('.chat-form textarea')
    if (ta && drafts[d.dataset.code]) {
      ta.value = drafts[d.dataset.code]
      d.open = true
    }
    if (ta && d.dataset.code === focusedCode) ta.focus()
  })
  afterRender(list, opts)
}

// 이야기 하나만 바꿔 끼우기. 입력 칸(.chat-form)은 안 건드림
function patchStory(d, r) {
  const tmp = document.createElement('div')
  tmp.innerHTML = storyHtml(r)
  const nd = tmp.firstElementChild

  d.className = nd.className
  if (nd.open) d.open = true // 새 답장 오면 펼치기 (접는 건 학생 마음)
  d.querySelector('summary').innerHTML = nd.querySelector('summary').innerHTML

  const msgs = d.querySelector('.thread-msgs')
  const newMsgs = nd.querySelector('.thread-msgs').innerHTML
  if (msgs.innerHTML !== newMsgs) msgs.innerHTML = newMsgs

  // 닫혔다/열렸다 바뀔 때만 아래쪽(입력 칸) 바꿈
  const foot = d.querySelector('.thread-foot')
  const newFoot = nd.querySelector('.thread-foot')
  if (foot.dataset.locked !== newFoot.dataset.locked) {
    foot.replaceWith(newFoot)
  } else {
    const ta = foot.querySelector('textarea')
    const nta = newFoot.querySelector('textarea')
    if (ta && nta) ta.placeholder = nta.placeholder
  }
}

function afterRender(list, opts) {
  lastList = list
  // 배지는 이번엔 그대로 보여주고 다음부터 안 보이게
  if (opts.visit && !$('page-help').hidden) {
    list.filter(isFresh).forEach(markSeen)
    saveMe()
  }
  updateReplyBox(list)
  connectEvents()
}

function markSeen(r) {
  me.seen[r.code] = lastTeacherAt(r)
  freshShown.add(r.code)
}

// 이야기 누르거나 답장 칸 누르면 읽은 걸로
function seenByTouch(e) {
  const d = e.target.closest('details.story')
  if (!d) return
  const r = lastList.find(x => x.code === d.dataset.code)
  if (!r || !isFresh(r)) return
  markSeen(r)
  saveMe()
  updateReplyBox(lastList)
}
$('myList').addEventListener('click', seenByTouch)
$('myList').addEventListener('focusin', seenByTouch)

// 홈에 "답장 왔어" 띄우기
function updateReplyBox(list) {
  const n = list.filter(isFresh).length
  $('replyBox').hidden = n === 0
  $('replyText').textContent = n > 1
    ? `답장이 ${n}개 왔어. 확인해볼래?`
    : '내가 보낸 이야기에 답장이 왔어. 확인해볼래?'
}

$('myList').addEventListener('input', e => {
  const ta = e.target.closest('.chat-form textarea')
  if (!ta) return
  setChatDraft(ta.closest('.chat-form').dataset.code, ta.value)
  // 쓰는 만큼 칸 늘어나게
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
})

// Enter 누르면 보내기, Shift+Enter는 줄바꿈 (한글 조합 처리는 common.js)
enterToSend($('myList'), '.chat-form textarea', ta => ta.closest('.chat-form').requestSubmit())

$('myList').addEventListener('submit', async e => {
  const form = e.target.closest('.chat-form')
  if (!form) return
  e.preventDefault()

  if (form.dataset.busy) return // 보내는 중에 또 누르면 무시
  const ta = form.querySelector('textarea')
  const text = ta.value.trim()
  if (!text) return ta.focus()

  const btn = form.querySelector('button')
  form.dataset.busy = '1'
  const ok = await checkBeforeSend(text, btn)
  if (!ok) {
    delete form.dataset.busy
    return ta.focus()
  }
  btn.disabled = true
  try {
    const res = await api(`/api/requests/${form.dataset.code}/messages`, { body: { text } })
    setChatDraft(form.dataset.code, '')
    ta.value = ''
    await renderMine()
    toast(res.warned ? '욕을 써서 경고가 1번 쌓였어' : '선생님한테 보냈어')
    if (res.danger) showDanger()
  } catch (err) {
    toast(err.message)
  }
  btn.disabled = false
  delete form.dataset.busy
})

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

// AI 판단 켜져 있으면 알려주기 (학생 글이 밖으로 나가는 거니까)
api('/api/config').then(c => {
  aiOn = c.ai
  $('aiHint').hidden = !c.ai
  if (c.ai) $('checkNote').textContent = '단톡방이나 DM에 보내려는 말을 넣어봐. AI(ChatGPT)가 같이 봐주고, 넣은 말은 저장 안 해.'
}).catch(() => {})

// ---------- 시작 ----------
if (!me) $('welcome').hidden = false
renderHome()
loadDraft()
renderMine()

let lastPage = null
try { lastPage = sessionStorage.getItem('shimpyo_page') } catch (e) {}
if (lastPage && $('page-' + lastPage)) go(lastPage)

// ---------- 실시간 ----------
// 선생님이 답장하면 서버가 바로 알려줌 → 새로고침 안 해도 뜸
let es = null
let mineTimer = null

function renderMineSoon() {
  clearTimeout(mineTimer)
  mineTimer = setTimeout(renderMine, 250)
}

function connectEvents() {
  if (!me || !me.codes.length || !window.EventSource) return
  const key = me.codes.join(',')
  if (es && es._key === key && es.readyState !== 2) return // 이미 연결됨
  if (es) es.close()
  es = new EventSource('/api/events?codes=' + encodeURIComponent(key))
  es._key = key
  es.addEventListener('req', renderMineSoon)
  es.addEventListener('all', renderMineSoon)
  // 다시 연결되면 그 사이에 온 거 받아오기
  es.addEventListener('open', renderMineSoon)
}

// 실시간 연결이 안 될 때만 15초마다 확인 (예비)
setInterval(() => {
  if (!es || es.readyState !== 1) renderMine()
}, 15000)
