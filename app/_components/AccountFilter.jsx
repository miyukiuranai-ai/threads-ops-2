import Link from 'next/link';

/** ページ上部の名義の絞り込み表示 */
export default function AccountFilter({ selected, base }) {
  if (!selected) return null;
  return (
    <p className="muted">名義 <b>@{selected.name}</b> で絞り込み中。<Link href={base}>すべて表示</Link></p>
  );
}
