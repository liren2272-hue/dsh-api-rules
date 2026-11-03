/**
 * 凭据自举：给 `cordis.patch.yml` 里 `apiKeyEnv: API_RULES_BEARER` 补一条占位凭据。
 *
 * 为什么需要：patch 把 codearts / officeace / cline / raccoon 注册进 llm-pi-ai 时用的是
 * 这条凭据引用；它缺失时 pi-ai 会以 MISSING_CREDENTIAL 拒绝请求，而本插件真正的账号
 * （AK/SK、网关地址 + Authorization）走的是自己隔离的 accounts.json。于是新机器上会
 * 出现「模型在选择器里、一发请求却报缺凭据」。
 *
 * 边界（都很重要，别改）：
 *  - 只在**缺失**时写，已有的（含环境变量、.env、用户在模型页设的）一律不动。
 *  - 任何错误只降一条 warn，**永不抛出**：自举失败不能打断插件装载。
 *  - 这里写的只是**占位**值，不是真密钥；真正的上游鉴权由本插件按路由注入。
 *
 * @module dsh-api-rules/seed
 */

/** DSH 侧占位凭据的 ref，必须与 cordis.patch.yml 的 apiKeyEnv 逐字相同。 */
export const BEARER_REF = 'API_RULES_BEARER'

/** 占位值：不是真密钥。pi-ai 只用它确认「引用已配置」。 */
export const BEARER_VALUE = 'sk-api-rules-local-placeholder'

/**
 * 只在缺失时写入占位凭据。
 *
 * 顺序只能是 describe → 判 configured → 缺失才 set：反过来会把用户真实密钥覆盖掉。
 *
 * @param {{ describe: (ref: string) => Promise<{ configured?: boolean } | undefined>, set: (ref: string, value: string) => Promise<unknown> }} credentials
 * @param {{ ref?: string, value?: string, logger?: { info?: Function, warn?: Function } }} [options]
 * @returns {Promise<'present'|'written'|'error'>}
 */
export async function ensureBearerReference(
  credentials,
  { ref = BEARER_REF, value = BEARER_VALUE, logger = console } = {},
) {
  try {
    const state = await credentials.describe(ref)
    if (state?.configured) return 'present'
    await credentials.set(ref, value)
    logger?.info?.(`[seed] 已写入占位凭据 ${ref}`)
    return 'written'
  } catch (error) {
    logger?.warn?.(`[seed] 自举凭据 ${ref} 失败，插件继续装载：${error?.message ?? error}`)
    return 'error'
  }
}
