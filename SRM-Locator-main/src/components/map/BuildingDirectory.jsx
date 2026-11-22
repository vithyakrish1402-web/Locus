import React, { memo, useMemo, useState } from 'react';
import { Building2, Search, SlidersHorizontal } from 'lucide-react';
import BuildingRow from './BuildingRow';
import { placeMatches } from '../../utils/campusPlaces';
import { BUILDINGS_LIST } from '../../copy/group';

const CATEGORIES = [
  ['ALL', 'All places'], ['ACADEMIC', 'Academic'], ['ENGINEERING', 'Engineering'],
  ['MEDICAL', 'Medical'], ['RESIDENTIAL', 'Hostels'], ['LOGISTICS', 'Cafes & hubs'], ['GROUNDS', 'Grounds'],
];

function BuildingDirectory({ places, query, onSearch, me, onOpen, onArScan, onNavigate }) {
  const [category, setCategory] = useState('ALL');
  const counts = useMemo(() => {
    const result = { ALL: places.length };
    for (const place of places) result[place.category] = (result[place.category] || 0) + 1;
    return result;
  }, [places]);
  const visible = useMemo(() => {
    const matches = places.filter(place => placeMatches(place, query) && (category === 'ALL' || place.category === category));
    if (!Number.isFinite(me?.lat) || !Number.isFinite(me?.lng)) return matches;
    const longitudeScale = Math.cos(me.lat * Math.PI / 180);
    const distance = place => (place.lat - me.lat) ** 2 + ((place.lng - me.lng) * longitudeScale) ** 2;
    return matches.sort((a, b) => distance(a) - distance(b));
  }, [places, query, category, me]);

  return <section className="building-directory" aria-label="Campus buildings">
    <div className="directory-intro">
      <span className="directory-emblem" aria-hidden="true"><Building2 size={23} /></span>
      <div><p className="directory-eyebrow">SRM KTR CAMPUS</p><h2>Find your next stop</h2>
        <p className="directory-subtitle">Buildings, cafes and spaces around you.</p></div>
    </div>
    <label className="directory-search">
      <Search size={18} aria-hidden="true" />
      <input type="search" aria-label="Search campus buildings" placeholder="Search buildings or places" value={query} onChange={e => onSearch(e.target.value)} />
    </label>
    <div className="directory-categories" role="group" aria-label="Building categories">
      {CATEGORIES.filter(([id]) => id !== 'GROUNDS' || counts.GROUNDS).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>
          {label}<span>{counts[id] || 0}</span>
        </button>)}
    </div>
    <div className="directory-results"><h3>{query.trim() ? 'Search results' : 'Explore campus'} <span>{visible.length}</span></h3>
      <span><SlidersHorizontal size={13} aria-hidden="true" />{me ? 'Nearest first' : 'Campus directory'}</span></div>
    {visible.length === 0 && <div className="directory-empty">
      <Search size={25} aria-hidden="true" /><p data-testid="buildings-no-match">{query.trim() ? BUILDINGS_LIST.noMatch(query.trim()) : 'No places in this category yet.'}</p>
      <button type="button" onClick={() => { setCategory('ALL'); onSearch(''); }}>Show all places</button>
    </div>}
    <div className="directory-cards">{visible.map(building => <BuildingRow key={building.id} building={building} me={me}
      onOpen={() => onOpen(building)} onArScan={() => onArScan(building)} onNavigate={() => onNavigate(building)} />)}</div>
  </section>;
}

export default memo(BuildingDirectory);
