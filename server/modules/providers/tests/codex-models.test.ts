import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';

const modelsCache = {
  models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list', priority: 1 },
    { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', priority: 2 },
  ],
};

test('custom Codex providers expose only their explicitly configured model', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-custom-models-'));
  try {
    const cachePath = path.join(tempRoot, 'models_cache.json');
    const configPath = path.join(tempRoot, 'config.toml');
    await writeFile(cachePath, JSON.stringify(modelsCache), 'utf8');
    await writeFile(configPath, 'model_provider = "custom"\nmodel = "gpt-5.6-sol"\n', 'utf8');

    const provider = new CodexProviderModels({ modelsCachePath: cachePath, configPath });
    const models = await provider.getSupportedModels();

    assert.equal(models.DEFAULT, 'gpt-5.6-sol');
    assert.deepEqual(models.OPTIONS.map((option) => option.value), ['gpt-5.6-sol']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('OpenAI Codex provider retains the available cached model catalog', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-openai-models-'));
  try {
    const cachePath = path.join(tempRoot, 'models_cache.json');
    const configPath = path.join(tempRoot, 'config.toml');
    await writeFile(cachePath, JSON.stringify(modelsCache), 'utf8');
    await writeFile(configPath, 'model_provider = "openai"\nmodel = "gpt-5.6-sol"\n', 'utf8');

    const provider = new CodexProviderModels({ modelsCachePath: cachePath, configPath });
    const models = await provider.getSupportedModels();

    assert.deepEqual(models.OPTIONS.map((option) => option.value), ['gpt-5.6-sol', 'gpt-5.6-luna']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
