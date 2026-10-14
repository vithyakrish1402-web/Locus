import React, { useState } from 'react';
import { Ban, MapPin, Navigation, Radio, ScanLine } from 'lucide-react';
import { Avatar, Button, ListRow, Sheet } from '../ui';
import { memberStatus, memberWhere } from '../../utils/memberStatus';
import { MEMBERS, MEMBER_OPTIONS, REMOVE_AND_BLOCK, firstName } from '../../copy/group';

// A member's options: solid opaque bottom sheet without glassmorphism.
// Provides their live info, Navigate to them, Ping, Show on map, Find with AR Scan,
// and Group Lead's Remove and block behind its confirmation.

/**
 * @param {{ member: object|null, me: object|null, heading: number, headingLive: boolean,
 *   isLead: boolean, onClose: () => void, onNavigate?: (member: object) => void, onPing: (id: string) => void,
 *   onShowOnMap: (member: object) => void, onArScan: (member: object) => void,
 *   onRemoveAndBlock: (id: string) => void }} props
 *   member: whose options are open, or null when closed
 */
export default function MemberOptions({ member, me, heading, headingLive, isLead, onClose, onNavigate, onPing, onShowOnMap, onArScan, onRemoveAndBlock }) {
  const [confirming, setConfirming] = useState(null);
  const shown = member ?? confirming;
  const name = shown?.name || '?';
  const first = firstName(shown?.name);

  const status = shown ? memberStatus(shown) : null;
  const place = shown ? memberWhere(shown, me, { heading, headingLive }) : null;
  const facts = [status?.text, place?.distance, place?.direction].filter(Boolean).join(' · ');

  const act = (fn) => () => { fn(member); onClose(); };

  // Pure solid opaque panel without glassmorphism / translucent blur
  const solidPanelClass = 'bg-[#161b22] dark:bg-[#12161c] border-t border-[#30363d] shadow-[0_-8px_32px_rgba(0,0,0,0.7)]';

  return (
    <>
      <Sheet open={Boolean(member)} onClose={onClose} label={MEMBERS.options(name)} panelClassName={solidPanelClass}>
        <div data-testid="member-options" className="px-4 flex flex-col">
          <div className="flex items-center gap-3.5 pb-3.5 border-b border-[#30363d]">
            <Avatar name={name} dashed={shown?.status === 'FROZEN' || !shown?.hasFix} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-heading truncate font-semibold text-white">{name}</p>
                {shown?.status === 'GHOST' ? (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Signal lost
                  </span>
                ) : (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {status?.text || 'Active'}
                  </span>
                )}
              </div>
              <p className="text-secondary text-gray-400 mt-0.5">{facts || 'Location tracking active'}</p>
            </div>
          </div>

          {/* Quick telemetry stat chips */}
          <div className="grid grid-cols-3 gap-2 py-3 border-b border-[#30363d]">
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#0d1117] border border-[#30363d]/60 text-center">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Distance</span>
              <span className="text-xs font-bold text-white mt-0.5">{place?.distance || '—'}</span>
            </div>
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#0d1117] border border-[#30363d]/60 text-center">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Battery</span>
              <span className={`text-xs font-bold mt-0.5 ${shown?.battery > 0 && shown.battery < 25 ? 'text-amber-400' : 'text-white'}`}>
                {Number.isFinite(shown?.battery) && shown.battery > 0 ? `${shown.battery}%` : '—'}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#0d1117] border border-[#30363d]/60 text-center">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Speed</span>
              <span className="text-xs font-bold text-white mt-0.5">
                {shown?.speed > 0 ? `${Math.round(shown.speed)} km/h` : '0 km/h'}
              </span>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-[#21262d]">
            {onNavigate && (shown?.lat != null && shown?.lng != null) && (
              <ListRow
                leading={<Navigation size={20} className="text-blue-400" />}
                title={MEMBER_OPTIONS.navigate(first)}
                description={place ? `${place.distance} away · live directions` : 'Set destination & navigate'}
                onClick={act(onNavigate)}
              />
            )}
            <ListRow
              leading={<Radio size={20} className="text-emerald-400" />}
              title={MEMBER_OPTIONS.ping(first)}
              description="Transmit sonar ping to their device"
              onClick={act((m) => onPing(m.id))}
            />
            {place && (
              <>
                <ListRow
                  leading={<MapPin size={20} className="text-amber-400" />}
                  title={MEMBER_OPTIONS.showOnMap}
                  description="Center and zoom on member position"
                  onClick={act(onShowOnMap)}
                />
                <ListRow
                  leading={<ScanLine size={20} className="text-purple-400" />}
                  title={MEMBER_OPTIONS.arScan}
                  description="Scan surroundings using AR camera"
                  onClick={act(onArScan)}
                />
              </>
            )}
            {isLead && (
              <ListRow
                danger
                leading={<Ban size={20} />}
                title={MEMBER_OPTIONS.removeAndBlock}
                description="Revoke squad access and ban user"
                onClick={() => { setConfirming(member); onClose(); }}
              />
            )}
          </div>
          <Button variant="secondary" block className="mt-3.5 mb-2 !bg-[#21262d] !border-[#30363d] text-gray-200" onClick={onClose}>
            {MEMBER_OPTIONS.cancel}
          </Button>
        </div>
      </Sheet>

      {/* Remove and block, confirmed: solid opaque */}
      <Sheet open={Boolean(confirming)} onClose={() => setConfirming(null)} label={REMOVE_AND_BLOCK.title(confirming?.name || '?')} panelClassName={solidPanelClass}>
        <div data-testid="remove-and-block-confirm" className="px-5 flex flex-col gap-4">
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-danger-soft text-danger" aria-hidden="true">
            <Ban size={26} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-title">{REMOVE_AND_BLOCK.title(confirming?.name || '?')}</h2>
            <p className="text-body text-text-secondary">{REMOVE_AND_BLOCK.body(firstName(confirming?.name))}</p>
          </div>
          <Button
            variant="danger"
            size="large"
            block
            onClick={() => { const id = confirming.id; setConfirming(null); onRemoveAndBlock(id); }}
          >
            {REMOVE_AND_BLOCK.confirm}
          </Button>
          <Button variant="plain" block onClick={() => setConfirming(null)}>{REMOVE_AND_BLOCK.cancel}</Button>
        </div>
      </Sheet>
    </>
  );
}
