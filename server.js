const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = process.env.PORT || 3000
const PIN = process.env.TEACHER_PIN || '1234'
const DB_FILE = path.join(__dirname, 'data', 'db.json')

const TYPES = ['따돌림', '놀림/욕설', '단톡방·SNS', '친구 관계 고민', '기타']
const WANTS = ['listen', 'advice', 'meet']

// ---------- 저장 (DB 깔 시간 없어서 json 파일로) ----------
let db = { moods: [], reqs: [] }

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  } catch (e) {
    // 파일 없으면 새로 시작
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
    saveDb()
  }
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

function today(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 헷갈리는 글자(0,O,1,I)는 뺌
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = ''
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  } while (db.reqs.some(r => r.code === code))
  return code
}

function okCls(cls) {
  return typeof cls === 'string' && /^[1-3]-([1-9]|1[0-5])$/.test(cls)
}

loadDb()

const app = express()
app.use(express.json({ limit: '20kb' }))
app.use(express.static(path.join(__dirname, 'public')))

// ---------- 학생 ----------

// 오늘 기분 기록 (하루에 하나, 다시 누르면 바뀜)
app.post('/api/moods', (req, res) => {
  const { id, cls, mood } = req.body
  if (!id || !okCls(cls) || ![1, 2, 3, 4, 5].includes(mood)) {
    return res.status(400).json({ error: '값이 이상해요' })
  }
  db.moods = db.moods.filter(m => !(m.id === id && m.date === today()))
  db.moods.push({ id: String(id).slice(0, 40), cls, date: today(), mood })
  saveDb()
  res.json({ ok: true })
})

// 내 최근 7일
app.get('/api/moods/mine', (req, res) => {
  const from = today(6)
  const list = db.moods
    .filter(m => m.id === req.query.id && m.date >= from)
    .map(m => ({ date: m.date, mood: m.mood }))
  res.json(list)
})

// 도움 요청 보내기
app.post('/api/requests', (req, res) => {
  const { cls, type, text, want, name } = req.body
  if (!okCls(cls) || !TYPES.includes(type) || !WANTS.includes(want)) {
    return res.status(400).json({ error: '빠진 게 있어요' })
  }
  if (typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: '내용을 조금만 더 적어줘' })
  }

  const r = {
    code: makeCode(),
    cls,
    type,
    text: text.trim().slice(0, 1000),
    want,
    // 직접 도와달라고 한 경우에만 이름 받음
    name: want === 'meet' && typeof name === 'string' ? name.trim().slice(0, 20) : '',
    status: 'new',
    reply: '',
    at: Date.now(),
  }
  db.reqs.push(r)
  saveDb()
  res.json({ code: r.code })
})

// 접수번호로 답장 확인. 이름은 안 돌려줌
app.get('/api/requests/:code', (req, res) => {
  const r = db.reqs.find(x => x.code === req.params.code.toUpperCase())
  if (!r) return res.status(404).json({ error: '없는 번호' })
  res.json({ code: r.code, text: r.text, status: r.status, reply: r.reply, at: r.at })
})

// ---------- 선생님 ----------
// 토큰은 그냥 메모리에. 서버 껐다 켜면 다시 로그인하면 됨
const tokens = new Set()

app.post('/api/teacher/login', (req, res) => {
  if (req.body.pin !== PIN) return res.status(401).json({ error: 'PIN이 틀렸어요' })
  const t = crypto.randomBytes(16).toString('hex')
  tokens.add(t)
  res.json({ token: t })
})

function needLogin(req, res, next) {
  if (!tokens.has(req.get('x-token'))) return res.status(401).json({ error: '로그인 필요' })
  next()
}

// 반 기분 통계. 누가 뭘 눌렀는지는 안 보냄 (숫자만)
app.get('/api/teacher/moods', needLogin, (req, res) => {
  const cls = req.query.cls
  const from = today(6)
  const list = db.moods.filter(m => m.date >= from && (!cls || m.cls === cls))

  const counts = [0, 0, 0, 0, 0]
  list.forEach(m => counts[m.mood - 1]++)

  // 날짜별 힘듦 비율
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = today(i)
    const ofDay = list.filter(m => m.date === d)
    const hard = ofDay.filter(m => m.mood >= 4).length
    days.push({ date: d, total: ofDay.length, hard })
  }

  res.json({ total: list.length, counts, days })
})

app.get('/api/teacher/requests', needLogin, (req, res) => {
  const cls = req.query.cls
  const list = db.reqs.filter(r => !cls || r.cls === cls).sort((a, b) => b.at - a.at)
  res.json(list)
})

app.post('/api/teacher/requests/:code/reply', needLogin, (req, res) => {
  const r = db.reqs.find(x => x.code === req.params.code)
  const reply = (req.body.reply || '').trim()
  if (!r) return res.status(404).json({ error: '없는 번호' })
  if (!reply) return res.status(400).json({ error: '답장이 비었어요' })
  r.reply = reply.slice(0, 1000)
  r.status = 'replied'
  saveDb()
  res.json({ ok: true })
})

app.post('/api/teacher/requests/:code/done', needLogin, (req, res) => {
  const r = db.reqs.find(x => x.code === req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  r.status = 'done'
  saveDb()
  res.json({ ok: true })
})

// 시연용 가짜 데이터
const SAMPLE_REQS = [
  {
    type: '단톡방·SNS',
    want: 'advice',
    name: '',
    text: '반 단톡방에서 제가 말하면 아무도 대답을 안 하고 바로 딴 얘기를 해요. 처음엔 우연인 줄 알았는데 일주일째 계속 그래요. 제가 예민한 건지 모르겠어요.',
  },
  {
    type: '놀림/욕설',
    want: 'meet',
    name: '김민수',
    text: '체육 시간마다 뒤에서 제 별명 부르면서 웃어요. 하지 말라고 했는데 장난인데 왜 정색하냐고 해요.',
  },
  {
    type: '친구 관계 고민',
    want: 'listen',
    name: '',
    text: '제일 친한 친구랑 싸웠는데 화해하고 싶은데 먼저 말 걸기가 너무 어려워요. 그냥 어디에라도 털어놓고 싶었어요.',
  },
]

app.post('/api/teacher/seed', needLogin, (req, res) => {
  const cls = okCls(req.body.cls) ? req.body.cls : '2-3'

  // 두 번 눌러도 안 겹치게 예전 시연 데이터는 지우고
  db.moods = db.moods.filter(m => !(m.cls === cls && m.id.startsWith('demo')))
  for (let s = 0; s < 25; s++) {
    for (let i = 0; i < 7; i++) {
      if (Math.random() < 0.2) continue // 안 누른 날도 있게
      let mood = Math.ceil(Math.random() * 3)
      if (Math.random() < 0.15) mood = 4
      if (s === 7 && i < 4) mood = 5 // 한 명은 요즘 계속 힘든 걸로
      db.moods.push({ id: 'demo' + s, cls, date: today(i), mood })
    }
  }

  SAMPLE_REQS.forEach((r, i) => {
    db.reqs.push({
      ...r,
      code: makeCode(),
      cls,
      status: 'new',
      reply: '',
      at: Date.now() - (i + 1) * 5 * 60 * 60 * 1000,
    })
  })

  saveDb()
  res.json({ ok: true })
})

app.post('/api/teacher/clear', needLogin, (req, res) => {
  db = { moods: [], reqs: [] }
  saveDb()
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`쉼표 서버 켜짐 → http://localhost:${PORT}`)
  console.log(`선생님 화면 → http://localhost:${PORT}/teacher.html (PIN: ${PIN})`)
})
