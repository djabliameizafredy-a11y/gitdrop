
import { useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Eye, EyeOff, Github, KeyRound, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGitdropStore } from '@/store/gitdrop'

export const GITHUB_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Gitdrop'

export function ConnectStep() {
  const connect = useGitdropStore((s) => s.connect)
  const connecting = useGitdropStore((s) => s.connecting)
  const connectError = useGitdropStore((s) => s.connectError)
  const app = useGitdropStore((s) => s.app)
  const device = useGitdropStore((s) => s.device)
  const startDeviceLogin = useGitdropStore((s) => s.startDeviceLogin)
  const cancelDeviceLogin = useGitdropStore((s) => s.cancelDeviceLogin)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(!app.deviceFlow)

  useEffect(() => {
    setManual(!app.deviceFlow)
  }, [app.deviceFlow])
  useEffect(() => () => cancelDeviceLogin(), [cancelDeviceLogin])

  const error = connectError && (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{connectError}</AlertDescription>
    </Alert>
  )

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" aria-hidden="true" />
            Connecter votre compte GitHub
          </CardTitle>
          <CardDescription>
            {app.deviceFlow
              ? 'Autorisez Gitdrop depuis GitHub — une seule fois, sans copier de token.'
              : 'Collez un token d’accès personnel (classique) avec les scopes « repo » et « workflow ».'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!app.git && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Git n’est pas installé sur cette machine : Gitdrop en a besoin pour pousser. Installez-le
                depuis git-scm.com puis relancez <code className="font-mono">gitdrop ui</code>.
              </AlertDescription>
            </Alert>
          )}

          {app.deviceFlow && device && (
            <div className="space-y-3 text-center">
              {device.status === 'waiting' ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Entrez ce code sur{' '}
                    <a
                      href={device.code.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-emerald-700 underline"
                    >
                      {device.code.verificationUri.replace('https://', '')}
                    </a>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(device.code.userCode)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                    className="mx-auto flex items-center gap-2 rounded-xl border bg-muted/40 px-5 py-3 font-mono text-2xl font-bold tracking-widest hover:bg-muted"
                    aria-label="Copier le code"
                  >
                    {device.code.userCode}
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                  <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    En attente de l’autorisation…
                  </p>
                  <Button variant="ghost" size="sm" onClick={cancelDeviceLogin}>
                    Annuler
                  </Button>
                </>
              ) : (
                <>
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {device.status === 'denied'
                        ? 'Autorisation refusée dans le navigateur.'
                        : 'Le code a expiré.'}
                    </AlertDescription>
                  </Alert>
                  <Button className="w-full" onClick={startDeviceLogin}>
                    Réessayer
                  </Button>
                </>
              )}
            </div>
          )}

          {app.deviceFlow && !device && (
            <Button className="w-full" disabled={connecting || !app.git} onClick={startDeviceLogin}>
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Github className="h-4 w-4" aria-hidden="true" />
              )}
              Se connecter avec GitHub
            </Button>
          )}

          {app.deviceFlow && !device && (
            <button
              type="button"
              onClick={() => setManual((v) => !v)}
              className="mx-auto block text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {manual ? 'Masquer' : 'Utiliser plutôt un token personnel'}
            </button>
          )}

          {manual && !device && (
            <div className="space-y-2">
              <Label htmlFor="token">Token d’accès personnel</Label>
              <div className="relative">
                <Input
                  id="token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_…"
                  autoComplete="off"
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? 'Masquer le token' : 'Afficher le token'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <a
                href={GITHUB_TOKEN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                Créer mon token sur GitHub (formulaire pré-rempli)
              </a>
              <Button
                className="w-full"
                variant={app.deviceFlow ? 'outline' : 'default'}
                disabled={connecting || token.trim().length < 20 || !app.git}
                onClick={() => connect(token.trim())}
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Github className="h-4 w-4" aria-hidden="true" />
                )}
                Se connecter avec ce token
              </Button>
            </div>
          )}

          {error}
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Le token est conservé uniquement sur votre machine (dossier de configuration de Gitdrop,
            droits restreints) et n’est envoyé qu’à GitHub.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
