// 저장은 json 파일로 (DB 깔 시간 없어서)
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'data', 'db.json')
const db = { moods: [], reqs: [] }

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    db.moods = saved.moods || []
    db.reqs = saved.reqs || []
  } catch (e) {
    // 파일 없으면 새로 만듦
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    save()
  }
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2))
}

function reset() {
  db.moods = []
  db.reqs = []
  save()
}

function today(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 헷갈리는 글자(0,O,1,I)는 뺌
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = ''
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  } while (db.reqs.some(r => r.code === code))
  return code
}

module.exports = { db, load, save, reset, today, makeCode }
