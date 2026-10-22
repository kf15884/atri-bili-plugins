#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $# == 2 ]] || { echo '用法：bash scripts/install-upgrade.sh /Koishi项目目录 服务名.service'; exit 1; }
PROJECT="$(realpath -- "$1")"
UNIT="$2"
[[ "$PROJECT" != / && "$PROJECT" != /root && "$PROJECT" != /home && "$PROJECT" != /opt && "$UNIT" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || { echo '项目或服务参数无效'; exit 1; }
for f in package.json package-lock.json koishi.yml; do [[ -f "$PROJECT/$f" ]] || { echo "原工程缺少$f，未更改"; exit 1; }; done
[[ -d "$PROJECT/node_modules" && -d "$PROJECT/data" ]] || { echo '缺少原依赖或数据目录'; exit 1; }
command -v npm >/dev/null; command -v node >/dev/null; command -v systemctl >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
(cd "$HERE" && sha256sum -c SHA256SUMS)
(cd "$HERE/dist" && sha256sum -c SHA256SUMS)
NEED=$(( $(du -sk "$PROJECT/node_modules" "$PROJECT/data" | awk '{s+=$1}END{print s}') + 102400 ))
FREE="$(df -Pk "$PROJECT" | awk 'NR==2{print $4}')"
[[ "$FREE" -gt "$NEED" ]] || { echo '磁盘不足以备份依赖和数据，未更改'; exit 1; }
BACKUP="$PROJECT/.atri-bili-backups/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p -m 700 "$BACKUP"; chmod 700 "$PROJECT/.atri-bili-backups"
WAS_ACTIVE=0; READY=0; EDITED=0
systemctl is-active --quiet "$UNIT" && WAS_ACTIVE=1
fail(){
 local code=$?; trap - ERR; set +e
 if [[ "$READY" == 1 && "$EDITED" == 1 ]]; then
  echo '恢复完整依赖和清单；不覆盖数据库、剧情或日记。'
  systemctl stop "$UNIT"
  mv -- "$PROJECT/node_modules" "$BACKUP/failed-node_modules"
  mv -- "$BACKUP/node_modules" "$PROJECT/node_modules"
  cp -a -- "$BACKUP/package.json" "$BACKUP/package-lock.json" "$PROJECT/"
 fi
 if [[ "$WAS_ACTIVE" == 1 ]]; then systemctl start "$UNIT"; fi
 echo "未完成；备份只在本机：$BACKUP；不要公开。"; exit "$code"
}
trap fail ERR
if [[ "$WAS_ACTIVE" == 1 ]]; then systemctl stop "$UNIT"; fi
cp -a -- "$PROJECT/package.json" "$PROJECT/package-lock.json" "$PROJECT/koishi.yml" "$BACKUP/"
cp -a -- "$PROJECT/node_modules" "$PROJECT/data" "$BACKUP/"
READY=1
EDITED=1
VENDOR="$PROJECT/.atri-bili-packages/api-0.7.8-beta.1"
mkdir -p -m 700 "$VENDOR"
cp -- "$HERE/dist/koishi-plugin-atri-bilibili-0.7.8-beta.1.tgz" "$HERE/dist/koishi-plugin-atri-bili-eyes-0.5.3-beta.1.tgz" "$VENDOR/"
(umask 022; cd "$PROJECT" && npm install --offline --ignore-scripts --no-audit --no-fund --legacy-peer-deps "$VENDOR/koishi-plugin-atri-bilibili-0.7.8-beta.1.tgz" "$VENDOR/koishi-plugin-atri-bili-eyes-0.5.3-beta.1.tgz" >"$BACKUP/install.log" 2>&1)
node - "$PROJECT" <<'NODE'
const path=require('node:path'),root=process.argv[2];
for(const [name,version] of [['koishi-plugin-atri-bilibili','0.7.8-beta.1'],['koishi-plugin-atri-bili-eyes','0.5.3-beta.1']]){
 const p=path.join(root,'node_modules',name);if(require(path.join(p,'package.json')).version!==version)throw Error('安装版本不一致');require(p)
}
NODE
if [[ "$WAS_ACTIVE" == 1 ]]; then systemctl start "$UNIT"; systemctl is-active --quiet "$UNIT"; fi
trap - ERR
echo "本地安装步骤完成；请核对插件加载日志并重设精简配置。私有备份：$BACKUP"
echo '权限修复：秘密备份保持私有，npm源码安装使用umask022。不执行B站账号写操作；旧数据未覆盖。HDS接入与QQ卡片须在服务器验收。'
