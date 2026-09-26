import { CityCanvas } from './scene/CityCanvas'
import { HeaderBar } from './ui/components/HeaderBar'
import { OverlapPanel } from './ui/components/OverlapPanel'
import { Legend } from './ui/components/Legend'

export default function App() {
  return (
    <div className="app-shell">
      <CityCanvas />
      <HeaderBar />
      <OverlapPanel />
      <Legend />
    </div>
  )
}
