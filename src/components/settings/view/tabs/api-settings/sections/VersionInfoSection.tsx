import { ExternalLink, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ZHISHU_WORDMARK_FONT_FAMILY } from '../../../../../../constants/branding';
import type { ReleaseInfo } from '../../../../../../types/sharedTypes';

const GITHUB_REPO_URL = 'https://github.com/564TeTe/ZhiShu';
const DOCS_URL = 'https://github.com/564TeTe/ZhiShu/tree/main/docs';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

type VersionInfoSectionProps = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseInfo: ReleaseInfo | null;
};

export default function VersionInfoSection({
  currentVersion,
  updateAvailable,
  latestVersion,
  releaseInfo,
}: VersionInfoSectionProps) {
  const { t } = useTranslation('settings');
  const releasesUrl = releaseInfo?.htmlUrl || `${GITHUB_REPO_URL}/releases`;

  return (
    <div className="border-t border-border/50 pt-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <img
            src="/app-mark.png?v=20260813b"
            alt="知枢"
            className="h-9 w-9 flex-shrink-0 object-contain"
          />
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-semibold text-foreground"
                style={{ fontFamily: ZHISHU_WORDMARK_FONT_FAMILY }}
              >
                知枢
              </span>
              <a
                href={releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                v{currentVersion}
              </a>
              {updateAvailable && latestVersion && (
                <a
                  href={releasesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 transition-colors hover:bg-green-500/20 dark:text-green-400"
                >
                  {t('apiKeys.version.updateAvailable', { version: latestVersion })}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">AI 研发协作与任务编排平台</p>
          </div>
        </div>

        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <GitHubIcon className="h-4 w-4" />
          <Star className="h-3.5 w-3.5" />
          <span>在 GitHub 上关注知枢</span>
        </a>

        <div className="flex flex-wrap gap-3 text-xs">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <GitHubIcon className="h-3.5 w-3.5" />
            GitHub 仓库
          </a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            知枢文档
          </a>
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          知枢把任务、执行、审批、事件和研发产物放在同一条可追踪链路中，帮助你理解每次 Agent 执行发生了什么。
        </p>
      </div>
    </div>
  );
}
