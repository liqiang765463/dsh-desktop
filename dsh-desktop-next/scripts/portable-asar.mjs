/** Small append-only ASAR overlay. Keeps vendor members and unpack policy intact. */
import { openSync, closeSync, readSync, writeSync, fstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function header(file) {
  const fd = openSync(file, 'r')
  try {
    const prefix = Buffer.alloc(16); if (readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('Invalid ASAR')
    const size = prefix.readUInt32LE(12), offset = 8 + prefix.readUInt32LE(4)
    if (!size || size > 64 * 1024 * 1024 || size + 16 > offset) throw new Error('Invalid ASAR header')
    const raw = Buffer.alloc(size); if (readSync(fd, raw, 0, size, 16) !== size) throw new Error('Truncated ASAR')
    return { files: JSON.parse(raw).files, offset, raw }
  } finally { closeSync(fd) }
}
export function member(file, name) {
  const h = header(file); let item = { files: h.files }
  for (const part of name.split('/')) item = item?.files?.[part]
  if (!item || item.unpacked || item.link || !Number.isSafeInteger(item.size) || item.size > 8 * 1024 * 1024) throw new Error('Invalid ASAR member: ' + name)
  const fd = openSync(file, 'r')
  try { const raw = Buffer.alloc(item.size); if (readSync(fd, raw, 0, raw.length, h.offset + Number(item.offset)) !== raw.length) throw new Error('Truncated member'); return raw }
  finally { closeSync(fd) }
}
export function overlay(source, destination, build) {
  const h = header(source), input = openSync(source, 'r'), updates = []
  try {
    let offset = fstatSync(input).size - h.offset
    for (const name of readdirSync(build).sort().filter(n => n.endsWith('.js') && n !== 'client.js')) {
      const raw = readFileSync(join(build, name)), blockSize = 4194304, blocks = []
      for (let i = 0; i < raw.length; i += blockSize) blocks.push(digest(raw.subarray(i, i + blockSize)))
      h.files.lib.files[name] = { size: raw.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: digest(raw), blockSize, blocks } }
      updates.push(raw); offset += raw.length
    }
    if (!updates.length) throw new Error('No compiled modules')
    const raw = Buffer.from(JSON.stringify({ files: h.files })), payload = Math.ceil((4 + raw.length) / 4) * 4
    const prefix = Buffer.alloc(16); prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(payload + 4, 4); prefix.writeUInt32LE(payload, 8); prefix.writeUInt32LE(raw.length, 12)
    const output = openSync(destination, 'wx', 0o600)
    try {
      writeSync(output, prefix); writeSync(output, raw); writeSync(output, Buffer.alloc(payload - 4 - raw.length))
      const buffer = Buffer.alloc(1024 * 1024); let at = h.offset, count
      while ((count = readSync(input, buffer, 0, buffer.length, at))) { writeSync(output, buffer, 0, count); at += count }
      for (const bytes of updates) writeSync(output, bytes)
    } finally { closeSync(output) }
    return digest(raw)
  } finally { closeSync(input) }
}
