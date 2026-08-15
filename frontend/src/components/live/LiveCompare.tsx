import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { TestResult } from '../../types';
import { useLiveSession } from '../../live/useLiveSession';
import { SessionStartForm } from './SessionStartForm';
import { LivePane } from './LivePane';
import { CaptureBar } from './CaptureBar';
import { PaneDialog } from './PaneDialog';
import { AlertCircle } from 'lucide-react';

interface Props {
  onResult: (result: TestResult) => void;
}

/**
 * Live-mode root (FR-63…FR-75).
 *
 * Results are handed straight up to App's shared `results` array and render
 * through the EXISTING, UNMODIFIED ResultCard — toApiUrls() on the backend
 * gives them exactly the shape it already receives (FR-69).
 */
export function LiveCompare({ onResult }: Props) {
  const live = useLiveSession(onResult);

  useEffect(() => {
    if (!live.error) return;
    toast.error(`${live.error.code}: ${live.error.message}`, { duration: 6000 });
    live.clearError();
  }, [live.error]);

  if (!live.session) {
    return <SessionStartForm onStart={(req) => void live.start(req)} starting={live.starting} />;
  }

  const { session } = live;

  return (
    <div className="space-y-4">
      <CaptureBar
        capturing={live.capturing}
        stage={live.stage}
        sizes={live.sizes}
        onCapture={(opts) => {
          void live.capture(opts).then((result) => {
            if (result) {
              toast.success(
                `${result.classification.classification.replace('_', ' ')} — ${result.classification.diff_percentage.toFixed(2)}% changed`
              );
            }
          });
        }}
        onClose={() => void live.close()}
      />

      {/* Two 1280px panes need far more room than the upload view's max-w-6xl. */}
      <div className="relative grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(['before', 'after'] as const).map((side) => (
          <LivePane
            key={side}
            side={side}
            label={side === 'before' ? 'Reference / stage' : 'Candidate / dev'}
            sessionId={session.sessionId}
            viewport={session.viewport}
            state={session.panes[side]}
            dimmed={live.capturing}
            onNavigate={(url) => live.navigate(side, url)}
            onHistory={(action) => live.history(side, action)}
            sendInput={(event) => live.sendInput(side, event)}
          />
        ))}

        {live.dialog && <PaneDialog dialog={live.dialog} onRespond={live.respondToDialog} />}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-slate-500">
        <AlertCircle size={13} className="mt-px shrink-0" />
        <span>
          Session <code className="text-slate-600">{session.sessionId}</code> · idle deadline{' '}
          {new Date(session.expiresAt).toLocaleTimeString()}. Panes use isolated browser contexts, so
          logging into one never touches the other&apos;s cookies (FR-66).
        </span>
      </div>
    </div>
  );
}
