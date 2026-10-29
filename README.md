# Gitdrop 🪂

**Drop your project. Push to GitHub.**

Gitdrop crée un dépôt GitHub et y pousse un dossier ou un `.zip` en quelques secondes — sans
connaître les remotes, les branches ni `gh` — puis vous accompagne après le premier push. En ligne de
commande, ou depuis une interface web locale avec glisser-déposer.

```bash
npm install -g gitdrop          # ou le binaire autonome, sans Node.js (voir plus bas)

gitdrop login                   # une seule fois
gitdrop push ./mon-projet       # repo créé et poussé
gitdrop push ./mon-site --public --deploy   # …et le site est en ligne
```

## Ce que fait `gitdrop push`

1. Vérifie la connexion GitHub (lance `gitdrop login` si besoin).
2. Détecte la stack (Next.js, React, Laravel, Python, Flutter, Go…).
3. **Protège vos secrets** (voir ci-dessous) : fichiers sensibles exclus, `.env.example` généré,
   historique Git analysé.
4. Génère un `.gitignore` adapté et un `README.md` si absents ; ajoute au choix une licence, un
   workflow CI, des topics GitHub.
5. Crée le commit en local, puis le dépôt GitHub, puis pousse sur `main`.
6. Publie le site sur GitHub Pages si demandé, et affiche les liens.

Le dépôt n'est créé qu'**après** le commit local : une erreur locale ne laisse jamais de dépôt vide
derrière elle. Si un push est interrompu, relancez la même commande : le dépôt vide est réutilisé.

## Commandes

| Commande | Rôle |
|---|---|
| `gitdrop push [chemin]` | Publie un dossier ou un `.zip` (défaut : dossier courant) |
| `gitdrop update ["message"]` | Commit + push. Sans message : un Conventional Commit est généré depuis le diff |
| `gitdrop update -b feat/x --pr` | Pousse sur une branche et ouvre la pull request |
| `gitdrop watch [dossier]` | Pousse automatiquement chaque modification (avec garde-fou secrets) |
| `gitdrop undo` | Annule le dernier commit poussé (commit d'annulation, jamais de force-push) |
| `gitdrop deploy` | Publie sur GitHub Pages un dépôt déjà poussé |
| `gitdrop ui [chemin]` | Interface web locale ; avec un chemin, le dossier est analysé sur place |
| `gitdrop login` / `logout` / `whoami` | Gestion de la connexion GitHub |
| `gitdrop history` | Derniers dépôts créés |

Options de `push` : `--name`, `--public` / `--private` (privé par défaut), `--readme` / `--no-readme`,
`--no-gitignore`, `--message`, `--description`, `--license mit|isc|unlicense`, `--ci`, `--deploy`,
`--topics a,b`, `--fresh-history`, `--force`, `--no-env-example`, `--yes` (aucune question).

## Sécurité

- **Fichiers sensibles** : `.env`, clés privées, identifiants… exclus par défaut (même si vous
  désactivez la génération du `.gitignore`). Une quinzaine de formats de clés sont reconnus (AWS,
  GitHub, OpenAI, Anthropic, Stripe, Slack, Google, SendGrid, npm, Twilio, Discord, Telegram, clés
  privées, URL de base de données) plus une détection par entropie ; les valeurs d'exemple sont ignorées.
- **`.env.example`** : créé automatiquement à côté d'un `.env` exclu — les noms de variables, jamais les valeurs.
- **Historique Git** : si le dossier a déjà un `.git`, tout son historique est analysé (fichiers
  sensibles ajoutés puis supprimés, secrets dans les lignes ajoutées). Gitdrop vous indique **où révoquer
  chaque clé** et propose `--fresh-history` : GitHub ne reçoit qu'un seul commit propre, votre
  historique local reste intact. En mode non interactif, un historique contenant des secrets bloque
  le push sauf `--fresh-history` ou `--force`.
- `gitdrop update` et `gitdrop watch` refusent de pousser des fichiers sensibles sans `--force`.
- **Une clé déjà commitée doit être considérée comme compromise** : la révoquer reste indispensable,
  même après une publication propre.

## Mettre un site en ligne (GitHub Pages)

`--deploy` (ou l'interrupteur dans l'interface) active GitHub Pages et ajoute un workflow de
déploiement. Projets supportés : **site statique** (`index.html`), **Vite**, **Create React App**
(le chemin de base `/<dépôt>/` est géré). Les frameworks à rendu serveur (Next.js, Nuxt, SvelteKit…)
ne sont pas supportés pour l'instant. Le workflow est poussé dans un second commit, une fois Pages
activé, pour que son premier run n'échoue pas. Un dépôt **privé** exige un plan GitHub payant : le push
réussit alors, et Gitdrop indique que le site n'a pas été publié.

## Installation

```bash
# Après la première publication sur npm, avec Node.js ≥ 20
npm install -g gitdrop

# Sans Node.js — binaire autonome (macOS / Linux), après une release
curl -fsSL https://github.com/djabliameizafredy-a11y/gitdrop/releases/latest/download/install.sh | sh

# Windows (PowerShell), après une release
irm https://github.com/djabliameizafredy-a11y/gitdrop/releases/latest/download/install.ps1 | iex
```

Le dépôt GitHub est public. Pour installer depuis les sources avant la première publication npm ou
la première release binaire, utilisez Node.js ≥ 20 et Git :

```bash
git clone https://github.com/djabliameizafredy-a11y/gitdrop.git
cd gitdrop
npm ci
npm run build
npm link
```

Les scripts d'installation des binaires vérifient leur somme SHA-256. Double-cliquer un binaire
(sans argument) ouvre directement l'interface. Prérequis dans tous les cas : **Git** installé.

## Connexion GitHub

- **Device Flow** (recommandé) : `gitdrop login` affiche un code à saisir sur `github.com/login/device`.
- **Token personnel** : `gitdrop login --token ghp_…` (scopes `repo` + `workflow`).
- **GitHub CLI** : `gitdrop login --gh` réutilise votre session `gh`.
- **CI / scripts** : variable d'environnement `GITDROP_TOKEN` (ou `GH_TOKEN` / `GITHUB_TOKEN`).

Le token est stocké dans `~/.config/gitdrop/config.json` (`%APPDATA%\gitdrop` sous Windows) avec les
droits `0600`. `gitdrop logout` le supprime. Il n'est jamais écrit dans le projet, ni dans l'URL du
remote, ni visible dans la liste des processus.

## Interface locale

`gitdrop ui` démarre un serveur sur `127.0.0.1` uniquement. Vos fichiers ne quittent jamais votre
machine, sauf vers GitHub. L'API locale n'accepte que les requêtes portant une clé aléatoire (dans
l'URL ouverte, générée à chaque lancement) et vérifie les en-têtes `Host` et `Origin`, ce qui bloque
les autres sites web et le DNS rebinding. Les navigateurs ne transmettent pas le dossier `.git` :
pour analyser l'historique d'un projet, lancez `gitdrop ui ./mon-projet`.

## Développement

```bash
npm install
npm run build          # CLI + interface → dist/
npm run build:binary   # exécutable autonome pour la plateforme courante → dist/bin/
npm test               # tests unitaires + de bout en bout contre un faux GitHub local
npm run dev:cli -- push ./un-projet
```

Les tests lancent le vrai CLI contre un faux serveur GitHub et de vrais dépôts Git « bare ». Pour
tester le binaire : `GITDROP_CLI=$PWD/dist/bin/gitdrop-linux-x64 node --test test/e2e.test.mjs`.

### Activer le Device Flow dans votre build

1. Créez une **OAuth App** sur <https://github.com/settings/developers> et cochez *Enable Device Flow*.
2. Construisez avec son *Client ID* (public, ce n'est pas un secret) :
   `GITDROP_CLIENT_ID=Iv1.xxxxxxxx npm run build` (ou définissez `GITDROP_CLIENT_ID` à l'exécution).
   Sans Client ID, Gitdrop propose la saisie d'un token.

### Publier

```bash
git tag v1.0.0 && git push --tags
```

- `publish.yml` construit, teste et publie sur npm avec provenance via npm Trusted Publishing (OIDC).
  Configurez d'abord `djabliameizafredy-a11y/gitdrop` et le workflow `publish.yml` comme éditeur de
  confiance dans les paramètres du paquet npm, avec la permission de publier. Le premier tag publie
  la version déclarée dans `package.json`.
- `release.yml` construit les binaires (Linux x64/arm64, macOS x64/arm64, Windows x64) et les joint à
  la release GitHub avec `install.sh` et `install.ps1`. Les scripts pointent vers
  `djabliameizafredy-a11y/gitdrop` (surcharge possible avec `GITDROP_REPO`). Variable de dépôt optionnelle :
  `GITDROP_CLIENT_ID`.

## Licence

MIT
