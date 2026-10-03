# 能力矩阵体检脚本（调研用，**只读**，可反复跑）
#
# 用途：按 adapter-design.md §5 的三个问题体检一个 DSH 插件，产出能力矩阵的一行。
#   (1) 是否模块级 import @deepseek-ai/*   —— F1 判据：卡运行时解析不到 ⇒ 原样加载必失败
#   (2) ctx.* 接口用量                      —— 依赖面，决定适配器要申报哪些能力
#   (3) 全局副作用                          —— 护栏②/③ 的判定输入
#   (4) 是否有 client 制品                  —— UI 捕获工作量
#
# 用法：
#   pwsh -NoProfile -File scripts/audit-plugins.ps1                 # 跑内置候选列表
#   pwsh -NoProfile -File scripts/audit-plugins.ps1 -Path <插件目录>  # 体检任意一个
#
# ⚠️ 本脚本**只读**：不写文件、不改 profile、不装东西。

param(
  [string]$Path
)

$ErrorActionPreference = 'Continue'

# ── 硬判据：出现这些 ctx 成员 = 直接操作宿主内部 ⇒ 不可适配（见矩阵文档 §3.2）
$hostSurgeryMembers = @('loader', 'reflect', 'fiber', 'registry', 'reflect')

function Test-Plugin {
  param([string]$Name, [string]$Dir)

  $pkgPath = Join-Path $Dir 'package.json'
  if (-not (Test-Path $pkgPath)) { Write-Output "---- $Name : 无 package.json（$Dir）"; return }

  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  Write-Output "======== $Name  v$($pkg.version) ========"

  if ($pkg.dsh) {
    Write-Output ("  dsh 段     : " + ($pkg.dsh | ConvertTo-Json -Compress -Depth 5))
  } else {
    Write-Output "  dsh 段     : (无)"
  }

  if ($pkg.peerDependencies) {
    $peers = @()
    foreach ($p in $pkg.peerDependencies.PSObject.Properties) { $peers += "$($p.Name)@$($p.Value)" }
    Write-Output ("  peers      : " + ($peers -join ', '))
  } else {
    Write-Output "  peers      : (无)"
  }

  $hasClient = (Test-Path (Join-Path $Dir 'lib\client.js')) -or
               (Test-Path (Join-Path $Dir 'client.mjs')) -or
               (Test-Path (Join-Path $Dir 'client'))
  Write-Output ("  client 制品: " + $(if ($hasClient) { '有（会向全局注册 UI）' } else { '无' }))

  # ── 扫描范围：src/ → lib/ → 包根（支持"包根直接 .mjs"的布局）
  $srcDir = $null
  if (Test-Path (Join-Path $Dir 'src')) { $srcDir = Join-Path $Dir 'src' }
  elseif (Test-Path (Join-Path $Dir 'lib')) { $srcDir = Join-Path $Dir 'lib' }
  else { $srcDir = $Dir }

  $files = @()
  $base = (Resolve-Path $srcDir).Path
  Get-ChildItem $srcDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    # ⚠️ 必须用**相对路径**判断 node_modules：插件自己可能就装在 node_modules 下
    #    （profile 装的插件都是），用绝对路径判断会把整个插件排除掉 —— 踩过。
    $rel = $_.FullName.Substring($base.Length)
    if ($_.Extension -in '.ts', '.js', '.mjs', '.cjs' -and
        $_.Name -notmatch '\.map$' -and
        $rel -notmatch '\\node_modules\\') {
      $files += $_
    }
  }
  $scopeName = if ($srcDir -eq $Dir) { '包根' } else { (Split-Path $srcDir -Leaf) + '/' }
  Write-Output ("  扫描范围   : {0} 个文件（{1}）" -f $files.Count, $scopeName)

  $sb = New-Object System.Text.StringBuilder
  foreach ($f in $files) {
    $txt = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($txt) { [void]$sb.AppendLine($txt) }
  }
  $all = $sb.ToString()

  # (1) import 真 DSH 包
  $importsDsh = [regex]::IsMatch($all, 'from\s+[''"]@deepseek-ai/') -or
                [regex]::IsMatch($all, 'require\([''"]@deepseek-ai/')
  Write-Output ("  1) import @deepseek-ai/* : " + $(if ($importsDsh) { '有（F1：原样加载会失败）' } else { '无' }))

  # (2) ctx.* 用量
  $members = [regex]::Matches($all, 'ctx\.([a-zA-Z_]\w*)') |
      ForEach-Object { $_.Groups[1].Value } | Group-Object | Sort-Object Count -Descending
  $top = @($members | Select-Object -First 12 | ForEach-Object { "$($_.Name)x$($_.Count)" })
  Write-Output ("  2) ctx.* 用量 : " + $(if ($top.Count) { $top -join '  ' } else { '(未扫到)' }))

  # (3) 副作用
  $side = @()
  if ([regex]::IsMatch($all, 'setInterval\(')) { $side += 'setInterval' }
  if ([regex]::IsMatch($all, 'ctx\.set\(')) { $side += 'ctx.set' }
  if ([regex]::IsMatch($all, 'writeFileSync|writeFile\(')) { $side += '写文件' }
  if ([regex]::IsMatch($all, 'process\.on\(')) { $side += 'process.on' }
  if ([regex]::IsMatch($all, 'registerTool|tools\.register')) { $side += '(有工具注册)' }
  Write-Output ("  3) 副作用/工具 : " + $(if ($side.Count) { $side -join ', ' } else { '未见明显项' }))

  # (4) 硬判据：宿主手术刀
  $surgery = @($members | Where-Object { $hostSurgeryMembers -contains $_.Name } | ForEach-Object { $_.Name })
  if ($surgery.Count) {
    Write-Output ("  4) 判定        : 【不可适配】出现宿主内部机制：" + (($surgery | Select-Object -Unique) -join ', '))
  } else {
    Write-Output "  4) 判定        : 未触发硬判据（仍需人工看依赖面）"
  }

  Write-Output ""
}

if ($Path) {
  Test-Plugin -Name (Split-Path $Path -Leaf) -Dir $Path
} else {
  # 候选目录**从环境推**，不写死本机路径：
  #   DSH_PROFILE_DIR —— profile 启动的 DSH 会设（插件装在它的 node_modules 下）
  #   DSH_HOME        —— 没设就按用户主目录下的 .dsh 兜底（开发用的插件源码在那儿）
  $profileRoot = if ($env:DSH_PROFILE_DIR) { Join-Path $env:DSH_PROFILE_DIR 'node_modules' } else { $null }
  $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  $srcRoot = Join-Path $dshHome 'plugin-src'

  $targets = @(
    @{ n = 'dsh-browser';        d = if ($profileRoot) { Join-Path $profileRoot 'dsh-browser' } else { '' } },
    @{ n = 'dsh-memory-plugin';  d = Join-Path $srcRoot '@openviking\dsh-memory-plugin' }
  )
  foreach ($t in $targets) {
    if ($t.d -and (Test-Path $t.d)) { Test-Plugin -Name $t.n -Dir $t.d }
    else { Write-Output "---- $($t.n) : 本机没有（跳过）`n" }
  }
}
