
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useGitdropStore } from '@/store/gitdrop'
import { SiteHeader } from './site-header'
import { Stepper } from './stepper'
import { ConnectStep } from './connect-step'
import { UploadStep } from './upload-step'
import { ConfigStep } from './config-step'
import { PushStep } from './push-step'
import { HistoryPanel } from './history-panel'
import { SiteFooter } from './site-footer'

export function GitdropApp() {
  const step = useGitdropStore((s) => s.step)
  const fetchMe = useGitdropStore((s) => s.fetchMe)
  const loadHistory = useGitdropStore((s) => s.loadHistory)

  useEffect(() => {
    fetchMe()
    loadHistory()
  }, [fetchMe, loadHistory])

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Stepper />
        <div className="mt-8">
          {step === 1 && <ConnectStep />}
          {step === 2 && <UploadStep />}
          {step === 3 && <ConfigStep />}
          {step === 4 && <PushStep />}
        </div>
        <HistoryPanel />
      </main>
      <SiteFooter />
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}
