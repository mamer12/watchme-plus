import { PinPad } from './PinPad';
import { lockLeft } from './pinGate';
import { profileStore } from './singleton';

/** Asks for the PIN of an adult profile (to leave a Kids profile or open management). */
export function GuardianPad({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  return (
    <PinPad
      title="Enter a parent PIN"
      subtitle="The PIN of a profile that isn't a Kids profile."
      lockedMs={lockLeft('guardian', { kv: undefined, now: () => Date.now() })}
      onCancel={onCancel}
      onSubmit={async (pin) => {
        const r = await profileStore.unlockGuardian(pin);
        if (r.ok) onOk();
        return r;
      }}
    />
  );
}
