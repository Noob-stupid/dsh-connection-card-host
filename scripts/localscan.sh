#!/usr/bin/env bash
# 本机路径 / 身份泄漏扫描 —— CI 与本地跑的是**同一份**。
#
# 为什么抽成脚本：这段逻辑原先内联在 ci.yml 里，于是出现了两个问题 ——
#   ① 本地复现要穿过 PowerShell/bash 的多层引号，**判出来的结果不可信**（实测踩过）
#   ② 与 selfcheck 的模式各写一份，迟早不一致
# 现在：模式只有这一份，CI 调它、本地也能调它。
#
# 用法：
#   bash scripts/localscan.sh
#   DSH_LOCALSCAN_IDENT='名1|名2' bash scripts/localscan.sh   # 附带身份扫描
#
# 身份清单**从环境读**，不写进仓库 —— 否则等于"为了防泄漏而在仓库里写下要防的字符串"。
# 退出码：0 = 干净；1 = 有命中或自检失败。
set -uo pipefail

# ── 模式（与 scripts/selfcheck-localscan.sh 里的 PATTERN 必须一致）──
# 盘符后**必须紧跟反斜杠**：URL 跟的是 //，所以这样不会误伤 https/http/xmlns。
BASE='(^|[^A-Za-z0-9+.-])[A-Za-z]:\\|file:///[A-Za-z]:'
IDENT="${DSH_LOCALSCAN_IDENT:-}"
if [ -n "$IDENT" ]; then
  SCAN="$BASE|$IDENT"
else
  SCAN="$BASE"
fi

# ── 允许的示例路径（文档里的示意值，不是真机路径）──
# 说明：这些是**教学用的假路径**（my-cards / downloads / <user>），
# 保留它们才能把"卡片来源可以是本地目录"讲清楚；它们指向的东西在任何机器上都不存在。
ALLOW='D:\\my-cards\\monitor-card|D:\\downloads\\monitor-card-1\.0\.0\.tgz|C:\\Users\\<user>'

fail=0
scanned=0
while IFS= read -r f; do
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.mp4|*.ico|*.tgz) continue ;;
    # 扫描器自己：它**必须**包含示例路径与模式（否则没法定义扫描），
    # 所以把自己排除 —— 这是本脚本唯一的例外，且写在这里可见。
    scripts/localscan.sh) continue ;;
  esac
  [ -f "$f" ] || continue
  scanned=$((scanned + 1))
  hits=$(grep -nE "$SCAN" "$f" 2>/dev/null | grep -vE "$ALLOW" || true)
  if [ -n "$hits" ]; then
    echo "::error file=$f::疑似本机路径/身份泄漏"
    echo "$hits"
    fail=1
  fi
done < <(git ls-files)

echo "已扫描 $scanned 个文件"
if [ -n "$IDENT" ]; then
  echo "身份清单：已配置"
else
  echo "身份清单：未配置 —— 本次只扫路径（不是失败）"
fi
# 防假绿：一个文件都没扫到说明范围写错了
if [ "$scanned" -lt 50 ]; then
  echo "::error::扫描文件数异常偏少（$scanned）—— 检查范围写错了"
  exit 1
fi
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "═══ 路径扫描通过 ═══"
