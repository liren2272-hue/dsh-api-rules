/**
 * 日志：尽量不依赖宿主结构，拿不到就静默降级。
 *
 * 插件加载/运行期只打少量信息，绝不在加载阶段发网络请求。
 */

/** 带插件前缀的日志。 */
function emit(level, message) {
  const line = `[dsh-tongji-aigc] ${message}`
  try {
    // 宿主 logger 是可选服务；拿不到就退回 console，不因日志把插件搞挂。
    if (globalThis.__DSH_TONGJI_LOG__ && typeof globalThis.__DSH_TONGJI_LOG__[level] === 'function') {
      globalThis.__DSH_TONGJI_LOG__[level](line)
      return
    }
  } catch {
    /* 忽略日志失败 */
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logInfo = (message) => emit('info', message)
export const logWarn = (message) => emit('warn', message)
export const logError = (message) => emit('error', message)
export const logDebug = (message) => emit('debug', message)
