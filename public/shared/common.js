// 학생/선생님 화면 둘 다 쓰는 함수들

async function api(url, opt = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = sessionStorage.getItem('shimpyo_token')
  if (token) headers['x-token'] = token

  const res = await fetch(url, {
    method: opt.body ? 'POST' : 'GET',
    ...opt,
    headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  })
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
    <circle cx="12" cy="12" r="11" fill="${m.color}"/>
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
