#!/usr/bin/env bash
# codespace 안 지우고 최신 코드 받기
#   npm run update
# 기분 기록이나 도움 요청(data/db.json), API 키(.env)는 git에 없어서 그대로 남아요

BR=$(git rev-parse --abbrev-ref HEAD)
echo "지금 브랜치: $BR"

# 직접 고친 게 있으면 잠깐 치워뒀다가 다시 넣기
STASHED=""
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "고친 파일이 있어서 잠깐 치워둘게요"
  git stash push -m "update 전에 치워둔 거" > /dev/null && STASHED=1
fi

if ! git pull --ff-only origin "$BR"; then
  echo ""
  echo "최신 코드를 못 받았어요. 위 메시지 확인해주세요."
  [ -n "$STASHED" ] && git stash pop > /dev/null
  exit 1
fi

npm install --no-audit --no-fund --loglevel=error

if [ -n "$STASHED" ]; then
  if git stash pop > /dev/null; then
    echo "치워둔 거 다시 넣었어요"
  else
    echo "치워둔 거 다시 넣다가 겹쳤어요. git status 보고 정리해주세요 (git stash list 에 남아 있음)"
  fi
fi

echo ""
echo "최신으로 바꿨어요! 켜져 있는 서버는 Ctrl+C로 끄고 다시 npm start"
echo "(npm run dev 로 켜두면 코드 바뀔 때 알아서 다시 켜져요)"
