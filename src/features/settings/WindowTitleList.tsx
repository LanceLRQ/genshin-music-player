import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WindowTitleListProps {
  titles: string[];
  onChange: (titles: string[]) => void;
}

/** 游戏窗口标题列表：每个标题一个可删除的徽章，至少保留一个 */
export function WindowTitleList({ titles, onChange }: WindowTitleListProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const title = text.trim();
    if (!title) return;
    if (titles.includes(title)) {
      toast.info('这个标题已经存在');
      return;
    }
    onChange([...titles, title]);
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {titles.map((title, index) => (
        <Badge key={title} variant="secondary">
          {title}
          <button
            type="button"
            aria-label={`删除标题 ${title}`}
            disabled={titles.length <= 1}
            className="ml-1 disabled:opacity-40"
            onClick={() => onChange(titles.filter((_, i) => i !== index))}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        ref={inputRef}
        value={text}
        placeholder="添加标题…"
        aria-label="新窗口标题"
        className="h-8 w-36"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
        }}
      />
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={add}>
        添加
      </Button>
    </div>
  );
}
