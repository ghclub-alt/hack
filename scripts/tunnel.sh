#!/usr/bin/env bash
# 외부에서 접속할 수 있게 터널 열기
#   npm run tunnel        -> cloudflare (가입 필요 없음)
#   npm run tunnel:ngrok  -> ngrok (토큰 필요)
# 서버(npm start)는 다른 터미널에서 먼저 켜두기!

PORT=${PORT:-3000}
WHICH=${1:-cloudflare}

if ! curl -s "http://localhost:$PORT" > /dev/null; then
  echo "서버가 안 켜져 있는 것 같아요. 다른 터미널에서 npm start 먼저!"
  exit 1
fi

if [ "$WHICH" = "ngrok" ]; then
  if ! command -v ngrok > /dev/null; then
    echo "ngrok이 없어요. bash scripts/install-tunnel.sh 먼저 실행"
    exit 1
  fi
  if [ -n "$NGROK_AUTHTOKEN" ]; then
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" > /dev/null
  fi
  ngrok http "$PORT"
else
  if ! command -v cloudflared > /dev/null; then
    echo "cloudflared가 없어요. bash scripts/install-tunnel.sh 먼저 실행"
    exit 1
  fi
  echo "잠깐 기다리면 https://xxxx.trycloudflare.com 주소가 나와요. 그걸로 접속!"
  cloudflared tunnel --url "http://localhost:$PORT"
fi
