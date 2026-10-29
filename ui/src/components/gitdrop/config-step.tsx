
import { useState } from 'react'
import {
  FileText,
  GitCommitHorizontal,
  Github,
  Globe,
  History,
  Scale,
  Workflow,
  Loader2,
  Lock,
  Rocket,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format'
import { slugifyRepoName, type Visibility } from '@core/types'
import { useGitdropStore } from '@/store/gitdrop'
import { toast } from 'sonner'

export function ConfigStep() {
  const config = useGitdropStore((s) => s.config)
  const updateConfig = useGitdropStore((s) => s.updateConfig)
  const analysis = useGitdropStore((s) => s.analysis)
  const session = useGitdropStore((s) => s.session)
  const upload = useGitdropStore((s) => s.upload)
  const startPush = useGitdropStore((s) => s.startPush)
  const [starting, setStarting] = useState(false)

  const username = session?.login ?? 'vous'
  const slug = slugifyRepoName(config.name || ' ')

  async function handlePush() {
    if (!config.name.trim() || !slug) {
      toast.error('Choisissez d’abord un nom de dépôt valide.')
      return
    }
    setStarting(true)
    try {
      await startPush()
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configurez votre dépôt</CardTitle>
          <CardDescription>
            Dernière étape avant le push — Gitdrop s’occupe du reste.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="repo-name">Nom du repository</Label>
            <div className="flex items-center overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring">
              <span className="flex items-center gap-1.5 border-r bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                <Github className="h-3.5 w-3.5" aria-hidden="true" />
                {username}/
              </span>
              <Input
                id="repo-name"
                value={config.name}
                onChange={(e) => updateConfig({ name: slugifyRepoName(e.target.value) })}
                placeholder="mon-super-projet"
                className="border-0 font-mono text-sm shadow-none focus-visible:ring-0"
                autoComplete="off"
                maxLength={100}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lettres, chiffres, tirets uniquement — slug généré automatiquement.
            </p>
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <Label>Visibilité</Label>
            <RadioGroup
              value={config.visibility}
              onValueChange={(v) => updateConfig({ visibility: v as Visibility })}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <Label
                htmlFor="vis-public"
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                  config.visibility === 'public'
                    ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600'
                    : 'hover:bg-muted/50'
                )}
              >
                <RadioGroupItem value="public" id="vis-public" className="mt-0.5" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Globe className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    Public
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Visible par tout le monde, idéal pour l’open source.
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="vis-private"
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                  config.visibility === 'private'
                    ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600'
                    : 'hover:bg-muted/50'
                )}
              >
                <RadioGroupItem value="private" id="vis-private" className="mt-0.5" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Lock className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    Privé
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Visible uniquement par vous et vos collaborateurs.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="repo-desc">Description (optionnel)</Label>
            <Input
              id="repo-desc"
              value={config.description}
              onChange={(e) => updateConfig({ description: e.target.value })}
              placeholder="Ex. : Portfolio réalisé avec Next.js"
              maxLength={350}
            />
          </div>

          {/* README */}
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <FileText className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Générer un README.md
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {analysis?.hasReadme
                  ? 'Le projet contient déjà un README — il sera conservé.'
                  : 'Badges, stack détectée et instructions d’installation inclus.'}
              </p>
            </div>
            <Switch
              checked={analysis?.hasReadme ? false : config.readme}
              disabled={analysis?.hasReadme}
              onCheckedChange={(v) => updateConfig({ readme: v })}
              aria-label="Générer un README"
            />
          </div>

          {/* .gitignore */}
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <div>
              <p className="text-sm font-semibold">🪂 Générer un .gitignore intelligent</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {analysis?.hasGitignore
                  ? 'Le projet contient déjà un .gitignore — il sera conservé.'
                  : `Adapté à la stack ${analysis?.stack.label ?? 'détectée'} + protection des .env.`}
              </p>
            </div>
            <Switch
              checked={analysis?.hasGitignore ? false : config.addGitignore}
              disabled={analysis?.hasGitignore}
              onCheckedChange={(v) => updateConfig({ addGitignore: v })}
              aria-label="Générer un .gitignore"
            />
          </div>

          {/* Clean history */}
          {analysis?.hasGit && (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <History className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Repartir d’un historique propre
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {analysis.history?.findings.length
                    ? 'Recommandé : l’historique contient des secrets. GitHub ne recevra qu’un seul commit.'
                    : 'GitHub ne recevra qu’un seul commit ; votre historique local reste intact.'}
                </p>
              </div>
              <Switch
                checked={config.freshHistory}
                onCheckedChange={(v) => updateConfig({ freshHistory: v })}
                aria-label="Repartir d’un historique propre"
              />
            </div>
          )}

          {/* Deploy */}
          {analysis?.deploy && (
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Globe className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    Mettre le site en ligne
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {analysis.deploy.label} — un workflow GitHub Pages est ajouté et activé.
                  </p>
                </div>
                <Switch
                  checked={config.deploy}
                  onCheckedChange={(v) => updateConfig({ deploy: v })}
                  aria-label="Mettre le site en ligne avec GitHub Pages"
                />
              </div>
              {config.deploy && config.visibility === 'private' && (
                <p className="mt-2 text-xs text-amber-700">
                  GitHub Pages sur un dépôt privé exige un plan payant : choisissez « Public » pour que le
                  site soit publié.
                </p>
              )}
            </div>
          )}

          {/* CI */}
          {analysis?.canCi && (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Workflow className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Ajouter un workflow CI
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Build et tests lancés à chaque push et pull request.
                </p>
              </div>
              <Switch
                checked={config.ci}
                onCheckedChange={(v) => updateConfig({ ci: v })}
                aria-label="Ajouter un workflow CI"
              />
            </div>
          )}

          {/* License */}
          {analysis && !analysis.hasLicense && (
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Scale className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Licence
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Ajoute un fichier LICENSE au dépôt.</p>
              </div>
              <select
                value={config.license}
                onChange={(e) => updateConfig({ license: e.target.value as typeof config.license })}
                aria-label="Licence"
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="none">Aucune</option>
                <option value="mit">MIT</option>
                <option value="isc">ISC</option>
                <option value="unlicense">Unlicense</option>
              </select>
            </div>
          )}

          {/* Commit message */}
          <div className="space-y-2">
            <Label htmlFor="commit-msg">Message du commit</Label>
            <Input
              id="commit-msg"
              value={config.commitMessage}
              onChange={(e) => updateConfig({ commitMessage: e.target.value })}
              placeholder="Initial commit"
              maxLength={200}
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Récapitulatif</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Projet</span>
              <span className="max-w-[170px] truncate font-medium">
                {upload.rootName ?? 'fichiers déposés'}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Stack</span>
              <span className="font-medium">
                {analysis ? `${analysis.stack.emoji} ${analysis.stack.label}` : '—'}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Contenu</span>
              <span className="font-medium">
                {analysis ? `${analysis.fileCount} fichiers • ${formatBytes(analysis.totalSize)}` : '—'}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Sensibles exclus</span>
              <span className="font-medium">{config.excludePaths.length}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Dépôt</span>
              <code className="max-w-[180px] truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                {username}/{slug || '…'}
              </code>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Visibilité</span>
              <Badge
                variant="outline"
                className="gap-1 text-[11px]"
              >
                {config.visibility === 'private' ? (
                  <>
                    <Lock className="h-3 w-3" aria-hidden="true" /> Privé
                  </>
                ) : (
                  <>
                    <Globe className="h-3 w-3" aria-hidden="true" /> Public
                  </>
                )}
              </Badge>
            </div>

            <Button className="mt-2 h-11 w-full text-base" onClick={() => void handlePush()} disabled={starting}>
              {starting ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Rocket className="h-5 w-5" aria-hidden="true" />
              )}
              Pousser sur GitHub
            </Button>
            <p className="flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              Envoi direct vers GitHub depuis votre machine — rien n’est conservé ailleurs.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
