const loadingDotAnimationDelays = ['0s', '0.15s', '0.3s'];

export default function AuthLoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/40 p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-gradient-to-b from-indigo-100/60 via-purple-100/30 to-transparent blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <div className="relative text-center" role="status" aria-live="polite">
        <p className="sr-only">正在加载...</p>
        <img
          src="/app-wordmark.png?v=20260813b"
          alt="知枢"
          className="mx-auto mb-3 h-20 w-auto object-contain"
        />
        <p className="mb-6 text-sm text-slate-400">AI 研发协作平台</p>
        <div aria-hidden className="flex items-center justify-center gap-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2.5 w-2.5 animate-bounce rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 shadow-md shadow-indigo-400/30"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
