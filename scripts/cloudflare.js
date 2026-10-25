// cloudflare 임시 터널 (share.js랑 server.js 둘 다 씀)
// 주소는 켤 때마다 바뀌지만 깃헙 로그인 없이 누구나 들어올 수 있음

const { spawn, execSync } = require('child_process')

const procs = []

function hasCloudflared() {
  try {
    execSync('command -v cloudflared', { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

function openTunnel(port) {
  return new Promise((resolve, reject) => {
    const p = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`])
    procs.push(p)
    const timer = setTimeout(() => reject(new Error('주소 받는 데 너무 오래 걸려요')), 40000)
    const onData = d => {
      const text = String(d)
      // 실패하면 로그에 api.trycloudflare.com 주소가 찍혀서 그거 말고
      // "단어-단어-단어.trycloudflare.com" 모양만 진짜 주소로 봄
      const m = text.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      } else if (/failed to request quick Tunnel/i.test(text)) {
        clearTimeout(timer)
        reject(new Error('cloudflare 서버에 연결이 안 돼요'))
      }
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('exit', code => reject(new Error('cloudflared가 꺼졌어요 (' + code + ')')))
  })
}

function closeTunnels() {
  procs.forEach(p => p.kill())
}

// 서버가 꺼질 때 터널도 같이 끄기
process.on('exit', closeTunnels)

module.exports = { hasCloudflared, openTunnel, closeTunnels }
