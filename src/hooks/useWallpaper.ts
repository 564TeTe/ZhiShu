import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../utils/api';

// Persisted value is just the stored filename; the blob is fetched on demand
// because /api/assets is auth-gated and a bare CSS url() cannot carry the
// Authorization header. Mirrors the chat image approach (ChatMessageImages).
const WALLPAPER_STORAGE_KEY = 'wallpaperFilename';
const WALLPAPER_SETTINGS_STORAGE_KEY = 'wallpaperSettings';

export type WallpaperFit = 'cover' | 'contain';

export type WallpaperSettings = {
  /** Opacity of the readability veil layered above the image. */
  overlayOpacity: number;
  /** Opacity of app surfaces above the wallpaper. */
  surfaceOpacity: number;
  /** Pixel blur applied to the image layer, before the veil. */
  blur: number;
  fit: WallpaperFit;
};

export const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  overlayOpacity: 0.28,
  surfaceOpacity: 0.84,
  blur: 0,
  fit: 'cover',
};

/** Window event dispatched whenever the wallpaper filename changes. */
export const WALLPAPER_CHANGED_EVENT = 'wallpaper-changed';

/** Reads the persisted wallpaper filename, or null when none is set. */
export function getWallpaperFilename(): string | null {
  return localStorage.getItem(WALLPAPER_STORAGE_KEY) || null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Reads the persisted visual treatment, falling back safely for old clients. */
export function getWallpaperSettings(): WallpaperSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLPAPER_SETTINGS_STORAGE_KEY) || '{}') as Record<string, unknown>;
    return {
      overlayOpacity: clamp(
        parsed.overlayOpacity,
        0,
        0.72,
        DEFAULT_WALLPAPER_SETTINGS.overlayOpacity,
      ),
      surfaceOpacity: clamp(
        parsed.surfaceOpacity,
        0,
        1,
        DEFAULT_WALLPAPER_SETTINGS.surfaceOpacity,
      ),
      blur: clamp(parsed.blur, 0, 18, DEFAULT_WALLPAPER_SETTINGS.blur),
      fit: parsed.fit === 'contain' ? 'contain' : DEFAULT_WALLPAPER_SETTINGS.fit,
    };
  } catch {
    return DEFAULT_WALLPAPER_SETTINGS;
  }
}

/**
 * Persists (or clears) the wallpaper filename and notifies listeners. Writing
 * immediately — like the codeEditor* keys — avoids depending on the settings
 * autosave flow, which only syncs server-backed preferences.
 */
export function setWallpaperFilename(filename: string | null): void {
  if (filename) {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, filename);
  } else {
    localStorage.removeItem(WALLPAPER_STORAGE_KEY);
  }
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
}

/** Persists visual treatment and reuses the same cross-component event. */
export function setWallpaperSettings(next: WallpaperSettings): void {
  localStorage.setItem(WALLPAPER_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
}

/**
 * Fetches one auth-gated asset image as a blob and returns an object URL for
 * use as an <img src> or CSS background. Used by both the app background layer
 * and the settings preview so the blob/revocation logic stays in one place.
 */
export function useAssetImageObjectUrl(filename: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let createdUrl: string | null = null;

    if (!filename) {
      setObjectUrl(null);
      return;
    }

    void (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/assets/images/${encodeURIComponent(filename)}`,
        );
        if (!response.ok) {
          if (!revoked) setObjectUrl(null);
          return;
        }
        const blob = await response.blob();
        if (revoked) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch {
        if (!revoked) setObjectUrl(null);
      }
    })();

    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [filename]);

  return objectUrl;
}

/**
 * Subscribes to wallpaper changes (localStorage + window event) and returns an
 * object URL ready to drop into a CSS `background-image`. Returns null when no
 * wallpaper is set or while it is still loading.
 */
export function useWallpaper(): { wallpaperUrl: string | null; wallpaperSettings: WallpaperSettings } {
  const [filename, setFilename] = useState<string | null>(() => getWallpaperFilename());
  const [wallpaperSettings, setWallpaperSettingsState] = useState<WallpaperSettings>(() => getWallpaperSettings());

  useEffect(() => {
    const handleChange = () => {
      setFilename(getWallpaperFilename());
      setWallpaperSettingsState(getWallpaperSettings());
    };
    window.addEventListener(WALLPAPER_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(WALLPAPER_CHANGED_EVENT, handleChange);
  }, []);

  const wallpaperUrl = useAssetImageObjectUrl(filename);
  return { wallpaperUrl, wallpaperSettings };
}
