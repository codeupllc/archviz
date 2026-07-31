import type { HobbyCompatibility } from '@archviz/provider-aws';
import type { LocalstackHealth, PlanStatus } from './usePlanRunner';

export interface TerraformToolbarProps {
  blocked: boolean;
  layoutBlocked: boolean;
  connected: boolean;
  running: boolean;
  status: PlanStatus;
  terraformVersion: string | null;
  /** Runner base URL (e.g. http://127.0.0.1:4180) — for status chips. */
  runnerUrl?: string;
  runnerDir: string | null;
  localstack: LocalstackHealth | null;
  hobby: HobbyCompatibility;
  canPickLocation: boolean;
  onPlan: () => void;
  onLocalstackApply: () => void;
  onLocalstackDestroy: () => void;
  onStartLocalstack?: () => void;
  onExport: () => void;
  onSaveAs?: () => void;
  /** Hide the top "Terraform" title when the parent already labels the section. */
  hideTitle?: boolean;
  /** Minimal chrome — parent owns badges/status (e.g. Live Terraform stage). */
  compact?: boolean;
}

function lsStatusLabel(ls: LocalstackHealth | null, connected: boolean): string {
  if (!connected) return 'runner offline';
  if (!ls) return 'unknown';
  if (!ls.dockerAvailable) return 'Docker missing';
  if (ls.running && ls.dockerSockMounted === false) return 'needs Docker socket';
  if (ls.running && ls.healthy) return 'running';
  if (ls.running) return 'starting…';
  if (!ls.authTokenConfigured) return 'needs auth token';
  return 'stopped';
}

/**
 * Grouped Terraform actions: Plan (real AWS creds) vs LocalStack apply/destroy,
 * plus export. Avoids a single crowded button row.
 */
export function TerraformToolbar(props: TerraformToolbarProps) {
  const {
    blocked,
    layoutBlocked,
    connected,
    running,
    status,
    terraformVersion,
    runnerUrl,
    runnerDir,
    localstack,
    hobby,
    canPickLocation,
    onPlan,
    onLocalstackApply,
    onLocalstackDestroy,
    onStartLocalstack,
    onExport,
    onSaveAs,
    hideTitle = false,
    compact = false,
  } = props;

  const planBusy = status === 'planning' || status === 'initializing';
  const applyBusy = status === 'applying';
  const destroyBusy = status === 'destroying';
  const startBusy = status === 'starting';

  const planEnabled = !blocked && !layoutBlocked && connected && !running;
  const lsEnabled = planEnabled && hobby.ok;
  const lsRunning = Boolean(localstack?.running && localstack.healthy);
  const showHobbyBadge = !hobby.ok && !hobby.paidEntitlements;
  const showPaidBadge = hobby.paidEntitlements;

  const planTitle = layoutBlocked
    ? 'Plan is not available for the multi-service layout — switch to single file or by category'
    : !connected
      ? 'Start the local runner first: pnpm runner'
      : blocked
        ? 'Fix errors before planning'
        : terraformVersion === null
          ? 'Runner is connected but terraform was not found on its PATH'
          : `terraform plan in ${runnerDir ?? 'workspace'}`;

  const applyTitle = layoutBlocked
    ? 'LocalStack apply is not available for the multi-service layout'
    : !connected
      ? 'Start the local runner first: pnpm runner (Docker required)'
      : blocked
        ? 'Fix errors before applying'
        : !hobby.ok
          ? (hobby.message ?? 'Diagram has resources outside LocalStack Hobby')
          : 'Apply to LocalStack (emulated AWS — never real cloud)';

  return (
    <div className={`tf-toolbar${compact ? ' tf-toolbar--compact' : ''}`}>
      {!hideTitle && !compact && (
        <div className="tf-toolbar__title-row">
          <span className="tf-toolbar__title">Terraform</span>
          <div className="tf-toolbar__badges">
            {blocked && <span className="code-panel__badge">errors</span>}
            {showHobbyBadge && (
              <span
                className="code-panel__badge code-panel__badge--hobby"
                title={
                  hobby.message ??
                  'LocalStack Hobby — set LOCALSTACK_AUTH_TOKEN for Ultimate services'
                }
              >
                Hobby
              </span>
            )}
            {showPaidBadge && (
              <span
                className="code-panel__badge code-panel__badge--paid"
                title="LOCALSTACK_AUTH_TOKEN detected — Ultimate-class palette types allowed"
              >
                Token
              </span>
            )}
          </div>
        </div>
      )}

      {hideTitle && !compact && blocked && (
        <div className="tf-toolbar__badges tf-toolbar__badges--inline">
          <span className="code-panel__badge">errors</span>
        </div>
      )}
      {hideTitle && !compact && showHobbyBadge && (
        <div className="tf-toolbar__badges tf-toolbar__badges--inline">
          <span
            className="code-panel__badge code-panel__badge--hobby"
            title={
              hobby.message ??
              'LocalStack Hobby — auth token required for Ultimate services'
            }
          >
            Hobby
          </span>
        </div>
      )}
      {hideTitle && !compact && showPaidBadge && (
        <div className="tf-toolbar__badges tf-toolbar__badges--inline">
          <span
            className="code-panel__badge code-panel__badge--paid"
            title="LOCALSTACK_AUTH_TOKEN detected — Ultimate-class palette types allowed"
          >
            Token
          </span>
        </div>
      )}

      <div className="tf-toolbar__group">
        <div className="tf-toolbar__group-label">
          <span>Validate</span>
          <span className="tf-toolbar__meta">
            {connected ? (terraformVersion ?? 'no terraform') : 'runner offline'}
            {runnerUrl ? ` · ${runnerUrl.replace(/^https?:\/\//, '')}` : ''}
          </span>
        </div>
        <div className="tf-toolbar__row">
          <button
            type="button"
            className="btn"
            disabled={!planEnabled}
            onClick={onPlan}
            title={planTitle}
          >
            {planBusy ? 'Planning…' : 'Plan'}
          </button>
          <div className="tf-toolbar__spacer" />
          {canPickLocation && onSaveAs && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={blocked}
              onClick={onSaveAs}
              title="Pick a different export folder"
            >
              Save As…
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={blocked}
            onClick={onExport}
            title={
              blocked
                ? 'Fix errors before exporting'
                : canPickLocation
                  ? 'Save generated Terraform'
                  : 'Download generated Terraform'
            }
          >
            Export
          </button>
        </div>
      </div>

      <div className="tf-toolbar__group">
        <div className="tf-toolbar__group-label">
          <span>LocalStack</span>
          <span
            className={`tf-toolbar__meta tf-toolbar__meta--dot ${lsRunning ? 'tf-toolbar__meta--ok' : ''}`}
          >
            {lsStatusLabel(localstack, connected)}
            {localstack?.image ? ` · ${localstack.image.replace(/^localstack\/localstack:/, '')}` : ''}
          </span>
        </div>
        <div className="tf-toolbar__row">
          {onStartLocalstack && connected && !lsRunning && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={running || !localstack?.dockerAvailable}
              onClick={onStartLocalstack}
              title={
                !localstack?.dockerAvailable
                  ? 'Install Docker to run LocalStack'
                  : 'Start LocalStack container on :4566'
              }
            >
              {startBusy ? 'Starting…' : 'Start'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={!lsEnabled}
            onClick={onLocalstackApply}
            title={applyTitle}
          >
            {applyBusy ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!lsEnabled}
            onClick={onLocalstackDestroy}
            title="Destroy this diagram’s LocalStack workspace only"
          >
            {destroyBusy ? 'Destroying…' : 'Destroy'}
          </button>
        </div>
      </div>

      {!hobby.ok && hobby.message && (
        <div className="code-panel__hobby-hint" role="status">
          {hobby.message}
        </div>
      )}
      {hobby.ok && connected && localstack && !localstack.dockerAvailable && (
        <div className="code-panel__hobby-hint" role="status">
          Docker is required for LocalStack. Install Docker Desktop, then restart the runner.
        </div>
      )}
      {hobby.ok &&
        connected &&
        localstack?.running &&
        localstack.dockerSockMounted === false && (
          <div className="code-panel__hobby-hint" role="status">
            LocalStack is missing the Docker socket mount — ECS/Lambda will fail with “Docker not
            available”. Apply or Start will recreate the container with{' '}
            <code>/var/run/docker.sock</code> mounted.
          </div>
        )}
      {hobby.ok && connected && localstack?.message && !localstack.healthy && localstack.message.includes('AUTH_TOKEN') && (
        <div className="code-panel__hobby-hint" role="status">
          {localstack.message}
        </div>
      )}
    </div>
  );
}
