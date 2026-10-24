#!/usr/bin/env bash
# 외부에서 접속할 수 있게 터널 열기 (학생, 선생님 따로 주소 나옴)
#   npm run tunnel        -> cloudflare (가입 필요 없음)
#   npm run tunnel:ngrok  -> ngrok (토큰 필요)
# 서버(npm start)는 다른 터미널에서 먼저 켜두기!

PORT=${PORT:-3000}
TEACHER_PORT=${TEACHER_PORT:-3001}
WHICH=${1:-cloudflare}

for p in "$PORT" "$TEACHER_PORT"; do
  if ! curl -s "http://localhost:$p" > /dev/null; then
    echo "포트 $p 서버가 안 켜져 있어요. 다른 터미널에서 npm start 먼저!"
    exit 1
  fi
done

# ---------- ngrok ----------
if [ "$WHICH" = "ngrok" ]; then
  if ! command -v ngrok > /dev/null; then
    echo "ngrok이 없어요. bash scripts/install-tunnel.sh 먼저 실행"
    exit 1
  fi
  if [ -z "$NGROK_AUTHTOKEN" ]; then
    echo "NGROK_AUTHTOKEN이 필요해요."
    echo "  https://dashboard.ngrok.com/get-started/your-authtoken 에서 복사해서"
    echo "  NGROK_AUTHTOKEN=토큰 npm run tunnel:ngrok"
    exit 1
  fi

  # 터널 두 개 한 번에 열려고 설정 파일 만듦
  CONF=$(mktemp --suffix=.yml)
  cat > "$CONF" <<EOF
version: "2"
authtoken: $NGROK_AUTHTOKEN
tunnels:
  student:
    proto: http
    addr: $PORT
  teacher:
    proto: http
    addr: $TEACHER_PORT
EOF
  echo "ngrok 화면에서 3000 → 학생, 3001 → 선생님 주소예요"
  ngrok start --all --config "$CONF"
  rm -f "$CONF"
  exit 0
fi

# ---------- cloudflare ----------
if ! command -v cloudflared > /dev/null; then
  echo "cloudflared가 없어요. bash scripts/install-tunnel.sh 먼저 실행"
  exit 1
fi

LOG_S=$(mktemp)
LOG_T=$(mktemp)
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG_S" 2>&1 &
cloudflared tunnel --no-autoupdate --url "http://localhost:$TEACHER_PORT" > "$LOG_T" 2>&1 &

# 끄면 터널도 같이 끄기
trap 'kill $(jobs -p) 2> /dev/null; rm -f "$LOG_S" "$LOG_T"' EXIT

echo "터널 여는 중... (10초 정도)"
for i in $(seq 1 40); do
  # 실패 로그에 나오는 api.trycloudflare.com 말고 "단어-단어.trycloudflare.com"만
  S=$(grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$LOG_S" | head -1)
  T=$(grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$LOG_T" | head -1)
  [ -n "$S" ] && [ -n "$T" ] && break
  sleep 1
done

if [ -z "$S" ] || [ -z "$T" ]; then
  echo "주소를 못 받았어요. 로그:"
  tail -5 "$LOG_S" "$LOG_T"
  exit 1
fi

echo ""
echo "  학생 화면   →  $S"
echo "  선생님 화면 →  $T"
echo ""
echo "학생 주소만 QR로 만들어서 나눠주세요. 선생님 주소는 따로 보관!"
echo "끄려면 Ctrl+C"
wait
