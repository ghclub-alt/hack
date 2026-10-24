// ChatGPT로 학생 메시지 판단하기
// OPENAI_API_KEY 있을 때만 씀. 없거나 실패하면 null 돌려줌 → 서버가 단어 목록으로 판단
//
// 단어 목록은 "선생님 걔가 저한테 OO이라고 했어요" 같은 거 구분을 잘 못해서
// 이런 애매한 걸 AI한테 물어보는 거

const KEY = process.env.OPENAI_API_KEY || ''
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const TIMEOUT = 8000 // 너무 오래 걸리면 그냥 단어 목록으로

const PROMPT = `너는 학교 상담 앱 "쉼표"에서 학생이 선생님한테 보낸 메시지를 확인하는 도우미야.
메시지를 읽고 아래 JSON으로만 답해. 다른 말은 쓰지 마.

{
  "insult_teacher": 학생이 선생님한테 직접 욕하거나 모욕하면 true. 다른 사람이 한 욕을 옮겨 적은 건 false,
  "profanity": 욕설이나 비속어가 들어 있으면 true (옮긴 말이어도 true),
  "quoted": 욕이 다른 사람이 한 말을 옮긴 거면 true,
  "danger": 자해, 자살 생각, 폭행, 협박, 돈 뺏기, 사진 유포, 성적인 괴롭힘처럼 어른이 바로 도와야 하는 위험 신호면 true,
  "prank": 진지한 고민이 아니라 장난이나 도배로 보이면 true,
  "reason": 선생님이 볼 한국어 한 줄 설명 (40자 이내)
}

판단할 때:
- 괴롭힘 당한 학생이 들은 욕을 그대로 적는 경우가 많아. 이건 insult_teacher가 아니야.
- 애매하면 insult_teacher는 false로. 학생이 억울하게 경고 받으면 안 돼.
- danger는 조금이라도 걱정되면 true로. 놓치는 게 더 위험해.`

function enabled() {
  return !!KEY
}

// 같은 말 또 물어보지 않게 (도배 대비)
const cache = new Map()

async function judge(text) {
  if (!KEY) return null
  const t = String(text).slice(0, 1000)
  if (cache.has(t)) return cache.get(t)

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
          { role: 'system', content: PROMPT },
          { role: 'user', content: t },
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
    const v = JSON.parse(data.choices[0].message.content)
    const out = {
      insultTeacher: v.insult_teacher === true,
      profanity: v.profanity === true,
      quoted: v.quoted === true,
      danger: v.danger === true,
      prank: v.prank === true,
      reason: String(v.reason || '').slice(0, 80),
    }
    if (cache.size > 500) cache.clear()
    cache.set(t, out)
    return out
  } catch (e) {
    console.log('[AI] 실패:', e.name === 'AbortError' ? '시간 초과' : e.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { judge, enabled, MODEL }
