import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { api } from "../lib/api";
import type { Post, User } from "../lib/types";
import { PostCard } from "../components/PostCard";

export function SavedPage({ user }: { user: User }) {
  const saved = useQuery({
    queryKey: ["bookmarks"],
    queryFn: () => api.get<Post[]>("/bookmarks").then((r) => r.data),
  });
  return (
    <div className="standard-page narrow">
      <div className="page-intro">
        <span className="page-icon">
          <Bookmark size={22} />
        </span>
        <p className="eyebrow">Самое дорогое</p>
        <h1>Избранное</h1>
        <p>Воспоминания, которые хочется держать рядом.</p>
      </div>
      {saved.isLoading && (
        <div className="empty-state">Загружаем избранное…</div>
      )}
      {saved.data?.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <Bookmark />
          </div>
          <h3>Пока здесь пусто</h3>
          <p>Нажмите на значок закладки у публикации, чтобы сохранить её.</p>
        </div>
      )}
      <div className="timeline-list">
        {saved.data?.map((post) => (
          <PostCard key={post.id} post={post} user={user} />
        ))}
      </div>
    </div>
  );
}
