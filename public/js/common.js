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

function fmtDate(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

function moodOf(v) {
  return MOODS.find(m => m.v === v)
}
