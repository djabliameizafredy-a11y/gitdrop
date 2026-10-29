
import { useState } from 'react'
import {
  Check,
  CheckCircle2,
  Circle,
  CloudUpload,
  Copy,
  Globe,
  ExternalLink,
  FileCheck2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Loader2,
  RotateCcw,
  Settings2,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useGitdropStore } from '@/store/gitdrop'
import { toast } from 'sonner'

const BASE_STEPS = ['files', 'commit', 'repo', 'push'] as const

const STEP_ICONS: Record<string, typeof Github> = {
  files: FileCheck2,
  commit: GitCommitHorizontal,
  repo: Github,
  push: CloudUpload,
  deploy: Globe,
}

export function PushStep() {
  const push = useGitdropStore((s) => s.push)
  const resetPush = useGitdropStore((s) => s.resetPush)
  const startPush = useGitdropStore((s) => s.startPush)
  const resetProject = useGitdropStore((s) => s.resetProject)
  const setStep = useGitdropStore((s) => s.setStep)
  const [copied, setCopied] = useState(false)
  const deploy = useGitdropStore((s) => s.config.deploy)
  const stepOrder = deploy ? ([...BASE_STEPS, 'deploy'] as const) : BASE_STEPS

  // -------------------------------------------------------------- success view
  if (push.done && push.result) {
    const r = push.result
    return (
      <Card className="overflow-hidden">
        <div className="bg-dots bg-gradient-to-br from-emerald-50 via-white to-violet-50 px-6 py-12 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 shadow-lg shadow-emerald-600/30">
            <Check className="h-8 w-8 text-white" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">Dépôt créé avec succès 🎉</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.fullName} • {r.fileCount} fichiers poussés
          </p>
          <div className="mx-auto mt-5 flex max-w-md items-center gap-2 rounded-xl border bg-white p-2 pl-3 shadow-sm">
            <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <code className="flex-1 truncate text-left font-mono text-sm">{r.url}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(r.url)
                  setCopied(true)
                  toast.success('Lien copié dans le presse-papiers')
                  setTimeout(() => setCopied(false), 2000)
                } catch {
                  toast.error('Copie impossible — sélectionnez le lien manuellement.')
                }
              }}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Copier
            </Button>
          </div>
          {r.siteUrl && (
            <a
              href={r.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{r.siteUrl}</span>
              <span className="shrink-0 text-xs font-normal text-emerald-700">en ligne dans ~1 min</span>
            </a>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <a href={r.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Ouvrir sur GitHub
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                resetPush()
                resetProject()
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Pousser un autre projet
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                document.getElementById('historique')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Voir l’historique
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  // ---------------------------------------------------------------- error view
  if (!push.running && push.error) {
    return (
      <Card>
        <CardContent className="space-y-4 py-10">
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Le push a échoué</AlertTitle>
            <AlertDescription>{push.error}</AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              onClick={() => {
                resetPush()
                void startPush()
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Réessayer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                resetPush()
                setStep(3)
              }}
            >
              <Settings2 className="h-4 w-4" />
              Modifier la configuration
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // --------------------------------------------------------------- running view
  return (
    <Card>
      <CardContent className="py-8">
        <div className="mx-auto max-w-xl space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-bold tracking-tight">La magie opère… ✨</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Votre projet part vers GitHub. Ne fermez pas cette page.
            </p>
          </div>

          <ul className="space-y-1" aria-live="polite">
            {stepOrder.map((id) => {
              const st = push.steps[id]?.status ?? 'pending'
              const label = push.steps[id]?.label ?? ''
              const Icon = STEP_ICONS[id]
              return (
                <li
                  key={id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                    st === 'running' && 'bg-emerald-50',
                    st === 'error' && 'bg-destructive/5'
                  )}
                >
                  {st === 'done' ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-100 text-emerald-600" aria-hidden="true" />
                  ) : st === 'running' ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-600" aria-hidden="true" />
                  ) : st === 'error' ? (
                    <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      st === 'pending' ? 'text-muted-foreground/70' : 'font-medium'
                    )}
                  >
                    {label}
                  </span>
                  {id === 'push' && st === 'running' && <GitBranch className="h-4 w-4 text-emerald-600/50" aria-hidden="true" />}
                </li>
              )
            })}
          </ul>

          {push.steps.push?.status === 'running' && push.percent > 0 && (
            <div className="space-y-1.5">
              <Progress value={push.percent} />
              <p className="text-center text-xs text-muted-foreground">{push.percent} % envoyé</p>
            </div>
          )}

          <p className="rounded-xl border border-dashed px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
            💡 Gitdrop utilise votre Git local : un commit propre est poussé sur la branche{' '}
            <code className="font-mono">main</code>, avec l’historique et les droits d’exécution
            préservés.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
