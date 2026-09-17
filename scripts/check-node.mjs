/**
 * preinstall 守卫：只允许使用「better-sqlite3 有预编译二进制」的 Node 版本。
 *
 * 背景：better-sqlite3 是 ABI 绑定的原生模块。若当前 Node 的 ABI 不在其
 * release 资产列表中，prebuild-install 会回落到 `node-gyp rebuild`，
 * 而本机（及多数开发机）没有 Visual Studio C++ 工具链 → 安装直接失败。
 *
 * better-sqlite3@11.x 提供的 node ABI（win32-x64）：
 *   node-v108=Node18   node-v115=Node20   node-v127=Node22   node-v131=Node23
 * 例如 Node 26（ABI 147）没有任何预编译包 → 必然失败。
 */
const PREBUILT = {
  108: 'Node 18',
  115: 'Node 20',
  127: 'Node 22',
  131: 'Node 23',
}

const abi = String(process.versions.modules)
const supported = Object.entries(PREBUILT)
  .map(([a, name]) => `${name} (ABI ${a})`)
  .join(' / ')

if (PREBUILT[abi]) {
  console.log(`[glimmer] Node ${process.version} (ABI ${abi}) OK`)
  process.exit(0)
}

console.error('')
console.error(`  [glimmer] 当前 Node 版本不受支持: ${process.version} (ABI ${abi})`)
console.error('  better-sqlite3 在该 ABI 下没有预编译二进制，会回落到 node-gyp 源码编译；')
console.error('  没有 Visual Studio C++ 工具链时会以 "Could not find any Visual Studio installation" 失败。')
console.error('')
console.error(`  支持: ${supported}`)
console.error('')
console.error('  解决办法：改用受支持的 Node，例如 Node 22（见 README「环境要求」）。')
console.error('')
process.exit(1)
