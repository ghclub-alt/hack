#!/usr/bin/env bash
# codespace 처음 만들 때 cloudflared랑 ngrok 깔아두는 스크립트
# 실패해도 서버는 돌아가니까 에러 나도 그냥 넘어감

case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "모르는 cpu: $(uname -m)"; exit 0 ;;
esac

if ! command -v cloudflared > /dev/null; then
  echo "cloudflared 설치 중..."
  sudo curl -fsSL -o /usr/local/bin/cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH" \
    && sudo chmod +x /usr/local/bin/cloudflared \
    || echo "cloudflared 설치 실패 (나중에 다시 해보기)"
fi

if ! command -v ngrok > /dev/null; then
  echo "ngrok 설치 중..."
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-$ARCH.tgz" \
    | sudo tar xz -C /usr/local/bin \
    || echo "ngrok 설치 실패 (나중에 다시 해보기)"
fi

exit 0
