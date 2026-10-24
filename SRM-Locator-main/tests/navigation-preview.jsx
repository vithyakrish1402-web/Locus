import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import TacticalLeafletMap from '../src/components/TacticalLeafletMap';
import { MapControls } from '../src/components/map/MapControls';
import MeetingPointConfirm from '../src/components/MeetingPointConfirm';
const origin = {lat:12.8231,lng:80.0442};
const end = {lat:12.824,lng:80.045};
const capture = map => { window.testMap = map; };
function Preview() {
  const [place,setPlace] = useState(null);
  return <main style={{height:'100dvh',width:'100vw',position:'relative'}}>
    <TacticalLeafletMap center={origin} zoom={18} currentZoom={18} onMapInstance={capture}
      onMapClick={p => {window.clickedPosition=p;}} onFocus={()=>{}} liveLocation={origin}
      liveIsNavigating liveHeading={90} users={[]} blockedUserIds={[]} ghostMembers={[]}
      places={[]} activeTab="users" activeWaypoint={{...end,name:'Main entrance',description:'Meet here at 4 pm'}}
      onArTrack={()=>{}} walkingRoute={{path:[origin,end],isRealRoute:true}} />
    <MapControls onCampus={()=>{}} onLocate={()=>{}} onToggleSatellite={()=>{}} onSettings={()=>{}} onScan={()=>setPlace({...end,name:'Main entrance'})} />
    <MeetingPointConfirm place={place} onCancel={()=>setPlace(null)} onConfirm={description=>{window.rallyDescription=description;setPlace(null);}} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
