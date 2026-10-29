
import { CloudUpload, Github, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGitdropStore } from '@/store/gitdrop'

export function SiteHeader() {
  const session = useGitdropStore((s) => s.session)
  const sessionLoaded = useGitdropStore((s) => s.sessionLoaded)
  const step = useGitdropStore((s) => s.step)
  const setStep = useGitdropStore((s) => s.setStep)
  const disconnect = useGitdropStore((s) => s.disconnect)

  return (
    <header className="sticky top-0 z-40 border-b bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setStep(session ? 2 : 1)}
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-sm shadow-emerald-600/30">
            <CloudUpload className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-base font-bold tracking-tight">Gitdrop</span>
            <span className="hidden text-[10px] text-muted-foreground sm:block">
              Drop your project. Push to GitHub.
            </span>
          </span>
          <Badge variant="outline" className="hidden font-mono text-[10px] font-normal text-muted-foreground md:inline-flex">
            interface locale
          </Badge>
        </button>

        {sessionLoaded && session ? (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3">
              <Avatar className="h-7 w-7">
                {session.avatarUrl ? (
                  <AvatarImage src={session.avatarUrl} alt={`Avatar de ${session.login}`} />
                ) : null}
                <AvatarFallback className="bg-emerald-100 text-xs font-semibold text-emerald-700">
                  {session.login.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[120px] truncate text-xs font-medium">
                {session.login}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => disconnect()}
              aria-label="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Se déconnecter</span>
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setStep(1)} disabled={step === 1}>
            <Github className="h-4 w-4" />
            Connecter GitHub
          </Button>
        )}
      </div>
    </header>
  )
}
