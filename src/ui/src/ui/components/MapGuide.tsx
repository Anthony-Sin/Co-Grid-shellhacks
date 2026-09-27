import { useState } from 'react'

export function MapGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="map-guide">
      <button
        className="map-guide-button"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Close guide ×' : 'How to use the map ?'}
      </button>

      {open && (
        <div className="map-guide-card">
          <h2>Explore the grid</h2>
          <p>Drag to move around the map. Scroll to zoom in or out.</p>
          <p>Select a colored overlap to see its project details.</p>
          <p>Switch between GA + SC, Savannah, and Augusta above.</p>
        </div>
      )}
    </div>
  )
}
