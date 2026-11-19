import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  Check,
  Clipboard,
  FileImage,
  Heart,
  Image,
  MessageCircle,
  Plus,
  Settings,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type {
  Category,
  Comment,
  Page,
  Post,
  Profile,
  SiteInfo,
  User,
} from "../lib/types";
import { PostEditor } from "./PostEditor";
import { CategoryAdmin } from "./CategoryAdmin";
import { BrandingAdmin } from "./BrandingAdmin";

const adminNav = [
  { to: "/admin", label: "Обзор", icon: BarChart3, end: true },
  { to: "/admin/posts", label: "Публикации", icon: BookOpen },
  { to: "/admin/profiles", label: "Авторы", icon: UserRound },
  { to: "/admin/categories", label: "Категории", icon: BookOpen },
  { to: "/admin/comments", label: "Комментарии", icon: MessageCircle },
  { to: "/admin/media", label: "Медиа", icon: FileImage },
  { to: "/admin/settings", label: "Настройки", icon: Settings },
  { to: "/admin/branding", label: "Оформление", icon: Image },
  { to: "/admin/users", label: "Участники", icon: Users },
];

export function AdminPage({ user }: { user: User }) {
  return (
    <div className="admin-shell">
      <div className="admin-heading">
        <p className="eyebrow">Пространство для управления</p>
        <h1>Админ-панель</h1>
      </div>
      <nav className="admin-nav" aria-label="Разделы управления">
        {adminNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="posts" element={<PostsAdmin />} />
        <Route path="posts/new" element={<PostEditor />} />
        <Route path="posts/:id/edit" element={<PostEditor />} />
        <Route path="profiles" element={<ProfilesAdmin />} />
        <Route path="categories" element={<CategoryAdmin />} />
        <Route path="comments" element={<CommentsAdmin />} />
        <Route path="media" element={<MediaAdmin />} />
        <Route path="settings" element={<SettingsAdmin user={user} />} />
        <Route
          path="branding"
          element={
            user.role === "super_admin" ? (
              <BrandingAdmin />
            ) : (
              <div className="empty-state">
                Этот раздел доступен главному администратору.
              </div>
            )
          }
        />
        <Route path="users" element={<UsersAdmin user={user} />} />
      </Routes>
    </div>
  );
}

type Stats = {
  posts: number;
  photos: number;
  videos: number;
  comments: number;
  reactions: number;
  drafts: number;
  scheduled: number;
  recent_actions: { action: string; entity_type: string; created_at: string }[];
  recent_comments: Comment[];
};
function Dashboard() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<Stats>("/admin/stats").then((r) => r.data),
  });
  const cards = [
    ["Публикаций", stats.data?.posts, BookOpen],
    ["Фотографий", stats.data?.photos, Image],
    ["Видео", stats.data?.videos, FileImage],
    ["Комментариев", stats.data?.comments, MessageCircle],
    ["Реакций", stats.data?.reactions, Heart],
    ["Черновиков", stats.data?.drafts, Clipboard],
    ["Запланировано", stats.data?.scheduled, CalendarClock],
  ] as const;
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Всё в одном месте</p>
          <h2>Обзор истории</h2>
        </div>
        <Link to="/admin/posts/new" className="button primary">
          <Plus size={18} /> Новая публикация
        </Link>
      </div>
      {stats.isError && (
        <div className="form-error">Не удалось получить статистику.</div>
      )}
      <div className="stat-grid">
        {cards.map(([label, count, Icon]) => (
          <div className="stat-card" key={label}>
            <span className="stat-icon">
              <Icon size={21} />
            </span>
            <strong>{count ?? "—"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="admin-columns">
        <section className="panel">
          <h3>Последние действия</h3>
          {stats.data?.recent_actions.length === 0 && (
            <p className="muted">Действий пока нет.</p>
          )}
          {stats.data?.recent_actions.map((x, i) => (
            <div className="activity-row" key={i}>
              <span className="activity-dot" />
              <span>
                {x.action} · {x.entity_type}
              </span>
              <time>
                {new Intl.DateTimeFormat("ru-RU", {
                  day: "numeric",
                  month: "short",
                }).format(new Date(x.created_at))}
              </time>
            </div>
          ))}
        </section>
        <section className="panel">
          <h3>Последние комментарии</h3>
          {stats.data?.recent_comments.length === 0 && (
            <p className="muted">Комментариев пока нет.</p>
          )}
          {stats.data?.recent_comments.map((x) => (
            <div className="activity-row" key={x.id}>
              <span className="comment-avatar mini">
                {x.author_name.charAt(0)}
              </span>
              <span>
                <strong>{x.author_name}</strong>
                <small>{x.content}</small>
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function PostsAdmin() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("new");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const posts = useQuery({
    queryKey: [
      "admin-posts",
      q,
      status,
      author,
      category,
      dateFrom,
      dateTo,
      sort,
    ],
    queryFn: () =>
      api
        .get<Page<Post>>("/admin/posts", {
          params: {
            q,
            status,
            sort,
            limit: 200,
            author_id: author || undefined,
            category_id: category || undefined,
            event_date_from: dateFrom || undefined,
            event_date_to: dateTo || undefined,
          },
        })
        .then((r) => r.data),
  });
  const profiles = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: () => api.get<Profile[]>("/admin/profiles").then((r) => r.data),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories").then((r) => r.data),
  });
  async function action(
    post: Post,
    kind: "delete" | "archive" | "pin" | "restore",
  ) {
    if (
      kind === "delete" &&
      !window.confirm(
        "Удалить публикацию? Её можно восстановить в разделе удалённых.",
      )
    )
      return;
    try {
      if (kind === "delete") await api.delete(`/posts/${post.id}`);
      else if (kind === "restore") await api.post(`/posts/${post.id}/restore`);
      else
        await api.patch(
          `/posts/${post.id}`,
          kind === "archive"
            ? { status: post.status === "archived" ? "published" : "archived" }
            : { is_pinned: !post.is_pinned },
        );
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function bulk(kind: "archive" | "delete" | "restore") {
    if (!selected.length) return;
    if (
      !window.confirm(
        `${kind === "delete" ? "Удалить" : kind === "restore" ? "Восстановить" : "Архивировать"} ${selected.length} публикаций?`,
      )
    )
      return;
    try {
      for (const id of selected) {
        if (kind === "delete") await api.delete(`/posts/${id}`);
        else if (kind === "restore") await api.post(`/posts/${id}/restore`);
        else await api.patch(`/posts/${id}`, { status: "archived" });
      }
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Истории и моменты</p>
          <h2>Публикации</h2>
        </div>
        <Link to="/admin/posts/new" className="button primary">
          <Plus size={18} /> Новая публикация
        </Link>
      </div>
      <div className="admin-filter-row">
        <input
          placeholder="Поиск по тексту…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск публикаций"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Статус"
        >
          <option value="">Все статусы</option>
          <option value="published">Опубликованы</option>
          <option value="draft">Черновики</option>
          <option value="scheduled">Запланированы</option>
          <option value="archived">Архив</option>
          <option value="deleted">Удалённые</option>
        </select>
        <select
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          aria-label="Автор"
        >
          <option value="">Все авторы</option>
          {profiles.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Категория"
        >
          <option value="">Все категории</option>
          {categories.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Дата события от"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Дата события до"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Сортировка"
        >
          <option value="new">Новые</option>
          <option value="old">Старые</option>
          <option value="event_new">События: новые</option>
          <option value="event_old">События: старые</option>
        </select>
      </div>
      {selected.length > 0 && (
        <div className="bulk-bar">
          <span>Выбрано: {selected.length}</span>
          {status === "deleted" ? (
            <button
              className="button outline small"
              onClick={() => bulk("restore")}
            >
              Восстановить
            </button>
          ) : (
            <>
              <button
                className="button outline small"
                onClick={() => bulk("archive")}
              >
                В архив
              </button>
              <button
                className="button danger small"
                onClick={() => bulk("delete")}
              >
                Удалить
              </button>
            </>
          )}
        </div>
      )}
      {message && <div className="form-error">{message}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Выбрать все"
                  checked={
                    !!posts.data?.items.length &&
                    selected.length === posts.data.items.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? posts.data?.items.map((x) => x.id) || []
                        : [],
                    )
                  }
                />
              </th>
              <th>Публикация</th>
              <th>Автор</th>
              <th>Статус</th>
              <th>Дата</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {posts.data?.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((x) => x !== p.id),
                      )
                    }
                  />
                </td>
                <td>
                  <strong>
                    {p.title || p.content.slice(0, 45) || "Без названия"}
                  </strong>
                  <small>
                    {p.visibility === "public"
                      ? "Публичная"
                      : p.visibility === "invited"
                        ? "По приглашению"
                        : "Приватная"}
                  </small>
                </td>
                <td>{p.author.display_name}</td>
                <td>
                  <span
                    className={`status-badge ${p.deleted_at ? "deleted" : p.status}`}
                  >
                    {p.deleted_at
                      ? "Удалено"
                      : (
                          {
                            draft: "Черновик",
                            published: "Опубликовано",
                            scheduled: "Запланировано",
                            archived: "Архив",
                          } as Record<string, string>
                        )[p.status]}
                  </span>
                </td>
                <td>
                  {new Intl.DateTimeFormat("ru-RU").format(
                    new Date(p.created_at),
                  )}
                </td>
                <td>
                  <div className="table-actions">
                    {p.deleted_at ? (
                      <button onClick={() => action(p, "restore")}>
                        Восстановить
                      </button>
                    ) : (
                      <>
                        <Link
                          className="text-link"
                          to={`/admin/posts/${p.id}/edit`}
                        >
                          Изменить
                        </Link>
                        <button onClick={() => action(p, "pin")}>
                          {p.is_pinned ? "Открепить" : "Закрепить"}
                        </button>
                        <button onClick={() => action(p, "archive")}>
                          {p.status === "archived" ? "Вернуть" : "В архив"}
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => action(p, "delete")}
                        >
                          Удалить
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.data?.items.length === 0 && (
          <div className="empty-state">Публикаций по этому запросу нет.</div>
        )}
      </div>
    </div>
  );
}

function ProfilesAdmin() {
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: () => api.get<Profile[]>("/admin/profiles").then((r) => r.data),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [message, setMessage] = useState("");
  function start(profile?: Profile) {
    setEditing(profile?.id || "new");
    setName(profile?.display_name || "");
    setUsername(profile?.username || "");
    setBio(profile?.bio || "");
    setAvatarId(profile?.avatar_url?.split("/").pop() || null);
    setActive(profile?.is_active ?? true);
    setMessage("");
  }
  async function uploadAvatar(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api.post<{ id: string }>("/admin/media", form);
      setAvatarId(r.data.id);
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = {
        display_name: name,
        username,
        bio,
        avatar_media_id: avatarId,
        is_active: active,
      };
      if (editing === "new") await api.post("/admin/profiles", payload);
      else await api.patch(`/admin/profiles/${editing}`, payload);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Лица нашей истории</p>
          <h2>Авторы</h2>
        </div>
        <button className="button primary" onClick={() => start()}>
          <Plus size={18} /> Добавить автора
        </button>
      </div>
      <div className="profile-grid">
        {profiles.data?.map((p) => (
          <div className="profile-card" key={p.id}>
            <span className="profile-avatar">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt="" />
              ) : (
                p.display_name.charAt(0)
              )}
            </span>
            <h3>{p.display_name}</h3>
            <span className="handle">@{p.username}</span>
            <p>{p.bio || "Автор воспоминаний"}</p>
            <span
              className={`status-badge ${p.is_active ? "published" : "archived"}`}
            >
              {p.is_active ? "Активен" : "Отключён"}
            </span>
            <button className="button outline small" onClick={() => start(p)}>
              Редактировать
            </button>
          </div>
        ))}
      </div>
      {editing && (
        <div className="modal-backdrop">
          <form className="modal-card form-stack" onSubmit={save}>
            <div className="modal-head">
              <h2>
                {editing === "new" ? "Новый автор" : "Редактировать автора"}
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label>
              Имя
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Username
              <input
                required
                pattern="[A-Za-z0-9_.]+"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              О себе
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
              />
            </label>
            <label>
              Аватар
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  e.target.files?.[0] && uploadAvatar(e.target.files[0])
                }
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Активный профиль
            </label>
            {message && <div className="form-error">{message}</div>}
            <button className="button primary wide">Сохранить</button>
          </form>
        </div>
      )}
    </div>
  );
}

function CommentsAdmin() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [message, setMessage] = useState("");
  const comments = useQuery({
    queryKey: ["admin-comments", status, q],
    queryFn: () =>
      api
        .get<Comment[]>("/admin/comments", { params: { status, q } })
        .then((r) => r.data),
  });
  async function moderate(id: string, action: string) {
    try {
      await api.patch(`/admin/comments/${id}/moderate`, null, {
        params: { action },
      });
      queryClient.invalidateQueries({ queryKey: ["admin-comments"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Разговоры</p>
          <h2>Комментарии</h2>
        </div>
      </div>
      <div className="admin-filter-row">
        <input
          placeholder="Поиск по комментариям…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="pending">Ожидают</option>
          <option value="approved">Одобрены</option>
          <option value="hidden">Скрыты</option>
          <option value="spam">Спам</option>
        </select>
      </div>
      {message && <div className="form-error">{message}</div>}
      <div className="comment-moderation-list">
        {comments.data?.map((c) => (
          <div className="moderation-card" key={c.id}>
            <div>
              <strong>{c.author_name}</strong>
              <span className={`status-badge ${c.moderation_status}`}>
                {c.moderation_status}
              </span>
            </div>
            <p>{c.content}</p>
            <div className="moderation-actions">
              <Link to={`/posts/${c.post_id}`} className="text-link">
                К публикации
              </Link>
              <button onClick={() => moderate(c.id, "approve")}>
                <Check size={15} /> Одобрить
              </button>
              <button onClick={() => moderate(c.id, "hide")}>Скрыть</button>
              <button onClick={() => moderate(c.id, "spam")}>Спам</button>
            </div>
          </div>
        ))}
        {comments.data?.length === 0 && (
          <div className="empty-state">Комментариев пока нет.</div>
        )}
      </div>
    </div>
  );
}

type LibraryItem = {
  id: string;
  url: string;
  media_type: "image" | "video";
  original_name: string;
  size_bytes: number;
  usage_count: number;
  created_at: string;
};
function MediaAdmin() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [message, setMessage] = useState("");
  const media = useQuery({
    queryKey: ["admin-media", q, kind],
    queryFn: () =>
      api
        .get<LibraryItem[]>("/admin/media", { params: { q, kind } })
        .then((r) => r.data),
  });
  async function remove(item: LibraryItem) {
    if (!window.confirm(`Удалить ${item.original_name}?`)) return;
    try {
      await api.delete(`/admin/media/${item.id}`);
      queryClient.invalidateQueries({ queryKey: ["admin-media"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Файлы истории</p>
          <h2>Медиатека</h2>
        </div>
      </div>
      <div className="admin-filter-row">
        <input
          placeholder="Поиск по имени файла…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все файлы</option>
          <option value="image">Фото</option>
          <option value="video">Видео</option>
        </select>
      </div>
      {message && <div className="form-error">{message}</div>}
      <div className="media-library">
        {media.data?.map((item) => (
          <div className="library-card" key={item.id}>
            <div className="library-preview">
              {item.media_type === "video" ? (
                <video src={item.url} controls />
              ) : (
                <img src={item.url} alt={item.original_name} />
              )}
            </div>
            <strong title={item.original_name}>{item.original_name}</strong>
            <small>
              {(item.size_bytes / 1024 / 1024).toFixed(2)} МБ ·{" "}
              {item.usage_count} публикаций
            </small>
            <div>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(`${location.origin}${item.url}`)
                    .then(() => setMessage("Ссылка скопирована"))
                }
              >
                <Clipboard size={15} /> Ссылка
              </button>
              <button
                className="danger-text"
                disabled={item.usage_count > 0}
                onClick={() => remove(item)}
              >
                <Trash2 size={15} /> Удалить
              </button>
            </div>
          </div>
        ))}
        {media.data?.length === 0 && (
          <div className="empty-state">Медиафайлов пока нет.</div>
        )}
      </div>
    </div>
  );
}

function SettingsAdmin({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get<SiteInfo>("/admin/settings").then((r) => r.data),
  });
  const [draft, setDraft] = useState<Partial<SiteInfo>>({});
  const [message, setMessage] = useState("");
  const value = { ...settings.data, ...draft };
  function set<K extends keyof SiteInfo>(key: K, val: SiteInfo[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api.patch("/admin/settings", draft);
      setDraft({});
      setMessage("Настройки сохранены");
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  if (user.role !== "super_admin")
    return (
      <div className="admin-content">
        <div className="empty-state">
          Настройки сайта доступны главному администратору.
        </div>
      </div>
    );
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Облик и доступ</p>
          <h2>Настройки сайта</h2>
        </div>
      </div>
      <form className="settings-grid" onSubmit={save}>
        <section className="panel form-stack">
          <h3>О нашей истории</h3>
          <label>
            Название сайта
            <input
              value={value.site_title || ""}
              onChange={(e) => set("site_title", e.target.value)}
            />
          </label>
          <label>
            Описание
            <input
              value={value.site_description || ""}
              onChange={(e) => set("site_description", e.target.value)}
            />
          </label>
          <label>
            Текст на главной
            <textarea
              rows={3}
              value={value.hero_text || ""}
              onChange={(e) => set("hero_text", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Первый участник
              <input
                value={value.primary_name || ""}
                onChange={(e) => set("primary_name", e.target.value)}
              />
            </label>
            <label>
              Второй участник
              <input
                value={value.secondary_name || ""}
                onChange={(e) => set("secondary_name", e.target.value)}
              />
            </label>
          </div>
          <label>
            Дата начала отношений
            <input
              type="date"
              value={value.relationship_start || ""}
              onChange={(e) =>
                set("relationship_start", e.target.value || null)
              }
            />
          </label>
        </section>
        <section className="panel form-stack">
          <h3>Видимость и оформление</h3>
          <label>
            Тема
            <select
              value={value.theme || "light"}
              onChange={(e) =>
                set("theme", e.target.value as SiteInfo["theme"])
              }
            >
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
              <option value="romantic">Романтическая</option>
            </select>
          </label>
          <label className="toggle-line">
            <span>Открыть публичный доступ</span>
            <input
              type="checkbox"
              checked={!!value.site_public}
              onChange={(e) => set("site_public", e.target.checked)}
            />
          </label>
          <p className="muted tiny">
            Гости увидят только публикации с публичной видимостью. Медиа
            приватных постов останутся закрытыми.
          </p>
          <label className="toggle-line">
            <span>Разрешить регистрацию</span>
            <input
              type="checkbox"
              checked={!!value.registration_enabled}
              onChange={(e) => set("registration_enabled", e.target.checked)}
            />
          </label>
          <p className="muted tiny">
            По умолчанию доступ выдаётся только по приглашениям.
          </p>
          <label>
            Логотип (ID медиа)
            <input
              value={value.logo_media_id || ""}
              onChange={(e) => set("logo_media_id", e.target.value || null)}
            />
          </label>
          <label>
            Фоновое изображение (ID медиа)
            <input
              value={value.background_media_id || ""}
              onChange={(e) =>
                set("background_media_id", e.target.value || null)
              }
            />
          </label>
          <label>
            Favicon (ID медиа)
            <input
              value={value.favicon_media_id || ""}
              onChange={(e) => set("favicon_media_id", e.target.value || null)}
            />
          </label>
          {message && (
            <div
              className={
                message === "Настройки сохранены" ? "success-box" : "form-error"
              }
            >
              {message}
            </div>
          )}
          <button
            className="button primary wide"
            disabled={!Object.keys(draft).length}
          >
            Сохранить настройки
          </button>
        </section>
      </form>
    </div>
  );
}

function UsersAdmin({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<User[]>("/admin/users").then((r) => r.data),
  });
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const r = await api.post<{ invite_url: string }>("/admin/invitations", {
        email,
        role,
      });
      setLink(r.data.invite_url);
      setEmail("");
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function update(
    person: User,
    changes: Partial<Pick<User, "role" | "is_active" | "access_granted">>,
  ) {
    if (
      changes.is_active === false &&
      !window.confirm(`Отключить аккаунт ${person.display_name}?`)
    )
      return;
    try {
      await api.patch(`/admin/users/${person.id}`, changes);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Доступ к истории</p>
          <h2>Участники</h2>
        </div>
      </div>
      <div className="admin-columns">
        <section className="panel">
          <h3>Пригласить участника</h3>
          <p className="muted tiny">
            Ссылка действует 7 дней. Отправьте её человеку лично.
          </p>
          <form className="form-stack" onSubmit={invite}>
            <label>
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Роль
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Участник</option>
                {user.role === "super_admin" && (
                  <option value="admin">Администратор</option>
                )}
              </select>
            </label>
            <button className="button primary">Создать приглашение</button>
          </form>
          {link && (
            <div className="invite-result">
              <input readOnly value={link} aria-label="Ссылка приглашения" />
              <button
                className="button outline small"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => setMessage("Ссылка скопирована"))
                }
              >
                Копировать
              </button>
            </div>
          )}
          {message && <p className="muted tiny">{message}</p>}
        </section>
        <section className="panel">
          <h3>Пользователи</h3>
          {users.data?.map((person) => (
            <div className="user-row" key={person.id}>
              <span className="comment-avatar">
                {person.display_name.charAt(0)}
              </span>
              <span>
                <strong>{person.display_name}</strong>
                <small>{person.email}</small>
              </span>
              {user.role === "super_admin" && person.role !== "super_admin" ? (
                <div className="user-row-actions">
                  <select
                    aria-label={`Роль ${person.display_name}`}
                    value={person.role}
                    onChange={(e) =>
                      update(person, { role: e.target.value as User["role"] })
                    }
                  >
                    <option value="member">Участник</option>
                    <option value="admin">Администратор</option>
                  </select>
                  <button
                    onClick={() =>
                      update(person, { access_granted: !person.access_granted })
                    }
                  >
                    {person.access_granted ? "Закрыть доступ" : "Дать доступ"}
                  </button>
                  <button
                    onClick={() =>
                      update(person, { is_active: !person.is_active })
                    }
                  >
                    {person.is_active ? "Отключить" : "Включить"}
                  </button>
                </div>
              ) : (
                <span className="status-badge published">{person.role}</span>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
