#!/usr/bin/env bash
# Makes this Windows release run on Linux (x86-64): adds the Linux builds of the two native modules the server
# uses (@node-rs/argon2 for password hashing, better-sqlite3 for the account database) beside the Windows ones,
# then checks that both load. Safe to run again; run it after every update (scripts/linux/update.sh does).
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null || { echo "Node.js is not installed (install Node.js 24)." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is not installed (it comes with Node.js 24 from NodeSource)." >&2; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "Node.js $(node --version) is too old: install Node.js 24." >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "This script fetches x86-64 builds; this machine is $(uname -m)." >&2; exit 1; }

# 1. argon2: the Linux build, the same version as the Windows one in the release
want=$(node -p 'require("./node_modules/@node-rs/argon2/package.json").version')
dest=node_modules/@node-rs/argon2-linux-x64-gnu
have=$(node -p "try { require('./$dest/package.json').version } catch { '' }")
if [ "$have" != "$want" ]; then
  echo "Installing @node-rs/argon2-linux-x64-gnu $want"
  tmp=$(mktemp -d)
  (cd "$tmp" && npm pack --silent "@node-rs/argon2-linux-x64-gnu@$want" >/dev/null)
  rm -rf "$dest" && mkdir -p "$dest"
  tar xzf "$tmp"/*.tgz -C "$dest" --strip-components=1
  rm -rf "$tmp"
fi

# 2. better-sqlite3: the prebuilt binary for this Node.js version (replaces the Windows one in build/Release)
echo "Fetching the better-sqlite3 binary for Node.js $(node --version)"
(cd node_modules/better-sqlite3 && npx --yes prebuild-install@7 -r node)

# 3. both load and work
node -e '
  const Db = require("./node_modules/better-sqlite3");
  new Db(":memory:").prepare("select 1").get();
  const argon2 = require("./node_modules/@node-rs/argon2");
  if (!argon2.verifySync(argon2.hashSync("check"), "check")) throw new Error("argon2 check failed");
  console.log("Native modules OK (Node.js " + process.version + ")");
'
