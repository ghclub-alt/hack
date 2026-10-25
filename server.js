// 쉼표 서버
// 학생 화면이랑 선생님 화면을 아예 다른 포트로 띄움
//   학생   → 3000
//   선생님 → 3001
// 그래야 터널 열 때 주소가 따로 나와서 학생이 선생님 화면 주소를 알 수가 없음

const express = require('express')
const path = require('path')
const fs = require('fs')

// .env 파일 있으면 읽기 (API 키 같은 거. git에는 안 올라감)
const fromEnvFile = new Set()
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && m[2] && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      fromEnvFile.add(m[1])
    }
  })
} catch (e) {}

const ai = require('./ai')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { db, load, save, reset, today, fromMonday, makeCode } = require('./db')
const { TYPES, findDanger, findBad, isQuoted, atTeacherBad } = require('./public/shared/data')

const PORT = Number(process.env.PORT) || 3000
const TEACHER_PORT = Number(process.env.TEACHER_PORT) || 3001
const PIN = process.env.TEACHER_PIN || '1234'

const WANTS = ['listen', 'advice', 'meet']
const HOUR = 60 * 60 * 1000
const WARN_LIMIT = 3 // 경고 이만큼 쌓이면 대화 닫힘

function okCls(cls) {
  return typeof cls === 'string' && /^[1-3]-([1-9]|1[0-5])$/.test(cls)
}

function makeApp(folder) {
  const app = express()
  app.set('trust proxy', true) // codespace/터널 뒤에서도 학생마다 ip 따로 보이게
  app.use(express.json({ limit: '20kb' }))
  // 인터넷 다시 연결됐나 확인용 (로그인 필요 없음)
  app.get('/api/ping', (req, res) => res.json({ ok: true }))
  // 이 주소가 학생 건지 선생님 건지 (터널 주소 확인용)
  app.get('/api/app', (req, res) => res.json({ app: folder }))
  // 서비스 워커는 맨 위 주소에 있어야 전체 화면을 맡을 수 있음
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache')
    res.sendFile(path.join(__dirname, 'public/shared/sw.js'))
  })
  app.use('/shared', express.static(path.join(__dirname, 'public/shared')))
  app.use(express.static(path.join(__dirname, 'public', folder)))
  return app
}

load()

// 예전 데이터(답장 하나짜리)를 대화 형식으로 바꿈
function migrate(r) {
  if (!r.messages) {
    r.messages = [{ from: 'student', text: r.text, at: r.at, bad: findBad(r.text) }]
    if (r.reply) r.messages.push({ from: 'teacher', text: r.reply, at: r.repliedAt || r.at })
  }
  if (r.warnings == null) r.warnings = 0
  if (r.locked == null) r.locked = false
}
db.reqs.forEach(migrate)

function findReq(code) {
  return db.reqs.find(x => x.code === String(code).toUpperCase())
}

function addDanger(r, text) {
  r.danger = [...new Set([...(r.danger || []), ...findDanger(text)])]
}

// 학생한테 보낼 때는 이름 빼고
function forStudent(r) {
  return {
    code: r.code,
    type: r.type,
    status: r.status,
    at: r.at,
    warnings: r.warnings,
    locked: r.locked,
    messages: r.messages.map(m => ({ from: m.from, text: m.text, at: m.at, kind: m.kind || '', auto: !!m.auto })),
  }
}

// ---------- 실시간 (새로고침 안 해도 바로 뜨게) ----------
// 웹소켓까지는 필요 없어서 SSE(서버 → 화면 한쪽 방향)로 함
// 뭔가 바뀌면 "바뀌었다"만 알려주고, 화면이 다시 받아감
const bus = new EventEmitter()
bus.setMaxListeners(0)

function changed(r) {
  bus.emit('req', { code: r.code, cls: r.cls })
}

function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write('retry: 3000\n\n')
  // 중간에 프록시가 끊지 않게 20초마다 빈 신호
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  req.on('close', () => clearInterval(ping))
}

function push(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

// 메시지 판단: ChatGPT 키 있으면 AI가, 없으면(또는 실패하면) 단어 목록으로
async function review(text) {
  const v = await ai.judge(text)
  if (v) return { by: 'ai', ...v }
  return reviewWords(text)
}

function reviewWords(text) {
  return {
    by: 'words',
    insultTeacher: atTeacherBad(text).length > 0,
    profanity: findBad(text).length > 0,
    quoted: isQuoted(text),
    situation: false, // 단어 목록으로는 구분 못 함
    danger: findDanger(text).length > 0,
    prank: false,
    reason: '',
  }
}

// 메시지에 붙여둘 판단 결과 (선생님 화면에 보여줌)
function checkOf(v) {
  return { by: v.by, insult: v.insultTeacher, danger: v.danger, prank: v.prank, reason: v.reason }
}

// AI가 욕 아니라고 하면 단어 목록에 걸린 것도 빼줌 ("죽어라 공부" 같은 거)
function badOf(text, v) {
  return v.by === 'ai' && !v.profanity ? [] : findBad(text)
}

// 바로 경고 줄지
// - 처음 보내는 사연(상황 설명)은 욕이 섞여도 경고 안 함. 선생님한테 욕한 것만
// - 대화는 학생이 직접 쓴 욕이면 경고. 누가 한 말 옮긴 거나 있었던 일 설명하다 나온 건 빼고
function shouldWarn(v, story = false) {
  if (v.insultTeacher) return true
  if (story) return false
  return v.profanity && !v.quoted && !v.situation
}

// 욕 쓰면 자동 경고
function autoWarn(r, v) {
  r.warnings += 1
  const n = r.warnings
  const what = v.insultTeacher ? '선생님한테 욕을' : '욕을'
  const text = n >= WARN_LIMIT
    ? `${what} 써서 자동으로 경고가 쌓였어요. 경고가 ${WARN_LIMIT}번이라 이 대화는 닫혔어요.`
    : `${what} 쓰면 안 돼요. 자동으로 경고가 1번 쌓였어요. (경고 ${n}/${WARN_LIMIT} · ${WARN_LIMIT}번이면 이 대화는 닫혀요)`
  // 학생 메시지 바로 뒤에 오게 1ms 뒤로
  r.messages.push({ from: 'teacher', kind: 'warn', auto: v.insultTeacher ? 'teacher' : 'swear', text, at: Date.now() + 1 })
  if (n >= WARN_LIMIT) {
    r.locked = true
    r.status = 'done'
  }
}

// ======================= 학생 =======================
const student = makeApp('student')

// 오늘 기분 기록 (하루에 하나, 다시 누르면 바뀜)
student.post('/api/moods', (req, res) => {
  const { id, cls, mood } = req.body
  if (!id || !okCls(cls) || ![1, 2, 3, 4, 5].includes(mood)) {
    return res.status(400).json({ error: '값이 이상해요' })
  }
  db.moods = db.moods.filter(m => !(m.id === id && m.date === today()))
  db.moods.push({ id: String(id).slice(0, 40), cls, date: today(), mood })
  save()
  bus.emit('mood', { cls })
  res.json({ ok: true })
})

// 내 최근 7일
student.get('/api/moods/mine', (req, res) => {
  const from = today(6)
  const list = db.moods
    .filter(m => m.id === req.query.id && m.date >= from)
    .map(m => ({ date: m.date, mood: m.mood }))
  res.json(list)
})

// 도움 요청 보내기
student.post('/api/requests', async (req, res) => {
  const { cls, type, text, want, name } = req.body
  if (!okCls(cls) || !TYPES.includes(type) || !WANTS.includes(want)) {
    return res.status(400).json({ error: '빠진 게 있어요' })
  }
  if (typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: '내용을 조금만 더 적어줘' })
  }

  const body = text.trim().slice(0, 1000)
  const v = await review(body)
  const now = Date.now()
  const r = {
    code: makeCode(),
    cls,
    type,
    text: body,
    want,
    // 직접 도와달라고 한 경우에만 이름 받음
    name: want === 'meet' && typeof name === 'string' ? name.trim().slice(0, 20) : '',
    danger: findDanger(body),
    messages: [{ from: 'student', text: body, at: now, bad: badOf(body, v), check: checkOf(v) }],
    aiDanger: v.by === 'ai' && v.danger ? (v.reason || 'AI가 위험 신호를 찾았어요') : '',
    warnings: 0,
    locked: false,
    status: 'new',
    reply: '',
    at: now,
  }
  const warned = shouldWarn(v, true)
  if (warned) autoWarn(r, v)
  db.reqs.push(r)
  save()
  changed(r)
  res.json({ code: r.code, danger: r.danger.length > 0 || !!r.aiDanger, warned })
})

// 접수번호로 대화 보기. 이름은 안 돌려줌
student.get('/api/requests/:code', (req, res) => {
  const r = findReq(req.params.code)
  // 학생이 지운 건 학생 쪽에서는 없는 걸로 (번호 아는 다른 사람이 못 보게)
  if (!r || r.studentDeleted) return res.status(404).json({ error: '없는 번호' })
  res.json(forStudent(r))
})

// 학생이 대화 이어가기
student.post('/api/requests/:code/messages', async (req, res) => {
  const r = findReq(req.params.code)
  if (!r || r.studentDeleted) return res.status(404).json({ error: '없는 번호' })
  if (r.locked) return res.status(403).json({ error: '선생님이 이 대화를 닫았어. 필요하면 새로 이야기를 보내줘.' })

  const text = String(req.body.text || '').trim().slice(0, 500)
  if (!text) return res.status(400).json({ error: '내용이 비었어' })

  // 장난으로 막 보내는 거 막기
  const last = r.messages[r.messages.length - 1]
  if (last.from === 'student' && Date.now() - last.at < 3000) {
    return res.status(429).json({ error: '조금만 천천히 보내줘' })
  }
  if (r.messages.length >= 200) return res.status(400).json({ error: '대화가 너무 길어졌어. 새로 이야기를 보내줘.' })

  // AI 기다리는 동안 또 보내면 안 되니까 먼저 넣어두고 판단은 나중에 붙임
  const m = { from: 'student', text, at: Date.now(), bad: findBad(text) }
  r.messages.push(m)
  r.status = 'new' // 선생님이 다시 봐야 함

  const v = await review(text)
  m.bad = badOf(text, v)
  m.check = checkOf(v)
  addDanger(r, text)
  if (v.by === 'ai' && v.danger) r.aiDanger = v.reason || 'AI가 위험 신호를 찾았어요'
  const warned = shouldWarn(v) && !r.locked
  if (warned) autoWarn(r, v)
  save()
  changed(r)
  res.json({ ...forStudent(r), warned, danger: findDanger(text).length > 0 || (v.by === 'ai' && v.danger) })
})

// 한 사람이 AI 너무 많이 못 쓰게 (1분에 20번, 돈 나가니까)
const checkHits = new Map()
function tooMany(req) {
  const now = Date.now()
  const hits = (checkHits.get(req.ip) || []).filter(t => now - t < 60000)
  if (hits.length >= 20) return true
  hits.push(now)
  checkHits.set(req.ip, hits)
  return false
}

// 도움 요청/답장 보내기 전에 검수 (AI 있으면 AI, 없으면 단어 목록). 저장 안 함
// 같은 글로 보내면 AI 결과 캐시돼 있어서 두 번 돈 안 나감
student.post('/api/review', async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 1000)
  if (!text) return res.status(400).json({ error: '내용이 비었어' })
  const useAi = ai.enabled() && !tooMany(req)
  const v = useAi ? await review(text) : await reviewWords(text)
  res.json({ ...v, words: badOf(text, v), warn: shouldWarn(v, req.body.story === true) })
})

// 말 점검을 ChatGPT로 (키 있을 때만). 저장은 안 하고 결과만 돌려줌
student.post('/api/check', async (req, res) => {
  if (!ai.enabled()) return res.status(404).json({ error: 'AI 꺼져 있음' })
  const text = String(req.body.text || '').trim().slice(0, 500)
  if (!text) return res.status(400).json({ error: '내용이 비었어' })
  if (tooMany(req)) return res.status(429).json({ error: '잠깐 쉬었다가 해줘' })

  const c = await ai.coach(text)
  if (!c) return res.status(503).json({ error: 'AI가 지금 대답을 안 해' })
  res.json(c)
})

// AI 판단 켜져 있는지 (학생 화면에 안내하려고)
student.get('/api/config', (req, res) => {
  res.json({ ai: ai.enabled() })
})

// 내 이야기에 뭐 바뀌면 바로 알려주기 (접수번호 아는 것만)
student.get('/api/events', (req, res) => {
  const codes = String(req.query.codes || '').toUpperCase().split(',')
    .filter(c => /^[A-Z0-9]{4}$/.test(c)).slice(0, 30)
  openStream(req, res)
  const onReq = e => { if (codes.includes(e.code)) push(res, 'req', { code: e.code }) }
  const onAll = () => push(res, 'all', {})
  bus.on('req', onReq)
  bus.on('all', onAll)
  req.on('close', () => {
    bus.off('req', onReq)
    bus.off('all', onAll)
  })
})

// ======================= 선생님 =======================
const teacher = makeApp('teacher')

// 토큰은 그냥 메모리에. 서버 껐다 켜면 다시 로그인하면 됨
const tokens = new Set()

// 선생님 주소가 공개일 수도 있어서 PIN 막 찍어보기 막기 (10분에 5번 틀리면 잠깐 막음)
const loginFails = new Map()
teacher.post('/api/login', (req, res) => {
  const now = Date.now()
  const fails = (loginFails.get(req.ip) || []).filter(t => now - t < 10 * 60000)
  if (fails.length >= 5) return res.status(429).json({ error: 'PIN을 너무 많이 틀렸어요. 10분 뒤에 다시 해주세요.' })
  if (req.body.pin !== PIN) {
    fails.push(now)
    loginFails.set(req.ip, fails)
    return res.status(401).json({ error: 'PIN이 틀렸어요' })
  }
  loginFails.delete(req.ip)
  const t = crypto.randomBytes(16).toString('hex')
  tokens.add(t)
  res.json({ token: t })
})

teacher.use('/api', (req, res, next) => {
  // EventSource(실시간)는 헤더를 못 붙여서 ?token= 으로도 받음
  const t = req.get('x-token') || req.query.token
  if (!tokens.has(t)) return res.status(401).json({ error: '로그인 필요' })
  next()
})

// 이번 주 = 월요일부터 오늘까지
function weekMoods(cls) {
  const from = today(fromMonday())
  const to = today()
  return db.moods.filter(m => m.date >= from && m.date <= to && (!cls || m.cls === cls))
}

function reqsOf(cls) {
  return db.reqs.filter(r => !cls || r.cls === cls)
}

// 반 기분 통계. 누가 뭘 눌렀는지는 안 보냄 (숫자만)
teacher.get('/api/moods', (req, res) => {
  const list = weekMoods(req.query.cls)
  const counts = [0, 0, 0, 0, 0]
  list.forEach(m => counts[m.mood - 1]++)

  const days = []
  // 월 화 수 목 금 토 일. 아직 안 온 날은 future
  const mo = fromMonday()
  for (let i = 0; i < 7; i++) {
    const d = today(mo - i)
    const c = [0, 0, 0, 0, 0]
    list.filter(m => m.date === d).forEach(m => c[m.mood - 1]++)
    days.push({ date: d, counts: c, future: i > mo })
  }
  res.json({ total: list.length, counts, days })
})

// 경고 모음. 위에서부터 급한 순
teacher.get('/api/alerts', (req, res) => {
  const cls = req.query.cls
  const now = Date.now()
  const alerts = []

  // 1. 위험한 단어가 들어간 요청 (또는 AI가 위험하다고 본 거)
  reqsOf(cls)
    .filter(r => ((r.danger && r.danger.length) || r.aiDanger) && r.status !== 'done')
    .forEach(r => {
      alerts.push({
        level: 'red',
        title: '위험 신호가 있는 요청',
        msg: r.danger && r.danger.length
          ? `${r.cls}반 요청에 "${r.danger.slice(0, 2).join('", "')}" 같은 말이 있어요. 바로 확인해 주세요.`
          : `${r.cls}반 요청 · AI: ${r.aiDanger}. 바로 확인해 주세요.`,
        code: r.code,
      })
    })

  // 2. 직접 도와달라고 했는데 12시간 넘게 답장 없음
  reqsOf(cls)
    .filter(r => r.want === 'meet' && r.status === 'new' && now - r.at > 12 * HOUR)
    .forEach(r => {
      alerts.push({
        level: 'orange',
        title: '직접 도움 요청이 기다리는 중',
        msg: `${Math.floor((now - r.at) / HOUR)}시간째 답장이 없어요. 학생이 기다리고 있어요.`,
        code: r.code,
      })
    })

  // 2-1. 마지막 메시지에 욕이 있음 (누가 한 말 옮긴 걸 수도 있어서 노랑)
  reqsOf(cls)
    .filter(r => r.status === 'new' && r.messages)
    .forEach(r => {
      const last = r.messages[r.messages.length - 1]
      if (last.from !== 'student') return
      const bad = last.bad && last.bad.length
      const prank = last.check && last.check.prank
      if (!bad && !prank) return
      const why = last.check && last.check.by === 'ai' && last.check.reason ? ` AI: ${last.check.reason}` : ''
      alerts.push({
        level: 'yellow',
        title: bad ? '욕설이 들어간 메시지' : '장난 같은 메시지',
        msg: bad
          ? `"${last.bad.slice(0, 2).join('", "')}" 같은 말이 있어요. 누가 한 말을 옮긴 건지, 장난인지 확인해 주세요.${why}`
          : `진지한 고민이 아닐 수도 있어요.${why}`,
        code: r.code,
      })
    })

  // 3. 3일 연속 힘들다고 한 학생 수 (누군지는 안 알려줌)
  const hardOn = d => new Set(db.moods.filter(m => m.date === d && m.mood >= 4 && (!cls || m.cls === cls)).map(m => m.id))
  const d0 = hardOn(today(0))
  const d1 = hardOn(today(1))
  const d2 = hardOn(today(2))
  const streak = [...d0].filter(id => d1.has(id) && d2.has(id)).length
  if (streak > 0) {
    alerts.push({
      level: 'orange',
      title: `3일 연속 힘들다고 한 학생 ${streak}명`,
      msg: '누군지는 안 보여요. 조회 시간에 "요즘 힘들면 쉼표로 얘기해도 돼" 한마디 해주세요.',
    })
  }

  // 4. 반 전체 분위기
  const week = weekMoods(cls)
  if (week.length >= 10) {
    const hardPct = Math.round(week.filter(m => m.mood >= 4).length / week.length * 100)
    const todays = week.filter(m => m.date === today())
    const todayPct = todays.length ? Math.round(todays.filter(m => m.mood >= 4).length / todays.length * 100) : 0

    if (todays.length >= 5 && todayPct >= hardPct + 15) {
      alerts.push({
        level: 'yellow',
        title: '오늘 갑자기 힘들다는 응답이 늘었어요',
        msg: `이번 주 평균 ${hardPct}% → 오늘 ${todayPct}%. 반에 무슨 일 있었는지 살펴봐 주세요.`,
      })
    } else if (hardPct >= 30) {
      alerts.push({
        level: 'yellow',
        title: '힘들다는 응답이 많은 한 주',
        msg: `이번 주 ${hardPct}%가 힘들다고 했어요.`,
      })
    }
  }

  // 급한 순서대로
  const order = { red: 0, orange: 1, yellow: 2 }
  alerts.sort((a, b) => order[a.level] - order[b.level])
  res.json(alerts)
})

teacher.get('/api/config', (req, res) => {
  res.json({ ai: ai.enabled(), model: ai.enabled() ? ai.MODEL : '', aiState })
})

// 학생이 뭐 보내거나 기분 누르면 바로 알려주기
teacher.get('/api/events', (req, res) => {
  const cls = req.query.cls || ''
  openStream(req, res)
  const mine = e => !cls || e.cls === cls
  const onReq = e => { if (mine(e)) push(res, 'req', { code: e.code }) }
  const onMood = e => { if (mine(e)) push(res, 'mood', {}) }
  const onAll = () => push(res, 'all', {})
  bus.on('req', onReq)
  bus.on('mood', onMood)
  bus.on('all', onAll)
  req.on('close', () => {
    bus.off('req', onReq)
    bus.off('mood', onMood)
    bus.off('all', onAll)
  })
})

teacher.get('/api/requests', (req, res) => {
  const list = reqsOf(req.query.cls).sort((a, b) => b.at - a.at)
  res.json(list)
})

teacher.post('/api/requests/:code/reply', (req, res) => {
  const r = findReq(req.params.code)
  const reply = String(req.body.reply || '').trim().slice(0, 1000)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  if (!reply) return res.status(400).json({ error: '답장이 비었어요' })
  r.messages.push({ from: 'teacher', text: reply, at: Date.now() })
  r.reply = reply
  r.status = 'replied'
  r.repliedAt = Date.now()
  save()
  changed(r)
  res.json({ ok: true })
})

// 장난이나 욕설이면 경고. 3번 쌓이면 대화 닫음
function warnText(n) {
  if (n >= WARN_LIMIT) {
    return `경고가 ${WARN_LIMIT}번 쌓여서 이 대화는 닫았어요. 진짜 도움이 필요한 일이 생기면 새로 이야기를 보내주세요.`
  }
  return `장난이나 욕설이 담긴 메시지는 보내면 안 돼요. 정말 힘든 일이 있으면 있는 그대로 얘기해줘도 괜찮아요. (경고 ${n}/${WARN_LIMIT} · ${WARN_LIMIT}번이면 이 대화는 닫혀요)`
}

teacher.post('/api/requests/:code/warn', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  if (r.locked) return res.status(400).json({ error: '이미 닫힌 대화예요' })

  r.warnings += 1
  const custom = String(req.body.text || '').trim().slice(0, 300)
  // 선생님이 직접 쓴 말이 있으면 그걸로, 경고 횟수는 뒤에 붙임
  const text = custom ? `${custom} (경고 ${r.warnings}/${WARN_LIMIT})` : warnText(r.warnings)
  r.messages.push({ from: 'teacher', kind: 'warn', text, at: Date.now() })
  r.repliedAt = Date.now()
  if (r.warnings >= WARN_LIMIT) {
    r.locked = true
    r.status = 'done'
  } else {
    r.status = 'replied'
  }
  save()
  changed(r)
  res.json({ ok: true, warnings: r.warnings, locked: r.locked })
})

// 잘못 닫았을 때 다시 열기
teacher.post('/api/requests/:code/unlock', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  r.locked = false
  r.warnings = 0
  r.status = 'replied'
  r.messages.push({ from: 'teacher', kind: 'info', text: '선생님이 대화를 다시 열었어요.', at: Date.now() })
  save()
  changed(r)
  res.json({ ok: true })
})

teacher.post('/api/requests/:code/done', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  r.status = 'done'
  save()
  changed(r)
  res.json({ ok: true })
})

// 선생님은 완전히 지우기 (되돌리기 안 됨)
teacher.post('/api/requests/:code/delete', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  db.reqs = db.reqs.filter(x => x !== r)
  save()
  changed(r) // 학생 화면도 바로 목록에서 빠지게
  res.json({ ok: true })
})

// 시연용 가짜 데이터
const SAMPLE_REQS = [
  {
    hoursAgo: 1,
    type: '놀림/욕설',
    want: 'advice',
    name: '',
    text: '쉬는 시간마다 화장실 앞에서 애들이 돈 빌려달라고 하는데 안 갚아요. 안 주면 때린다고 해서 무서워요.',
  },
  {
    hoursAgo: 4,
    type: '단톡방·SNS',
    want: 'advice',
    name: '',
    text: '반 단톡방에서 제가 말하면 아무도 대답을 안 하고 바로 딴 얘기를 해요. 처음엔 우연인 줄 알았는데 일주일째 계속 그래요. 제가 예민한 건지 모르겠어요.',
    // 대화 이어진 예시 (몇 시간 전에 보냈는지)
    chat: [
      { from: 'teacher', hoursAgo: 3, text: '말해줘서 고마워. 예민한 거 아니야. 일주일이나 그랬으면 많이 신경 쓰였겠다. 혹시 언제부터 그랬는지 기억나?' },
      { from: 'student', hoursAgo: 2, text: '지난주 수행평가 조 짤 때 제가 한 명이랑 좀 싸웠는데 그 뒤로 그런 것 같아요' },
    ],
  },
  {
    hoursAgo: 2,
    type: '기타',
    want: 'listen',
    name: '',
    text: '아 ㅋㅋ 존나 심심하다 선생님 병신 ㅋㅋㅋ',
  },
  {
    hoursAgo: 15,
    type: '놀림/욕설',
    want: 'meet',
    name: '김민수',
    text: '체육 시간마다 뒤에서 제 별명 부르면서 웃어요. 하지 말라고 했는데 장난인데 왜 정색하냐고 해요.',
  },
  {
    hoursAgo: 26,
    type: '친구 관계 고민',
    want: 'listen',
    name: '',
    text: '제일 친한 친구랑 싸웠는데 화해하고 싶은데 먼저 말 걸기가 너무 어려워요. 그냥 어디에라도 털어놓고 싶었어요.',
  },
]

teacher.post('/api/seed', (req, res) => {
  const cls = okCls(req.body.cls) ? req.body.cls : '2-3'

  // 두 번 눌러도 안 겹치게 예전 시연 데이터는 지우고
  db.moods = db.moods.filter(m => !(m.cls === cls && m.id.startsWith('demo')))
  db.reqs = db.reqs.filter(r => !(r.cls === cls && r.demo))

  for (let s = 0; s < 26; s++) {
    for (let i = 0; i < 7; i++) {
      const sad = s === 7 || s === 12 // 이 두 명은 요즘 계속 힘든 걸로
      if (!sad && Math.random() < 0.15) continue // 안 누른 날도 있게
      let mood = Math.ceil(Math.random() * 3)
      if (Math.random() < 0.15) mood = 4
      if (sad && i < 4) mood = 4 + (i % 2)
      db.moods.push({ id: 'demo' + s, cls, date: today(i), mood })
    }
  }

  SAMPLE_REQS.forEach(r => {
    const at = Date.now() - r.hoursAgo * HOUR
    const messages = [{ from: 'student', text: r.text, at, bad: findBad(r.text) }]
    ;(r.chat || []).forEach(c => {
      messages.push({ from: c.from, text: c.text, at: Date.now() - c.hoursAgo * HOUR, bad: c.from === 'student' ? findBad(c.text) : undefined })
    })
    const last = messages[messages.length - 1]
    db.reqs.push({
      type: r.type,
      want: r.want,
      name: r.name,
      text: r.text,
      code: makeCode(),
      cls,
      danger: findDanger(r.text),
      messages,
      warnings: 0,
      locked: false,
      status: last.from === 'teacher' ? 'replied' : 'new',
      reply: '',
      at,
      demo: true,
    })
  })

  save()
  bus.emit('all')
  res.json({ ok: true })
})

teacher.post('/api/clear', (req, res) => {
  reset()
  bus.emit('all')
  res.json({ ok: true })
})

// ======================= 켜기 =======================
// codespace면 포트별 주소 만들어서 보여줌
function urlOf(port) {
  const name = process.env.CODESPACE_NAME
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  if (name && domain) return `https://${name}-${port}.${domain}`
  return `http://localhost:${port}`
}

// 포트 겹치면 영어 에러 말고 뭘 하면 되는지 알려주기
function onListenError(port) {
  return err => {
    if (err.code !== 'EADDRINUSE') throw err
    console.log('')
    console.log(`포트 ${port}번을 벌써 다른 서버가 쓰고 있어요.`)
    console.log('다른 터미널에 npm start 나 npm run share 가 켜져 있으면 거기서 Ctrl+C 로 끄고 다시 해주세요.')
    console.log('(npm start 켜둔 채로 공개 주소만 필요하면 npm run share 해도 돼요. 켜진 서버 그대로 씀)')
    process.exit(1)
  }
}

// codespace면 학생 포트를 공개(Public)로 바꿔서 깃헙 로그인 없이 들어오게
// 주소(https://codespace이름-3000.app.github.dev)는 codespace 안 지우면 계속 똑같음
// 학교/조직 설정 때문에 공개가 막혀 있으면 ngrok으로 (아래 startNgrok)
const { execFile, execFileSync, execSync, spawn } = require('child_process')
const os = require('os')

// 선생님 주소도 밖에서 열지: PIN 바꿨으면 열고, 1234 그대로면 안 엶 (아무나 들어올 수 있으니까)
// TEACHER_PUBLIC=1 이면 무조건 열고, 0이면 무조건 안 엶
const PIN_CHANGED = PIN !== '1234'
const TEACHER_OPEN = process.env.TEACHER_PUBLIC === '1' || (process.env.TEACHER_PUBLIC !== '0' && PIN_CHANGED)

// 선생님 화면을 학생 주소 밑 /teacher/ 에도 붙임
// ngrok 무료는 고정 도메인이 하나뿐이라 이렇게 해야 선생님 주소도 고정됨 (3001은 그대로 따로 열림)
if (TEACHER_OPEN) {
  // /teacher 로 오면 /teacher/ 로 (끝에 / 있어야 상대 경로가 맞음)
  student.use((req, res, next) => {
    if (req.path !== '/teacher') return next()
    res.redirect('/teacher/' + req.originalUrl.slice('/teacher'.length))
  })
  student.use('/teacher', teacher)
}
const teacherPath = url => url + '/teacher/'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 로그인 안 한 사람처럼 주소에 들어가 봄
// open: 잘 들어가짐 / login: 깃헙 로그인 화면으로 보내짐 / unknown: 모르겠음
async function checkOpen(url) {
  let state = 'unknown'
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url + '/api/ping', { redirect: 'manual', headers: { accept: 'application/json' } })
      const loc = r.headers.get('location') || ''
      if (r.status >= 200 && r.status < 300) return 'open'
      if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400 && /login|auth/i.test(loc))) state = 'login'
    } catch (e) {}
    await sleep(3000) // 공개로 바꾼 게 적용되는 데 몇 초 걸릴 때가 있음
  }
  return state
}

function makePublic(tries = 2) {
  const ports = [`${PORT}:public`]
  if (TEACHER_OPEN) ports.push(`${TEACHER_PORT}:public`)

  execFile('gh', ['codespace', 'ports', 'visibility', ...ports, '-c', process.env.CODESPACE_NAME], async (err, stdout, stderr) => {
    if (err && tries > 1) {
      // 포트가 막 열린 참이면 실패할 때가 있어서 한 번 더
      return setTimeout(() => makePublic(tries - 1), 4000)
    }
    const why = err ? (err.code === 'ENOENT' ? 'gh 프로그램이 없어요' : String(stderr || err.message).trim().split('\n')[0]) : ''

    // 진짜 로그인 없이 들어가지는지 확인
    const state = await checkOpen(urlOf(PORT))
    console.log('')
    if (state === 'open') {
      console.log('학생 주소 확인 완료! 깃헙 로그인 없이 들어가져요.')
      console.log('(처음 들어가면 깃헙 안내 화면이 한 번 떠요 → Continue 누르면 됨)')
      showQr('학생 화면 고정 주소 (codespace 안 지우면 안 바뀜)', urlOf(PORT))
      if (TEACHER_OPEN) console.log(`선생님 화면 → ${teacherPath(urlOf(PORT))}  (PIN 있는 사람만 들어갈 수 있어요)`)
      else console.log('선생님 화면은 비공개예요 (PIN이 1234 그대로라서). .env에서 TEACHER_PIN 바꾸면 밖에서도 열려요.')
      console.log('')
      return
    }
    if (state === 'login') {
      console.log('!!! 학생 주소가 아직 깃헙 로그인해야 들어가져요 !!!')
      if (why) console.log(`  (공개로 바꾸기 실패: ${why})`)
      console.log('  학교/동아리 조직 설정이 공개 포트를 막고 있을 수 있어요.')
    } else {
      console.log('학생 주소가 로그인 없이 들어가지는지 확인을 못 했어요. 깃헙 로그인 안 된 폰으로 한 번 열어보세요.')
      if (why) console.log(`  (공개로 바꾸기 실패: ${why})`)
      console.log(`  로그인 화면이 뜨면: 아래 "포트(Ports)" 탭 → ${PORT} 오른쪽 클릭 → Port Visibility → Public`)
    }
    console.log('')
    console.log('그래도 안 되면 ngrok으로 열기 (주소 고정 가능):')
    ngrokHelp()
    showQr('학생 화면 (깃헙 로그인 필요할 수 있음)', urlOf(PORT))
  })
}

function ngrokHelp() {
  console.log('  1. https://dashboard.ngrok.com 가입 → Your Authtoken 복사')
  console.log('  2. 주소 고정하려면 Domains 메뉴에서 무료 도메인 하나 받기 (○○○.ngrok-free.app)')
  console.log('  3. .env 파일에')
  console.log('       NGROK_AUTHTOKEN=복사한토큰')
  console.log('       NGROK_DOMAIN=○○○.ngrok-free.app')
  console.log('  4. Ctrl+C 로 끄고 npm start 다시')
}

function showQr(title, url) {
  console.log('')
  console.log(`=== ${title} ===`)
  require('qrcode-terminal').generate(url, { small: true }, code => console.log(code))
  console.log(' ' + url)
  console.log('')
}

// ---------- ngrok ----------
// NGROK_AUTHTOKEN 있으면 npm start 할 때 같이 켬
// NGROK_DOMAIN(무료 고정 도메인) 있으면 학생 주소는 매번 똑같음
let ngrokProc = null

function hasNgrok() {
  try {
    execSync('command -v ngrok', { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

// ngrok 무료 계정은 도메인이 하나뿐이라 터널은 학생 거 하나만
// (둘 다 열면 같은 주소에 학생/선생님이 겹쳐서 선생님 화면만 뜨는 일이 생김)
// 선생님 화면은 같은 주소 밑 /teacher/ 로 들어감
function startNgrok() {
  if (!hasNgrok()) {
    console.log('')
    console.log('NGROK_AUTHTOKEN은 있는데 ngrok 프로그램이 없어요. 이거 한 번 실행하고 npm start 다시:')
    console.log('  bash scripts/install-tunnel.sh')
    if (process.env.CODESPACE_NAME) makePublic()
    return
  }

  // 전에 켜놓고 안 꺼진 쉼표 ngrok 있으면 끄기 (같은 주소 붙잡고 있으면 새로 못 엶)
  try { execFileSync('pkill', ['-f', 'ngrok start --all --config .*shimpyo-ngrok-']) } catch (e) {}

  const domain = (process.env.NGROK_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  let conf = 'version: "2"\n'
  conf += `authtoken: ${JSON.stringify(process.env.NGROK_AUTHTOKEN)}\n`
  conf += 'tunnels:\n'
  conf += `  student:\n    proto: http\n    addr: ${PORT}\n`
  if (domain) conf += `    domain: ${JSON.stringify(domain)}\n`
  // 토큰 들어 있어서 나만 읽게 만들고, 켜지면 바로 지움
  const file = path.join(os.tmpdir(), `shimpyo-ngrok-${process.pid}.yml`)
  fs.writeFileSync(file, conf, { mode: 0o600 })

  console.log('')
  console.log('ngrok 켜는 중...')
  ngrokProc = spawn('ngrok', ['start', '--all', '--config', file, '--log', 'stdout', '--log-format', 'json'])
  let shown = false
  let buf = ''
  let lastErr = ''
  const timer = setTimeout(() => {
    if (!shown) console.log('ngrok 주소를 못 받았어요' + (lastErr ? `: ${ngrokWhy(lastErr)}` : '. 인터넷 연결 확인해보세요'))
  }, 20000)

  ngrokProc.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    lines.forEach(line => {
      let j
      try { j = JSON.parse(line) } catch (e) { return }
      if (j.lvl === 'eror' || j.lvl === 'crit') lastErr = j.err || j.msg
      if (!shown && j.msg === 'started tunnel' && j.url) {
        shown = true
        clearTimeout(timer)
        fs.rm(file, { force: true }, () => {})
        showNgrok(j.url, domain)
      }
    })
  })
  // 설정 잘못되면 로그 말고 그냥 에러 글자로 나올 때도 있음
  ngrokProc.stderr.on('data', d => {
    const t = String(d).replace(/^ERROR:\s*/gm, '').trim()
    if (t) lastErr = t
  })
  ngrokProc.on('error', e => { lastErr = e.message })
  ngrokProc.on('exit', code => {
    clearTimeout(timer)
    fs.rm(file, { force: true }, () => {})
    if (shown) {
      console.log('ngrok이 꺼졌어요. 학생 주소가 안 열릴 거예요. 서버 다시 켜주세요.')
      return
    }
    console.log('')
    console.log(`ngrok 켜기 실패: ${ngrokWhy(lastErr) || '종료 코드 ' + code}`)
    if (process.env.CODESPACE_NAME) {
      console.log('일단 codespace 주소로 열어볼게요.')
      makePublic()
    }
  })
}

// 자주 나오는 ngrok 에러를 알아듣게
function ngrokWhy(err) {
  if (!err) return ''
  if (/ERR_NGROK_105|ERR_NGROK_107|authtoken/i.test(err)) return 'NGROK_AUTHTOKEN이 틀렸어요. 대시보드에서 다시 복사해주세요'
  if (/ERR_NGROK_108/.test(err)) return '이 ngrok 계정이 벌써 다른 데서 켜져 있어요. 다른 터미널/컴퓨터의 ngrok을 끄고 다시'
  if (/ERR_NGROK_334|already online/i.test(err)) return '이 주소에 벌써 다른 ngrok이 붙어 있어요. 다른 터미널의 ngrok(npm run tunnel:ngrok 등)이나 ngrok 대시보드 Endpoints에서 끄고 다시'
  if (/ERR_NGROK_320[0-9]|domain/i.test(err)) return `NGROK_DOMAIN이 이 계정 도메인이 아니에요. ngrok 대시보드 Domains에 있는 그대로 넣기 (${err.split('\n')[0]})`
  return err.split('\n')[0]
}

// 주소에 들어가 보면 진짜 학생 화면이 나오는지
async function whichApp(url) {
  try {
    const r = await fetch(url + '/api/app', { headers: { 'ngrok-skip-browser-warning': '1', accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    return (await r.json()).app || ''
  } catch (e) {
    return ''
  }
}

async function showNgrok(url, domain) {
  console.log('')
  console.log('ngrok 켜짐! 깃헙 로그인 없이 누구나 들어올 수 있어요.')
  console.log('(처음 들어가면 ngrok 안내 화면이 떠요 → Visit Site 누르면 됨)')
  showQr(domain ? '학생 화면 고정 주소 (ngrok 고정 도메인)' : '학생 화면 (ngrok)', url)

  const app = await whichApp(url)
  if (app === 'teacher') {
    console.log('!!! 이 주소에 선생님 화면이 떠요. 다른 데서 켠 ngrok이 같은 주소를 쓰고 있는 듯 !!!')
    console.log('    ngrok 대시보드 → Endpoints 에서 다른 거 끄고, 다른 터미널의 ngrok도 끈 다음 npm start 다시')
  } else if (app !== 'student') {
    console.log('(학생 화면 확인은 못 했어요. 폰으로 한 번 열어보세요)')
  }

  if (TEACHER_OPEN) {
    console.log(`선생님 화면 → ${teacherPath(url)}  (선생님만! 학생한테 보여주지 말기)`)
  } else {
    console.log('선생님 화면은 밖에서 안 열었어요 (PIN이 1234 그대로라서). .env에서 TEACHER_PIN 바꾸면')
    console.log(`  ${teacherPath(url)} 로 열려요`)
  }
  if (process.env.CODESPACE_NAME) console.log(`  codespace 주인은 여기로도 됨 → ${urlOf(TEACHER_PORT)}`)
  console.log('')
}

process.on('exit', () => { if (ngrokProc) ngrokProc.kill() })
// Ctrl+C로 끌 때도 위에 exit가 불리게
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

// ---------- ChatGPT 키 확인 ----------
let aiState = 'off'

function keySource() {
  if (fromEnvFile.has('OPENAI_API_KEY')) return '.env 파일'
  if (process.env.CODESPACES) return 'codespace 비밀값'
  return '환경변수'
}

async function checkAi() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('ChatGPT → 꺼짐 (OPENAI_API_KEY 없음. 단어 목록으로 판단)')
    if (process.env.CODESPACES) {
      console.log('  codespace 비밀값(Secrets)에 넣었으면 codespace를 한 번 다시 시작해야 들어와요')
    }
    return
  }
  const key = `키 ${ai.maskedKey()} (${keySource()})`
  console.log(`ChatGPT → 키 확인 중... ${key}`)
  const v = await ai.verify()
  aiState = v.state
  const msg = {
    ok: `ChatGPT → 켜짐! (${ai.MODEL}) 말 점검이랑 메시지 판단에 써요`,
    'bad-key': 'ChatGPT → 키가 틀렸어요 (401). 키 다시 복사해서 넣어주세요',
    'no-model': `ChatGPT → ${ai.MODEL} 모델을 이 키로 못 써요. OPENAI_MODEL 바꿔보기`,
    quota: 'ChatGPT → 키는 맞는데 크레딧(돈)이 없어요. OpenAI 결제 확인',
    busy: 'ChatGPT → 지금 요청이 많대요 (429). 일단 켜두고 안 되면 단어 목록으로',
    unreachable: `ChatGPT → OpenAI에 연결이 안 돼요 (${v.detail}). 일단 켜두고 안 되면 단어 목록으로`,
    error: `ChatGPT → 확인 실패 (${v.status}). 일단 켜두고 안 되면 단어 목록으로`,
  }[v.state]
  console.log(msg)
  if (!ai.enabled()) console.log('  → 지금은 단어 목록으로 판단해요. 고치고 서버 다시 켜기')
}

// API 키가 실수로 깃헙에 올라갔는지 확인
function checkKeyLeak() {
  execFile('git', ['ls-files', '--error-unmatch', '.env'], { cwd: __dirname }, err => {
    if (!err) {
      console.log('')
      console.log('!!! .env 파일이 git에 올라가 있어요. API 키가 깃헙에 공개될 수 있어요 !!!')
      console.log('    git rm --cached .env 하고 커밋, 그리고 OpenAI에서 키 새로 만들기')
    }
  })
  execFile('git', ['grep', '-l', '-E', 'sk-[A-Za-z0-9_-]{20,}', '--', '.', ':!.env.example'], { cwd: __dirname }, (err, out) => {
    const files = String(out || '').trim()
    if (files) {
      console.log('')
      console.log(`!!! API 키처럼 생긴 게 코드에 들어 있어요: ${files.split('\n').join(', ')}`)
      console.log('    깃헙에 올리기 전에 지우고, 이미 올렸으면 OpenAI에서 키 새로 만들기')
    }
  })
}

let opened = 0
function onOpen() {
  opened += 1
  if (opened < 2) return
  if (process.env.SHIMPYO_SHARE) return // npm run share가 따로 주소 만듦
  if (process.env.NGROK_AUTHTOKEN) startNgrok()
  else if (process.env.CODESPACE_NAME) setTimeout(makePublic, 2000) // 포트 연결될 시간 조금 주고
}

student.listen(PORT, () => {
  console.log(`학생 화면   → ${urlOf(PORT)}`)
  onOpen()
}).on('error', onListenError(PORT))

teacher.listen(TEACHER_PORT, () => {
  console.log(`선생님 화면 → ${urlOf(TEACHER_PORT)}  (PIN: ${PIN})`)
  checkAi()
  checkKeyLeak()
  onOpen()
}).on('error', onListenError(TEACHER_PORT))
