import { Bookmark } from 'lucide-react';
import { useBookmarks } from '../store/bookmarks';
import { cn } from '../lib/cn';

type BookmarkButtonProps = {
  problemKey: string;
  className?: string;
};

export function BookmarkButton({ problemKey, className }: BookmarkButtonProps) {
  const { toggle, has } = useBookmarks();
  const isBookmarked = has(problemKey);

  return (
    <button
      onClick={() => toggle(problemKey)}
      className={cn(
        'shrink-0 rounded-lg p-1.5 transition',
        isBookmarked ? 'text-gold' : 'text-muted hover:text-text',
        className,
      )}
      title={isBookmarked ? 'ブックマーク解除' : 'ブックマーク'}
    >
      <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
    </button>
  );
}
