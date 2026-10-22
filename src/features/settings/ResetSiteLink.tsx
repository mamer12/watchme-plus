import { useState } from 'react';
import { ResetSiteDialog } from './ResetSiteDialog';

/** A small "Reset site data" text link that opens the same confirmation dialog as Settings. */
export function ResetSiteLink({ className = 'link' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Reset site data
      </button>
      {open && <ResetSiteDialog onClose={() => setOpen(false)} />}
    </>
  );
}
