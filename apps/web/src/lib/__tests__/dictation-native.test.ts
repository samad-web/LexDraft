import { beforeEach, describe, expect, it, vi } from 'vitest';

// The device recogniser is faked: each start() takes the next scripted outcome.
const h = vi.hoisted(() => ({
  perm: 'granted' as string,
  script: [] as Array<string | Error>,
  starts: 0,
  want: { current: true },
}));

vi.mock('@capacitor-community/speech-recognition', () => ({
  SpeechRecognition: {
    requestPermissions: async () => ({ speechRecognition: h.perm }),
    start: async () => {
      h.starts++;
      const next = h.script.shift();
      if (next === undefined) {
        h.want.current = false; // the advocate taps stop
        return { matches: [] };
      }
      if (next instanceof Error) throw next;
      return { matches: [next] };
    },
    stop: async () => {},
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

const { listenNative } = await import('@/hooks/useDictation');

beforeEach(() => {
  h.perm = 'granted';
  h.script = [];
  h.starts = 0;
  h.want.current = true;
});

describe('Dictate in the Android app (device recogniser)', () => {
  it('delivers each phrase until the advocate taps stop', async () => {
    h.script = ['My client received a cheque', 'it was dishonoured'];
    const got: string[] = [];
    await listenNative('en-IN', h.want, (t) => got.push(t));
    expect(got).toEqual(['My client received a cheque', 'it was dishonoured']);
  });

  it('a silence timeout keeps listening', async () => {
    h.script = [new Error('No match'), new Error('No match'), new Error('No match'), new Error('No match'), 'after a pause'];
    const got: string[] = [];
    await listenNative('en-IN', h.want, (t) => got.push(t));
    expect(got).toEqual(['after a pause']);
  });

  it('microphone refused: never starts', async () => {
    h.perm = 'denied';
    await listenNative('en-IN', h.want, () => {});
    expect(h.starts).toBe(0);
  });

  it('gives up after 3 real failures instead of looping', async () => {
    h.script = Array.from({ length: 10 }, () => new Error('Recognizer busy'));
    await listenNative('en-IN', h.want, () => {});
    expect(h.starts).toBe(3);
  });
});
