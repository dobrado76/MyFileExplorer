import { createRoot } from 'react-dom/client'
import { CompiledListsWindowApp } from './components/CompiledListsWindowApp'
import './styles/tokens.css'
import './styles/app.css'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<CompiledListsWindowApp />)
}
