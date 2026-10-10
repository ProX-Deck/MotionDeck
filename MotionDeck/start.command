#!/bin/bash
# MotionDeck 交付版启动器(macOS / Linux)
# 双击 → 启动静态服务 → 服务自己打开浏览器 → 再检查导出依赖(缺则询问并安装)。
# 与 start.bat 同一套流程:
#   1. 解析 Node.js
#   2. 后台启动 server.mjs —— 它自己协商端口(80→8080→…)并打开浏览器,
#      启动器不做任何端口探测/就绪检测,只回显它的启动横幅。
#   3. 检查 node_modules、puppeteer、ffmpeg/ffprobe:缺失或损坏一律自动修复,不询问。
#   4. 保持窗口,按 Ctrl+C 停止服务并退出。
#
# 说明:
#   - server.mjs 只用 Node 内置模块(零第三方依赖),所以工作台本身不需要 node_modules。
#   - node_modules 只在【导出视频】时需要:export-frames.mjs 里 import puppeteer,
#     Node 只能从 node_modules 解析,且必须是 puppeteer 自带的 Chromium
#     (系统 Chrome 在无头+虚拟时间下不推进 CSS 动画时间线,会出坏成片)。
cd "$(dirname "$0")" || exit 1

# 去除 WorkBuddy/CodeBuddy 可能注入的 broker 文件钩子,避免运行时被拦
unset NODE_OPTIONS

# Ctrl+C / 退出时一并停掉后台服务,不留孤儿进程
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

# 解析可用 Node.js:优先 WorkBuddy 内置 managed node(兼容 node 与 bin/node 两种布局),
# 找不到再退化系统环境
NODE_BIN=""
for p in $(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/node "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | sort -V); do
  [ -x "$p" ] && NODE_BIN="$p"
done
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ 找不到 Node.js,请先安装(>=22.12):https://nodejs.org"
  exit 1
fi

echo "🚀 使用 Node.js: $NODE_BIN ($("$NODE_BIN" -v 2>/dev/null))"

# ============================================================
# 国内 npm 镜像(默认). Google/GitHub 在国内不稳定,所有可下载依赖都走 npmmirror:
#   - npm registry        -> registry.npmmirror.com         (JS 包)
#   - puppeteer Chromium   -> npmmirror 二进制镜像(原 Google CDN)
#   - ffmpeg-static 二进制 -> npmmirror 二进制镜像(原 GitHub)
# 注:ffprobe-static 的二进制直接打进 npm 包,registry 一项即覆盖。
# 这些只作用于本次启动,不会修改用户全局 npm 配置。
# ============================================================
export NPM_REGISTRY="https://registry.npmmirror.com"
export PUPPETEER_DOWNLOAD_BASE_URL="https://registry.npmmirror.com/-/binary/chrome-for-testing"
export FFMPEG_BINARIES_URL="https://registry.npmmirror.com/-/binary/ffmpeg-static"

# 把 node 所在目录加入 PATH,确保 npm 与 server.mjs 内部 spawn("node", ...) 能找到可执行文件;
# 同时纳入 macOS 常见二进制目录,确保 ffmpeg/ffprobe 等也能被找到(spawnSync 继承此 PATH)。
# ffmpeg-static / ffprobe-static 目录先加进来(此时可以还不存在),等 npm 装完,
# 后续 spawn 就能直接在 PATH 里找到 ffmpeg/ffprobe,无需重启服务。
export PATH="$(dirname "$NODE_BIN"):$PWD/node_modules/ffmpeg-static:$PWD/node_modules/ffprobe-static:/opt/homebrew/bin:/usr/local/bin:$PATH"

# ── Phase 1:后台启动服务(它自己会打开浏览器)──────────────────────────────
# 直接继承终端(stdout/stderr 不重定向到文件),这样导出进度([export] ...)
# 会实时显示在本窗口,恢复「导出时 shell 能看到进度」的体验。
echo "[*] 正在后台启动 MotionDeck 服务..."
"$NODE_BIN" server.mjs &
SERVER_PID=$!

# 给服务一点时间绑定端口并打印横幅(横幅会直接出现在本窗口)
sleep 2
echo ""

# ── Phase 2:导出依赖(缺失或损坏则直接安装,不询问)─────────────────────────
# 不只看目录是否存在,而是真的让 node 去解析 puppeteer,
# 这样「目录在但内容残缺/损坏」也能被发现并重装。
NEED_INSTALL=0
[ -d "node_modules" ] || NEED_INSTALL=1
[ -d "node_modules/puppeteer" ] || NEED_INSTALL=1
# paths:[cwd] 把解析锁定在本项目,避免装在全局某处的 puppeteer
# 让本地残缺的 node_modules 被误判成"已就绪"。
if ! "$NODE_BIN" -e "try{require.resolve('puppeteer',{paths:[process.cwd()]})}catch(e){process.exit(1)}" >/dev/null 2>&1; then
  NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = 0 ]; then
  echo "[OK] node_modules 已就绪(puppeteer 可解析)。"
else
  echo "[*] node_modules 缺失或不完整,正在安装导出依赖(只影响导出,工作台已可用)..."
  if npm install --registry="$NPM_REGISTRY"; then
    echo "[OK] node_modules 安装完成。"
    echo "    提示:若导出时提示缺少 Chromium,执行:npm run setup"
  else
    echo "[X] npm install 失败,请手动执行 npm install。"
  fi
fi

# ── Phase 3:ffmpeg / ffprobe(缺失则自动安装,不询问)──────────────────────
# 与 node_modules 同一条规则:不交互。系统 PATH 里已有 ffmpeg/ffprobe 就直接跳过
# (例如 brew install ffmpeg 装的),不会覆盖。
FF_OK=0
FFP_OK=0
command -v ffmpeg  >/dev/null 2>&1 && FF_OK=1
command -v ffprobe >/dev/null 2>&1 && FFP_OK=1
if [ "$FF_OK" = 1 ] && [ "$FFP_OK" = 1 ]; then
  echo "[OK] ffmpeg / ffprobe 已就绪。"
else
  [ "$FF_OK" = 1 ] && [ "$FFP_OK" != 1 ] && echo "[!] 有 ffmpeg 但缺 ffprobe。"
  echo "[*] PATH 里没有 ffmpeg 或 ffprobe,正在用 npm 安装(导出视频需要)..."
  if npm install ffmpeg-static ffprobe-static --no-save --registry="$NPM_REGISTRY"; then
    # 把两个二进制都复制进同一个「已在 PATH 中」的目录 node_modules/ffmpeg-static。
    # 这样才与包布局无关:ffmpeg-static 的二进制在包根目录,而 ffprobe-static 在
    # bin/<platform>/<arch>/ 下,光把两个包目录加进 PATH 是找不到 ffprobe 的。
    # 用 require() 解析还顺带兼容了两者的导出差异:ffmpeg-static 导出字符串,
    # ffprobe-static 导出 {path}。复制进 PATH 目录后,**已经在跑的服务无需重启**就能找到。
    "$NODE_BIN" -e "const fs=require('fs'),P=require('path'),X=process.platform==='win32'?'.exe':'',D=process.cwd()+'/node_modules/ffmpeg-static';fs.mkdirSync(D,{recursive:true});function R(m){try{var x=require(m);return typeof x==='string'?x:(x?x.path:null)}catch(e){return null}};function C(s,n){if(s==null)return 0;var d=P.join(D,n+X);try{if(fs.existsSync(d)){if(fs.realpathSync(s)===fs.realpathSync(d))return 1};fs.copyFileSync(s,d);if(X==='')fs.chmodSync(d,493);return 1}catch(e){return 0}};var a=C(R('ffmpeg-static'),'ffmpeg'),b=C(R('ffprobe-static'),'ffprobe');console.log('    ffmpeg='+a+' ffprobe='+b);"
    echo "[OK] ffmpeg / ffprobe 已装到 node_modules(其目录已在 PATH 中,本次会话即可用)。"
    echo "    除 npm 方案外,也可以系统级安装:macOS brew install ffmpeg"
  else
    echo "[X] 安装失败,请手动安装 ffmpeg 并加入 PATH。"
  fi
fi

echo ""
echo "[i] 检查完成。工作台现在可用于预览和导入;缺失的依赖只影响导出。"
echo ""
echo "[*] MotionDeck 正在运行。按 Ctrl+C 停止服务并退出。"

# 保持脚本存活;Ctrl+C 会被上面的 trap 捕获,连带停掉后台服务
wait "$SERVER_PID"
