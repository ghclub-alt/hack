// 쉼표 서버
// 학생 화면이랑 선생님 화면을 아예 다른 포트로 띄움
//   학생   → 3000
//   선생님 → 3001
// 그래야 터널 열 때 주소가 따로 나와서 학생이 선생님 화면 주소를 알 수가 없음

const express = require('express')
const path = require('path')
const crypto = require('crypto')
const { db, load, save, reset, today, makeCode } = require('./db')
const { TYPES, findDanger, findBad } = require('./public/shared/data')

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
  app.use(express.json({ limit: '20kb' }))
  // 인터넷 다시 연결됐나 확인용 (로그인 필요 없음)
  app.get('/api/ping', (req, res) => res.json({ ok: true }))
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
    messages: r.messages.map(m => ({ from: m.from, text: m.text, at: m.at, kind: m.kind || '' })),
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
student.post('/api/requests', (req, res) => {
  const { cls, type, text, want, name } = req.body
  if (!okCls(cls) || !TYPES.includes(type) || !WANTS.includes(want)) {
    return res.status(400).json({ error: '빠진 게 있어요' })
  }
  if (typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: '내용을 조금만 더 적어줘' })
  }

  const body = text.trim().slice(0, 1000)
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
    messages: [{ from: 'student', text: body, at: now, bad: findBad(body) }],
    warnings: 0,
    locked: false,
    status: 'new',
    reply: '',
    at: now,
  }
  db.reqs.push(r)
  save()
  res.json({ code: r.code, danger: r.danger.length > 0 })
})

// 접수번호로 대화 보기. 이름은 안 돌려줌
student.get('/api/requests/:code', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  res.json(forStudent(r))
})

// 학생이 대화 이어가기
student.post('/api/requests/:code/messages', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  if (r.locked) return res.status(403).json({ error: '선생님이 이 대화를 닫았어. 필요하면 새로 이야기를 보내줘.' })

  const text = String(req.body.text || '').trim().slice(0, 500)
  if (!text) return res.status(400).json({ error: '내용이 비었어' })

  // 장난으로 막 보내는 거 막기
  const last = r.messages[r.messages.length - 1]
  if (last.from === 'student' && Date.now() - last.at < 3000) {
    return res.status(429).json({ error: '조금만 천천히 보내줘' })
  }
  if (r.messages.length >= 200) return res.status(400).json({ error: '대화가 너무 길어졌어. 새로 이야기를 보내줘.' })

  r.messages.push({ from: 'student', text, at: Date.now(), bad: findBad(text) })
  addDanger(r, text)
  r.status = 'new' // 선생님이 다시 봐야 함
  save()
  res.json(forStudent(r))
})

// ======================= 선생님 =======================
const teacher = makeApp('teacher')

// 토큰은 그냥 메모리에. 서버 껐다 켜면 다시 로그인하면 됨
const tokens = new Set()

teacher.post('/api/login', (req, res) => {
  if (req.body.pin !== PIN) return res.status(401).json({ error: 'PIN이 틀렸어요' })
  const t = crypto.randomBytes(16).toString('hex')
  tokens.add(t)
  res.json({ token: t })
})

teacher.use('/api', (req, res, next) => {
  if (!tokens.has(req.get('x-token'))) return res.status(401).json({ error: '로그인 필요' })
  next()
})

function weekMoods(cls) {
  const from = today(6)
  return db.moods.filter(m => m.date >= from && (!cls || m.cls === cls))
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
  for (let i = 6; i >= 0; i--) {
    const d = today(i)
    const c = [0, 0, 0, 0, 0]
    list.filter(m => m.date === d).forEach(m => c[m.mood - 1]++)
    days.push({ date: d, counts: c })
  }
  res.json({ total: list.length, counts, days })
})

// 경고 모음. 위에서부터 급한 순
teacher.get('/api/alerts', (req, res) => {
  const cls = req.query.cls
  const now = Date.now()
  const alerts = []

  // 1. 위험한 단어가 들어간 요청
  reqsOf(cls)
    .filter(r => r.danger && r.danger.length && r.status !== 'done')
    .forEach(r => {
      alerts.push({
        level: 'red',
        title: '위험 신호가 있는 요청',
        msg: `${r.cls}반 요청에 "${r.danger.slice(0, 2).join('", "')}" 같은 말이 있어요. 바로 확인해 주세요.`,
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
      if (last.from !== 'student' || !last.bad || !last.bad.length) return
      alerts.push({
        level: 'yellow',
        title: '욕설이 들어간 메시지',
        msg: `"${last.bad.slice(0, 2).join('", "')}" 같은 말이 있어요. 누가 한 말을 옮긴 건지, 장난인지 확인해 주세요.`,
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
  res.json({ ok: true })
})

teacher.post('/api/requests/:code/done', (req, res) => {
  const r = findReq(req.params.code)
  if (!r) return res.status(404).json({ error: '없는 번호' })
  r.status = 'done'
  save()
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
  res.json({ ok: true })
})

teacher.post('/api/clear', (req, res) => {
  reset()
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
const { execFile } = require('child_process')

function makePublic(tries = 2) {
  const ports = [`${PORT}:public`]
  // 선생님 화면은 기본으로 비공개 (깃헙 로그인한 사람만). 다른 폰에서도 열려면 TEACHER_PUBLIC=1
  if (process.env.TEACHER_PUBLIC === '1') ports.push(`${TEACHER_PORT}:public`)

  execFile('gh', ['codespace', 'ports', 'visibility', ...ports, '-c', process.env.CODESPACE_NAME], (err, stdout, stderr) => {
    if (err && tries > 1) {
      // 포트가 막 열린 참이면 실패할 때가 있어서 한 번 더
      return setTimeout(() => makePublic(tries - 1), 4000)
    }
    console.log('')
    if (err) {
      console.log('학생 주소를 자동으로 공개로 못 바꿨어요. 직접 한 번만 바꿔주세요:')
      console.log(`  아래 "포트(Ports)" 탭 → ${PORT} 오른쪽 클릭 → Port Visibility → Public`)
      const why = err.code === 'ENOENT' ? 'gh 프로그램이 없어요' : String(stderr || err.message).trim().split('\n')[0]
      if (why) console.log(`  (이유: ${why})`)
    } else {
      console.log('학생 주소를 공개로 바꿨어요. 깃헙 로그인 없이 누구나 들어올 수 있어요.')
      if (process.env.TEACHER_PUBLIC === '1') console.log('선생님 주소도 공개예요. PIN 꼭 바꿔두기!')
      else console.log('선생님 주소는 비공개 그대로예요 (깃헙 로그인한 사람만).')
    }
    showStudentQr()
  })
}

function showStudentQr() {
  const url = urlOf(PORT)
  console.log('')
  console.log('=== 학생 화면 고정 주소 (codespace 안 지우면 안 바뀜) ===')
  require('qrcode-terminal').generate(url, { small: true }, code => console.log(code))
  console.log(' ' + url)
  console.log('')
}

let opened = 0
function onOpen() {
  opened += 1
  if (opened < 2) return
  if (process.env.CODESPACE_NAME && !process.env.SHIMPYO_SHARE) {
    // 포트 연결될 시간 조금 주고
    setTimeout(makePublic, 2000)
  }
}

student.listen(PORT, () => {
  console.log(`학생 화면   → ${urlOf(PORT)}`)
  onOpen()
}).on('error', onListenError(PORT))

teacher.listen(TEACHER_PORT, () => {
  console.log(`선생님 화면 → ${urlOf(TEACHER_PORT)}  (PIN: ${PIN})`)
  onOpen()
}).on('error', onListenError(TEACHER_PORT))
