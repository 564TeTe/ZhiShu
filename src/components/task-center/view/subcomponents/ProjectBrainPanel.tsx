import { Send, ShieldCheck, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../../../../shared/view/ui';
import { askProjectBrain, fetchBrainMessages, fetchBrainThreads } from '../../api/taskCenterApi';
import type { BrainMessage } from '../../model/taskCenterModel';

export function ProjectBrainPanel({ projectId, refreshToken = 0 }: { projectId: string; refreshToken?: number }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [question, setQuestion] = useState('当前做到哪一步，还有什么阻塞？');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async (selectedThreadId: string) => {
    setMessages(await fetchBrainMessages(projectId, selectedThreadId));
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void fetchBrainThreads(projectId).then(async (threads) => {
      if (!active || !threads[0]) return;
      setThreadId(threads[0].threadId);
      const values = await fetchBrainMessages(projectId, threads[0].threadId);
      if (active) setMessages(values);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [projectId, refreshToken]);

  return (
    <Card className="rounded-none">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />项目大脑
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              只读取已记录的项目上下文；回答不会自动变成正式决策，也不会触发执行。
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" />只读分析 · 不调用工具
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.length > 0 && (
          <div className="max-h-80 space-y-3 overflow-auto rounded-md border bg-muted/10 p-3">
            {messages.map((message) => (
              <div key={message.messageId} className={message.role === 'USER' ? 'ml-8' : 'mr-8'}>
                <div className="text-[11px] font-medium text-muted-foreground">
                  {message.role === 'USER' ? '你' : '项目大脑'}
                </div>
                <div className="mt-1 whitespace-pre-wrap rounded-md border bg-background p-3 text-sm">
                  {message.content}
                </div>
                {message.role === 'BRAIN' && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    上下文 {message.contextPackageId} · {message.citations.length} 个引用
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim() || isRunning) return;
            setIsRunning(true);
            setError(null);
            void askProjectBrain(projectId, question.trim(), threadId)
              .then(async (result) => {
                setThreadId(result.threadId);
                await loadMessages(result.threadId);
              })
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
              .finally(() => setIsRunning(false));
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="询问当前项目状态、决策、约束或风险"
          />
          <Button type="submit" disabled={isRunning || !question.trim()}>
            <Send className="mr-2 h-4 w-4" />{isRunning ? '正在读取项目上下文…' : '询问项目大脑'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
