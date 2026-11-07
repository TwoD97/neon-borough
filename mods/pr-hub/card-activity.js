import { orderedRuns, runState, position } from './flow.js';

// Keep finished PRs in the tracker's short-lived cache for chained workflows
// and open details, but remove them from the active inbox and filter counts.
export function isActiveCard(card) {
  const state=String(card.pr?.state ?? '').toUpperCase();
  if(state === 'CLOSED')return false;
  if(state !== 'MERGED')return true;
  const flow=card.flow, runs=flow?.runs ?? [];
  if(!runs.length)return Boolean(flow?.active);
  return runs.some(run=>!['ok','skipped'].includes(runState(run)));
}

// CI belongs to the PR head; after merging, show Actions on the merge commit.
// A finished merge is not evidence that those workflows have finished.
export function cardActivity(card, t) {
  const state = String(card.pr?.state ?? '').toUpperCase();
  if (state === 'CLOSED') return null;
  if (state === 'MERGED') {
    const flow = card.flow;
    if (!flow) return null;
    const runs = orderedRuns(flow.runs);
    if (!runs.length) return flow.active
      ? {icon:'spinner',tone:'run',label:t('flow_checking_short'),detail:t('flow_checking'),moving:true}
      : null;
    const states = runs.map(runState);
    const failed = states.includes('bad');
    const running = states.includes('running');
    const queued = states.includes('queued');
    const waiting = states.includes('waiting');
    const cancelled = states.includes('cancelled');
    const kind = running ? 'running' : waiting ? 'waiting' : queued ? 'queued' : failed ? 'failed' : cancelled ? 'cancelled' : 'finished';
    const detail = runs.map(run => {
      const at = position(flow.jobs?.[run.id]?.jobs);
      return `${run.name}: ${runState(run)}${at ? ` · ${at.job}${at.step ? ` / ${at.step}` : ''}` : ''}`;
    }).join('\n');
    return {
      icon:running ? 'spinner' : failed ? 'cross' : kind === 'finished' ? 'check' : 'pending',
      tone:failed ? 'bad' : running ? 'run' : waiting || queued ? 'warn' : cancelled ? 'dim' : 'ok',
      label:t(`flow_${kind}_short`) + (failed && (running || queued || waiting) ? ' !' : ''),
      detail,moving:running,
    };
  }
  const ci = card.status?.ci;
  const checks = [...(ci?.checks ?? []), ...(ci?.ai ?? [])].filter(check => check.state === 'running');
  if (ci?.kind !== 'running' && !checks.length) return null;
  const failed = ci?.kind === 'failed';
  return {icon:'spinner',tone:failed ? 'bad' : 'run',label:t(checks.length ? 'flow_running_short' : 'flow_checking_short') + (failed ? ' !' : ''),
    detail:checks.map(check=>check.name).join('\n') || t('ci_running'),moving:true};
}
