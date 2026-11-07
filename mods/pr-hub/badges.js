import { cardActivity } from './card-activity.js';
// Three stable slots: checks/workflows, review, merge. Missing data never becomes a checkmark.
export function compactBadges(card, t) {
  const status = card.status ?? {}, pr = card.pr ?? {};
  const ci = {
    passed: ['check', 'ok', 'ci_passed'], failed: ['cross', 'bad', 'ci_failed'],
    running: ['spinner', 'run', 'ci_running'], none: ['pending', 'dim', 'ci_none'],
  }[status.ci?.kind] ?? ['pending', 'dim', 'ci_none'];
  const review = {
    approved: ['check', 'ok', 'r_approved'], reviewed: ['check', 'ok', 'r_reviewed'],
    changes: ['cross', 'bad', 'r_changes'], ai_running: ['spinner', 'run', 'r_ai'],
    required: ['pending', 'wait', 'r_wait'], none: ['pending', 'dim', 'r_none'],
  }[status.review] ?? ['pending', 'dim', 'r_none'];
  let merge = ['pending', 'dim', 'merge'];
  if (status.name === 'merged') merge = ['check', 'merged', 'merged'];
  else if (status.name === 'closed') merge = ['cross', 'dim', 'closed'];
  else if (status.name === 'draft') merge = ['pending', 'dim', 'draft'];
  else if (status.name === 'conflict' || pr.mergeable === 'CONFLICTING') merge = ['cross', 'bad', 'conflict'];
  else if (pr.mergeStateStatus === 'BEHIND') merge = ['pending', 'warn', 'behind'];
  else if (pr.mergeStateStatus === 'BLOCKED') merge = ['cross', 'warn', 'blocked'];
  else if (status.name === 'ready' && pr.mergeable === 'MERGEABLE') merge = ['check', 'merge', 'ready'];
  const badges = [ci, review, merge].map(([icon, tone, key], i) => ({
    icon, tone, label: `${t(['ci', 'review', 'merge'][i])}: ${t(key)}`,
  }));
  const activity = cardActivity(card,t);
  if (String(pr.state).toUpperCase() === 'MERGED' && activity)
    badges[0] = {...activity,label:`${activity.label}\n${activity.detail}`};
  return badges;
}
