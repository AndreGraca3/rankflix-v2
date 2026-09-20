import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// tailwind.css must be imported first: it establishes Tailwind v4's cascade layer order
// (theme, base, components, utilities). index.css's legacy rules are wrapped in `@layer base`
// so Tailwind's utility classes (layer `utilities`) always win over them regardless of
// selector specificity or import order - unlayered CSS otherwise always beats layered CSS,
// which is what caused Tailwind classes like `rounded-full`/`bg-none`/`p-0` on plain elements
// to be silently overridden by index.css's legacy resets.
import './tailwind.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
