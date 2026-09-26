import { CityCanvas } from './scene/CityCanvas'
import { HeaderBar } from './ui/components/HeaderBar'
import { OverlapPanel } from './ui/components/OverlapPanel'
import { Legend } from './ui/components/Legend'
import { AgentBar } from './ui/components/AgentBar'
import { ViewModes } from './ui/components/ViewModes'
import './styles/viewmodes.css'

export default function App() {
  return (
    <div className="app-shell">
      <CityCanvas />
      <HeaderBar />
      <OverlapPanel />
      <Legend />
      <AgentBar />
      <ViewModes />
    </div>
  )
}
