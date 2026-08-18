import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageIcon, ImagePlus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';

import { DarkModeToggle } from '../../../../shared/view/ui';
import type { CodeEditorSettingsState, ProjectSortOrder } from '../../types/types';
import {
  DEFAULT_WALLPAPER_SETTINGS,
  useAssetImageObjectUrl,
  type WallpaperSettings,
} from '../../../../hooks/useWallpaper';
import { authenticatedFetch } from '../../../../utils/api';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
  wallpaperFilename: string | null;
  onWallpaperChange: (filename: string | null) => void;
  wallpaperSettings: WallpaperSettings;
  onWallpaperSettingsChange: (settings: WallpaperSettings) => void;
};

type WallpaperUploadResponse = {
  filename?: string;
  error?: string;
};

export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
  wallpaperFilename,
  onWallpaperChange,
  wallpaperSettings,
  onWallpaperSettingsChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Preview reuses the same auth-fetched blob URL helper as the app background.
  const previewSrc = useAssetImageObjectUrl(wallpaperFilename);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('wallpaper', file);
      const response = await authenticatedFetch('/api/assets/wallpaper', {
        method: 'POST',
        body: formData,
        headers: {}, // Let browser set Content-Type for FormData
      });
      const data = (await response.json()) as WallpaperUploadResponse;
      if (!response.ok || !data.filename) {
        throw new Error(data.error || t('appearanceSettings.wallpaper.uploadFailed'));
      }
      onWallpaperChange(data.filename);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('appearanceSettings.wallpaper.uploadFailed'));
    } finally {
      setIsUploading(false);
      // Reset so selecting the same file again still fires onChange.
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClear = () => {
    setUploadError(null);
    onWallpaperChange(null);
  };

  const updateWallpaperSetting = <K extends keyof WallpaperSettings>(
    key: K,
    value: WallpaperSettings[K],
  ) => {
    onWallpaperSettingsChange({ ...wallpaperSettings, [key]: value });
  };

  const resetWallpaperSettings = () => {
    onWallpaperSettingsChange({ ...DEFAULT_WALLPAPER_SETTINGS });
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('appearanceSettings.wallpaper.label')}
        description={t('appearanceSettings.wallpaper.description')}
      >
        <SettingsCard className="overflow-hidden">
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <div className="relative overflow-hidden rounded-xl border border-border/80 bg-muted/30">
              {previewSrc ? (
                <div className="relative h-44 sm:h-52">
                  <img
                    src={previewSrc}
                    alt={t('appearanceSettings.wallpaper.preview')}
                    className={`h-full w-full ${wallpaperSettings.fit === 'cover' ? 'object-cover' : 'object-contain'}`}
                    style={{ filter: `blur(${wallpaperSettings.blur}px)`, transform: wallpaperSettings.blur > 0 ? 'scale(1.04)' : undefined }}
                  />
                  <div
                    className="absolute inset-0 bg-background"
                    style={{ opacity: wallpaperSettings.overlayOpacity }}
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-10 text-white">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{t('appearanceSettings.wallpaper.active')}</div>
                      <div className="truncate text-[11px] text-white/75" title={wallpaperFilename ?? undefined}>
                        {wallpaperFilename}
                      </div>
                    </div>
                    <ImageIcon className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <div className="flex h-44 flex-col items-center justify-center gap-2 text-center sm:h-52">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-border bg-background/70">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="text-sm font-medium text-foreground">{t('appearanceSettings.wallpaper.empty')}</div>
                  <div className="text-xs text-muted-foreground">{t('appearanceSettings.wallpaper.hint')}</div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
              aria-label={t('appearanceSettings.wallpaper.upload')}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              {isUploading ? t('appearanceSettings.wallpaper.uploading') : t('appearanceSettings.wallpaper.upload')}
            </button>
            {wallpaperFilename && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                aria-label={t('appearanceSettings.wallpaper.clear')}
              >
                <Trash2 className="h-4 w-4" />
                {t('appearanceSettings.wallpaper.clear')}
              </button>
            )}
            {uploadError && <p className="basis-full text-sm text-destructive">{uploadError}</p>}
          </div>

          <div className="border-t border-border/70 px-4 py-2 sm:px-5">
            <div className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t('appearanceSettings.wallpaper.controls')}
              </div>
              <button
                type="button"
                onClick={resetWallpaperSettings}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('appearanceSettings.wallpaper.reset')}
              </button>
            </div>
            <div className="grid gap-x-6 gap-y-4 pb-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t('appearanceSettings.wallpaper.overlay')}</span>
                  <span className="tabular-nums text-foreground">{Math.round(wallpaperSettings.overlayOpacity * 100)}%</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="72"
                  step="1"
                  value={Math.round(wallpaperSettings.overlayOpacity * 100)}
                  onChange={(event) => updateWallpaperSetting('overlayOpacity', Number(event.target.value) / 100)}
                  className="w-full accent-primary"
                  aria-label={t('appearanceSettings.wallpaper.overlay')}
                />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t('appearanceSettings.wallpaper.surface')}</span>
                  <span className="tabular-nums text-foreground">{Math.round(wallpaperSettings.surfaceOpacity * 100)}%</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(wallpaperSettings.surfaceOpacity * 100)}
                  onChange={(event) => updateWallpaperSetting('surfaceOpacity', Number(event.target.value) / 100)}
                  className="w-full accent-primary"
                  aria-label={t('appearanceSettings.wallpaper.surface')}
                />
              </label>
              <label className="space-y-2">
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t('appearanceSettings.wallpaper.blur')}</span>
                  <span className="tabular-nums text-foreground">{wallpaperSettings.blur}px</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="18"
                  step="1"
                  value={wallpaperSettings.blur}
                  onChange={(event) => updateWallpaperSetting('blur', Number(event.target.value))}
                  className="w-full accent-primary"
                  aria-label={t('appearanceSettings.wallpaper.blur')}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:col-span-2">
                <span>{t('appearanceSettings.wallpaper.fit')}</span>
                <select
                  value={wallpaperSettings.fit}
                  onChange={(event) => updateWallpaperSetting('fit', event.target.value as WallpaperSettings['fit'])}
                  className="w-36 rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="cover">{t('appearanceSettings.wallpaper.cover')}</option>
                  <option value="contain">{t('appearanceSettings.wallpaper.contain')}</option>
                </select>
              </label>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
