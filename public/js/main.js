// 학생 화면

// 내 정보는 그냥 폰에 저장 (id는 랜덤이라 누군지 모름)
let me = JSON.parse(localStorage.getItem('shimpyo_me') || 'null')

function saveMe() {
  localStorage.setItem('shimpyo_me', JSON.stringify(me))
}

// ---------- 페이지 이동 ----------
function go(name) {
  document.querySelectorAll('.page').forEach(p => {
    p.hidden = p.id !== 'page-' + name
  })
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.page === name)
  })
  window.scrollTo(0, 0)
}

document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.page))
})
document.querySelectorAll('[data-go]').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.go))
})

// ---------- 처음 설정 ----------
const selGrade = document.getElementById('selGrade')
const selClass = document.getElementById('selClass')
for (let i = 1; i <= 3; i++) selGrade.innerHTML += `<option value="${i}">${i}학년</option>`
for (let i = 1; i <= 15; i++) selClass.innerHTML += `<option value="${i}">${i}반</option>`

document.getElementById('btnSetup').onclick = () => {
  me = {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    cls: selGrade.value + '-' + selClass.value,
    codes: [],
  }
  saveMe()
  renderHome()
}

function renderHome() {
  document.getElementById('setupBox').hidden = !!me
  document.getElementById('myClass').textContent = me
    ? me.cls.replace('-', '학년 ') + '반'
    : ''
  renderMoods()
}

// ---------- 오늘 기분 ----------
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

  const wrap = document.getElementById('moods')
  wrap.innerHTML = MOODS.map(m => `
    <button class="mood ${todayMood && todayMood.mood === m.v ? 'picked' : ''}" data-v="${m.v}" style="--c:${m.color}">
      <span class="dot"></span>${m.label}
    </button>`).join('')

  wrap.querySelectorAll('.mood').forEach(btn => {
    btn.onclick = () => pickMood(Number(btn.dataset.v))
  })

  document.getElementById('moodMsg').textContent = todayMood
    ? moodOf(todayMood.mood).reply
    : '하나만 누르면 끝. 누가 눌렀는지는 아무도 몰라.'

  // 최근 7일 점
  let html = ''
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i)
    const rec = mine.find(m => m.date === d)
    const color = rec ? moodOf(rec.mood).color : '#ddd'
    html += `<div class="day"><span style="background:${color}"></span>${i === 0 ? '오늘' : Number(d.slice(8)) + '일'}</div>`
  }
  document.getElementById('week').innerHTML = html

  // 일주일에 3번 이상 힘들다고 했거나 오늘 많이 힘들면 살짝 알려줌
  const hard = mine.filter(m => m.mood >= 4).length
  document.getElementById('careBox').hidden = !(hard >= 3 || (todayMood && todayMood.mood === 5))
}

async function pickMood(v) {
  if (!me) {
    alert('위에서 반 먼저 골라줘!')
    return
  }
  try {
    await api('/api/moods', { body: { id: me.id, cls: me.cls, mood: v } })
    renderMoods()
  } catch (e) {
    alert('저장이 안 됐어. 잠시 후에 다시 눌러줘')
  }
}

// ---------- 말 점검 ----------
// 일부러 서버로 안 보냄. 보내기 전 말은 저장할 이유가 없어서
function checkMsg(text) {
  const flat = text.replace(/\s/g, '')
  const found = BAD_WORDS.filter(b => flat.includes(b.word.replace(/\s/g, '')))
  let score = found.reduce((sum, b) => sum + b.level, 0)
  const tips = []

  if (found.length && /[ㅋㅎ]{2,}/.test(text)) {
    tips.push('ㅋㅋ 붙이면 장난 같아도, 받는 사람은 하나도 안 웃길 수 있어.')
  }
  if (/[!?]{3,}/.test(text)) {
    tips.push('느낌표나 물음표가 많으면 화난 걸로 보일 수 있어.')
    score += 1
  }
  if (found.length && /@\S+/.test(text)) {
    tips.push('단톡방에서 콕 집어서(@) 이런 말 하면 다른 애들도 다 보게 돼.')
    score += 1
  }
  return { found, score, tips }
}

document.getElementById('btnCheck').onclick = () => {
  const text = document.getElementById('msgInput').value.trim()
  const box = document.getElementById('checkResult')
  if (!text) {
    box.hidden = true
    return
  }

  const r = checkMsg(text)
  let shown = esc(text)
  r.found.forEach(b => {
    shown = shown.split(esc(b.word)).join(`<mark>${esc(b.word)}</mark>`)
  })

  let title, cls
  if (r.score === 0) {
    title = '괜찮아 보여!'
    cls = 'ok'
  } else if (r.score <= 2) {
    title = '한 번만 더 읽어볼래?'
    cls = 'soso'
  } else {
    title = '이건 안 보내는 게 좋겠어'
    cls = 'bad'
  }

  let html = `<h3 class="res ${cls}">${title}</h3>
    <p class="hint">친구한테 이렇게 왔다고 생각해봐</p>
    <div class="bubble">${shown}</div>`

  if (r.found.length) {
    html += '<ul class="alts">'
    r.found.forEach(b => {
      html += `<li><b>${esc(b.word)}</b> → ${b.alt ? '"' + esc(b.alt) + '" 은 어때?' : '이 말은 그냥 빼는 게 좋아'}</li>`
    })
    html += '</ul>'
  }
  r.tips.forEach(t => {
    html += `<p class="tip">${t}</p>`
  })
  if (r.score === 0) {
    html += '<p class="tip">그래도 화난 상태면 10분만 있다가 보내는 것도 방법이야.</p>'
  }

  box.innerHTML = html
  box.hidden = false
}

// ---------- 도움 요청 ----------
document.getElementById('typeChips').innerHTML = TYPES.map(t =>
  `<label><input type="radio" name="type" value="${t}">${t}</label>`
).join('')

const nameWrap = document.getElementById('nameWrap')
document.querySelectorAll('input[name=want]').forEach(r => {
  r.addEventListener('change', () => {
    nameWrap.hidden = r.value !== 'meet'
  })
})

document.getElementById('helpForm').onsubmit = async e => {
  e.preventDefault()
  if (!me) {
    alert('홈에서 반 먼저 골라줘!')
    go('home')
    return
  }

  const type = document.querySelector('input[name=type]:checked')
  const text = document.getElementById('helpText').value.trim()
  const want = document.querySelector('input[name=want]:checked').value

  if (!type) return alert('어떤 일인지 하나만 골라줘')
  if (text.length < 5) return alert('조금만 더 적어줄래?')

  const btn = e.target.querySelector('button[type=submit]')
  btn.disabled = true
  try {
    const res = await api('/api/requests', {
      body: {
        cls: me.cls,
        type: type.value,
        text,
        want,
        name: document.getElementById('helpName').value,
      },
    })
    me.codes.push(res.code)
    saveMe()

    e.target.reset()
    nameWrap.hidden = true

    const done = document.getElementById('helpDone')
    done.innerHTML = `<p>잘 보냈어. 말해줘서 고마워.</p>
      <p class="code">${res.code}</p>
      <p class="hint">접수번호야. 이걸로 답장 확인할 수 있어. 캡처해두면 편해.</p>`
    done.hidden = false
    renderMyCodes()
  } catch (err) {
    alert(err.message)
  }
  btn.disabled = false
}

function renderMyCodes() {
  const box = document.getElementById('myCodes')
  if (!me || !me.codes.length) {
    box.innerHTML = ''
    return
  }
  box.innerHTML = '<span class="hint">내가 보낸 거:</span>' +
    me.codes.slice().reverse().map(c => `<button data-code="${c}">${c}</button>`).join('')
  box.querySelectorAll('button').forEach(b => {
    b.onclick = () => showReq(b.dataset.code)
  })
}

async function showReq(code) {
  const out = document.getElementById('findResult')
  code = code.trim().toUpperCase()
  if (!code) return

  try {
    const r = await api('/api/requests/' + encodeURIComponent(code))
    out.innerHTML = `<div class="req-view">
      <p><span class="tag">${STATUS[r.status]}</span> <span class="hint">${r.code} · ${fmtDate(r.at)}</span></p>
      <p class="mine">${esc(r.text)}</p>
      ${r.reply
        ? `<p class="reply"><b>선생님</b><br>${esc(r.reply)}</p>`
        : '<p class="hint">아직 답장이 없어. 선생님이 확인하면 꼭 답해줄 거야.</p>'}
    </div>`
  } catch (e) {
    out.innerHTML = '<p class="hint">그 번호는 없어. 다시 확인해줘.</p>'
  }
}

document.getElementById('btnFind').onclick = () => {
  showReq(document.getElementById('codeInput').value)
}

// ---------- 봤을 때 ----------
document.getElementById('guideList').innerHTML = GUIDE.map((g, i) => `
  <details ${i === 0 ? 'open' : ''}>
    <summary>${g.title}</summary>
    <ol>${g.items.map(t => `<li>${t}</li>`).join('')}</ol>
  </details>`).join('')

renderHome()
renderMyCodes()
