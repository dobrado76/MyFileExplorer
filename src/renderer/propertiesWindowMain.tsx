import { createRoot } from 'react-dom/client'
import { PropertiesWindowApp } from './components/PropertiesWindowApp'
import './styles/tokens.css'
import './styles/app.css'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<PropertiesWindowApp />)
}
