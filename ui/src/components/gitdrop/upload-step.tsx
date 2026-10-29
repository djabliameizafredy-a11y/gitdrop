
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  CloudUpload,
  FileArchive,
  FileText,
  Files,
  FileUp,
  FolderUp,
  HardDrive,
  Loader2,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  analyzeWorkspace,
  collectFromDataTransfer,
  collectFromInput,
  zipAndUpload,
  type CollectedFile,
} from '@/lib/client'
import { formatBytes } from '@/lib/format'
import { useGitdropStore } from '@/store/gitdrop'
import { toast } from 'sonner'

let preloadConsumed = false

export function UploadStep() {
  const upload = useGitdropStore((s) => s.upload)
  const analysis = useGitdropStore((s) => s.analysis)
  const config = useGitdropStore((s) => s.config)
  const setUpload = useGitdropStore((s) => s.setUpload)
  const uploadReady = useGitdropStore((s) => s.uploadReady)
  const setAnalysis = useGitdropStore((s) => s.setAnalysis)
  const freshHistory = useGitdropStore((s) => s.config.freshHistory)
  const applyAnalysisToConfig = useGitdropStore((s) => s.applyAnalysisToConfig)
  const updateConfig = useGitdropStore((s) => s.updateConfig)
  const toggleExclude = useGitdropStore((s) => s.toggleExclude)
  const resetProject = useGitdropStore((s) => s.resetProject)
  const setStep = useGitdropStore((s) => s.setStep)

  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dirInputRef.current?.setAttribute('webkitdirectory', '')
    dirInputRef.current?.setAttribute('directory', '')
  }, [])

  async function analyzeAndFinish(workspaceId: string) {
    setUpload({ phase: 'analyzing' })
    const a = await analyzeWorkspace(workspaceId)
    setAnalysis(a)
    setUpload({ phase: 'ready' })
  }

  // `gitdrop ui ./projet`: the folder is analysed in place (with its .git history), once.
  const preload = useGitdropStore((s) => s.app.preload)
  useEffect(() => {
    if (!preload || preloadConsumed || upload.phase !== 'idle') return
    preloadConsumed = true
    uploadReady({ workspaceId: preload.workspaceId, fileCount: 0, totalSize: 0, rootName: preload.name })
    analyzeAndFinish(preload.workspaceId).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Analyse impossible'
      setUpload({ phase: 'error', error: msg })
      toast.error(msg)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload])

  async function processSelection(collected: { files: CollectedFile[]; skipped: number }) {
    if (collected.skipped > 0) {
      toast.info(
        `${collected.skipped} élément(s) ignoré(s) automatiquement (node_modules, .git, fichiers système…)`
      )
    }
    try {
      setUpload({ phase: 'zipping', progress: 0, error: null })
      const res = await zipAndUpload(collected.files, (phase, progress) =>
        setUpload({ phase, progress })
      )
      uploadReady(res)
      await analyzeAndFinish(res.workspaceId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Une erreur est survenue'
      setUpload({ phase: 'error', error: msg })
      toast.error(msg)
    }
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const dt = e.dataTransfer
    if (!dt) return
    const collected = await collectFromDataTransfer(dt)
    await processSelection(collected)
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    // Copy first: resetting the input empties the live FileList in Chrome.
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    void processSelection(collectFromInput(picked))
  }

  // ------------------------------------------------------------------ loading
  if (
    upload.phase === 'zipping' ||
    upload.phase === 'uploading' ||
    upload.phase === 'analyzing'
  ) {
    const label =
      upload.phase === 'zipping'
        ? `Compression des fichiers… ${upload.progress} %`
        : upload.phase === 'uploading'
          ? `Envoi vers Gitdrop… ${upload.progress} %`
          : 'Analyse du projet…'
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" aria-hidden="true" />
          <Progress value={upload.phase === 'analyzing' ? undefined : upload.progress} className="max-w-sm" />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {label}
          </p>
        </CardContent>
      </Card>
    )
  }

  // ----------------------------------------------------------------- analysis
  if (upload.phase === 'ready' && analysis) {
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">Analyse du projet</CardTitle>
            <CardDescription>
              {analysis.fileCount} fichiers prêts • {formatBytes(analysis.totalSize)}
              {upload.rootName ? ` • dossier « ${upload.rootName} »` : ''}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => resetProject()}>
            <RotateCcw className="h-4 w-4" />
            Changer de projet
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Files className="h-3.5 w-3.5" aria-hidden="true" /> Fichiers
              </p>
              <p className="mt-1 text-xl font-semibold">{analysis.fileCount}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" /> Taille
              </p>
              <p className="mt-1 text-xl font-semibold">{formatBytes(analysis.totalSize)}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Stack détectée</p>
              <p className="mt-1 truncate text-sm font-semibold">
                {analysis.stack.emoji} {analysis.stack.label}
              </p>
              {analysis.stack.details.length > 0 && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {analysis.stack.details.join(' • ')}
                </p>
              )}
            </div>
            <div className="rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" /> README
              </p>
              <p className="mt-1 text-sm font-semibold">
                {analysis.hasReadme ? 'Déjà présent' : 'Sera généré ✨'}
              </p>
            </div>
          </div>

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              {analysis.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {/* Secrets found in the Git history */}
          {analysis.history && analysis.history.findings.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-4" role="alert">
              <p className="flex items-center gap-2 font-medium text-red-800">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Secrets dans l’historique Git ({analysis.history.findings.length})
              </p>
              <p className="mt-1 text-xs leading-relaxed text-red-700">
                Ces fichiers ont été commités dans ce dossier ({analysis.history.commits} commits analysés)
                et seraient publiés avec l’historique, même supprimés depuis. Par défaut, Gitdrop ne
                publie qu’un seul commit propre. <strong>Considérez ces clés comme compromises et
                révoquez-les.</strong>
              </p>
              <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1 scroll-slim">
                {analysis.history.findings.map((f) => (
                  <li key={f.path} className="rounded-lg border border-red-200/70 bg-white p-2.5">
                    <p className="truncate font-mono text-xs font-medium">
                      {f.path}{' '}
                      <span className="font-sans font-normal text-muted-foreground">
                        · commit {f.commit}
                        {f.stillPresent ? ' · toujours présent' : ' · supprimé depuis'}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.reasons.map((r) => (
                        <Badge
                          key={r}
                          variant="outline"
                          className="border-red-300 bg-red-100/60 text-[10px] font-normal text-red-800"
                        >
                          {r}
                        </Badge>
                      ))}
                    </div>
                    {f.providers.map((p) => (
                      <a
                        key={p.name}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 block text-[11px] font-medium text-red-700 underline"
                      >
                        Révoquer la clé {p.name} →
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
              {analysis.history.truncated && (
                <p className="mt-2 text-[11px] text-red-700">Analyse limitée aux premiers 64 Mo d’historique.</p>
              )}
            </div>
          )}

          {/* Sensitive files */}
          {analysis.sensitiveFiles.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="flex items-center gap-2 font-medium text-amber-800">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Fichiers sensibles détectés ({analysis.sensitiveFiles.length})
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-700">
                Par défaut, Gitdrop les exclut du push et les ajoute au .gitignore : ils
                resteront sur votre machine, et un .env.example sans valeurs est créé pour les
                variables d’environnement. Décochez si vous savez ce que vous faites.
              </p>
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1 scroll-slim">
                {analysis.sensitiveFiles.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-start gap-2.5 rounded-lg border border-amber-200/70 bg-white p-2.5"
                  >
                    <Checkbox
                      id={`sec-${f.path}`}
                      checked={config.excludePaths.includes(f.path)}
                      onCheckedChange={() => toggleExclude(f.path)}
                      className="mt-0.5"
                      aria-label={`Exclure ${f.path} du push`}
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`sec-${f.path}`}
                        className="block cursor-pointer truncate font-mono text-xs font-medium"
                      >
                        {f.path}
                      </label>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {f.reasons.map((r) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className="border-amber-300 bg-amber-100/60 text-[10px] font-normal text-amber-800"
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* .gitignore preview */}
          {analysis.gitignoreContent ? (
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50">
                <span>🪂 Un .gitignore adapté ({analysis.stack.label}) sera généré</span>
                <span className="text-xs text-muted-foreground group-data-[state=open]:hidden">
                  Prévisualiser
                </span>
                <span className="hidden text-xs text-muted-foreground group-data-[state=open]:inline">
                  Masquer
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed scroll-slim">
                  {analysis.gitignoreContent}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
              Un fichier .gitignore est déjà présent dans le projet : il sera conservé.
            </p>
          )}

          {analysis.hasGit && (
            <p className="text-xs text-muted-foreground">
              ℹ️ Un historique Git local a été détecté.{' '}
              {freshHistory
                ? 'GitHub ne recevra qu’un seul commit propre ; votre historique local reste intact.'
                : 'Tout l’historique sera publié — activez « Repartir d’un historique propre » à l’étape suivante pour n’envoyer qu’un commit.'}
            </p>
          )}

          {/* Continue */}
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => resetProject()}>
              <RotateCcw className="h-4 w-4" />
              Changer de projet
            </Button>
            <Button
              onClick={() => {
                applyAnalysisToConfig()
                setStep(3)
              }}
            >
              Continuer
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ----------------------------------------------------------------- dropzone
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Déposer votre projet ici"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging
            ? 'scale-[1.01] border-emerald-600 bg-emerald-50'
            : 'border-border hover:border-emerald-500 hover:bg-emerald-50/40'
        )}
      >
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100">
          <CloudUpload
            className={cn('h-8 w-8 text-emerald-600', dragging && 'animate-bounce')}
            aria-hidden="true"
          />
        </span>
        <p className="text-lg font-semibold">Glissez votre projet ici</p>
        <p className="text-sm text-muted-foreground">
          Dossier, fichiers ou archive .zip — 90 Mo max
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
          >
            <FileUp className="h-4 w-4" />
            Parcourir les fichiers
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              dirInputRef.current?.click()
            }}
          >
            <FolderUp className="h-4 w-4" />
            Choisir un dossier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              zipInputRef.current?.click()
            }}
          >
            <FileArchive className="h-4 w-4" />
            Importer un .zip
          </Button>
        </div>
      </div>

      {upload.phase === 'error' && upload.error && (
        <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {upload.error}
        </p>
      )}

      <p className="mx-auto mt-4 max-w-xl text-center text-xs leading-relaxed text-muted-foreground">
        node_modules, .git et fichiers système sont ignorés automatiquement. Vos fichiers
        transitent uniquement vers GitHub — rien d’autre.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPick}
        aria-label="Sélectionner des fichiers"
      />
      <input
        ref={dirInputRef}
        type="file"
        className="hidden"
        onChange={onPick}
        aria-label="Sélectionner un dossier"
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={onPick}
        aria-label="Sélectionner une archive zip"
      />
    </div>
  )
}
