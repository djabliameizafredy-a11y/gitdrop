
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Github, Globe, History, Lock, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useGitdropStore } from '@/store/gitdrop'

export function HistoryPanel() {
  const history = useGitdropStore((s) => s.history)
  const historyLoaded = useGitdropStore((s) => s.historyLoaded)
  const loadHistory = useGitdropStore((s) => s.loadHistory)

  return (
    <section id="historique" className="mt-12" aria-label="Historique des pushes">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Historique des pushes
            </CardTitle>
            <CardDescription className="text-xs">
              Les dépôts créés avec Gitdrop sur cette machine.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadHistory()}
            aria-label="Rafraîchir l’historique"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {!historyLoaded ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
              Aucun push pour le moment — votre premier dépôt apparaîtra ici.
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1 scroll-slim">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <Github className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={item.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {item.username}/{item.repoName}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {item.fileCount} fichiers •{' '}
                      {formatDistanceToNow(new Date(item.createdAt), {
                        addSuffix: true,
                        locale: fr,
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      {item.visibility === 'private' ? (
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
