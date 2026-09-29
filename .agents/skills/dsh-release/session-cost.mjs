// 会话成本诊断：按轮列出「请求数 / token」，定位哪一轮把成本顶上去。
//
//   node .agents/skills/dsh-release/session-cost.mjs [sessionId]
//
// sessionId 缺省取 $DSH_SESSION_ID；会话日志是多帧 zstd（每帧一段 JSONL），
// Node 的 zstdDecompressSync 只解第一帧，所以按帧魔数扫描 + 按事件 seq 去重。
// 桶目录名 = 工作目录转义后的名字，直接全量搜 $DSH_HOME/sessions/*/<id>/。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const id = process.argv[2] ?? process.env.DSH_SESSION_ID
if (!id) {
  console.error('usage: node session-cost.mjs <sessionId>   (or set DSH_SESSION_ID)')
  process.exit(1)
}
const sessionsRoot = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh'), 'sessions')
let file = null
for (const bucket of readdirSync(sessionsRoot)) {
  const candidate = join(sessionsRoot, bucket, id, 'session.v3.jsonl.zstd')
  if (existsSync(candidate)) { file = candidate; break }
}
if (!file) { console.error(`no session file for id ${id} under ${sessionsRoot}`); process.exit(1) }

const buf = readFileSync(file)
const offs = []
for (let i = 0; i + 4 <= buf.length; i++) if (buf.compare(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), 0, 4, i, i + 4) === 0) offs.push(i)
const events = new Map()
for (const start of offs) {
  let text; try { text = zstdDecompressSync(buf.subarray(start)).toString('utf8') } catch { continue }
  const parsed = []; let ok = true
  for (const line of text.split('\n').filter(Boolean)) { try { parsed.push(JSON.parse(line)) } catch { ok = false; break } }
  if (!ok) continue
  for (const event of parsed) if (typeof event.seq === 'number' && !events.has(event.seq)) events.set(event.seq, event)
}
const byTurn = new Map()
for (const event of [...events.values()].sort((a, b) => a.seq - b.seq)) {
  const usage = event.type === 'assistant/message' ? event.data?.usage : undefined
  if (!usage) continue
  const row = byTurn.get(event.data.turn) ?? { requests: 0, tokens: 0 }
  row.requests += 1
  row.tokens += (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
  byTurn.set(event.data.turn, row)
}
for (const [turn, row] of byTurn) console.log(`turn ${turn}: ${row.requests} reqs, ${(row.tokens / 1e6).toFixed(2)}M tok`)
