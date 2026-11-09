import type { ConfigModel } from '../config/model'

/** The workspace's money currency when it is unambiguous (every stored currency field uses the same ISO code). */
export function currencyOfConfig(cfg: ConfigModel): string | undefined {
  const codes = new Set<string>()
  for (const m of cfg.modules) for (const f of m.fields) if (f.type === 'currency' && f.currency) codes.add(f.currency)
  return codes.size === 1 ? [...codes][0] : undefined
}
