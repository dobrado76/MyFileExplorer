import { createRoot } from 'react-dom/client'
import { defaultSettings } from '@shared/schemas/settings'
import { NowPlayingApp } from './components/NowPlayingApp'
import { useAppStore } from './store/appStore'
import './styles/tokens.css'
import './styles/app.css'

const win32 = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
useAppStore.setState({
  settings: defaultSettings,
  platform: win32 ? 'win32' : 'linux'
})

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(<NowPlayingApp />)
}
