
import { Lock } from 'lucide-react'
import { useGitdropStore } from '@/store/gitdrop'

export function SiteFooter() {
  const version = useGitdropStore((s) => s.app.version)
  return (
    <footer className="mt-auto border-t bg-muted/30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-1.5 px-4 py-3.5 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
        <p>
          <strong className="font-semibold text-foreground">Gitdrop</strong>
          {version ? ` · v${version}` : ''} · interface locale
        </p>
        <p className="flex items-center gap-1.5 text-center sm:text-right">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          Vos fichiers ne transitent que vers GitHub. Projet indépendant, non affilié à GitHub.
        </p>
      </div>
    </footer>
  )
}
