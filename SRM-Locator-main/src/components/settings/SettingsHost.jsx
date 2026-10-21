import React, { useEffect } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import SettingsScreen, { SETTINGS_Z } from './SettingsScreen';
import { setSettingsOpen, useSettingsOpen } from '../../utils/settingsOpen';

// The Settings layer. It reads the open flag itself (utils/settingsOpen.js) rather than App
// holding it in state, so opening Settings re-renders this, not the whole of App.

export default function SettingsHost({ onSignOut, onAdmin, ...screenProps }) {
  const open = useSettingsOpen();
  const reduceMotion = useReducedMotion();
  // The flag outlives this component, so a host that goes (sign-out, a test) leaves it closed.
  useEffect(() => () => setSettingsOpen(false), []);
  return (
    <AnimatePresence>
      {open && (
        // The outer layer is opaque and above the bars from its first frame to its last; only the
        // screen inside it fades (its parts then arrive one by one, see SettingsScreen). A moving element is its own stacking context, so with the motion
        // on an unlayered wrapper, Settings' z-index counted only inside it and the top and bottom
        // bars drew over Settings until the motion finished.
        <motion.div key="settings" data-testid="settings-layer" className="fixed inset-0 bg-bg" style={{ zIndex: SETTINGS_Z }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.15 : 0.2, ease: 'easeOut' }}
          >
            <SettingsScreen
              {...screenProps}
              onClose={() => setSettingsOpen(false)}
              onSignOut={() => { setSettingsOpen(false); onSignOut(); }}
              onAdmin={onAdmin ? () => { setSettingsOpen(false); onAdmin(); } : undefined}
          />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
