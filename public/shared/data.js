// 학생/선생님 화면 + 서버가 같이 쓰는 데이터
// (서버에서는 require로 불러감 → 맨 아래 module.exports)

const MOODS = [
  // 좋음(초록) ↔ 힘듦(빨강) 양쪽으로 갈라지게. 가운데는 회색
  { v: 1, label: '좋아', color: '#3a8a6c', ink: '#fff', reply: '좋다! 그 기분 오래 갔으면.' },
  { v: 2, label: '괜찮아', color: '#a8d5bf', ink: '#26302b', reply: '괜찮은 하루였구나.' },
  { v: 3, label: '그냥 그래', color: '#e3ddd1', ink: '#26302b', reply: '그런 날도 있지 뭐.' },
  { v: 4, label: '좀 힘들어', color: '#f3ab88', ink: '#26302b', reply: '좀 힘들었구나. 오늘은 일찍 쉬자.' },
  { v: 5, label: '많이 힘들어', color: '#d9534a', ink: '#fff', reply: '많이 힘들었구나. 혼자 안 버텨도 돼.' },
]

const TYPES = ['따돌림', '놀림/욕설', '단톡방·SNS', '친구 관계 고민', '기타']

const WANT = {
  listen: '그냥 들어주세요',
  advice: '조언 원함',
  meet: '직접 도와주세요',
}

const STATUS = {
  new: '접수됨',
  replied: '답장 옴',
  done: '마무리',
}

// 도움 요청 글에 이런 말 있으면 바로 경고
// 학생 쪽은 연락처 띄우고, 선생님 쪽은 빨간 알림
const DANGER_WORDS = [
  '죽고 싶', '죽고싶', '죽을래', '자살', '자해', '사라지고 싶', '사라지고싶',
  '살기 싫', '살기싫', '뛰어내', '손목',
  '맞았', '때렸', '때려', '때린', '폭행', '돈 뺏', '돈뺏', '돈을 뺏', '협박', '빵셔틀', '셔틀',
  '몸캠', '사진 뿌', '사진뿌', '유포',
]

// 상처 주는 말 + 바꿔 말하기
// 우리 팀끼리 모은 거라 부족함. 계속 추가하기
// TODO: '죽어라 공부함' 같은 것도 걸림.. 나중에 고치기
const BAD_WORDS = [
  { word: '꺼져', level: 2, alt: '지금은 좀 혼자 있고 싶어' },
  { word: '닥쳐', level: 2, alt: '잠깐만, 내 말도 들어줄래?' },
  { word: '닥치', level: 2, alt: '잠깐만, 내 말도 들어줄래?' },
  { word: '찐따', level: 3, alt: null },
  { word: '병신', level: 3, alt: null },
  { word: 'ㅂㅅ', level: 3, alt: null },
  { word: '죽어', level: 3, alt: null },
  { word: '죽을래', level: 2, alt: '그거 하지 말아줘' },
  { word: '못생', level: 2, alt: null },
  { word: '돼지', level: 2, alt: null },
  { word: '노답', level: 1, alt: '이건 좀 어렵겠다' },
  { word: '극혐', level: 1, alt: '나는 이거 별로야' },
  { word: '관종', level: 1, alt: null },
  { word: '왕따', level: 2, alt: null },
  { word: '니가 뭔데', level: 2, alt: '나는 생각이 좀 달라' },
  { word: '너 빼고', level: 2, alt: '다 같이 하자' },
  { word: '쟤 빼고', level: 2, alt: '다 같이 하자' },
  { word: '아무도 너', level: 3, alt: null },
  { word: '너 같은 애', level: 2, alt: null },
  { word: '느금', level: 3, alt: null },
  { word: '애미', level: 3, alt: null },
  { word: '정신병', level: 2, alt: null },
]

const GUIDE = [
  {
    title: '눈앞에서 봤을 때',
    icon: 'eye',
    tint: '#fde7d9',
    items: [
      '같이 웃지 않기. 웃는 것만으로도 하는 애한테는 응원처럼 보여.',
      '직접 말리기 무서우면 안 해도 돼. 대신 "야 선생님이 너 찾던데" 같은 말로 그 자리를 끊어줄 수 있어.',
      '당한 친구 옆에 가서 같이 있어주기. 그것만으로도 엄청 커.',
      '어른한테 알리기. 담임, 상담 선생님, 보건 선생님 누구든 괜찮아.',
    ],
  },
  {
    title: '단톡방이나 SNS에서 봤을 때',
    icon: 'phone',
    tint: '#fbf0c4',
    items: [
      '캡처부터. 날짜랑 누가 보냈는지 보이게 찍어두기.',
      'ㅋㅋ나 이모티콘으로 반응하지 않기.',
      '당한 친구한테 따로 갠톡으로 "괜찮아?" 한마디 보내주기.',
      '계속 초대했다 내보내는 거, 한 명만 빼고 새 방 파는 것도 사이버 따돌림이야.',
      '쉼표 도움 요청에 "단톡방·SNS"로 남기거나 117에 문자(#0117) 보내도 돼.',
    ],
  },
  {
    title: '내가 당하고 있을 때',
    icon: 'shield',
    tint: '#dcefe4',
    items: [
      '네 잘못 아니야. 진짜로.',
      '기록 남기기. 언제, 어디서, 누가, 뭐라고 했는지 메모장에 적어두기.',
      '한 명이라도 믿을 만한 사람한테 말하기. 어른이면 더 좋고.',
      '말로 하기 힘들면 쉼표에 글로 남겨도 돼. 이름 안 써도 돼.',
    ],
  },
  {
    title: '혹시 내가 상처 주는 말을 했다면',
    icon: 'chat',
    tint: '#e7e4f3',
    items: [
      '"장난이었어"는 내 입장이고, 상대가 싫었으면 그건 장난이 아니었던 거야.',
      '변명 말고 "미안해, 다신 안 그럴게" 짧게.',
      '다음부턴 보내기 전에 "말 점검"에 한번 돌려보기.',
    ],
  },
]

// 홈에 하루에 하나씩 나오는 말
const TIPS = [
  '"괜찮아?" 한마디가 생각보다 커.',
  '오늘 고마웠던 사람 한 명한테 말로 해보기.',
  '단톡방 ㅋㅋ 하나도 누군가한테는 상처일 수 있어.',
  '힘든 건 약한 게 아니야. 말하는 건 용기고.',
  '쉬는 시간에 혼자 있는 친구 있으면 한번 불러보기.',
  '화날 땐 메시지 보내기 전에 10분만.',
  '선생님도 너희 얘기 듣는 거 좋아해. 진짜로.',
]

// 위험 단어 찾기 (띄어쓰기 달라도 걸리게)
function findDanger(text) {
  const flat = String(text).replace(/\s/g, '')
  return DANGER_WORDS.filter(w => flat.includes(w.replace(/\s/g, '')))
}

if (typeof module !== 'undefined') {
  module.exports = { MOODS, TYPES, WANT, STATUS, DANGER_WORDS, BAD_WORDS, GUIDE, TIPS, findDanger }
}
