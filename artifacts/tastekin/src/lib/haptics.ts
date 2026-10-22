// Haptic feedback for the native shell. Every function is fire-and-forget
// and a no-op in the browser, so call sites never branch on platform and
// the web build is byte-for-byte unaffected in behaviour. Failures (plugin
// missing on a build, device without a Taptic engine) are swallowed: a
// missing tick must never break a like, a save or a send.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const enabled = Capacitor.isNativePlatform();

/** Light tap: like, save, follow, send — confirms the touch landed. */
export function hapticTap(): void {
  if (!enabled) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/** Selection tick: pull-to-refresh reaching its threshold, segment changes. */
export function hapticSelection(): void {
  if (!enabled) return;
  void Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd()).catch(() => {});
}

/** Success notification: an action that completed something (e.g. a refresh landed). */
export function hapticSuccess(): void {
  if (!enabled) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}
