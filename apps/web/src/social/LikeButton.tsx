import {useState} from 'react';
import {Heart} from 'lucide-react';
import {request} from '../api';

/**
 * Public like toggle. Only rendered for a signed-in viewer on a visible public
 * item; the server re-checks visibility on every request.
 */
export function LikeButton({lessonId, initialLiked, initialCount, disabled = false}: {
  lessonId: string; initialLiked: boolean; initialCount: number; disabled?: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = async () => {
    setBusy(true); setError('');
    try {
      const value = liked
        ? await request<{liked: boolean; like_count: number}>(`/social/moves/${encodeURIComponent(lessonId)}/like`, 'DELETE', {})
        : await request<{liked: boolean; like_count: number}>(`/social/moves/${encodeURIComponent(lessonId)}/like`, 'PUT', {});
      setLiked(value.liked);
      setCount(value.like_count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That like could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return <span className="like-control">
    <button type="button" className="secondary" disabled={busy || disabled}
      aria-pressed={liked} aria-label={liked ? 'Remove like' : 'Like this lesson'}
      onClick={() => void toggle()}>
      <Heart size={16} fill={liked ? 'currentColor' : 'none'}/>{count}
    </button>
    {error && <span className="small muted" role="status">{error}</span>}
  </span>;
}
