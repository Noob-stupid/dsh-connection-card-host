#!/usr/bin/env bash
# 自校验：确认 ci.yml 里那条路径扫描模式**既有效又不误伤**。
#
# 为什么需要：如果模式写坏了（比如转义被吃掉），扫描会**永远绿** ——
# 那是"假绿"，比没有扫描更糟（给人已经守住了的错觉）。
# 反之如果模式过度宽泛，会误伤 URL，让 CI 天天红，最后被人加白名单加到失效。
#
# 用法：bash scripts/selfcheck-localscan.sh
set -uo pipefail

# ⚠️ 模式必须与 .github/workflows/ci.yml 里的**逐字一致**。
#    修改任何一边都要同步另一边。
PATTERN='(^|[^A-Za-z0-9+.-])[A-Za-z]:\\'
# 夹具用变量拼出来，避免仓库里出现**字面**的盘符路径（CI 会扫描仓库自身）
DRIVE='D'
SAMPLE_PATH="${DRIVE}:\\tmp\\x"

# ⚠️ 身份清单**从环境读**，不写进仓库。
#
# 理由：本文件与 ci.yml 都会被扫描器扫到 —— 把真实用户名写成字面量，
# 等于"为了防泄漏而在仓库里写下要防的那个字符串"。
# CI 从仓库变量读（见 ci.yml），本地开发这样跑：
#
#     DSH_LOCALSCAN_IDENT='某用户名' bash scripts/selfcheck-localscan.sh
#
# 未配置时**跳过身份用例**并如实报告（不是失败，也不是假装通过）。
IDENT="${DSH_LOCALSCAN_IDENT:-}"

ok=1
check() {
  # $1=期望(match|nomatch) $2=样本 $3=说明
  local want="$1" sample="$2" desc="$3"
  if printf '%s\n' "$sample" | grep -qE "$PATTERN"; then
    got=match
  else
    got=nomatch
  fi
  if [ "$got" = "$want" ]; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc（期望 $want，实得 $got）"
    ok=0
  fi
}

echo "── 路径模式 ──"
check match   "$SAMPLE_PATH"                      '真机绝对路径能命中'
check match   "dsh plugin add $SAMPLE_PATH"      '句中绝对路径能命中'
check match   "  $SAMPLE_PATH"                    '行首缩进的绝对路径能命中'
check nomatch 'https://example.com/x'          'URL 不误伤（https 的 s:）'
check nomatch 'http://127.0.0.1:19387/x'       'URL 不误伤（http 的 p: + 端口）'
check nomatch 'xmlns="http://www.w3.org/2000/svg"' 'SVG xmlns 不误伤'
check nomatch 'npm:foo'                        'npm 协议的冒号不误伤'
check nomatch 'a:b'                            '紧跟字母的冒号不误伤'

echo "── 身份模式 ──"
if [ -z "$IDENT" ]; then
  # 未配置身份清单：**如实说跳过**，不要把"没测"说成"通过"
  echo "  ⏭  跳过（未配置 DSH_LOCALSCAN_IDENT —— 身份清单不写进仓库）"
else
  if printf '%s\n' "${DRIVE}:\\Users\\someone" | grep -qE "$IDENT"; then
    echo "  ❌ 普通用户名被误伤"; ok=0
  else
    echo "  ✅ 普通用户名不误伤"
  fi
  if printf '%s\n' "${DRIVE}:\\Users\\${IDENT%%|*}\\x" | grep -qE "$IDENT"; then
    echo "  ✅ 本机用户名能命中"
  else
    echo "  ❌ 本机用户名命不中"; ok=0
  fi
fi

echo
if [ "$ok" -eq 1 ]; then
  echo "═══ 自校验通过：模式有效且不误伤 ═══"
  exit 0
fi
echo "═══ 自校验失败：模式有问题，CI 的扫描不可信 ═══"
exit 1
