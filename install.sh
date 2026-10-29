#!/bin/sh
# Installe Gitdrop (binaire autonome, sans Node.js) :
#   curl -fsSL https://github.com/djabliameizafredy-a11y/gitdrop/releases/latest/download/install.sh | sh
set -eu

REPO="${GITDROP_REPO:-djabliameizafredy-a11y/gitdrop}"
BASE="${GITDROP_BASE_URL:-https://github.com/$REPO/releases/latest/download}"
DIR="${GITDROP_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) echo "Système non supporté : $(uname -s). Sous Windows, utilisez install.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "Architecture non supportée : $(uname -m)" >&2; exit 1 ;;
esac

asset="gitdrop-$os-$arch"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "→ Téléchargement de $asset…"
curl -fsSL "$BASE/$asset" -o "$tmp/$asset"
curl -fsSL "$BASE/$asset.sha256" -o "$tmp/$asset.sha256"

expected="$(cut -d' ' -f1 "$tmp/$asset.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
else
  echo "Aucun outil de somme de contrôle (sha256sum/shasum) : installation annulée." >&2
  exit 1
fi
if [ "$expected" != "$actual" ]; then
  echo "Somme de contrôle invalide : le téléchargement est corrompu ou altéré." >&2
  exit 1
fi

mkdir -p "$DIR"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$DIR/gitdrop"
echo "✔ Gitdrop installé dans $DIR/gitdrop"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *) echo "⚠ $DIR n'est pas dans votre PATH. Ajoutez à votre shell :  export PATH=\"$DIR:\$PATH\"" ;;
esac
echo "Essayez :  gitdrop login   puis   gitdrop push ./mon-projet"
