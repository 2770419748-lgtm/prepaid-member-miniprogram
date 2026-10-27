const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';

function pick(alphabet: string, random: Uint32Array, index: number): string {
  return alphabet[random[index] % alphabet.length];
}

/** 生成一个初始密码：10 位，字母和数字都有，去掉了容易看错的 0/O、1/l/I。 */
export function generateInitialPassword(): string {
  const random = new Uint32Array(10);
  crypto.getRandomValues(random);
  const all = LETTERS + DIGITS;
  const chars = Array.from({ length: 10 }, (_, i) => pick(all, random, i));
  chars[0] = pick(LETTERS, random, 0);
  chars[9] = pick(DIGITS, random, 9);
  return chars.join('');
}
