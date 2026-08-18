import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from './useSessionStore';
import {
  removeOptimisticUserEchoes,
  removePersistedAssistantEchoes,
} from './sessionMessageReconciliation';

const createUserMessage = (
  id: string,
  timestamp: string,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp,
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content: '',
  ...overrides,
});

test('replaces an optimistic image-only turn with its persisted Claude copy', () => {
  const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png', name: 'image.png' }],
  });
  const persisted = createUserMessage('claude_image', '2026-07-28T20:30:26.000Z', {
    images: [{ data: 'data:image/png;base64,AAAA' }],
  });

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});

test('does not collapse an attachment-only turn into a server row without attachments', () => {
  const local = createUserMessage('local_image', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/upload.png' }],
  });
  const persisted = createUserMessage('claude_empty', '2026-07-28T20:30:22.000Z');

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), [local]);
});

test('matches optimistic attachment turns to persisted turns one-to-one', () => {
  const firstLocal = createUserMessage('local_first', '2026-07-28T20:30:21.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/first.png' }],
  });
  const secondLocal = createUserMessage('local_second', '2026-07-28T20:30:25.000Z', {
    images: [{ path: 'C:/Users/test/.cloudcli/assets/second.png' }],
  });
  const firstPersisted = createUserMessage('claude_first', '2026-07-28T20:30:22.000Z', {
    images: [{ data: 'data:image/png;base64,AAAA' }],
  });

  const remainingRealtime = removeOptimisticUserEchoes(
    [firstPersisted],
    [firstLocal, secondLocal],
  );

  assert.deepEqual(remainingRealtime.map((message) => message.id), ['local_second']);
});

test('keeps the existing optimistic text reconciliation behavior', () => {
  const local = createUserMessage('local_text', '2026-07-28T20:30:21.000Z', {
    content: 'hello',
  });
  const persisted = createUserMessage('claude_text', '2026-07-28T20:30:26.000Z', {
    content: 'hello',
  });

  assert.deepEqual(removeOptimisticUserEchoes([persisted], [local]), []);
});

test('removes a persisted OpenCode assistant reply after reconciling its optimistic user turn', () => {
  const firstUser = createUserMessage('server_user_1', '2026-08-14T02:52:27.000Z', {
    provider: 'opencode',
    content: '11111',
  });
  const firstAssistant: NormalizedMessage = {
    ...firstUser,
    id: 'server_assistant_1',
    timestamp: '2026-08-14T02:52:34.000Z',
    role: 'assistant',
    content: 'What would you like help with?',
  };
  const secondUser = createUserMessage('server_user_2', '2026-08-14T02:52:47.000Z', {
    provider: 'opencode',
    content: '你好',
  });
  const persistedAssistant: NormalizedMessage = {
    ...secondUser,
    id: 'server_assistant_2',
    timestamp: '2026-08-14T02:52:52.137Z',
    role: 'assistant',
    content: '你好！有什么我可以帮你的吗？',
  };
  const streamEnd: NormalizedMessage = {
    ...persistedAssistant,
    id: 'server_stream_end_2',
    timestamp: '2026-08-14T02:52:52.202Z',
    kind: 'stream_end',
    role: undefined,
    content: undefined,
  };
  const optimisticUser = createUserMessage('local_user_2', '2026-08-14T02:52:47.000Z', {
    provider: 'opencode',
    content: '你好',
  });
  const realtimeAssistant: NormalizedMessage = {
    ...persistedAssistant,
    id: 'realtime_assistant_2',
    timestamp: '2026-08-14T02:52:52.274Z',
  };

  const remaining = removePersistedAssistantEchoes(
    [firstUser, firstAssistant, secondUser, persistedAssistant, streamEnd],
    [optimisticUser, realtimeAssistant],
  );

  assert.deepEqual(remaining, []);
});
