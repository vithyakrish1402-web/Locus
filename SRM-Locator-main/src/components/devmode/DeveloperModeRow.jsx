import React from 'react';
import { Card } from '../ui';
import { Switch } from '../ui';

/** The Settings row. Only admin accounts are given this (App.jsx loads it for no one else). */
export default function DeveloperModeRow({ checked, onChange }) {
  return (
    <section className="mb-6" data-testid="developer-mode-row">
      <Card className="shadow-sm">
        <Switch
          label="Developer mode"
          description="Tools for testing. Admin accounts only."
          checked={checked}
          onChange={onChange}
        />
      </Card>
    </section>
  );
}
