// 쉼표 서비스 워커
// 학생/선생님 둘 다 이 파일 씀 (sw.js?app=student 이런 식으로 등록)
// 인터넷 끊겨도 화면은 뜨게만. api(기분, 도움 요청)는 저장 안 하고 항상 서버로 감

const APP = new URL(location).searchParams.get('app') === 'teacher' ? 'teacher' : 'student'
const VERSION = 'v12' // 파일 바꾸고 배포할 때 숫자 올리기
const CACHE = `shimpyo-${APP}-${VERSION}`
// 선생님 화면은 학생 주소 밑 /teacher/ 에서도 돌아서 경로는 전부 sw.js 있는 곳 기준
const BASE = new URL('./', location).pathname

const FILES = {
  student: ['./', 'app.css', 'app.js'],
  teacher: ['./', 'dash.css', 'dash.js'],
}
const COMMON = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'shared/base.css',
  'shared/common.js',
  'shared/data.js',
  'shared/icons.js',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...FILES[APP], ...COMMON]))
      .then(() => self.skipWaiting())
  )
})

// 예전 버전 캐시 지우기
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(`shimpyo-${APP}-`) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (!url.protocol.startsWith('http')) return
  if (url.origin === location.origin) {
    if (url.pathname.startsWith(BASE + 'api/')) return
    // 학생 쪽 서비스 워커는 /teacher/ 는 안 건드림 (선생님 거가 따로 있음)
    if (APP === 'student' && url.pathname.startsWith('/teacher/')) return
  }

  // 인터넷 되면 항상 새 거 (해커톤 중에 계속 고치니까)
  // 안 되면 저장해둔 거 보여줌
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true })
        if (hit) return hit
        if (req.mode === 'navigate') return caches.match('./')
        return Response.error()
      })
  )
})
