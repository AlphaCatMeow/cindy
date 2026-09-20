import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isSharedTaskPeer, type SharedTaskOwnedItem } from '@cindy/device-link';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { VendorIcon, agentKindToVendor } from '@/components/sidebar/VendorIcon';
import type { Session } from '@/lib/ccAgent.types';
import { useAuth } from '@/contexts/AuthContext';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useRemoteProjectSessions, isRemoteDeviceMarkedDisconnected, remoteProjectsStore } from './remoteProjectsStore';
import { JoinSharedTaskDialog } from './JoinSharedTaskDialog';
import { sharedTaskErrorKey } from './sharedTaskCompatibility';

/** Uses the existing session mirror; choosing a task must not reconnect or fetch it again. */
export function SharedTasksSection({ activeSessionId, localSessions = [], onSelect }: {
  activeSessionId?: string | null;
  localSessions?: readonly Session[];
  onSelect(id: string): void;
}) {
  const { t } = useTranslation();
  const { isAuthenticated, dataOwnerId } = useAuth();
  const generation = getDataOwnerGeneration().generation;
  const sessions = useRemoteProjectSessions();
  const joined = useMemo(() => sessions.filter(session =>
    !!session.deviceLinkDeviceId && isSharedTaskPeer(session.deviceLinkDeviceId)), [sessions]);
  const [collapsed, setCollapsed] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [owned, setOwned] = useState<SharedTaskOwnedItem[]>([]);
  const [tab, setTab] = useState<'owned' | 'joined'>('joined');
  const [opening, setOpening] = useState<string | null>(null);
  const pending = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    const captured = ++epoch.current;
    const owner = getDataOwnerGeneration();
    setOwned([]); setOpening(null); setJoinOpen(false); pending.current = false;
    if (!isAuthenticated) return;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const items = await window.electronAPI.sharedTask.account({ action: 'owned' }) as SharedTaskOwnedItem[];
        if (captured === epoch.current && isDataOwnerGenerationCurrent(owner)) setOwned(items);
      } catch { /* Retain the last confirmed list during transient network failures. */ }
      finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 30_000);
    window.addEventListener('cindy:shared-task-owned-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      epoch.current++; clearInterval(timer);
      window.removeEventListener('cindy:shared-task-owned-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isAuthenticated, dataOwnerId, generation]);
  const both = owned.length > 0 && joined.length > 0;
  const visibleTab = both ? tab : owned.length ? 'owned' : 'joined';
  const openOwned = async (item: SharedTaskOwnedItem) => {
    if (item.sessionId === activeSessionId || pending.current) return;
    const owner = getDataOwnerGeneration();
    const captured = epoch.current;
    const current = () => captured === epoch.current && isDataOwnerGenerationCurrent(owner);
    pending.current = true; setOpening(item.sharedTaskId);
    try {
      if (!item.local && !sessions.some(session => session.id === item.sessionId && session.deviceLinkDeviceId === item.hostDeviceId)) {
        await window.electronAPI.deviceLink.openLink(item.hostDeviceId);
        if (!current()) return;
        remoteProjectsStore.pinSessionOrigin(item.hostDeviceId, item.sessionId);
      }
      if (current()) onSelect(item.sessionId);
    } catch (error) { if (current()) toast.error(t(sharedTaskErrorKey(error))); }
    finally { if (current()) { pending.current = false; setOpening(null); } }
  };
  if (!isAuthenticated) return null;
  return <>{(owned.length > 0 || joined.length > 0) && <section className="mx-3 mb-2 border-b border-[var(--border-default)] pb-3" aria-label={t('sharedTask.title')}>
    <div className="flex min-h-8 items-center justify-between gap-2">
      {both ? <SegmentedControl role="tablist" fullWidth className="min-w-0 flex-1"
        aria-label={t('sharedTask.title')} value={visibleTab} onValueChange={value => { setTab(value); setCollapsed(false); }}
        options={[
          { value: 'owned', label: t('sharedTask.ownedTab') },
          { value: 'joined', label: t('sharedTask.joinedTab') },
        ]} optionClassName="px-1.5" /> : <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}
        className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-12 text-[var(--text-secondary)] hover:bg-[var(--surface-hover-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]">
        {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {t(visibleTab === 'owned' ? 'sharedTask.ownedSection' : 'sharedTask.joinedSection')}
      </button>}
      <Button variant="secondary" className="w-8 shrink-0 border-transparent bg-transparent p-0" aria-label={t('sharedTask.join')} title={t('sharedTask.join')} onClick={() => setJoinOpen(true)}><Plus size={16} aria-hidden /></Button>
    </div>
    {(!collapsed || both) && visibleTab === 'owned' && owned.map(item => <button key={item.sharedTaskId} type="button"
      aria-current={item.sessionId === activeSessionId ? 'page' : undefined} disabled={!!opening} aria-busy={opening === item.sharedTaskId || undefined}
      onClick={() => void openOwned(item)} title={item.title}
      className={cn('my-0.5 flex min-h-14 w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-[var(--surface-hover-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]', item.sessionId === activeSessionId && 'bg-[var(--surface-chip)]')}>
      <SharedTaskAgentIcon agentKind={(item.local ? localSessions : sessions).find(session => session.id === item.sessionId)?.agentKind} />
      <span className="min-w-0 flex-1"><span className="block truncate text-13 font-medium text-[var(--text-primary)]">{item.title}</span>
        <span className="mt-0.5 block truncate text-11 text-[var(--text-secondary)]">{t(item.local ? 'sharedTask.thisDevice' : 'sharedTask.otherDevice')}</span>
      </span>
    </button>)}
    {(!collapsed || both) && visibleTab === 'joined' && joined.map(session => <button key={session.id} type="button"
      aria-current={session.id === activeSessionId ? 'page' : undefined}
      onClick={() => { if (session.id !== activeSessionId) onSelect(session.id); }}
      className={cn('my-0.5 flex min-h-14 w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-[var(--surface-hover-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]',
        session.id === activeSessionId && 'bg-[var(--surface-chip)]')}
      title={session.title || t('sharedTask.title')}>
      <SharedTaskAgentIcon agentKind={session.agentKind} />
      <span className="min-w-0 flex-1"><span className="block truncate text-13 font-medium text-[var(--text-primary)]">{session.title || t('sharedTask.title')}</span>
        <span className="mt-0.5 block truncate text-11 text-[var(--text-secondary)]">{t(isRemoteDeviceMarkedDisconnected(session.deviceLinkDeviceId!) ? 'sharedTask.reconnecting' : 'sharedTask.title')}</span>
      </span>
    </button>)}
  </section>}
    <JoinSharedTaskDialog open={joinOpen} onOpenChange={setJoinOpen} />
  </>;
}

function SharedTaskAgentIcon({ agentKind }: { agentKind?: Session['agentKind'] }) {
  const vendor = agentKindToVendor(agentKind);
  return <span className="mt-0.5 flex w-[15px] shrink-0 items-center justify-center" aria-hidden>
    <VendorIcon vendor={vendor} size={vendor === 'cc' ? 13 : 12} />
  </span>;
}
