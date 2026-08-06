import crypto from 'node:crypto';

// RFC 6238 TOTP (and its RFC 4226 HOTP base), implemented directly against Node's crypto
// module rather than pulling in a dependency — the algorithm is small and fixed, and every
// mainstream authenticator app (Google Authenticator, Authy, 1Password, etc.) speaks the
// same standard, so no compatibility is lost.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// 20 random bytes (160 bits) — the size RFC 4226 recommends for HMAC-SHA1-based OTP.
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpAt(secretBase32: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

// Accepts the current 30s step plus one step on either side, to tolerate normal clock
// drift between the server and the user's device without widening the window so much
// that a guessed code becomes easy.
export function verifyTotp(secretBase32: string, token: string, window = 1, step = 30, digits = 6): boolean {
  const clean = token.replace(/\s/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== digits) return false;
  const counter = Math.floor(Date.now() / 1000 / step);
  const secret = base32Decode(secretBase32);
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqualStr(hotp(secret, counter + w, digits), clean)) return true;
  }
  return false;
}

// The otpauth:// URI every authenticator app accepts for manual entry (no QR image here —
// showing the secret + this URL as text is the same "can't scan the code?" fallback those
// apps themselves offer, without pulling in a QR-rendering dependency).
export function otpauthUrl(secretBase32: string, accountEmail: string, issuer = 'Lastro'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCode(): string {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
