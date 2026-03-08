'use client';

import { useState } from 'react';

const TIERS = [
  { limit: 25000, pricePerBlock: 4.20 },
  { limit: 75000, pricePerBlock: 1.80 },
  { limit: 150000, pricePerBlock: 1.50 },
  { limit: Infinity, pricePerBlock: 0.75 },
];

const CURRENCIES: Record<string, { factor: number; label: string }> = {
  USD: { factor: 1,     label: 'US Dollar' },
  AUD: { factor: 1.41,  label: 'Australian Dollar' },
  INR: { factor: 60,    label: 'Indian Rupee' },
  CNY: { factor: 7,     label: 'Chinese Yuan' },
  EUR: { factor: 1,     label: 'Euro' },
  GBP: { factor: 0.8,   label: 'Pound Sterling' },
  JPY: { factor: 120,   label: 'Japanese Yen' },
  SGD: { factor: 1.33,  label: 'Singapore Dollar' },
  MXN: { factor: 18,    label: 'Mexican Peso' },
  AED: { factor: 3.65,  label: 'UAE Dirham' },
  SAR: { factor: 3.65,  label: 'Saudi Riyal' },
  ZAR: { factor: 14,    label: 'South African Rand' },
  NGN: { factor: 770,   label: 'Nigerian Naira' },
  KES: { factor: 90,    label: 'Kenyan Shilling' },
  EGP: { factor: 35,    label: 'Egyptian Pound' },
  NZD: { factor: 1.6,   label: 'New Zealand Dollar' },
  CAD: { factor: 1.25,  label: 'Canadian Dollar' },
  IDR: { factor: 13800, label: 'Indonesian Rupiah' },
  MYR: { factor: 4.5,   label: 'Malaysian Ringgit' },
  RUB: { factor: 95,    label: 'Russian Ruble' },
};

function calculateCost(credits: number): number {
  let remaining = credits;
  let total = 0;
  for (const tier of TIERS) {
    if (remaining <= 0) break;
    const tierCredits = Math.min(remaining, tier.limit);
    total += (tierCredits / 1000) * tier.pricePerBlock;
    remaining -= tierCredits;
  }
  return total;
}

export function CreditCalculator() {
  const [currency, setCurrency] = useState('USD');
  const [credits, setCredits] = useState('');

  const addOn = parseInt(credits) || 0;
  const usdCost = calculateCost(addOn);
  const { factor, label } = CURRENCIES[currency];
  const converted = (usdCost * factor).toFixed(2);

  return (
    <div className="not-prose mt-6 rounded-xl border bg-fd-card p-5 shadow-sm space-y-4">
      <p className="font-semibold text-fd-foreground">Calculate Add-on limits</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Currency dropdown */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fd-muted-foreground">
            Payment Currency
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary"
          >
            {Object.entries(CURRENCIES).map(([code, { label }]) => (
              <option key={code} value={code}>
                {code} — {label}
              </option>
            ))}
          </select>
        </div>

        {/* Credits input */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fd-muted-foreground">
            Add-on Credits
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={credits}
            onChange={(e) => {
              const val = e.target.value;
              // Allow only non-negative integers
              if (val === '' || (/^\d+$/.test(val) && parseInt(val) >= 0)) {
                setCredits(val);
              }
            }}
            placeholder="e.g. 10000"
            className="rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary"
          />
        </div>
      </div>

      {/* Result */}
      <div className="rounded-lg border border-fd-border bg-fd-muted/40 px-4 py-3">
        {addOn > 0 ? (
          <>
            <p className="text-2xl font-bold text-green-600">
              {converted} {currency}
            </p>
            <p className="mt-1 text-xs text-fd-muted-foreground">
              The total amount payable for {' '} 
              <span className="font-semibold text-fd-foreground">
                {addOn.toLocaleString()}
              </span>{' '}
              Add-on credits 
            </p>
          </>
        ) : (
          <p className="text-sm text-fd-muted-foreground">
            Enter the number of add-on credits to see the estimated monthly cost.
          </p>
        )}
      </div>
      {/* Disclaimer */}
      <p className="text-xs font-medium text-yellow-600 border-l-2 border-fd-primary pl-2">
        Disclaimer: All calculated rates are approximate and subject to changes in the exchange rate.
      </p>
    </div>
  );
}
