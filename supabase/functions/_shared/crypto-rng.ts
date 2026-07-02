// shuffleDeck(rng) に注入する、予測不能な乱数源。Deno/ブラウザ標準の crypto.getRandomValues を使う。
export function cryptoRng(): () => number {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 0x100000000;
  };
}
