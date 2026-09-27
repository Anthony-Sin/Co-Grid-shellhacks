import { CityCanvas } from './scene/CityCanvas'
import { HeaderBar } from './ui/components/HeaderBar'
import { OverlapPanel } from './ui/components/OverlapPanel'
import { AgentBar } from './ui/components/AgentBar'
import { ViewModes } from './ui/components/ViewModes'
import './styles/viewmodes.css'

export default function App() {
  // Legend is intentionally unmounted — the left rail already carries
  // tier checkboxes + utility chips, so the floating legend was redundant
  // (the detail cards it used to host now live inside the agent rail).
  return (
    <div className="app-shell">
      <CityCanvas />
      <HeaderBar />
      <OverlapPanel />
      <AgentBar />
      <ViewModes />
    </div>
  )
}
