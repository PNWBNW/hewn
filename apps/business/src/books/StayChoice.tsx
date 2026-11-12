"use client";

/**
 * What "stay logged in" does, said where the choice is made (Joshua, 2026-11-11). For that time
 * the books are as good as unlocked on this device: the key that opens them is kept in the
 * browser's storage (@pnw/vault `remember`), where anyone who can use the device, or copy its
 * browser data, can use it too.
 */
export const STAY_NOTE =
  "Your books reopen here without your passphrase until you log out. Anyone who can use this device, or copy its browser data, could open them too. Handy on your own phone, where switching apps can reload the page. Leave it off on a shared device.";

/**
 * The "stay logged in" tick box: the same wherever books are opened (log in, setup, restoring a
 * file or from the account), always shown and never ticked for the person.
 */
export function StayChoice({ checked, onChange }: { checked: boolean; onChange: (stay: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Stay logged in on this device for 24 hours
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{STAY_NOTE}</span>
      </span>
    </label>
  );
}
