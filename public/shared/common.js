// 학생/선생님 화면 둘 다 쓰는 함수들

async function api(url, opt = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = sessionStorage.getItem('shimpyo_token')
  if (token) headers['x-token'] = token

  let res
  try {
    res = await fetch(url, {
      method: opt.body ? 'POST' : 'GET',
      ...opt,
      headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    })
  } catch (e) {
    // 인터넷 끊기면 fetch 자체가 터짐
    showOffline(true)
    const err = new Error('인터넷 연결이 끊겼어요. 연결되면 다시 해주세요.')
    err.offline = true
    throw err
  }
  showOffline(false)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || '서버 오류')
    err.status = res.status
    throw err
  }
  return data
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function dayName(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()]
}

function fmtDate(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

function timeAgo(ts) {
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return '방금'
  if (min < 60) return min + '분 전'
  if (min < 60 * 24) return Math.floor(min / 60) + '시간 전'
  return Math.floor(min / 60 / 24) + '일 전'
}

function moodOf(v) {
  return MOODS.find(m => m.v === v)
}

// 기분 얼굴 그림. 입 모양만 바꿈
const MOUTHS = {
  1: 'M7.5 13.5 Q12 18.5 16.5 13.5',
  2: 'M8.5 14.5 Q12 17 15.5 14.5',
  3: 'M8.5 15.2 L15.5 15.2',
  4: 'M8.5 16.5 Q12 14 15.5 16.5',
  5: 'M8 17 Q12 13 16 17',
}

function face(v, size = 40) {
  const m = moodOf(v)
  const tear = v === 5 ? `<path d="M16.6 10.6 q.9 1.4 0 2.1 q-.9-.7 0-2.1z" fill="#cfe6ff" stroke="none"/>` : ''
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.6" fill="${m.color}" stroke="#26302b" stroke-width="1.5"/>
    <g fill="${m.ink}"><circle cx="8.6" cy="9.6" r="1.25"/><circle cx="15.4" cy="9.6" r="1.25"/></g>
    <path d="${MOUTHS[v]}" fill="none" stroke="${m.ink}" stroke-width="1.6" stroke-linecap="round"/>
    ${tear}
  </svg>`
}

// 아이콘 (svg sprite에 있는 거)
function icon(name, size = 20) {
  return `<svg class="ic" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`
}

// 아래에 잠깐 뜨는 알림
function toast(msg) {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.remove('show'), 2200)
}

// ---------- 앱으로 설치 (PWA) ----------
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// 위에 "인터넷 끊김" 줄
// navigator.onLine은 와이파이만 잡혀 있어도 true라서 서버 요청 실패할 때도 띄움
let offlineTimer = null

function showOffline(on) {
  const bar = document.getElementById('offlineBar')
  if (!bar) return false
  const was = !bar.hidden
  bar.hidden = !on

  // 끊긴 동안 5초마다 서버 살아났나 확인
  if (on && !offlineTimer) {
    offlineTimer = setInterval(async () => {
      try {
        const r = await fetch('/api/ping', { cache: 'no-store' })
        if (r.ok) window.dispatchEvent(new Event('online'))
      } catch (e) {}
    }, 5000)
  }
  if (!on && offlineTimer) {
    clearInterval(offlineTimer)
    offlineTimer = null
  }
  return was
}

// 서비스 워커 등록 + 인터넷 끊기면 위에 표시
function setupPwa(app, onlineMsg) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js?app=' + app).catch(e => console.log('서비스 워커 등록 실패', e))
    })
  }

  window.addEventListener('offline', () => showOffline(true))
  window.addEventListener('online', () => {
    if (showOffline(false)) toast(onlineMsg)
  })
  if (!navigator.onLine) showOffline(true)
}

// 설치 버튼
// 안드로이드 크롬은 beforeinstallprompt 이벤트로 바로 설치창 띄울 수 있고
// 아이폰 사파리는 그런 게 없어서 "공유 → 홈 화면에 추가" 안내만 함
function setupInstall(o) {
  const box = document.getElementById(o.box)
  const btn = document.getElementById(o.btn)
  if (!box || isStandalone()) return

  try {
    if (localStorage.getItem(o.key) === '1') return
  } catch (e) {}

  let deferred = null
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e
    box.hidden = false
  })

  if (isIOS()) {
    const msg = o.msg && document.getElementById(o.msg)
    if (msg) {
      msg.textContent = o.iosMsg
      btn.hidden = true
    }
    box.hidden = false
  }

  btn.onclick = async () => {
    if (!deferred) {
      if (isIOS()) alert(o.iosMsg)
      return
    }
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    if (outcome === 'accepted') box.hidden = true
  }

  if (o.close) {
    document.getElementById(o.close).onclick = () => {
      box.hidden = true
      try { localStorage.setItem(o.key, '1') } catch (e) {}
    }
  }

  window.addEventListener('appinstalled', () => { box.hidden = true })
}

// ---------- 답장 칸: Enter = 보내기, Shift+Enter = 줄바꿈 ----------
// 한글은 마지막 글자가 "조합 중"일 때 Enter 누르면 keydown이 isComposing=true(키코드 229)로 와서
// 그냥 두면 브라우저가 줄바꿈을 넣어버림. 그래서
//   1) 조합 중 Enter도 줄바꿈은 막고, 조합 끝나면(compositionend) 보냄
//   2) 폰 키보드는 keydown에 Enter 정보가 없을 때가 있어서 beforeinput(줄바꿈 들어가기 직전)에서도 막음
//   3) 크롬은 조합 끝난 뒤 Enter keydown이 한 번 더 와서, 0.4초 안에 두 번은 안 보냄
function enterToSend(root, selector, send) {
  let shift = false
  let waitCompose = null
  let lastSend = 0

  const fire = ta => {
    if (Date.now() - lastSend < 400) return
    lastSend = Date.now()
    send(ta)
  }
  const isBox = el => el && el.matches && el.matches(selector)

  root.addEventListener('keydown', e => {
    if (!isBox(e.target)) return
    shift = e.shiftKey
    const enter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter'
    if (!enter || e.shiftKey) return
    e.preventDefault()
    if (e.isComposing || e.keyCode === 229) waitCompose = e.target
    else fire(e.target)
  })

  root.addEventListener('beforeinput', e => {
    if (!isBox(e.target)) return
    if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return
    if (shift) return // Shift+Enter는 줄바꿈 그대로
    e.preventDefault()
    if (e.isComposing) waitCompose = e.target
    else fire(e.target)
  })

  root.addEventListener('compositionend', e => {
    if (!waitCompose || e.target !== waitCompose) return
    const ta = waitCompose
    waitCompose = null
    setTimeout(() => fire(ta), 0) // 조합된 글자가 칸에 들어간 다음에
  })

  root.addEventListener('keyup', e => {
    if (e.key === 'Shift') shift = false
  })
}
