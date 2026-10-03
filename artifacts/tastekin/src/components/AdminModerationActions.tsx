import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModerationActionInput, ModerationInspection } from '@workspace/api-client-react';

type Action = ModerationActionInput['action'];
type Inspection = ModerationInspection;
type Props = { reportId: string; ar: boolean; isAdmin: boolean; onChanged?: () => void | Promise<void> };

const MAX_REASON = 1000;
const labels: Record<Action, [string, string]> = {
  hide_edit: ['Hide Edit', 'إخفاء التعديل'], restore_edit: ['Restore Edit', 'استعادة التعديل'],
  hide_comment: ['Hide comment', 'إخفاء التعليق'], restore_comment: ['Restore comment', 'استعادة التعليق'],
  suspend_user: ['Suspend account', 'تعليق الحساب'], unsuspend_user: ['Unsuspend account', 'إلغاء تعليق الحساب'],
};
const typeLabel = { edit: ['Edit', 'تعديل'], comment: ['Comment', 'تعليق'], profile: ['Profile', 'ملف شخصي'] } as const;

async function readError(res: Response, ar: boolean) {
  try {
    const p = await res.json();
    const m = p && (p.error || p.message);
    if (typeof m === 'string' && m) return m;
  } catch { /* ignore */ }
  return ar ? `فشل الطلب (${res.status})` : `Request failed (${res.status})`;
}
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '');

export function AdminModerationActions({ reportId, ar, isAdmin, onChanged }: Props) {
  const t = (en: string, arText: string) => (ar ? arText : en);
  const [data, setData] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [mediaSrc, setMediaSrc] = useState('');
  const [mediaState, setMediaState] = useState<'none' | 'loading' | 'ready' | 'error'>('none');
  const sendingRef = useRef(false);
  const loadCtl = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async (id: string, initial: boolean) => {
    loadCtl.current?.abort();
    const ctl = new AbortController();
    loadCtl.current = ctl;
    if (initial) { setLoading(true); setLoadError(''); }
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(id)}/inspection`, { credentials: 'include', cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error(await readError(res, ar));
      const json = await res.json() as Inspection;
      if (ctl.signal.aborted) return;
      setData(json); setLoadError('');
    } catch (e) {
      if (ctl.signal.aborted) return;
      setLoadError(e instanceof Error && e.message ? e.message : t('Could not load this report.', 'تعذر تحميل هذا البلاغ.'));
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar]);

  useEffect(() => {
    if (!isAdmin) return;
    setData(null); setPending(null); setReason(''); setSuccess(''); setActionError('');
    void load(reportId, true);
    const timer = window.setInterval(() => { void load(reportId, false); }, 30000);
    const onFocus = () => { void load(reportId, false); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); loadCtl.current?.abort(); };
  }, [reportId, isAdmin, load]);

  const mediaUrl = data?.target.mediaUrl;
  useEffect(() => {
    setMediaSrc('');
    if (!isAdmin || !mediaUrl || !mediaUrl.startsWith('/api/') || mediaUrl.startsWith('//')) { setMediaState('none'); return; }
    const ctl = new AbortController();
    let objectUrl = '';
    setMediaState('loading');
    fetch(mediaUrl, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('media');
        const blob = await res.blob();
        if (ctl.signal.aborted) return;
        if (!blob.type.startsWith('image/')) throw new Error('type');
        objectUrl = URL.createObjectURL(blob);
        setMediaSrc(objectUrl); setMediaState('ready');
      })
      .catch(() => { if (!ctl.signal.aborted) setMediaState('error'); });
    return () => { ctl.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [mediaUrl, isAdmin]);

  if (!isAdmin) return null;

  const target = data?.target;
  const trimmed = reason.trim();
  const reasonValid = trimmed.length > 0 && trimmed.length <= MAX_REASON;
  const contentAction: Action | null = !target ? null
    : target.targetType === 'edit' ? (target.hidden ? 'restore_edit' : 'hide_edit')
    : target.targetType === 'comment' ? (target.hidden ? 'restore_comment' : 'hide_comment') : null;
  const accountAction: Action | null = target ? (target.suspended ? 'unsuspend_user' : 'suspend_user') : null;
  const actions = [contentAction, accountAction].filter((a): a is Action => a !== null);
  const isAccount = (a: Action) => a === 'suspend_user' || a === 'unsuspend_user';

  const submit = async () => {
    if (!pending || !reasonValid || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setActionError('');
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}/actions`, {
        method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pending, reason: trimmed, confirmed: true }),
      });
      if (!res.ok) throw new Error(await readError(res, ar));
      setSuccess(`${labels[pending][ar ? 1 : 0]}: ${t('done. This can be reversed.', 'تم. يمكن التراجع عن ذلك.')}`);
      setPending(null); setReason('');
      await load(reportId, false);
      try { await onChangedRef.current?.(); } catch { /* queue refresh is best effort */ }
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : t('Action failed.', 'فشل الإجراء.'));
    } finally { sendingRef.current = false; setSending(false); }
  };

  return (
    <section className="approved-panel" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'} data-testid="admin-moderation-actions" aria-busy={loading}>
      <h3>{t('Moderation', 'الإشراف')}</h3>
      {loading && !data ? <p role="status" data-testid="status-moderation-loading">{t('Loading report details...', 'جار تحميل تفاصيل البلاغ...')}</p> : null}
      {loadError ? <div role="alert" data-testid="status-moderation-error">
        <p>{loadError}</p>
        <button type="button" className="approved-button" onClick={() => void load(reportId, true)} data-testid="button-moderation-retry">{t('Retry', 'إعادة المحاولة')}</button>
      </div> : null}
      {target ? <>
        <p data-testid="text-moderation-target">
          {typeLabel[target.targetType][ar ? 1 : 0]} · {target.targetId} · {target.hidden ? t('Hidden', 'مخفي') : t('Visible', 'ظاهر')} · {target.suspended ? t('Account suspended', 'الحساب معلق') : t('Account active', 'الحساب نشط')}
        </p>
        {mediaState === 'loading' ? <p role="status">{t('Loading media...', 'جار تحميل الوسائط...')}</p> : null}
        {mediaState === 'error' ? <p>{t('Media could not be loaded.', 'تعذر تحميل الوسائط.')}</p> : null}
        {mediaSrc ? <img src={mediaSrc} alt={t('Reported media', 'الوسائط المبلغ عنها')} style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 12 }} data-testid="img-moderation-media" /> : null}
        <div style={{ display: 'grid', gap: 8, margin: '8px 0' }}>
          {Object.entries(target.data).map(([k, v]) => (
            <div key={k}><strong>{k}</strong><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }} dir="auto">{show(v)}</div></div>
          ))}
        </div>
        <h3>{t('Audit history', 'سجل المراجعة')}</h3>
        {data && data.history.length ? <ol style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 6, fontSize: 12 }} data-testid="list-moderation-history">
          {data.history.map((h) => (
            <li key={h.id}><strong>{h.action}</strong> · {new Date(h.createdAt).toLocaleString(ar ? 'ar' : 'en')} · {h.adminUserId}
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} dir="auto">{h.note}</div>
              {h.previousState && h.newState && <details><summary>{t('Before and after', 'الحالة قبل وبعد')}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} dir="ltr">{show(h.previousState)}{' → '}{show(h.newState)}</pre>
              </details>}</li>
          ))}
        </ol> : <p>{t('No actions taken yet.', 'لم يتم اتخاذ أي إجراء بعد.')}</p>}

        {success ? <p role="status" data-testid="status-moderation-success">{success}</p> : null}
        {target.protectedAccount ? <p data-testid="text-moderation-protected">{t('This account is protected, so account actions are disabled.', 'هذا الحساب محمي، لذلك تم تعطيل إجراءات الحساب.')}</p> : null}

        <label htmlFor={`mod-reason-${reportId}`}>{t('Reason (required)', 'السبب (مطلوب)')}</label>
        <textarea id={`mod-reason-${reportId}`} value={reason} maxLength={MAX_REASON + 200} rows={3} disabled={sending}
          onChange={(e) => setReason(e.target.value)} style={{ width: '100%' }} data-testid="input-moderation-reason" />
        <p aria-live="polite">{trimmed.length}/{MAX_REASON}{trimmed.length > MAX_REASON ? ` · ${t('Too long', 'طويل جدا')}` : ''}</p>
        {actions.map((a) => {
          const blocked = isAccount(a) && target.protectedAccount;
          return <button key={a} type="button" className={`approved-button wide${a.startsWith('restore') || a === 'unsuspend_user' ? '' : ' danger'}`}
            disabled={!reasonValid || blocked || sending} onClick={() => { setActionError(''); setSuccess(''); setPending(a); }}
            data-testid={`button-moderation-${a}`}>{labels[a][ar ? 1 : 0]}</button>;
        })}

        {pending ? <div className="approved-panel admin-confirm" role="alertdialog" aria-modal="true" aria-label={labels[pending][ar ? 1 : 0]} data-testid="dialog-moderation-confirm">
          <h3>{labels[pending][ar ? 1 : 0]}?</h3>
          <p>{isAccount(pending)
            ? t(`This affects the account that owns ${target.targetType} ${target.targetId} (creator ${target.creatorId}).`, `يؤثر هذا على الحساب المالك لـ${typeLabel[target.targetType][1]} ${target.targetId} (المبدع ${target.creatorId}).`)
            : t(`This affects ${target.targetType} ${target.targetId}.`, `يؤثر هذا على ${typeLabel[target.targetType][1]} ${target.targetId}.`)}</p>
          <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{trimmed}</p>
          <p>{t('The action is logged and can be reversed.', 'يتم تسجيل الإجراء ويمكن التراجع عنه.')}</p>
          {actionError ? <p role="alert" data-testid="status-moderation-action-error">{actionError}</p> : null}
          <div className="admin-confirm-actions">
            <button type="button" className="approved-button" disabled={sending} onClick={() => { setPending(null); setActionError(''); }} data-testid="button-moderation-cancel">{t('Cancel', 'إلغاء')}</button>
            <button type="button" className="approved-button primary" disabled={sending || !reasonValid} onClick={() => void submit()} data-testid="button-moderation-confirm">
              {sending ? t('Working...', 'جار التنفيذ...') : actionError ? t('Retry', 'إعادة المحاولة') : t('Confirm', 'تأكيد')}</button>
          </div>
        </div> : null}
      </> : null}
    </section>
  );
}

export default AdminModerationActions;
