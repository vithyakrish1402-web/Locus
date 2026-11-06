import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Map, Building2, Users } from 'lucide-react';
import '../src/index.css';
import BuildingDirectory from '../src/components/map/BuildingDirectory';
import BottomTabBar from '../src/components/BottomTabBar';
import { AnimatedThemeToggler } from '../src/components/ui/animated-theme-toggler';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase';
import { installTheme } from '../src/theme/theme';
import { installPerformanceMode } from '../src/utils/performanceMode';
installTheme(); installPerformanceMode();
const tabs = [{ id: 'map', label: 'Map', Icon: Map, flourish: 'lift' }, { id: 'buildings', label: 'Buildings', Icon: Building2, flourish: 'lift' }, { id: 'group', label: 'Group', Icon: Users, flourish: 'pop' }];
function Preview() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('buildings');
  const act = (action, building) => { window.lastDirectoryAction = { action, id: building.id }; };
  return <main className="bg-bg text-text font-ui" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="section-page-header flex items-center justify-between px-5 py-4"><h1 className="text-xl font-semibold">Buildings</h1><AnimatedThemeToggler /></header>
    <div className="directory-scroll flex-1 min-h-0 overflow-auto px-4 pb-24">
      <BuildingDirectory places={SRM_MASTER_DATABASE} query={query} onSearch={setQuery} me={{ lat: 12.8237, lng: 80.0444 }}
        onOpen={b => act('open', b)} onArScan={b => act('scan', b)} onNavigate={b => act('navigate', b)} />
    </div><BottomTabBar tabs={tabs} activeId={tab} onSelect={setTab} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview />);
