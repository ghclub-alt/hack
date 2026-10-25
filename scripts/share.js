// npm run share
// 서버 켜고 + cloudflare 터널 두 개 열고 + 주소랑 QR까지 한 번에
//
// codespace 포트 주소(...app.github.dev)는 깃헙 로그인해야 들어가져서
// 학생들 폰으로 들어가게 하려면 이걸로 열어야 함 (cloudflare 주소는 로그인 필요 없음)

const qr = require('qrcode-terminal')
const { hasCloudflared, openTunnel, closeTunnels } = require('./cloudflare')

const PORT = Number(process.env.PORT) || 3000
const TEACHER_PORT = Number(process.env.TEACHER_PORT) || 3001

if (!hasCloudflared()) {
  console.log('cloudflared가 없어요. 먼저 이거 한 번 실행:')
  console.log('  bash scripts/install-tunnel.sh')
  process.exit(1)
}

// 서버가 벌써 켜져 있나? (npm start 켜둔 채로 share 하는 경우)
async function alive(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/ping`)
    return r.ok
  } catch (e) {
    return false
  }
}

async function startServer() {
  const [s, t] = await Promise.all([alive(PORT), alive(TEACHER_PORT)])
  if (s && t) {
    console.log('서버가 이미 켜져 있어서 그거 그대로 쓸게요.')
    return
  }
  if (s || t) {
    console.log(`포트 ${s ? PORT : TEACHER_PORT}번만 켜져 있어요. 켜져 있는 서버 끄고(Ctrl+C) 다시 해주세요.`)
    process.exit(1)
  }
  // 아무것도 안 켜져 있으면 같은 프로세스에서 서버 켜기
  process.env.SHIMPYO_SHARE = '1'
  require('../server')
}

function stop() {
  closeTunnels()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

;(async () => {
  await startServer()
  console.log('\n공개 주소 만드는 중... (10초 정도)\n')
  try {
    const [s, t] = await Promise.all([openTunnel(PORT), openTunnel(TEACHER_PORT)])

    console.log('================================================')
    console.log(' 학생 화면  (이 QR을 화면에 띄우거나 나눠주세요)')
    console.log('================================================')
    qr.generate(s, { small: true }, code => console.log(code))
    console.log(' ' + s)
    console.log('')
    console.log('================================================')
    console.log(' 선생님 화면  (선생님만! 학생한테 보여주지 말기)')
    console.log('================================================')
    console.log(' ' + t)
    console.log('')
    console.log('깃헙 로그인 없이 누구나 들어올 수 있어요. 끄려면 Ctrl+C')
    console.log('(처음 몇 초는 주소가 안 열릴 수 있어요. 잠깐 기다렸다가 다시 열기)')
  } catch (e) {
    console.log('터널 열기 실패: ' + e.message)
    console.log('인터넷 연결 확인하고 다시 해보세요. 안 되면 npm run tunnel:ngrok')
    stop()
  }
})()
