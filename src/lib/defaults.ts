import type { Quality, RecorderDefaults } from './types';
import { DEFAULTS_KEY, DEFAULT_DEFAULTS } from './types';

export async function loadDefaults(): Promise<RecorderDefaults> {
  const data = await chrome.storage.local.get(DEFAULTS_KEY);
  const d = data[DEFAULTS_KEY] as Partial<RecorderDefaults> | undefined;
  return {
    includeMic: d?.includeMic ?? DEFAULT_DEFAULTS.includeMic,
    quality: (d?.quality as Quality | undefined) ?? DEFAULT_DEFAULTS.quality,
    splitMinutes: d?.splitMinutes ?? DEFAULT_DEFAULTS.splitMinutes,
    micDeviceId: d?.micDeviceId ?? DEFAULT_DEFAULTS.micDeviceId,
    respectMeetMute: d?.respectMeetMute ?? DEFAULT_DEFAULTS.respectMeetMute,
  };
}

export async function saveDefaults(d: RecorderDefaults): Promise<void> {
  await chrome.storage.local.set({ [DEFAULTS_KEY]: d });
}
