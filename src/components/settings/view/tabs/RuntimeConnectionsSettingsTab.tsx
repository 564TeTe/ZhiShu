import { useCallback, useEffect, useState } from 'react';
import { Check, CircleX, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type HealthStatus = 'available' | 'auth_failed' | 'rate_limited' | 'unreachable' | 'server_error' | 'not_checked' | 'credential_error';
type Connection = {
  id: string; name: string; baseUrl: string; defaultModel: string | null; enabled: boolean;
  credentialConfigured: boolean; credentialHint: string | null; lastHealthStatus: HealthStatus;
  lastHealthCode: number | null; lastCheckedAt: string | null; lastLatencyMs: number | null;
};
const emptyForm = { name: '', baseUrl: 'https://api.anthropic.com', apiKey: '', defaultModel: '' };

export default function RuntimeConnectionsSettingsTab() {
  const { t } = useTranslation('settings');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await authenticatedFetch('/api/runtime-connections'); const body = await response.json(); setConnections(body.connections ?? []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    if (!form.name || !form.baseUrl || !form.apiKey) return;
    setSaving(true); setMessage(null);
    try { const response = await authenticatedFetch('/api/runtime-connections', { method: 'POST', body: JSON.stringify(form) }); if (!response.ok) throw new Error(t('connections.messages.saveFailed')); setForm(emptyForm); setMessage(t('connections.messages.saved')); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('connections.messages.saveFailed')); }
    finally { setSaving(false); }
  };
  const test = async (id: string) => {
    setMessage(t('connections.messages.testing'));
    const response = await authenticatedFetch(`/api/runtime-connections/${id}/test`, { method: 'POST' });
    const body = await response.json();
    setMessage(body.available ? t('connections.messages.available') : `${t(`connections.health.${body.healthStatus as HealthStatus}`, { defaultValue: t('connections.messages.testFailed') })}${body.status ? ` (HTTP ${body.status})` : ''}`);
    await load();
  };
  const remove = async (id: string) => { const response = await authenticatedFetch(`/api/runtime-connections/${id}`, { method: 'DELETE' }); if (response.status === 409) setMessage(t('connections.messages.inUse')); await load(); };
  return (
    <div className="space-y-8">
      <SettingsSection title={t('connections.title')} description={t('connections.description')}>
        <SettingsCard className="p-4"><div className="grid gap-3 md:grid-cols-2">{(['name', 'baseUrl', 'apiKey', 'defaultModel'] as const).map((field) => <input key={field} type={field === 'apiKey' ? 'password' : 'text'} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} placeholder={{ name: t('connections.fields.name'), baseUrl: t('connections.fields.baseUrl'), apiKey: t('connections.fields.apiKey'), defaultModel: t('connections.fields.defaultModel') }[field]} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />)}</div><button type="button" onClick={() => void create()} disabled={saving || !form.name || !form.baseUrl || !form.apiKey} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />{t('connections.actions.add')}</button></SettingsCard>
      </SettingsSection>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <SettingsSection title={t('connections.configured.title')} description={t('connections.configured.description')}>
        <SettingsCard divided>{loading ? <div className="p-4 text-sm text-muted-foreground">{t('connections.loading')}</div> : connections.length === 0 ? <div className="p-4 text-sm text-muted-foreground">{t('connections.empty')}</div> : connections.map((connection) => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><div><div className="font-medium">{connection.name}</div><div className="text-xs text-muted-foreground">{connection.baseUrl} · {connection.defaultModel || t('connections.defaults.model')} · {connection.credentialHint || t('connections.defaults.credential')}</div><div className="mt-1 text-xs text-muted-foreground">{t('connections.health.label')}{t('connections.health.separator')} {t(`connections.health.${connection.lastHealthStatus}`)}{connection.lastHealthCode ? ` · HTTP ${connection.lastHealthCode}` : ''}{connection.lastLatencyMs != null ? ` · ${connection.lastLatencyMs} ms` : ''}{connection.lastCheckedAt ? ` · ${new Date(connection.lastCheckedAt).toLocaleString()}` : ''}</div></div><div className="flex items-center gap-2"><button type="button" title={t('connections.actions.test')} aria-label={t('connections.actions.test')} onClick={() => void test(connection.id)} className="rounded-md border border-border p-2"><RefreshCw className="h-4 w-4" /></button><button type="button" title={t('connections.actions.delete')} aria-label={t('connections.actions.delete')} onClick={() => void remove(connection.id)} className="rounded-md border border-border p-2 text-destructive"><Trash2 className="h-4 w-4" /></button>{connection.enabled ? <Check className="h-4 w-4 text-emerald-500" /> : <CircleX className="h-4 w-4 text-muted-foreground" />}</div></div>)}</SettingsCard>
      </SettingsSection>
    </div>
  );
}
