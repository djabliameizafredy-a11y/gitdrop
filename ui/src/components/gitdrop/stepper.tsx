
import { Check, FolderUp, Github, Rocket, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGitdropStore } from '@/store/gitdrop'

const STEPS = [
  { id: 1 as const, label: 'Connexion', icon: Github },
  { id: 2 as const, label: 'Projet', icon: FolderUp },
  { id: 3 as const, label: 'Configuration', icon: Settings2 },
  { id: 4 as const, label: 'Envoi', icon: Rocket },
]

export function Stepper() {
  const step = useGitdropStore((s) => s.step)
  const setStep = useGitdropStore((s) => s.setStep)

  return (
    <nav aria-label="Étapes du push" className="flex items-start gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const state = s.id < step ? 'done' : s.id === step ? 'current' : 'todo'
        const Icon = s.icon
        return (
          <div key={s.id} className="flex flex-1 items-start gap-1.5 sm:gap-3">
            <button
              type="button"
              disabled={s.id >= step}
              onClick={() => setStep(s.id)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg px-1 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                s.id < step ? 'cursor-pointer' : 'cursor-default'
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full border-2 transition-colors',
                  state === 'current' &&
                    'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
                  state === 'done' && 'border-emerald-600 bg-emerald-50 text-emerald-700',
                  state === 'todo' && 'border-border bg-white text-muted-foreground'
                )}
              >
                {state === 'done' ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span
                className={cn(
                  'text-[10px] font-medium sm:text-xs',
                  state === 'todo' ? 'text-muted-foreground' : 'text-foreground'
                )}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="mt-[18px] h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className={cn(
                    'h-full rounded-full bg-emerald-500 transition-all duration-500',
                    s.id < step ? 'w-full' : 'w-0'
                  )}
                />
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
