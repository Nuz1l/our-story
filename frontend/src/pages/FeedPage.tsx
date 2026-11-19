import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  CalendarDays,
  Heart,
  Plus,
  Sparkles,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  Category,
  Page,
  Post,
  Profile,
  SiteInfo,
  User,
} from "../lib/types";
import { PostCard } from "../components/PostCard";

function daysSince(value: string | null) {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
}
function startDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function PostSkeleton() {
  return (
    <div className="post-skeleton" aria-label="Загружаем воспоминания">
      <span className="skeleton-avatar" />
      <div>
        <span className="skeleton-line short" />
        <span className="skeleton-line" />
        <span className="skeleton-line medium" />
        <span className="skeleton-photo" />
      </div>
    </div>
  );
}

export function FeedPage({
  site,
  user,
  story = false,
}: {
  site: SiteInfo;
  user?: User;
  story?: boolean;
}) {
  const [sort, setSort] = useState(story ? "story" : "new");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<Profile[]>("/profiles").then((r) => r.data),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories").then((r) => r.data),
  });
  const posts = useInfiniteQuery({
    queryKey: ["posts", story, sort, author, category],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api
        .get<Page<Post>>("/posts", {
          params: {
            sort,
            timeline_only: story,
            author_id: author || undefined,
            category_id: category || undefined,
            limit: 20,
            offset: pageParam,
          },
        })
        .then((r) => r.data),
    getNextPageParam: (last, pages) =>
      pages.length * 20 < last.total ? pages.length * 20 : undefined,
  });
  const items = posts.data?.pages.flatMap((page) => page.items) || [];
  useEffect(() => {
    if (!sentinel.current || !posts.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !posts.isFetchingNextPage)
          posts.fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [posts.hasNextPage, posts.isFetchingNextPage, posts.fetchNextPage]);
  const days = daysSince(site.relationship_start);
  return (
    <div className="content-shell">
      <div className="feed-column">
        <section className="hero-card">
          <div className="hero-decoration">✳</div>
          <p className="eyebrow">
            {story ? "История по датам событий" : "Наш личный мир"}
          </p>
          <h1>
            {story ? (
              <>
                Всё началось
                <br />
                <em>с одного момента.</em>
              </>
            ) : (
              <>
                История, которую
                <br />
                <em>мы пишем вместе.</em>
              </>
            )}
          </h1>
          <p className="hero-description">
            {story
              ? "От первых встреч до сегодняшнего дня — каждый момент здесь на своём месте."
              : site.hero_text}
          </p>
          <div className="hero-people">
            <div className="avatar-pair">
              <span>
                {profiles.data?.[0]?.avatar_url ? (
                  <img src={profiles.data[0].avatar_url} alt="" />
                ) : (
                  site.primary_name.charAt(0)
                )}
              </span>
              <span>
                {profiles.data?.[1]?.avatar_url ? (
                  <img src={profiles.data[1].avatar_url} alt="" />
                ) : (
                  site.secondary_name.charAt(0)
                )}
              </span>
            </div>
            <strong>
              {site.primary_name} <span className="amp">&</span>{" "}
              {site.secondary_name}
            </strong>
          </div>
          {days !== null && (
            <div className="days-together">
              <Heart size={17} fill="currentColor" />
              <strong>{days.toLocaleString("ru-RU")}</strong>
              <span>дней вместе</span>
              <small>с {startDate(site.relationship_start!)}</small>
            </div>
          )}
        </section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {story ? "От начала до сегодня" : "Последние моменты"}
            </p>
            <h2>{story ? "Наша история" : "Лента воспоминаний"}</h2>
          </div>
          {user?.access_granted &&
            ["admin", "super_admin"].includes(user.role) && (
              <Link to="/admin/posts/new" className="button primary small">
                <Plus size={17} /> Добавить
              </Link>
            )}
        </div>
        <div className="feed-filters">
          <div
            className="pill-group"
            role="group"
            aria-label="Порядок публикаций"
          >
            <button
              className={sort === "new" ? "active" : ""}
              onClick={() => setSort("new")}
            >
              Новые
            </button>
            <button
              className={sort === "old" ? "active" : ""}
              onClick={() => setSort("old")}
            >
              Старые
            </button>
            <button
              className={sort === "story" ? "active" : ""}
              onClick={() => setSort("story")}
            >
              По дате события
            </button>
          </div>
          <div className="select-row">
            <select
              aria-label="Автор"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            >
              <option value="">Все авторы</option>
              {profiles.data?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Категория"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Все темы</option>
              {categories.data?.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="timeline-list">
          {posts.isLoading && (
            <>
              <PostSkeleton />
              <PostSkeleton />
            </>
          )}
          {posts.isError && (
            <div className="empty-state">
              Не удалось загрузить публикации. Обновите страницу.
            </div>
          )}
          {!posts.isLoading && items.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">
                <Heart size={26} />
              </div>
              <h3>История начинается здесь</h3>
              <p>Публикаций пока нет. Первое воспоминание скоро появится.</p>
              {user?.access_granted &&
                ["admin", "super_admin"].includes(user.role) && (
                  <Link className="button primary" to="/admin/posts/new">
                    Создать первое воспоминание
                  </Link>
                )}
            </div>
          )}
          {items.map((post) => (
            <PostCard key={post.id} post={post} user={user} />
          ))}
        </div>
        <div ref={sentinel} aria-hidden="true" />
        {posts.hasNextPage && (
          <button
            className="button outline wide"
            onClick={() => posts.fetchNextPage()}
          >
            <ArrowDown size={17} />{" "}
            {posts.isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
          </button>
        )}
      </div>
      <aside className="right-rail">
        <div className="rail-card quote-card">
          <span className="quote-mark">“</span>
          <p>Самые тёплые истории состоят из маленьких моментов.</p>
          <span className="eyebrow">Our Memories</span>
        </div>
        <div className="rail-card">
          <p className="eyebrow">Исследовать</p>
          <Link to="/story">
            <Sparkles size={18} /> Наша история <span>→</span>
          </Link>
          <Link to="/calendar">
            <CalendarDays size={18} /> Календарь <span>→</span>
          </Link>
        </div>
        <div className="rail-note">
          <Heart size={15} /> Бережно храним то, что важно
        </div>
      </aside>
    </div>
  );
}

export function PostPage({ user }: { user?: User }) {
  const { id } = useParams();
  const post = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<Post>(`/posts/${id}`).then((r) => r.data),
    enabled: !!id,
  });
  return (
    <div className="single-post-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={17} /> К ленте
      </Link>
      {post.isLoading && (
        <div className="empty-state">Загружаем воспоминание…</div>
      )}
      {post.isError && (
        <div className="empty-state">Воспоминание недоступно.</div>
      )}
      {post.data && <PostCard post={post.data} user={user} full />}
    </div>
  );
}
