import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import type { Principal } from './policy'
import { McpFailure } from './errors'

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function cleanText(value: string, principal: Principal): string {
  let cleaned = stripVTControlCharacters(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  cleaned = cleaned.replace(/https?:\/\/[^\s<>"']+/g, raw => {
    try {
      const url = new URL(raw)
      url.username = ''; url.password = ''
      for (const key of [...url.searchParams.keys()]) if (/token|secret|password|credential|api.?key|signature|authorization/i.test(key)) url.searchParams.set(key, '[redacted]')
      return url.href
    } catch { return '[invalid URL]' }
  })
  if (!principal.disclosePaths) for (const root of principal.roots) cleaned = cleaned.replaceAll(root.directory, `[${root.name}]`)
  return cleaned
}
export function clean<T>(value: T, principal: Principal): T {
  if (typeof value === 'string') return cleanText(value, principal) as T
  if (Array.isArray(value)) return value.map(item => clean(item, principal)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, clean(item, principal)])) as T
  return value
}
export function utf8Chunk(text: string, offset: number, maxBytes: number) {
  const bytes = Buffer.from(text)
  let end = Math.min(bytes.length, offset + maxBytes)
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return { text: bytes.subarray(offset, end).toString('utf8'), end, total: bytes.length }
}
export class Cursors {
  private readonly secret = randomBytes(32)
  encode(binding: unknown, offset: number) {
    const body = Buffer.from(JSON.stringify({ binding: digest(binding), offset, expires: Date.now() + 30 * 60_000 })).toString('base64url')
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`
  }
  offset(token: string | undefined, binding: unknown): number {
    if (!token) return 0
    try {
      const [body, signature, extra] = token.split('.')
      const expected = createHmac('sha256', this.secret).update(body).digest()
      const received = Buffer.from(signature, 'base64url')
      if (extra || expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error()
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString())
      if (parsed.binding !== digest(binding) || parsed.expires < Date.now() || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error()
      return parsed.offset
    } catch { throw new McpFailure('CURSOR_EXPIRED', 'This cursor is incompatible or expired. Read the first page again.') }
  }
}
