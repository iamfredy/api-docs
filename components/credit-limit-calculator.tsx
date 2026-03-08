'use client';

import { useState } from 'react';

const EDITIONS: Record<string, { baseCredit: number; creditsPerUser: number; label: string }> = {
  'Enterprise/ZohoOne': { baseCredit: 100000, creditsPerUser: 1000, label: 'Enterprise/ZohoOne/CRMPlus' },
  'Professional':       { baseCredit: 75000,  creditsPerUser: 500,  label: 'Professional' },
  'Standard':           { baseCredit: 50000,  creditsPerUser: 250,  label: 'Standard' },
  'Express':            { baseCredit: 25000,  creditsPerUser: 100,  label: 'Express' },
};

export function CreditLimitCalculator() {
  const [edition, setEdition] = useState('Enterprise/ZohoOne');
  const [users, setUsers] = useState('100');

  const userCount = parseInt(users) || 0;
  const { baseCredit, creditsPerUser, label } = EDITIONS[edition];
  const totalCredits = baseCredit + userCount * creditsPerUser;

  return (
    <div className="not-prose mt-6 rounded-xl border bg-fd-card p-5 shadow-sm space-y-4">
      <p className="font-semibold text-fd-foreground">Calculate Credit Limits</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Edition dropdown */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fd-muted-foreground">
            Edition
          </label>
          <select
            value={edition}
            onChange={(e) => setEdition(e.target.value)}
            className="rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary"
          >
            {Object.entries(EDITIONS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Users input */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fd-muted-foreground">
            Purchased Users Count
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={users}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || (/^\d+$/.test(val) && parseInt(val) >= 0)) {
                setUsers(val);
              }
            }}
            placeholder="e.g. 100"
            className="rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary"
          />
        </div>
      </div>

      {/* Result */}
      <div className="rounded-lg border border-fd-border bg-fd-muted/40 px-4 py-3">
        <p className="text-2xl font-bold text-green-600">
          {totalCredits.toLocaleString()} Credits
        </p>
        <p className="mt-1 text-xs text-fd-muted-foreground">
          {userCount > 0 ? (
            <>
              With the purchase of{' '}
              <span className="font-semibold text-fd-foreground">{userCount}</span>{' '}
              users for{' '}
              <span className="font-semibold text-fd-foreground">{label}</span>{' '}
              edition
            </>
          ) : (
            'Base credits apply by default. Please enter the number of users.'
          )}
        </p>
      </div>
    </div>
  );
}
