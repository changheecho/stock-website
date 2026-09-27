const tails = new Map<string, Promise<void>>()

export const sellLockKey = (environment: string, exchange: string, code: string) => {
  const normalizedExchange = exchange.toUpperCase()
  const market = normalizedExchange.includes('NASDAQ') || normalizedExchange === 'ND' ? 'ND'
    : normalizedExchange.includes('NYSE') || normalizedExchange === 'NY' ? 'NY'
      : normalizedExchange.includes('AMEX') || normalizedExchange === 'NA' ? 'NA' : 'KRX'
  const normalizedCode = market === 'KRX' ? code.toUpperCase().replace(/^[AJQ]/, '') : code.toUpperCase()
  return `${environment}:${market}:${normalizedCode}`
}

/** Serialize all sell requests for a single mock account/security inside this Node process. */
export async function withSellLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const turn = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => turn)
  tails.set(key, tail)
  await previous
  try { return await action() }
  finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}
