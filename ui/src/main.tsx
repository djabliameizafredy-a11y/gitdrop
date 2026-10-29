import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GitdropApp } from '@/components/gitdrop/gitdrop-app'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GitdropApp />
  </StrictMode>
)
