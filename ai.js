// ChatGPT 쓰는 곳 모음
//   judge() - 도움 요청/대화 메시지 판단 (선생님한테 욕했나, 위험한가, 장난인가)
//   coach() - 말 점검 (보내기 전에 말투 봐주고 바꿔 쓴 문장 주기)
//   verify() - 켤 때 키가 진짜 되는지 확인
// OPENAI_API_KEY 없거나 실패하면 null → 서버가 단어 목록으로 대신 판단

const KEY = process.env.OPENAI_API_KEY || ''
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const TIMEOUT = 8000 // 너무 오래 걸리면 그냥 단어 목록으로

// 켤 때 확인해보고 키가 틀렸거나 돈이 없으면 아예 안 부름 (매번 실패하니까)
let broken = false

function enabled() {
  return !!KEY && !broken
}

// 화면에 보여줄 때 키 가리기 (sk-...a1b2)
function maskedKey() {
  return KEY ? `${KEY.slice(0, 3)}...${KEY.slice(-4)}` : ''
}

// 공통: 물어보고 JSON으로 받기
async function ask(system, user) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log(`[AI] 실패 ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    const data = await res.json()
    return JSON.parse(data.choices[0].message.content)
  } catch (e) {
    console.log('[AI] 실패:', e.name === 'AbortError' ? '시간 초과' : e.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// 같은 말 또 물어보지 않게 (도배 대비)
function cached(fn) {
  const cache = new Map()
  return async text => {
    if (!enabled()) return null
    const t = String(text).slice(0, 1000)
    if (cache.has(t)) return cache.get(t)
    const out = await fn(t)
    if (out) {
      if (cache.size > 500) cache.clear()
      cache.set(t, out)
    }
    return out
  }
}

// ---------- 도움 요청 / 대화 판단 ----------
const JUDGE_PROMPT = `너는 학교 상담 앱 "쉼표"에서 학생이 선생님한테 보낸 메시지를 확인하는 도우미야.
메시지를 읽고 아래 JSON으로만 답해. 다른 말은 쓰지 마.

{
  "insult_teacher": 학생이 선생님한테 직접 욕하거나 모욕하면 true. 다른 사람이 한 욕을 옮겨 적은 건 false,
  "profanity": 욕설이나 비속어가 들어 있으면 true (옮긴 말이어도 true),
  "quoted": 욕이 다른 사람이 한 말을 옮긴 거면 true,
  "situation": 학생이 겪은 일이나 그때 기분을 설명하다가 욕이 섞인 거면 true (대화 상대한테 하는 욕이 아님),
  "danger": 자해, 자살 생각, 폭행, 협박, 돈 뺏기, 사진 유포, 성적인 괴롭힘처럼 어른이 바로 도와야 하는 위험 신호면 true,
  "prank": 진지한 고민이 아니라 장난이나 도배로 보이면 true,
  "reason": 선생님이 볼 한국어 한 줄 설명 (40자 이내)
}

판단할 때:
- 괴롭힘 당한 학생이 들은 욕을 그대로 적는 경우가 많아. 이건 insult_teacher가 아니고 quoted는 true야.
- "죽어라 공부했다", "웃겨 죽어" 같은 말버릇은 욕이 아니야 (profanity false).
- 유행어 속에 욕이 들어 있으면 profanity true야. 예: "존잘", "존맛", "두존크"(두상 존X 크다), "샤갈"(욕 대신 쓰는 감탄사), "시바", "ㅅ1ㅂ"처럼 숫자·기호 끼운 욕
- 패드립(느개비, 엠창), 사람 깎아내리는 말(급식충, 틀딱, 맘충, 한남, 김치녀), 혐오 밈(운지, 부엉이바위, 노무노무, 홍어, 탱크데이)도 profanity true
  (단, 시바견, 피아노 운지법, 홍어회, 한남동, 화가 샤갈처럼 원래 뜻으로 쓴 건 false)
- 학생이 직접 쓴 욕이면 상대가 누구든 profanity true, quoted false.
- "그때 진짜 ㅈ같았어요", "걔 때문에 개빡쳐요"처럼 있었던 일을 털어놓다 나온 욕은 situation true.
  "ㅅㅂ 왜 답 안 해", 아무 이유 없이 욕만 쓴 거, 장난은 situation false.
- 애매하면 insult_teacher는 false로. 학생이 억울하게 경고 받으면 안 돼.
- danger는 조금이라도 걱정되면 true로. 놓치는 게 더 위험해.`

const judge = cached(async t => {
  const v = await ask(JUDGE_PROMPT, t)
  if (!v) return null
  return {
    insultTeacher: v.insult_teacher === true,
    profanity: v.profanity === true,
    quoted: v.quoted === true,
    situation: v.situation === true,
    danger: v.danger === true,
    prank: v.prank === true,
    reason: String(v.reason || '').slice(0, 80),
  }
})

// ---------- 말 점검 ----------
const COACH_PROMPT = `너는 중고등학생이 단톡방이나 DM에 메시지를 보내기 전에 말투를 봐주는 친구 같은 도우미야.
반말로, 짧고 다정하게. 혼내지 말고 받는 사람 입장을 생각하게 도와줘.
아래 JSON으로만 답해. 다른 말은 쓰지 마.

{
  "level": "ok" (보내도 괜찮음) | "careful" (오해 살 수 있음) | "hurtful" (상처 줄 수 있음),
  "summary": 한 줄 평가 (25자 이내),
  "why": 받는 친구가 어떻게 느낄 수 있는지 한두 문장,
  "phrases": 상처 줄 수 있는 표현을 메시지에 있는 그대로 잘라서 배열로 (최대 5개, 없으면 []),
  "better": 하고 싶은 말은 살리고 덜 상처 주게 바꾼 문장 (괜찮으면 "")
}

판단할 때:
- 욕이 없어도 따돌림("너 빼고", "아무도 너 안 좋아해"), 비꼬기, 외모 놀림, 단톡방 공개 망신은 hurtful
- "죽어라 공부했다" 같은 관용 표현은 괜찮아
- 존잘/존맛처럼 욕이 섞인 유행어, 급식충·틀딱 같은 비하 말, 운지·홍어 같은 혐오 밈은 장난처럼 써도 careful 이상
- better는 실제로 학생이 보낼 법한 자연스러운 말로`

const LEVELS = ['ok', 'careful', 'hurtful']

const coach = cached(async t => {
  const v = await ask(COACH_PROMPT, t)
  if (!v) return null
  return {
    level: LEVELS.includes(v.level) ? v.level : 'careful',
    summary: String(v.summary || '').slice(0, 60),
    why: String(v.why || '').slice(0, 200),
    // 메시지에 진짜 있는 것만 (표시하려고)
    phrases: (Array.isArray(v.phrases) ? v.phrases : [])
      .map(p => String(p).trim())
      .filter(p => p && t.includes(p))
      .slice(0, 5),
    better: String(v.better || '').slice(0, 300),
  }
})

// ---------- 키 확인 ----------
// 진짜로 한 번 불러봄 (모델 목록만 보면 돈 없는 건 못 잡아서)
async function verify() {
  if (!KEY) return { state: 'off' }
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (res.ok) return { state: 'ok' }

    const body = await res.json().catch(() => ({}))
    const code = (body.error && (body.error.code || body.error.type)) || ''
    let state = 'error'
    if (res.status === 401) state = 'bad-key'
    else if (res.status === 404 || code === 'model_not_found') state = 'no-model'
    else if (code === 'insufficient_quota') state = 'quota'
    else if (res.status === 429) state = 'busy'
    // 키/모델/돈 문제면 고쳐질 때까지 안 부름. 잠깐 바쁜 거면 계속 씀
    if (['bad-key', 'no-model', 'quota'].includes(state)) broken = true
    return { state, status: res.status }
  } catch (e) {
    return { state: 'unreachable', detail: e.name === 'TimeoutError' ? '시간 초과' : e.message }
  }
}

module.exports = { judge, coach, verify, enabled, maskedKey, MODEL }
