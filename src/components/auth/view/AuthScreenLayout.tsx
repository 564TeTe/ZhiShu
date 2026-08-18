import type { ReactNode } from 'react';

type AuthScreenLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footerText?: string;
};

export default function AuthScreenLayout({
  title,
  description,
  children,
  footerText,
}: AuthScreenLayoutProps) {
  return (
    <div className="relative h-screen overflow-y-auto bg-[#f7f3ed] text-[#25292d]">
      <img
        aria-hidden
        src="/auth-ink-landscape.webp"
        alt=""
        className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center"
      />

      <main className="relative mx-auto grid min-h-full w-full max-w-[1240px] grid-cols-1 items-start px-5 pb-8 pt-8 lg:grid-cols-[minmax(0,1fr)_470px] lg:gap-20 lg:px-8 lg:pt-[clamp(8.5rem,14vh,10rem)] xl:gap-28">
        <section className="hidden max-w-[520px] -translate-x-5 pt-10 lg:block" aria-label="知枢品牌介绍">
          <img
            src="/app-wordmark.png?v=20260813b"
            alt="知枢"
            className="h-20 w-auto object-contain"
          />
          <h2 className="mt-8 font-serif text-5xl font-normal leading-tight text-[#25292d]">
            知枢 · 智联未来
          </h2>
          <div className="mt-5 flex items-center gap-2" aria-hidden>
            <span className="h-0.5 w-6 bg-[#e85d1f]" />
            <span className="h-0.5 w-4 bg-[#e8c8b8]" />
          </div>
          <p className="mt-5 text-lg leading-8 text-[#6f7477]">
            企业级 AI 协作平台，让知识流动，让协作更高效。
          </p>
        </section>

        <section className="w-full max-w-[470px] justify-self-center rounded-lg border border-white/80 bg-white/92 px-7 py-9 shadow-[0_18px_55px_rgba(67,54,43,0.10)] backdrop-blur-md sm:px-11 sm:py-10 lg:translate-x-5 lg:justify-self-end xl:translate-x-10">
          <img
            src="/app-wordmark.png?v=20260813b"
            alt="知枢"
            className="mx-auto mb-7 h-14 w-auto object-contain lg:hidden"
          />

          <div className="text-center">
            <h1 className="font-serif text-[2rem] font-normal leading-tight text-[#25292d]">{title}</h1>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[#85898c]">{description}</p>
          </div>

          <div className="mt-8">{children}</div>

          {footerText && (
            <div className="mt-7 border-t border-[#ece9e5] pt-5 text-center">
              <p className="text-xs leading-relaxed text-[#9a9d9f]">{footerText}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
